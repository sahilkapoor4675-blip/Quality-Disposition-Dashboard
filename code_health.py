#!/usr/bin/env python3
"""Lightweight V27.x code-health gate; no third-party tooling required."""
from pathlib import Path
import ast, re, sys

ROOT = Path(__file__).resolve().parents[1]
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
# duplicates because the current cascade is intentionally preserved in V27.2.
css=(ROOT/"app.css").read_text(encoding="utf-8")
selectors=[]
for m in re.finditer(r'([^{}]+)\{', css):
    raw=m.group(1).strip()
    if raw and not raw.startswith('@'):
        selectors.append(raw)
dups=sorted({s for s in selectors if selectors.count(s)>1})
if dups:
    warnings.append(f"CSS duplicate selector groups: {len(dups)} (report only; cascade preserved)")

print("V27.2 CODE HEALTH")
print(f"  server.py: {len(server.splitlines())} lines")
print(f"  app.js: {(ROOT/'app.js').read_text(encoding='utf-8').count(chr(10))+1} lines")
print(f"  app.css: {len(css.splitlines())} lines")
print(f"  duplicate CSS selector groups: {len(dups)}")
if warnings:
    for w in warnings: print("  WARN:", w)
if errors:
    for e in errors: print("  ERROR:", e)
    sys.exit(1)
print("  PASS")
