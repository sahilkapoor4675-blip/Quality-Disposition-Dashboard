import gzip
import json
import os
import shutil
import tempfile
import unittest


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
    unittest.main(verbosity=2)
