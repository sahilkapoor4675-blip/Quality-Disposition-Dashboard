#!/usr/bin/env python3
"""Release gate: one command runs every check and prints a PASS/FAIL table.

    python tests/run_gate.py           # everything (~1 min)
    python tests/run_gate.py --fast    # skips the slow export stress test

Runs only on isolated temporary databases - never point it at production.
"""
import shutil, subprocess, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PY = sys.executable
T = ROOT / "tests"
FAST = "--fast" in sys.argv

checks = [
    ("py_compile", [PY, "-m", "py_compile", *[str(ROOT / f) for f in (
        "server.py", "reports.py", "alerts.py", "logging_setup.py", "session_store.py",
        "dr_storage.py", "dr_recovery.py", "dr_pg_backup.py")]]),
]
if shutil.which("node"):
    checks += [("node --check app.js", ["node", "--check", str(ROOT / "app.js")]),
               ("node --check sw.js", ["node", "--check", str(ROOT / "sw.js")]),
               ("node --check sfx.js", ["node", "--check", str(ROOT / "sfx.js")])]
checks += [
    ("static checks (code health + admin UX)", [PY, str(T / "static_checks.py")]),
    ("regression (6 suites)", [PY, str(T / "regression.py")]),
    ("unit tests (alerts + disaster recovery)", [PY, str(T / "test_units.py")]),
    ("smoke (server + 47 routes)", [PY, str(T / "test_smoke.py")]),
    ("exports" + ("" if FAST else " + stress"), [PY, str(T / "test_exports.py")] + ([] if FAST else ["--stress"])),
]

results = []
for name, cmd in checks:
    t0 = time.time()
    p = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    ok = p.returncode == 0
    results.append((name, ok, time.time() - t0))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}  ({results[-1][2]:.0f}s)", flush=True)
    if not ok:
        print((p.stdout + p.stderr)[-3000:])

failed = [n for n, ok, _ in results if not ok]
print("\nRELEASE GATE " + ("FAIL: " + ", ".join(failed) if failed else "PASS - safe to deploy"))
sys.exit(1 if failed else 0)
