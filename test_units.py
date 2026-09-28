"""Unit + integration tests: backup-failure alerts (alerts.py) and disaster recovery (server.py).

Merged from test_alerts.py + test_disaster_recovery.py.  Run:  python tests/test_units.py
"""
import gzip, json, os, shutil, sys, tempfile, threading, time, unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent   # repo root (this file lives in tests/)
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


# ============================ alerts ============================
class _Receiver:
    """Tiny local webhook endpoint that records every POSTed JSON body."""

    def __init__(self):
        self.bodies = []
        outer = self

        class H(BaseHTTPRequestHandler):
            def do_POST(self):
                n = int(self.headers.get("Content-Length", 0))
                outer.bodies.append(json.loads(self.rfile.read(n) or b"{}"))
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"ok")

            def log_message(self, *a):
                pass

        self.httpd = HTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.httpd.server_port}/hook"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def wait_for(self, count, timeout=5.0):
        end = time.time() + timeout
        while time.time() < end and len(self.bodies) < count:
            time.sleep(0.02)
        return len(self.bodies) >= count

    def close(self):
        self.httpd.shutdown()
        self.httpd.server_close()


class AlertsUnitTests(unittest.TestCase):
    def setUp(self):
        import alerts
        self.alerts = alerts
        alerts.configure(None, None)
        alerts._mem_state.clear()
        self.rx = _Receiver()
        self._env = dict(os.environ)
        os.environ["ALERT_WEBHOOK_URL"] = self.rx.url
        os.environ["ALERT_COOLDOWN_MINUTES"] = "60"
        for k in ("ALERT_EMAIL_TO", "SMTP_HOST"):
            os.environ.pop(k, None)

    def tearDown(self):
        self.rx.close()
        os.environ.clear()
        os.environ.update(self._env)

    def test_sends_then_dedupes_then_recovers_once(self):
        a = self.alerts
        self.assertTrue(a.raise_alert("k", "disk full", "boom", wait=True))
        self.assertEqual(len(self.rx.bodies), 1)
        body = self.rx.bodies[0]
        self.assertIn("ALERT: disk full", body["text"])
        self.assertEqual(body["event"], "alert.k")
        self.assertEqual(body["text"][:1900], body["content"])  # Discord field mirrors Slack's
        # Still failing inside the cooldown -> suppressed.
        self.assertFalse(a.raise_alert("k", "disk full", "boom", wait=True))
        self.assertEqual(len(self.rx.bodies), 1)
        # Recovery: exactly one message, then a second resolve is a no-op.
        self.assertTrue(a.resolve_alert("k", "disk ok", wait=True))
        self.assertFalse(a.resolve_alert("k", "disk ok", wait=True))
        self.assertEqual(len(self.rx.bodies), 2)
        self.assertIn("RECOVERED: disk ok", self.rx.bodies[1]["text"])
        # After recovery a new failure alerts immediately again.
        self.assertTrue(a.raise_alert("k", "disk full", wait=True))
        self.assertEqual(len(self.rx.bodies), 3)

    def test_realerts_after_cooldown(self):
        a = self.alerts
        self.assertTrue(a.raise_alert("k", "x", wait=True))
        a._mem_state["alert_open:k"] = repr(time.time() - 3 * 3600)  # 3h ago > 60min
        self.assertTrue(a.raise_alert("k", "x", wait=True))
        self.assertEqual(len(self.rx.bodies), 2)

    def test_resolve_without_open_alert_sends_nothing(self):
        self.assertFalse(self.alerts.resolve_alert("never", "fine", wait=True))
        self.assertEqual(self.rx.bodies, [])

    def test_secrets_are_redacted(self):
        os.environ["DR_S3_SECRET_ACCESS_KEY"] = "SUPERSECRETVALUE123"
        self.alerts.raise_alert("k", "x", "upload failed key=SUPERSECRETVALUE123", wait=True)
        self.assertNotIn("SUPERSECRETVALUE123", json.dumps(self.rx.bodies))
        self.assertIn("***", self.rx.bodies[0]["text"])

    def test_dead_webhook_never_raises_and_email_still_tried(self):
        os.environ["ALERT_WEBHOOK_URL"] = "http://127.0.0.1:9/nothing-listens-here"
        res = self.alerts.send_test()
        self.assertEqual(res, {"webhook": False})

    def test_no_channel_configured_is_just_logged(self):
        os.environ.pop("ALERT_WEBHOOK_URL")
        self.assertEqual(self.alerts.describe()["webhook"], False)
        self.assertTrue(self.alerts.raise_alert("k", "x", wait=True))  # no exception


class BackupAlertIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="qd_alerts_")
        os.environ.pop("DATABASE_URL", None)
        os.environ["DR_REMOTE_ENABLED"] = "false"
        import server
        cls.server = server
        server.USE_POSTGRES = False
        server.DB_PATH = os.path.join(cls.tmp, "quality.db")
        server.BACKUP_DIR = os.path.join(cls.tmp, "backups")
        os.makedirs(server.BACKUP_DIR, exist_ok=True)
        server._seed_postgres_if_empty = lambda: None
        shutil.copy2(server._BUNDLED_SEED_DB, server.DB_PATH)
        server._ensure_admin_schema()
        server.ensure_fast_indexes()

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def setUp(self):
        self.rx = _Receiver()
        self._env = dict(os.environ)
        os.environ["ALERT_WEBHOOK_URL"] = self.rx.url
        os.environ["ALERT_COOLDOWN_MINUTES"] = "60"
        self.server.alerts._mem_state.clear()
        conn = self.server.get_conn()
        conn.execute("DELETE FROM app_state WHERE key LIKE 'alert_open:%'")
        conn.commit()
        conn.close()

    def tearDown(self):
        self.rx.close()
        os.environ.clear()
        os.environ.update(self._env)

    def test_offsite_failure_alerts_once_and_recovery_alerts_once(self):
        s = self.server
        orig = (s.is_remote_configured, s.dr_upload_file, s.dr_verify_uploaded_file)
        try:
            s.is_remote_configured = lambda: True
            def boom(*a, **k):
                raise RuntimeError("S3 unreachable")
            s.dr_upload_file = boom
            r1 = s._write_backup_file("t1")
            self.assertEqual(r1["remote_status"], "failed")
            self.assertTrue(self.rx.wait_for(1))
            self.assertIn("Off-site backup copy FAILED", self.rx.bodies[0]["text"])
            self.assertIn("S3 unreachable", self.rx.bodies[0]["text"])
            # Second failure inside the cooldown must not spam.
            s._write_backup_file("t2")
            time.sleep(0.4)
            self.assertEqual(len(self.rx.bodies), 1)
            # Off-site starts working -> a single RECOVERED message.
            s.dr_upload_file = lambda *a, **k: None
            s.dr_verify_uploaded_file = lambda *a, **k: True
            r3 = s._write_backup_file("t3")
            self.assertEqual(r3["remote_status"], "verified")
            self.assertTrue(self.rx.wait_for(2))
            self.assertIn("RECOVERED", self.rx.bodies[1]["text"])
            s._write_backup_file("t4")
            time.sleep(0.4)
            self.assertEqual(len(self.rx.bodies), 2)
        finally:
            s.is_remote_configured, s.dr_upload_file, s.dr_verify_uploaded_file = orig

    def test_local_backup_failure_alerts_and_returns_none(self):
        s = self.server
        orig = s._backup_snapshot_transaction
        try:
            def boom(reason="manual"):
                raise OSError("disk full")
            s._backup_snapshot_transaction = boom
            self.assertIsNone(s._write_backup_file("t5"))
            self.assertTrue(self.rx.wait_for(1))
            self.assertIn("Backup could NOT be created", self.rx.bodies[0]["text"])
            self.assertIn("disk full", self.rx.bodies[0]["text"])
        finally:
            s._backup_snapshot_transaction = orig
        # Next good backup clears it.
        self.assertIsNotNone(s._write_backup_file("t6"))
        self.assertTrue(self.rx.wait_for(2))
        self.assertIn("RECOVERED", self.rx.bodies[1]["text"])

    def test_status_payload_reports_alerting_flags_without_secrets(self):
        st = self.server._backup_status()
        self.assertEqual(st["alerting"]["webhook"], True)
        self.assertNotIn(self.rx.url, json.dumps(st))


# ======================== disaster recovery ========================
class DisasterRecoveryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="qd_v66_dr_")
        # Import server once, then redirect its SQLite paths to an isolated temp DB.
        os.environ.pop("DATABASE_URL", None)
        os.environ["DR_REMOTE_ENABLED"] = "false"
        import server
        cls.server = server
        cls.server.USE_POSTGRES = False
        cls.server.DB_PATH = os.path.join(cls.tmp, "quality.db")
        cls.server.BACKUP_DIR = os.path.join(cls.tmp, "backups")
        os.makedirs(cls.server.BACKUP_DIR, exist_ok=True)
        cls.server._seed_postgres_if_empty = lambda: None
        # Start this suite from the same 4,936-row bundled seed the shipped app uses,
        # then prove recovery points advance with live mutations rather than staying
        # tied to the original seed database.
        shutil.copy2(cls.server._BUNDLED_SEED_DB, cls.server.DB_PATH)
        cls.server._ensure_admin_schema()
        cls.server.ensure_fast_indexes()

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def setUp(self):
        # Each test gets the same 4,936-row baseline. This prevents test order
        # from turning a previous mutation into a false failure.
        try:
            self.server._cache_clear()
        except Exception:
            pass
        if os.path.exists(self.server.DB_PATH):
            os.remove(self.server.DB_PATH)
        shutil.copy2(self.server._BUNDLED_SEED_DB, self.server.DB_PATH)
        self.server._ensure_admin_schema()
        self.server.ensure_fast_indexes()
        self.server.BACKUP_DIR = os.path.join(self.tmp, "backups", self._testMethodName)
        shutil.rmtree(self.server.BACKUP_DIR, ignore_errors=True)
        os.makedirs(self.server.BACKUP_DIR, exist_ok=True)

    def test_v5_snapshot_tracks_live_revision_and_all_tables(self):
        s = self.server
        conn = s.get_conn()
        initial = int(conn.execute("SELECT COUNT(*) FROM disposition").fetchone()[0])
        conn.close()
        self.assertEqual(initial, 4936)
        # Add a genuinely new live record after the seed state.
        result = s._insert_records([{
            "heat_no": "TEST", "batch_no": "DR-V66-UNIQUE-20260927", "work_center": "WC", "grade": "G",
            "output_weight": 1.0, "main_defect": "SCRATCH", "defect_intensity": "LOW",
            "quality_decision": "PRIME", "insp_lot_date": "2026-09-27", "ud_date": "",
            "month": "Sep-2026", "week": "Wk of 21-Sep-26", "quarter": "Q2", "financial_year": "FY 2026-27",
        }])
        self.assertEqual(result["inserted"], 1)
        out = s._write_backup_file("test")
        self.assertIsNotNone(out)
        path = os.path.join(s.BACKUP_DIR, out["filename"])
        with gzip.open(path, "rt", encoding="utf-8") as f:
            data = json.load(f)
        self.assertEqual(data["backup_version"], 5)
        self.assertEqual(data["counts"]["disposition"], 4937)
        self.assertIn("app_state", data["persistent_tables"])
        self.assertGreaterEqual(int(data["data_revision"]), 1)
        valid, reason = s._backup_is_valid(data, require_integrity=True)
        self.assertTrue(valid, reason)
        # A later edit must advance the revision and the next recovery point must
        # reflect the current live row-set, not the original 4,936-row seed.
        conn = s.get_conn(); conn.execute("UPDATE disposition SET output_weight=? WHERE batch_no=?", (2.0, "DR-V66-UNIQUE-20260927")); s._mark_disposition_changed(conn); conn.commit(); conn.close()
        later = s._write_backup_file("test_after_update")
        later_path = os.path.join(s.BACKUP_DIR, later["filename"])
        with gzip.open(later_path, "rt", encoding="utf-8") as f: later_data = json.load(f)
        self.assertEqual(later_data["counts"]["disposition"], 4937)
        self.assertGreater(int(later_data["data_revision"]), int(data["data_revision"]))
        updated_rows = [r for r in later_data["tables"]["disposition"] if r.get("batch_no") == "DR-V66-UNIQUE-20260927"]
        self.assertEqual(len(updated_rows), 1)
        self.assertEqual(updated_rows[0]["output_weight"], 2.0)

    def test_restore_round_trip(self):
        s = self.server
        # Create current state with multiple persistent tables.
        conn = s.get_conn()
        conn.execute("INSERT INTO kpi_targets(label,target,warning,critical,direction) VALUES(?,?,?,?,?)", ("DR KPI", 90, 85, 80, "higher"))
        s._mark_non_disposition_changed(conn)
        conn.commit(); conn.close()
        backup = s._write_backup_file("roundtrip")
        path = os.path.join(s.BACKUP_DIR, backup["filename"])
        with gzip.open(path, "rt", encoding="utf-8") as f: data = json.load(f)
        conn = s.get_conn(); conn.execute("DELETE FROM kpi_targets WHERE label=?", ("DR KPI",)); s._mark_non_disposition_changed(conn); conn.commit(); conn.close()
        result = s._restore_backup_data(data)
        self.assertGreaterEqual(result["kpi_targets"], 1)
        conn = s.get_conn(); row = conn.execute("SELECT target FROM kpi_targets WHERE label=?", ("DR KPI",)).fetchone(); conn.close()
        self.assertIsNotNone(row)

    def test_strict_bool_rejects_string_false(self):
        with self.assertRaises(ValueError):
            self.server._strict_bool("false", "active")

    def test_import_history_can_commit_atomically_with_disposition(self):
        s = self.server
        batch = "DR-V66-ATOMIC-20260927"
        result = s._insert_records([{
            "heat_no": "ATOMIC", "batch_no": batch, "work_center": "WC", "grade": "G",
            "output_weight": 1.0, "main_defect": "SCRATCH", "defect_intensity": "LOW",
            "quality_decision": "PRIME", "insp_lot_date": "2026-09-27", "ud_date": "",
            "month": "Sep-2026", "week": "Wk of 21-Sep-26", "quarter": "Q2", "financial_year": "FY 2026-27",
        }], import_history={
            "filename": "atomic.xlsx", "detected": 1, "valid": 1, "duplicates": None, "errors": None, "imported_by": "tester"
        })
        self.assertEqual(result["inserted"], 1)
        conn = s.get_conn()
        disp = conn.execute("SELECT COUNT(*) FROM disposition WHERE batch_no=?", (batch,)).fetchone()[0]
        hist = conn.execute("SELECT COUNT(*) FROM import_history WHERE filename=?", ("atomic.xlsx",)).fetchone()[0]
        conn.close()
        self.assertEqual(int(disp), 1)
        self.assertEqual(int(hist), 1)

    def test_postgres_sequence_restore_guard_uses_max_id(self):
        s = self.server
        original = s.USE_POSTGRES
        try:
            s.USE_POSTGRES = True

            class FakeResult:
                def __init__(self, row): self.row = row
                def fetchone(self): return self.row

            class FakeConn:
                def __init__(self): self.calls = []
                def execute(self, sql, params=()):
                    self.calls.append((sql, params))
                    if 'information_schema.columns' in sql:
                        return FakeResult((1,))
                    if 'pg_get_serial_sequence' in sql:
                        return FakeResult(('public.disposition_id_seq',))
                    return FakeResult((123,))

            conn = FakeConn()
            s._reset_postgres_sequences(conn, ['disposition'])
            sql, params = conn.calls[-1]
            self.assertIn('setval', sql.lower())
            self.assertEqual(params, ('public.disposition_id_seq',))
            self.assertIn('MAX(id)', sql)
        finally:
            s.USE_POSTGRES = original


if __name__ == "__main__":
    unittest.main()
