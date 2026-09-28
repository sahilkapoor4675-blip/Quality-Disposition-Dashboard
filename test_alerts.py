import json
import os
import shutil
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer


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


if __name__ == "__main__":
    unittest.main()
