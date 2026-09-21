#!/usr/bin/env python3
"""Static, data-free contract checks for Admin navigation UX."""
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
HTML = ROOT / "admin.html"
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
