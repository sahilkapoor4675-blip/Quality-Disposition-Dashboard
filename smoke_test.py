#!/usr/bin/env python3
"""Non-destructive smoke tests.
Starts the app locally against an isolated, disposable copy of the bundled
database (never the real persistent store), exercises read-only endpoints,
and verifies that the bundled disposition record count has not changed. No
imports/deletes/writes are performed against any real data by this test.
"""
import json, os, shutil, sqlite3, subprocess, sys, tempfile, time, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PORT = int(os.environ.get("SMOKE_PORT", "8765"))
BASE = f"http://127.0.0.1:{PORT}"

def get(path):
    with urllib.request.urlopen(BASE + path, timeout=8) as r:
        return r.status, r.headers.get("Content-Type", ""), r.read()

def assert_json(path, key=None):
    status, ct, body = get(path)
    assert status == 200, f"{path}: HTTP {status}"
    data = json.loads(body.decode("utf-8"))
    if key is not None:
        assert key in data, f"{path}: missing {key}"
    return data

def main():
    tmpdir = tempfile.mkdtemp(prefix="qcr_smoke_")
    db_path = os.path.join(tmpdir, "quality.db")
    shutil.copy2(ROOT / "quality.db", db_path)
    try:
        db = sqlite3.connect(db_path)
        before = db.execute("SELECT COUNT(*) FROM disposition").fetchone()[0]
        before_users = db.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        before_usernames = [r[0] for r in db.execute("SELECT username FROM users ORDER BY id").fetchall()]
        db.close()
        assert before == 4936, f"unexpected baseline record count: {before}"
        env = os.environ.copy()
        env.pop("ADMIN_USERNAME", None)
        env.pop("ADMIN_PASSWORD", None)
        env["DB_PATH"] = db_path  # isolated, disposable — never the real persistent database
        proc = subprocess.Popen([sys.executable, str(ROOT / "server.py"), str(PORT)], cwd=ROOT,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env, text=True)
        try:
            for _ in range(40):
                try:
                    get("/api/health")
                    break
                except Exception:
                    time.sleep(0.15)
            else:
                out = proc.stdout.read(2000) if proc.stdout else ""
                raise AssertionError("server did not start: " + out)

            status, ct, html = get("/")
            assert status == 200 and b"app-version" in html, "index/version marker missing"
            get("/app.css")
            get("/app.js")
            assert_json("/api/filters", "month")
            kpis = assert_json("/api/kpis", "kpis")
            assert len(kpis["kpis"]) >= 12, f"unexpected KPI payload size: {len(kpis['kpis'])}"
            qcr = assert_json("/api/qcr", "k")
            assert all(key in qcr for key in ("k", "d", "w", "m", "fr", "intel")), "QCR core payload incomplete"
            assert_json("/api/work_center_grade", "by_work_center")
            assert_json("/api/defect_analysis", "register")
            assert_json("/api/period_trend", "weekly")
            assert_json("/api/data_freshness")
            assert_json("/api/connection_status")
            db = sqlite3.connect(db_path)
            after = db.execute("SELECT COUNT(*) FROM disposition").fetchone()[0]
            after_users = db.execute("SELECT COUNT(*) FROM users").fetchone()[0]
            after_usernames = [r[0] for r in db.execute("SELECT username FROM users ORDER BY id").fetchall()]
            db.close()
            assert after == before, f"data changed during smoke test: {before} -> {after}"
            assert after_users == before_users and after_usernames == before_usernames, "users table changed during smoke test"
            print(f"SMOKE TEST PASS — {after} disposition records unchanged; KPI payload={len(kpis['kpis'])}; core tabs/API endpoints OK.")
        finally:
            proc.terminate()
            try: proc.wait(timeout=3)
            except subprocess.TimeoutExpired: proc.kill()
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)

if __name__ == "__main__":
    main()
