#!/usr/bin/env python3
"""End-to-end checks for the two mutating admin flows that no other test in this
suite exercises past the API's surface: import PREVIEW -> CONFIRM (the two-step
commit, not just /api/admin/import_preview on its own), and backup CREATE ->
mutate -> RESTORE (a real round trip, not just that each endpoint returns 200).
Both run against a real server process on an isolated, disposable copy of the
database -- never the real quality.db.

    python tests/test_data_lifecycle.py

Known gap this file does NOT cover: the PostgreSQL-backed deployment path
(DB_URL / dr_pg_backup.py). That requires a live Postgres instance and the
psycopg2 driver, neither of which is available in this sandbox (no outbound
network to install the driver, no database server). If you have a Postgres
instance available, point DB_URL at a disposable database and re-run the
existing backup/restore and import suites against it by hand before a release
that touches dr_pg_backup.py or the DB_URL code path in server.py.
"""
import http.cookiejar, io, json, os, shutil, sqlite3, subprocess, sys, tempfile, time, uuid
import urllib.error, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORT = int(os.environ.get("LIFECYCLE_TEST_PORT", "8798"))
BASE = f"http://127.0.0.1:{PORT}"
ADMIN_USER = "tester"
ADMIN_PASS = "Strong-Admin-1234!"


class Client:
    """Minimal cookie- and CSRF-aware HTTP client, matching how the browser
    talks to server.py (session cookie + X-CSRF-Token header on writes)."""

    def __init__(self, base):
        self.base = base
        self.cj = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cj))

    def _csrf(self):
        for c in self.cj:
            if c.name == "qdash_csrf":
                return c.value
        return None

    def request(self, method, path, body=None, headers=None, raw_body=None):
        headers = dict(headers or {})
        data = raw_body
        if body is not None:
            data = json.dumps(body).encode()
            headers.setdefault("Content-Type", "application/json")
        if method != "GET":
            token = self._csrf()
            if token:
                headers["X-CSRF-Token"] = token
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=headers)
        try:
            r = self.opener.open(req, timeout=30)
            return r.status, r.read()
        except urllib.error.HTTPError as e:
            return e.code, e.read()

    def get(self, path):
        return self.request("GET", path)

    def post_json(self, path, body):
        return self.request("POST", path, body=body)

    def post_multipart(self, path, filename, content, extra_fields=None):
        boundary = uuid.uuid4().hex
        parts = []
        for k, v in (extra_fields or {}).items():
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\n'
            f'Content-Type: application/octet-stream\r\n\r\n'.encode() + content + f'\r\n--{boundary}--\r\n'.encode()
        )
        return self.request("POST", path, raw_body=b"".join(parts),
                             headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})


def _start_server(db_path, backup_dir):
    env = os.environ.copy()
    env["DB_PATH"] = str(db_path)
    env["BACKUP_DIR"] = str(backup_dir)
    env["ADMIN_USERNAME"] = ADMIN_USER
    env["ADMIN_PASSWORD"] = ADMIN_PASS
    env["APP_VERSION"] = "test"
    env.pop("RENDER", None)
    proc = subprocess.Popen([sys.executable, str(ROOT / "server.py"), str(PORT)], cwd=ROOT,
                             stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env, text=True)
    for _ in range(60):
        try:
            urllib.request.urlopen(BASE + "/api/health", timeout=2)
            return proc
        except Exception:
            if proc.poll() is not None:
                out = proc.stdout.read(3000) if proc.stdout else ""
                raise AssertionError("server exited before becoming ready:\n" + out)
            time.sleep(0.2)
    proc.terminate()
    raise AssertionError("server did not become ready in time")


def _row_count(db_path):
    conn = sqlite3.connect(db_path)
    try:
        return conn.execute("SELECT COUNT(*) FROM disposition").fetchone()[0]
    finally:
        conn.close()


def _sample_csv(n, batch_prefix):
    """n rows of plausible, self-consistent data, guaranteed not to collide with
    the bundled dataset's batch numbers (so they're unambiguously "the new rows")."""
    header = "HEAT NO,BATCH NO,INSP LOT DATE,WORK CENTER,GRADE,OUTPUT WEIGHT,MAIN DEFECT,DEFECT INTENSITY,QUALITY DECISION\n"
    rows = "".join(
        f"LIFECYCLE-H{i},{batch_prefix}{i:04d},2026-05-0{1 + i % 9},CND_SLT,Ni-Silver,1.5,NO DEFECT,,PRIME\n"
        for i in range(n)
    )
    return (header + rows).encode()


def test_import_preview_then_confirm(client, db_path):
    before = _row_count(db_path)
    n = 12
    status, body = client.post_multipart("/api/admin/import_preview", "lifecycle.csv",
                                          _sample_csv(n, "LIFE"))
    assert status == 200, f"import_preview failed: {status} {body[:300]}"
    preview = json.loads(body)
    assert preview.get("valid") == n, f"expected {n} valid rows, got {preview.get('valid')}: {body[:300]}"
    assert preview.get("errors") == 0, f"unexpected parse errors: {body[:300]}"
    preview_id = preview.get("preview_id")
    assert preview_id, f"import_preview did not return a preview_id: {body[:300]}"

    # The confirm step is what actually writes to the database -- preview alone
    # (already covered elsewhere) must never mutate anything on its own.
    assert _row_count(db_path) == before, "import_preview mutated the database (it must only parse/validate)"

    status, body = client.post_json("/api/admin/import_confirm", {"preview_id": preview_id})
    assert status == 200, f"import_confirm failed: {status} {body[:300]}"
    result = json.loads(body)
    assert result.get("inserted") == n, f"expected {n} inserted, got: {body[:300]}"

    after = _row_count(db_path)
    assert after == before + n, f"row count after confirm: expected {before + n}, got {after}"

    # A second confirm with the same (now-consumed) preview_id must be rejected,
    # not silently insert the same rows again.
    status, body = client.post_json("/api/admin/import_confirm", {"preview_id": preview_id})
    assert status == 400, f"re-confirming a used preview_id should fail, got {status}: {body[:200]}"
    assert _row_count(db_path) == after, "re-confirming a used preview_id inserted rows again"
    print(f"  import preview->confirm: {before} -> {after} rows (+{n}); "
          "re-confirm correctly rejected.")


def test_backup_create_then_restore(client, db_path):
    before = _row_count(db_path)
    status, body = client.post_json("/api/admin/backup/create", {})
    assert status == 200, f"backup/create failed: {status} {body[:300]}"
    backup_name = json.loads(body).get("filename")
    assert backup_name, f"backup/create did not return a filename: {body[:300]}"

    # Mutate the database after the backup, so restoring it is a real, visible change.
    status, body = client.post_multipart("/api/admin/import_preview", "post_backup.csv",
                                          _sample_csv(5, "POSTBK"))
    preview_id = json.loads(body)["preview_id"]
    status, body = client.post_json("/api/admin/import_confirm", {"preview_id": preview_id})
    assert status == 200, f"setup import for restore test failed: {body[:300]}"
    mutated = _row_count(db_path)
    assert mutated == before + 5, f"setup mutation didn't take: {before} -> {mutated}"

    status, body = client.post_json("/api/admin/backup/restore", {"name": backup_name})
    assert status == 200, f"backup/restore failed: {status} {body[:300]}"
    restored = json.loads(body)
    assert restored.get("ok") is True, f"backup/restore did not report ok: {body[:300]}"

    after = _row_count(db_path)
    assert after == before, f"restore did not bring row count back to {before}, got {after}"
    print(f"  backup create->mutate(+5)->restore: {before} -> {mutated} -> {after} rows "
          f"(backup file: {backup_name}).")


def run():
    tmpdir = Path(tempfile.mkdtemp(prefix="qdash_lifecycle_"))
    db_path = tmpdir / "quality.db"
    backup_dir = tmpdir / "backups"
    shutil.copy2(ROOT / "quality.db", db_path)
    proc = _start_server(db_path, backup_dir)
    try:
        client = Client(BASE)
        status, body = client.post_json("/api/login", {"username": ADMIN_USER, "password": ADMIN_PASS})
        assert status == 200, f"login failed: {status} {body[:300]}"

        test_import_preview_then_confirm(client, db_path)
        test_backup_create_then_restore(client, db_path)
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(tmpdir, ignore_errors=True)
    print("DATA LIFECYCLE TEST PASS — import preview->confirm (with used-preview "
          "rejection) and backup create->mutate->restore both round-trip correctly.")


if __name__ == "__main__":
    run()
