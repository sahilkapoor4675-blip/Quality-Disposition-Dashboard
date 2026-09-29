#!/usr/bin/env python3
"""Real-browser regression checks (Chromium via Playwright).

The other gate checks (regression.py, static_checks.py, test_smoke.py) run the
server and read source files, but none of them actually load a page in a
browser -- so a bug that only shows up in the DOM/JS runtime can pass every
other check and still ship. Three bugs found in manual testing were exactly
that kind: the admin sidebar highlighting the wrong section on click, filters
letting you pick a combination with zero overlapping records, and the CSP
tightening in server.py silently breaking an inline onclick="..." handler.
This file drives a real headless Chromium against a real server process and
checks the actual rendered/runtime behaviour, so those regressions fail the
gate instead of reaching production.

Requires the optional `playwright` package with the Chromium browser
installed (`pip install playwright && playwright install chromium`). This is
a dev/CI dependency, not a runtime one -- it is never imported by server.py
-- so run_gate.py adds this check only when both are available, and skips it
(with a visible note, not a silent pass) otherwise.

    python tests/test_browser.py
"""
import os, shutil, subprocess, sys, tempfile, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORT = int(os.environ.get("BROWSER_TEST_PORT", "8799"))
BASE = f"http://127.0.0.1:{PORT}"
ADMIN_USER = "tester"   # NOT "admin": the users table intentionally hides the
                        # reset-password/toggle actions for that literal username,
                        # so a different seed name is needed to test those buttons.
ADMIN_PASS = "Strong-Admin-1234!"


def _start_server(db_path):
    env = os.environ.copy()
    env["DB_PATH"] = str(db_path)          # isolated, disposable copy -- never the real DB
    env["BACKUP_DIR"] = str(db_path.parent / "backups")
    env["ADMIN_USERNAME"] = ADMIN_USER
    env["ADMIN_PASSWORD"] = ADMIN_PASS
    env["APP_VERSION"] = "test"
    env.pop("RENDER", None)
    proc = subprocess.Popen([sys.executable, str(ROOT / "server.py"), str(PORT)], cwd=ROOT,
                             stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env, text=True)
    import urllib.request
    for _ in range(60):
        try:
            urllib.request.urlopen(BASE + "/api/health", timeout=2)
            return proc
        except Exception:
            if proc.poll() is not None:
                out = proc.stdout.read(3000) if proc.stdout else ""
                raise AssertionError("server exited before becoming ready:\n" + out)
            time.sleep(0.2)
    proc.terminate()
    raise AssertionError("server did not become ready in time")


def run():
    from playwright.sync_api import sync_playwright

    tmpdir = Path(tempfile.mkdtemp(prefix="qdash_browser_"))
    db_path = tmpdir / "quality.db"
    shutil.copy2(ROOT / "quality.db", db_path)
    proc = _start_server(db_path)
    violations = []   # CSP violations, collected across the WHOLE run (every page)
    console_errors = []
    page_errors = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(args=["--no-sandbox"])
            context = browser.new_context(viewport={"width": 1440, "height": 900})
            # The real Google Fonts CDN is deliberately unreachable in CI; abort it so
            # the test can't flake on outbound network access it doesn't actually need.
            context.route("**/fonts.g*/**", lambda route: route.abort())

            def watch(page, label):
                page.add_init_script(
                    "document.addEventListener('securitypolicyviolation', e => "
                    "(window.__csp = window.__csp || []).push(e.violatedDirective + ': ' + e.blockedURI));"
                )
                page.on("console", lambda m: console_errors.append(f"{label}: {m.text[:200]}")
                        if m.type == "error" and "ERR_FAILED" not in m.text else None)
                page.on("pageerror", lambda e: page_errors.append(f"{label}: {str(e)[:300]}"))

            def collect_csp(page, label):
                for v in page.evaluate("window.__csp || []"):
                    violations.append(f"{label}: {v}")

            # ---- Dashboard: load, tabs, filter cascade, empty-selection state ----
            page = context.new_page()
            watch(page, "dashboard")
            page.goto(BASE + "/", wait_until="load")
            page.wait_for_timeout(1000)
            page.click("#introDashboardBtn")
            page.wait_for_timeout(2000)
            assert page.locator(".kpi-card").count() >= 8, "dashboard KPI cards did not render"

            for i in range(1, 6):
                page.click(f"#tabs button:nth-child({i})")
                page.wait_for_timeout(600)
            page.click("#tabs button:nth-child(1)")
            page.wait_for_timeout(400)

            # Cascading filters (#4): narrowing one dropdown must narrow the others.
            def options_for(key):
                return page.eval_on_selector_all(
                    f'.filter-field[data-filter-key="{key}"] .filter-options > *',
                    "els => els.map(e => e.textContent)")
            months_before = options_for("month")
            page.click('.filter-field[data-filter-key="quarter"] .filter-trigger')
            page.wait_for_timeout(200)
            page.click('.filter-field[data-filter-key="quarter"] .filter-option[data-value="Q2"]')
            page.wait_for_timeout(1200)
            months_after = options_for("month")
            assert len(months_after) < len(months_before), (
                f"filters did not cascade: month options unchanged after Quarter=Q2 "
                f"({months_before} -> {months_after})")

            # Empty-selection state: an impossible combo must say so, not show fake 0% KPIs.
            page.click('.filter-field[data-filter-key="month"] .filter-trigger')
            page.wait_for_timeout(200)
            # Pick a month NOT in the (already narrowed) list, forcing a zero-overlap combo,
            # by re-selecting a month from the ORIGINAL full list that quarter=Q2 excludes.
            excluded_month = next(m for m in months_before if m not in months_after and m != "All")
            page.evaluate("()=>document.querySelectorAll('.filter-field[data-filter-key=\"month\"] .filter-trigger')[0].click()")
            page.wait_for_timeout(150)
            # The option for excluded_month no longer exists in the (correctly) narrowed
            # dropdown -- which is the #4 fix working. To still exercise the #2 empty-state
            # banner, force the combination directly via the URL (a bookmarked/shared link
            # can still encode a stale combo even though the UI itself now prevents picking one).
            page.keyboard.press("Escape")
            page.goto(f"{BASE}/?month={excluded_month.replace(' ', '%20')}&quarter=Q2")
            page.wait_for_timeout(1800)
            banner = page.inner_text("#periodBanner")
            assert "No records match" in banner, f"empty-selection banner missing, got: {banner!r}"

            collect_csp(page, "dashboard")

            # ---- Admin: login, and every sidebar link must highlight itself ----
            page2 = context.new_page()
            watch(page2, "admin")
            page2.goto(BASE + "/admin", wait_until="load")
            page2.fill("#username", ADMIN_USER)
            page2.fill("#password", ADMIN_PASS)
            page2.click("#loginBtn")
            page2.wait_for_timeout(2000)
            assert page2.eval_on_selector("#loginBox", "el => getComputedStyle(el).display") == "none", \
                "admin login did not succeed"

            mismatches = []
            for link in page2.query_selector_all(".sidebar-link"):
                target = link.get_attribute("data-target")
                link.click()
                page2.wait_for_timeout(1500)
                active = page2.eval_on_selector(".sidebar-link.active", "el => el.dataset.target")
                if active != target:
                    mismatches.append((target, active))
            assert not mismatches, f"admin sidebar highlighted the wrong section: {mismatches}"

            # CSP-safe delegated handlers (#2): users table actions must still work via
            # data-action + addEventListener, not a (now-blocked) onclick="..." attribute.
            # Checked directly on the rendered DOM (not just "does the feature still work")
            # because a stray onclick="..." would be silently inert under this CSP -- the
            # button would still exist and look clickable, it just wouldn't do anything.
            page2.click('.sidebar-link[data-target="usersPanel"]')
            page2.wait_for_timeout(1200)
            reset_btn = page2.query_selector('#usersBody [data-action="reset-user"]')
            assert reset_btn is not None, "reset-user delegated button missing from users table"
            inline_handlers = page2.eval_on_selector_all(
                "#usersBody [onclick]", "els => els.length")
            assert inline_handlers == 0, (
                f"found {inline_handlers} onclick=\"...\" attribute(s) in the users table -- "
                "these are silently blocked by the script-src CSP (no 'unsafe-inline'); "
                "use data-action + addEventListener delegation instead")

            collect_csp(page2, "admin")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(tmpdir, ignore_errors=True)

    assert not violations, "Content-Security-Policy violation(s) at runtime: " + "; ".join(violations)
    assert not page_errors, "Uncaught JS error(s): " + "; ".join(page_errors)
    assert not console_errors, "Browser console error(s): " + "; ".join(console_errors)
    print("BROWSER REGRESSION PASS — dashboard load, all tabs, cascading filters, "
          "empty-selection banner, admin nav highlighting, CSP-safe admin actions; "
          "zero CSP violations / console errors / uncaught JS errors.")


if __name__ == "__main__":
    run()
