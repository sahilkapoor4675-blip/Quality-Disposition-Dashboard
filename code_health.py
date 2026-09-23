#!/usr/bin/env python3
"""Lightweight code-health gate; no third-party tooling required."""
from pathlib import Path
import ast, re, sys

ROOT = Path(__file__).resolve().parent
errors=[]; warnings=[]

for rel in ["server.py","app.js","app.css","index.html","admin.html"]:
    p=ROOT/rel
    if not p.exists(): errors.append(f"Missing {rel}")

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
css=(ROOT/"app.css").read_text(encoding="utf-8")
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
js_all = (ROOT/"app.js").read_text(encoding="utf-8")
haystack = html_all + js_all
css_classes = sorted({m.group(1) for sel in selectors for m in re.finditer(r'\.([a-zA-Z][\w-]*)', sel)})
orphans=[]
for cls in css_classes:
    if not re.search(r'(?<![\w-])'+re.escape(cls)+r'(?![\w-])', haystack):
        orphans.append(cls)
if orphans:
    warnings.append(f"Orphaned CSS classes (no reference in html/js): {len(orphans)} -> {', '.join(orphans[:15])}"+(" ..." if len(orphans)>15 else ""))

print("CODE HEALTH")
print(f"  server.py: {len(server.splitlines())} lines")
print(f"  app.js: {(ROOT/'app.js').read_text(encoding='utf-8').count(chr(10))+1} lines")
print(f"  app.css: {len(css.splitlines())} lines")
print(f"  duplicate CSS selector groups: {len(dups)}")
print(f"  orphaned CSS classes: {len(orphans)}")
if warnings:
    for w in warnings: print("  WARN:", w)
if errors:
    for e in errors: print("  ERROR:", e)
    sys.exit(1)
print("  PASS")
