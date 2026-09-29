#!/usr/bin/env python3
"""Static, data-free checks: code health (syntax, secrets, CSS report) + Admin navigation contract.

Merged from code_health.py + admin_ux_audit.py.  Run:  python tests/static_checks.py
"""
import ast, re, sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent   # repo root (this file lives in tests/)

EXPECTED = [
    "homePanel", "dataQualityPanel", "kpiPanel", "addRecordPanel", "importPanel",
    "importHistoryPanel", "recordsPanel", "fishbonePanel", "fishboneMapPanel",
    "commandCenterPanel", "databasePanel", "performancePanel", "backupsPanel",
    "recoveryPanel", "securityPanel", "validationPanel", "usersPanel",
    "auditExplorerPanel", "auditTrailPanel", "auditAnalyticsPanel", "activityPanel",
]


class ContractParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.nav_ids = []
        self.sections = []
        self.ids = set()
        self.duplicates = set()
        self.stack = []
    def handle_starttag(self, tag, attrs):
        d = dict(attrs)
        ident = d.get('id')
        classes = set((d.get('class') or '').split())
        self.stack.append((tag, ident, classes))
        if ident:
            if ident in self.ids: self.duplicates.add(ident)
            self.ids.add(ident)
        if tag == 'button' and 'sidebar-link' in classes:
            target = d.get('data-target')
            self.nav_ids.append(target)
            assert d.get('aria-controls') == target
        if 'admin-section' in classes and ident:
            assert any(x[1] == 'adminContentGrid' for x in self.stack[:-1]), ident
            self.sections.append((ident, d.get('data-admin-section-order')))
        if ident == 'kpiHistoryBody':
            assert any(x[1] == 'kpiPanel' for x in self.stack[:-1]), 'KPI history escaped KPI panel'
        if 'admin-prod-grid' in classes:
            assert any(x[1] == 'homePanel' for x in self.stack[:-1]), 'Overview health card escaped Overview panel'
    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs); self.handle_endtag(tag)
    def handle_endtag(self, tag):
        for i in range(len(self.stack)-1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                break


def read_bundle(kind):
    """app.js / app.css are built from src/<kind>/*.<kind> in filename order."""
    return "".join(p.read_text(encoding="utf-8") for p in sorted((ROOT/"src"/kind).glob("*."+kind)))


def code_health():
    errors=[]; warnings=[]

    for rel in ["server.py","index.html","admin.html"]:
        p=ROOT/rel
        if not p.exists(): errors.append(f"Missing {rel}")
    for rel,ext in (("src/js",".js"),("src/css",".css")):
        if not list((ROOT/rel).glob("*"+ext)): errors.append(f"Missing frontend source pieces in {rel}/")

    # Python syntax
    try:
        ast.parse((ROOT/"server.py").read_text(encoding="utf-8"))
    except Exception as e:
        errors.append(f"server.py syntax: {e}")

    server=(ROOT/"server.py").read_text(encoding="utf-8")
    for secret_pat in [r'QCR@Admin\d+!', r'ChangeMe@\d+', r'password\s*=\s*[\'\"][^\'\"]+[\'\"]']:
        if re.search(secret_pat, server, re.I):
            errors.append(f"Possible hardcoded credential pattern: {secret_pat}")

    # Basic JS/CSS sanity checks and a duplicate-selector report. We do not fail on
    # duplicates because the current cascade is intentionally preserved.
    css=read_bundle("css")
    selectors=[]
    for m in re.finditer(r'([^{}]+)\{', css):
        raw=m.group(1).strip()
        if raw and not raw.startswith('@'):
            selectors.append(raw)
    dups=sorted({s for s in selectors if selectors.count(s)>1})
    if dups:
        warnings.append(f"CSS duplicate selector groups: {len(dups)} (report only; cascade preserved)")

    # Orphaned-class report: CSS classes with no matching reference anywhere in the
    # markup/JS. This is what would have caught the old ".qcr-health-score" family —
    # leftover styling for markup that had already been removed/renamed elsewhere,
    # left in app.css and later silently colliding with an unrelated feature that
    # reused one of its class names (".qcr-health-reasons"). Report-only: a class
    # can legitimately be unused right after a deliberate removal, or be reserved
    # for a state that's only toggled at runtime, so this warns rather than fails.
    html_all = (ROOT/"index.html").read_text(encoding="utf-8") + (ROOT/"admin.html").read_text(encoding="utf-8")
    js_all = read_bundle("js")
    haystack = html_all + js_all
    css_classes = sorted({m.group(1) for sel in selectors for m in re.finditer(r'\.([a-zA-Z][\w-]*)', sel)})

    # Dynamic-class awareness: app.js frequently builds a class name at runtime
    # instead of writing it out literally — e.g. `` `status-${status}` `` or
    # `'toast-'+(kind||'info')` — so a plain substring search on css_classes would
    # wrongly call "status-good"/"toast-error" orphaned even though they're the
    # exact strings those two lines produce. Detect the *prefix* used in either
    # pattern and treat any CSS class starting with a live prefix as referenced.
    dynamic_prefixes = set(re.findall(r'([a-zA-Z][\w-]*-)\$\{', haystack))
    dynamic_prefixes |= set(re.findall(r"""([a-zA-Z][\w-]*-)['"]\s*\+""", haystack))

    orphans=[]
    for cls in css_classes:
        if any(cls.startswith(p) for p in dynamic_prefixes):
            continue
        if not re.search(r'(?<![\w-])'+re.escape(cls)+r'(?![\w-])', haystack):
            orphans.append(cls)
    if orphans:
        warnings.append(f"Orphaned CSS classes (no reference in html/js): {len(orphans)} -> {', '.join(orphans[:15])}"+(" ..." if len(orphans)>15 else ""))

    print("CODE HEALTH")
    print(f"  server.py: {len(server.splitlines())} lines")
    print(f"  app.js (bundle of {len(list((ROOT/'src'/'js').glob('*.js')))} files): {js_all.count(chr(10))+1} lines")
    print(f"  app.css (bundle of {len(list((ROOT/'src'/'css').glob('*.css')))} files): {len(css.splitlines())} lines")
    print(f"  duplicate CSS selector groups: {len(dups)}")
    print(f"  orphaned CSS classes: {len(orphans)}")
    if warnings:
        for w in warnings: print("  WARN:", w)
    if errors:
        for e in errors: print("  ERROR:", e)
        sys.exit(1)
    print("  PASS")


def admin_ux_audit():
    HTML = ROOT / "admin.html"
    text = HTML.read_text(encoding='utf-8')
    p = ContractParser(); p.feed(text); p.close()
    assert not p.duplicates, sorted(p.duplicates)
    assert p.nav_ids == EXPECTED, ("sidebar order mismatch", p.nav_ids)
    assert [x[0] for x in p.sections] == EXPECTED, ("section order mismatch", [x[0] for x in p.sections])
    assert [x[1] for x in p.sections] == [str(i) for i in range(1, len(EXPECTED)+1)]
    assert 'window.addEventListener(\'scroll\',scheduleSpy' in text
    assert 'window.goAdminSection=go' in text
    assert 'aria-current' in text
    assert '__adminSyncSidebarVisibility' in text
    print(f"ADMIN UX AUDIT PASS — {len(EXPECTED)} sidebar sections and content sections are one-to-one, ordered, role-aware, and scroll-synced.")


    # V64.2 follow-up contracts: top search removed, readable sidebar labels,
    # deterministic fresh-position tab switching.
    assert 'id="adminGlobalSearch"' not in text, 'Top admin global search UI must be removed'
    assert 'Ctrl K' not in text, 'Dead global-search shortcut must be removed'
    assert 'grid-template-columns:300px minmax(0,1fr)' in text, 'Desktop sidebar must have readable width'
    assert '.sidebar-link .sidebar-icon' in text, 'Icon selector must not style label spans as icons'
    assert '.sidebar-link-text{min-width:0;flex:1 1 auto;width:auto;overflow:visible' in text, 'Sidebar labels must not be clipped/ellipsized'
    assert 'window.scrollTo({top:targetTop' in text, 'Tab switching must use deterministic window scrolling'
    assert 'navOffset=isMobile' in text, 'Mobile sticky sidebar offset must be reserved on tab switch'
    assert '@media(max-width:650px){.sidebar-link{padding:8px 9px!important;font-size:12.5px!important}.sidebar-icon{width:22px!important}.admin-commandbar{position:static' in text, 'Mobile command bar must not remain sticky after global search removal'
    assert 'const closeSearch=()=>{}' not in text, 'Dead search helper must be removed'
    print('V64.2 admin UX follow-up contracts: PASS')


if __name__ == "__main__":
    code_health()
    admin_ux_audit()
