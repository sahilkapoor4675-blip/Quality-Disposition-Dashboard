#!/usr/bin/env python3
"""Disaster-recovery utility for Quality Disposition Dashboard V66.

Examples:
  python3 dr_recovery.py verify path/to/backup.json.gz
  DATABASE_URL=... python3 dr_recovery.py restore path/to/backup.json.gz

Restore is intentionally explicit and does NOT run automatically. The live
application must be offline/frozen while a restore is performed.
"""
import argparse
import gzip
import json
import os
import sys


def load_backup(path):
    if not os.path.isfile(path):
        raise SystemExit(f"Backup not found: {path}")
    try:
        with gzip.open(path, "rt", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)


def main():
    ap = argparse.ArgumentParser(description="Quality Disposition Dashboard V66 disaster recovery")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p_verify = sub.add_parser("verify")
    p_verify.add_argument("backup")
    p_restore = sub.add_parser("restore")
    p_restore.add_argument("backup")
    p_restore.add_argument("--yes", action="store_true", help="required confirmation for destructive restore")
    args = ap.parse_args()
    data = load_backup(args.backup)
    import server
    valid, reason = server._backup_is_valid(data, require_integrity=True)
    if not valid:
        raise SystemExit(f"INVALID backup: {reason}")
    print(f"VALID backup v{data.get('backup_version')} revision={data.get('data_revision','—')} sha256={data.get('integrity_sha256','')}")
    print(f"Tables: {len(data.get('persistent_tables', []))} | Disposition rows: {data.get('counts', {}).get('disposition', '—')}")
    if args.cmd == "restore":
        if not args.yes:
            raise SystemExit("Refusing destructive restore without --yes. Stop/freeze the live app first.")
        server._require_safety_backup("cli_before_restore")
        result = server._restore_backup_data(data)
        print("RESTORED")
        print(json.dumps(result, indent=2, default=str))
        rp = server._post_mutation_backup("cli_after_restore")
        print("Recovery point:", json.dumps(rp, default=str))


if __name__ == "__main__":
    main()
