"""
Cross-instance sync for admin/viewer sessions and login-attempt throttling.

Context: server.py's SESSIONS / LOGIN_ATTEMPTS dicts are the fast path on
every request (no DB round-trip for the common case) and remain exactly as
they were. This module adds a *Postgres-backed* fallback so that, when the
app is deployed with DATABASE_URL set (the only configuration where running
more than one instance/dyno makes sense — SQLite is a single local file),
a login on one instance is recognised on another, and a brute-force lockout
applies across every instance rather than just the one that saw the failed
attempts.

Every function here is a deliberate no-op when `use_postgres` is False, so a
SQLite deployment's behavior and performance are completely unchanged — this
module is additive, not a replacement for the in-memory dicts.

All functions accept `get_conn` (server.py's connection factory) as a
parameter rather than importing server.py, to avoid a circular import.
"""
import json


def db_session_upsert(get_conn, use_postgres, token, meta, expires):
    if not use_postgres:
        return
    try:
        conn = get_conn()
        payload = json.dumps(meta, ensure_ascii=False, default=str)
        conn.execute(
            "INSERT INTO sessions (token,payload,expires) VALUES (%s,%s,%s) "
            "ON CONFLICT (token) DO UPDATE SET payload=EXCLUDED.payload, expires=EXCLUDED.expires",
            (token, payload, expires),
        )
        conn.commit(); conn.close()
    except Exception:
        pass


def db_session_fetch(get_conn, use_postgres, token):
    """Returns (meta dict, expires float) or (None, None)."""
    if not use_postgres or not token:
        return None, None
    try:
        conn = get_conn()
        row = conn.execute("SELECT payload, expires FROM sessions WHERE token=%s", (token,)).fetchone()
        conn.close()
        if not row:
            return None, None
        meta = json.loads(row[0])
        return meta, float(row[1])
    except Exception:
        return None, None


def db_session_delete(get_conn, use_postgres, token):
    if not use_postgres or not token:
        return
    try:
        conn = get_conn()
        conn.execute("DELETE FROM sessions WHERE token=%s", (token,))
        conn.commit(); conn.close()
    except Exception:
        pass


def db_sessions_delete_by_user(get_conn, use_postgres, user_id):
    if not use_postgres or user_id is None:
        return
    try:
        conn = get_conn()
        conn.execute("DELETE FROM sessions WHERE payload::jsonb->>'user_id' = %s", (str(user_id),))
        conn.commit(); conn.close()
    except Exception:
        pass


def db_cleanup_expired_sessions(get_conn, use_postgres, now):
    if not use_postgres:
        return
    try:
        conn = get_conn()
        conn.execute("DELETE FROM sessions WHERE expires < %s", (now,))
        conn.commit(); conn.close()
    except Exception:
        pass


def db_login_check(get_conn, use_postgres, ip, now, window, max_attempts):
    """Returns (allowed: bool, retry_after_seconds: int) using the shared
    Postgres-backed counter. Best-effort: any DB error fails open (allowed)
    rather than locking everyone out because of a transient DB hiccup — the
    in-memory LOGIN_ATTEMPTS check the caller also runs still applies."""
    if not use_postgres:
        return True, 0
    try:
        conn = get_conn()
        row = conn.execute("SELECT count, window_start FROM login_attempts WHERE ip=%s", (ip,)).fetchone()
        if not row or (now - float(row[1])) >= window:
            conn.execute(
                "INSERT INTO login_attempts (ip,count,window_start) VALUES (%s,0,%s) "
                "ON CONFLICT (ip) DO UPDATE SET count=0, window_start=EXCLUDED.window_start",
                (ip, now),
            )
            conn.commit(); conn.close()
            return True, 0
        count = int(row[0])
        conn.close()
        if count >= max_attempts:
            return False, int(max(1, window - (now - float(row[1]))))
        return True, 0
    except Exception:
        return True, 0


def db_login_record_failure(get_conn, use_postgres, ip, now, window):
    if not use_postgres:
        return
    try:
        conn = get_conn()
        row = conn.execute("SELECT count, window_start FROM login_attempts WHERE ip=%s", (ip,)).fetchone()
        if not row or (now - float(row[1])) >= window:
            conn.execute(
                "INSERT INTO login_attempts (ip,count,window_start) VALUES (%s,1,%s) "
                "ON CONFLICT (ip) DO UPDATE SET count=1, window_start=EXCLUDED.window_start",
                (ip, now),
            )
        else:
            conn.execute("UPDATE login_attempts SET count=count+1 WHERE ip=%s", (ip,))
        conn.commit(); conn.close()
    except Exception:
        pass


def db_login_clear(get_conn, use_postgres, ip):
    if not use_postgres:
        return
    try:
        conn = get_conn()
        conn.execute("DELETE FROM login_attempts WHERE ip=%s", (ip,))
        conn.commit(); conn.close()
    except Exception:
        pass


def db_login_attempts_snapshot(get_conn, use_postgres, limit=50):
    """For the admin rate-limit inspection panel: current locked-out/near-locked
    IPs as tracked in the shared Postgres table (multi-instance view). Empty
    list on SQLite (no shared store) or on any DB error."""
    if not use_postgres:
        return []
    try:
        conn = get_conn()
        rows = conn.execute(
            "SELECT ip, count, window_start FROM login_attempts ORDER BY count DESC, window_start DESC LIMIT %s",
            (limit,),
        ).fetchall()
        conn.close()
        return [{"ip": r[0], "count": int(r[1]), "window_start": float(r[2])} for r in rows]
    except Exception:
        return []
