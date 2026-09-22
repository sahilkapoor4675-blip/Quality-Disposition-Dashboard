#!/usr/bin/env python3
"""Targeted V64.5 regression checks for the Admin/security/performance fixes.

This script uses a temporary SQLite database copied from the bundled seed and
never mutates the repository's quality.db. Run with:
    python3 regression_v64_5.py
"""
from __future__ import annotations

import gzip
import importlib
import os
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TMP = Path(tempfile.mkdtemp(prefix="qdash_v64_5_"))
os.environ["DB_PATH"] = str(TMP / "quality.db")
os.environ.pop("DATABASE_URL", None)
os.environ["APP_VERSION"] = "V64.5"
shutil.copy2(ROOT / "quality.db", TMP / "quality.db")

try:
    sys.path.insert(0, str(ROOT))
    server = importlib.import_module("server")
    server._ensure_admin_schema()
    server.ensure_fast_indexes()

    conn = server.get_conn()
    state0 = server._disposition_state(conn)
    assert state0["revision"] == 0, state0
    conn.close()

    # Mutation revision must advance transactionally and be visible to a later
    # preview-confirm comparison.
    conn = server.get_conn()
    before = server._disposition_state(conn)
    server._mark_disposition_changed(conn)
    conn.commit()
    conn.close()
    after = server._disposition_state()
    assert after["revision"] == before["revision"] + 1, (before, after)
    assert after["changed_at"], after

    # Session activity flag must be honored by viewer authentication.
    class Handler:
        class Headers:
            def get(self, name, default=""):
                return "qdash_user=target-token" if name == "Cookie" else default
        headers = Headers()

    with server.SESSION_LOCK:
        server.SESSIONS["target-token"] = {"role": "viewer", "active": True, "expires": server._dt.datetime.now().timestamp() + 600}
    assert server._viewer_meta(Handler()) is not None
    with server.SESSION_LOCK:
        server.SESSIONS["target-token"]["active"] = False
    assert server._viewer_meta(Handler()) is None

    # User disable/reset now have one shared session-revocation primitive.
    with server.SESSION_LOCK:
        server.SESSIONS["a"] = {"user_id": 77, "role": "viewer", "active": True, "expires": server._dt.datetime.now().timestamp() + 600}
        server.SESSIONS["b"] = {"user_id": 88, "role": "viewer", "active": True, "expires": server._dt.datetime.now().timestamp() + 600}
    assert server._revoke_user_sessions(77) == 1
    with server.SESSION_LOCK:
        assert "a" not in server.SESSIONS and "b" in server.SESSIONS

    # Backup listing: second unchanged read must be served from metadata cache,
    # so gzip+JSON validation is not repeated.
    server._write_backup_file("v64_5_regression")
    server._backup_list_cache_clear()
    calls = {"n": 0}
    original = server._backup_is_valid
    def counted(data, require_integrity=False):
        calls["n"] += 1
        return original(data, require_integrity=require_integrity)
    server._backup_is_valid = counted
    first = server._list_backups()
    second = server._list_backups()
    assert first and second, (first, second)
    assert calls["n"] == len(first), (calls, len(first))
    server._backup_is_valid = original

    # Current bundled data remains readable and the optimized data-quality
    # duplicate calculation has the expected zero-duplicate seed result.
    conn = server.get_conn()
    dup_groups = conn.execute("SELECT COUNT(*) FROM (SELECT UPPER(TRIM(batch_no)) b FROM disposition WHERE TRIM(COALESCE(batch_no,''))<>'' GROUP BY UPPER(TRIM(batch_no)) HAVING COUNT(*)>1)").fetchone()[0]
    total = conn.execute("SELECT COUNT(*) FROM disposition").fetchone()[0]
    conn.close()
    assert int(total) == 4936, total
    assert int(dup_groups) == 0, dup_groups

    print("V64.5 TARGETED REGRESSION PASS")
    print(f"  disposition rows: {total}")
    print(f"  mutation revision: {after['revision']}")
    print(f"  backup cache validation calls: {calls['n']} for {len(first)} backup(s)")
finally:
    try:
        shutil.rmtree(TMP)
    except Exception:
        pass
