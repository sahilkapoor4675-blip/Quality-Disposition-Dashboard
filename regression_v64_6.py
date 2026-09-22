#!/usr/bin/env python3
"""Targeted V64.6 UI regression checks; does not modify the repository DB."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent
app_js = (ROOT / "app.js").read_text(encoding="utf-8")
app_css = (ROOT / "app.css").read_text(encoding="utf-8")
index = (ROOT / "index.html").read_text(encoding="utf-8")
version_file = ROOT / "VERSION.txt"
version = version_file.read_text(encoding="utf-8").strip() if version_file.exists() else "APP_VERSION=" + re.search(r'<meta name="app-version" content="([^"]+)"\>', index).group(1)

assert version == "APP_VERSION=V64.6"
assert 'const _tableNormalOrder = new Map()' in app_js
assert 'Three-state cycle for the same column: ascending → descending → natural order.' in app_js
assert 'rememberTableNormalOrder(tableId);' in app_js, 'metric-table natural-order snapshot missing'
assert '3rd click: reset to normal order' in app_js
assert '_tableSortState.delete(tableId);' in app_js
assert 'aria-sort' in app_js and 'ascending' in app_js and 'descending' in app_js and "'none'" in app_js
assert 'function fmtDonutQty3' in app_js
assert 'function fmtDonutPct3' in app_js
assert 'fmtDonutPct3(s.frac)' in app_js
assert 'valFmt?opts.valFmt(s.val)' in app_js
assert 'data-tip="${escQcr(s.d[labelKey])}: ${(opts.valFmt?opts.valFmt(s.val):s.val.toFixed(2))} (${fmtDonutPct3(s.frac)})"' in app_js
assert '.dashboard-table td:not(:first-child)' in app_css
assert re.search(r'valFmt: fmtDonutQty3', app_js)
# Non-donut chart contracts must remain at their V64.5 precision.
assert 'lineFmt: v => (v*100).toFixed(0)+"%"' in app_js
assert 'axisFmt: v => (v*100).toFixed(0)+"%"' in app_js
assert 'fmt: v => (v*100).toFixed(1)+"%"' in app_js
assert '{key:"qty", label:"Qty (MT)", color:"#7C3AED", fmt: v => v.toFixed(1)}' in app_js
assert '{key:"output_qty", label:"Output Qty (MT)", color:"#7C3AED", fmt: v => v.toFixed(0)}' in app_js
assert 'function fmtChartNum3' not in app_js
assert 'function fmtChartPct3' not in app_js
assert 'fmtChartPct3' not in app_js
assert '.qcr-rca-table thead th{background:linear-gradient(180deg,#2f93cf 0%,#1f6690 100%);color:#fff' in app_css
assert 'html[data-theme="dark"] .qcr-rca-table thead th{background:linear-gradient(180deg,#2f93cf 0%,#194e6e 100%);color:#F0F7FF' in app_css
assert 'html[data-theme="dark"] .qcr-compare th{background:linear-gradient(180deg,#2f93cf 0%,#194e6e 100%)' in app_css
assert '#tab-dashboard .panel > h3' in app_css
assert '#tab-wcgrade .panel > h3' in app_css
assert '#tab-defects .panel > h3' in app_css
assert '#tab-weekly .panel > h3' in app_css
assert 'background:linear-gradient(135deg,#fbfdff 0%,#eef6ff 58%,#e5f0ff 100%) !important' in app_css
assert 'background:linear-gradient(135deg,#142541 0%,#173a63 62%,#194b78 100%) !important' in app_css
assert '#tab-dashboard .panel > h3::before' in app_css
assert '#tab-weekly .panel > h3::before' in app_css
assert 'Only dashboard analytics cards use this treatment' in app_css
assert '<meta name="app-version" content="V64.6">' in index
assert 'app.css?v=68.6' in index
assert 'app.js?v=64.6.4' in index
print('V64.6 UI REGRESSION PASS')


def test_analytics_presentation_mode():
    js = (ROOT / 'app.js').read_text(encoding='utf-8')
    css = (ROOT / 'app.css').read_text(encoding='utf-8')
    assert 'function openAnalyticsPresentation(panel)' in js
    assert 'function closeAnalyticsPresentation()' in js
    assert 'wireAnalyticsPresentation();' in js
    assert 'data-presentation-close' in js
    assert 'analytics-presentation-open' in css
    assert 'analytics-expand-btn' in css
    assert 'analytics-presentation-panel>h3' in css
    assert 'analytics-presentation-panel>#decisionPie' in css
    assert 'if(e.key!=="Tab" || !_analyticsPresentationState) return;' in js
    assert 'request another API' not in js.lower()

test_analytics_presentation_mode()
