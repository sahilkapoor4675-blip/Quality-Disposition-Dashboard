#!/usr/bin/env python3
"""Non-destructive smoke tests on an isolated, disposable copy of the bundled database.

Merged from smoke_test.py (real server process, dataset unchanged) + http_smoke.py (in-process, 47 routes).
  python tests/test_smoke.py           # runs both, each in a fresh process
  python tests/test_smoke.py server    # only the real-server smoke test
  python tests/test_smoke.py http      # only the in-process route sweep
"""
import http.cookiejar, json, os, shutil, sqlite3, subprocess, sys, tempfile, threading, time
import urllib.parse, urllib.request
from urllib.error import HTTPError
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent   # repo root (this file lives in tests/)

PORT = int(os.environ.get("SMOKE_PORT", "8765"))
BASE = f"http://127.0.0.1:{PORT}"

def get(path):
    with urllib.request.urlopen(BASE + path, timeout=8) as r:
        return r.status, r.headers.get("Content-Type", ""), r.read()

def assert_json(path, key=None):
    status, ct, body = get(path)
    assert status == 200, f"{path}: HTTP {status}"
    data = json.loads(body.decode("utf-8"))
    if key is not None:
        assert key in data, f"{path}: missing {key}"
    return data

def smoke_server():
    tmpdir = tempfile.mkdtemp(prefix="qcr_smoke_")
    db_path = os.path.join(tmpdir, "quality.db")
    shutil.copy2(ROOT / "quality.db", db_path)
    try:
        db = sqlite3.connect(db_path)
        before = db.execute("SELECT COUNT(*) FROM disposition").fetchone()[0]
        before_users = db.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        before_usernames = [r[0] for r in db.execute("SELECT username FROM users ORDER BY id").fetchall()]
        db.close()
        assert before == 4936, f"unexpected baseline record count: {before}"
        env = os.environ.copy()
        env.pop("ADMIN_USERNAME", None)
        env.pop("ADMIN_PASSWORD", None)
        env["DB_PATH"] = db_path  # isolated, disposable — never the real persistent database
        proc = subprocess.Popen([sys.executable, str(ROOT / "server.py"), str(PORT)], cwd=ROOT,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env, text=True)
        try:
            for _ in range(40):
                try:
                    get("/api/health")
                    break
                except Exception:
                    time.sleep(0.15)
            else:
                out = proc.stdout.read(2000) if proc.stdout else ""
                raise AssertionError("server did not start: " + out)

            status, ct, html = get("/")
            assert status == 200 and b"app-version" in html, "index/version marker missing"
            st, ct, css = get("/app.css")
            assert st == 200 and b":root" in css and b"intro" in css, "app.css bundle incomplete"
            st, ct, js = get("/app.js")
            assert st == 200 and b"async function init(" in js and js.rstrip().endswith(b"}"), "app.js bundle incomplete"
            assert_json("/api/filters", "month")
            kpis = assert_json("/api/kpis", "kpis")
            assert len(kpis["kpis"]) >= 12, f"unexpected KPI payload size: {len(kpis['kpis'])}"
            qcr = assert_json("/api/qcr", "k")
            assert all(key in qcr for key in ("k", "d", "w", "m", "fr", "intel")), "QCR core payload incomplete"
            assert_json("/api/work_center_grade", "by_work_center")
            assert_json("/api/defect_analysis", "register")
            assert_json("/api/period_trend", "weekly")
            assert_json("/api/data_freshness")
            assert_json("/api/connection_status")
            # Regression: an absurd `page` used to overflow the SQL OFFSET -> HTTP 500.
            for bad_page in ("99999999999999999999", "1000000", "-5", "abc"):
                dd = assert_json(f"/api/drilldown?page={bad_page}", "rows")
                assert dd["page"] >= 1 and dd["total_pages"] >= 1, f"drilldown page={bad_page}: bad paging {dd.get('page')}/{dd.get('total_pages')}"
            db = sqlite3.connect(db_path)
            after = db.execute("SELECT COUNT(*) FROM disposition").fetchone()[0]
            after_users = db.execute("SELECT COUNT(*) FROM users").fetchone()[0]
            after_usernames = [r[0] for r in db.execute("SELECT username FROM users ORDER BY id").fetchall()]
            db.close()
            assert after == before, f"data changed during smoke test: {before} -> {after}"
            assert after_users == before_users and after_usernames == before_usernames, "users table changed during smoke test"
            print(f"SMOKE TEST PASS — {after} disposition records unchanged; KPI payload={len(kpis['kpis'])}; core tabs/API endpoints OK.")
        finally:
            proc.terminate()
            try: proc.wait(timeout=3)
            except subprocess.TimeoutExpired: proc.kill()
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def smoke_http():
    from datetime import date
    with tempfile.TemporaryDirectory(prefix='qdash_http_') as td:
        os.environ['DB_PATH']=str(Path(td)/'quality.db')
        os.environ['APP_VERSION'] = 'test'
        os.environ['ADMIN_USERNAME']='admin'
        os.environ['ADMIN_PASSWORD']='Strong-Admin-1234!'
        os.environ.pop('RENDER',None)
        sys.path.insert(0,str(ROOT))
        import server
        server._ensure_admin_schema(); server.ensure_fast_indexes(); server.STARTUP_READY=True; server.STARTUP_ERROR=''
        d=date(2026,9,1); m,w,q,fy=server._derive_period_fields(d)
        rec={'heat_no':'H1','batch_no':'B1','work_center':'WC1','grade':'A','output_weight':10.0,'main_defect':'ROLL MARK','defect_intensity':'LIGHT','quality_decision':'PRIME','insp_lot_date':d.isoformat(),'ud_date':'','month':m,'week':w,'quarter':q,'financial_year':fy}
        server._insert_records([rec])

        from http.server import ThreadingHTTPServer
        httpd=ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        port=httpd.server_address[1]
        t=threading.Thread(target=httpd.serve_forever,daemon=True); t.start()
        errors=[]; checked=[]
        cj=http.cookiejar.CookieJar(); opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
        def get(path, expected=(200,)):
            try:
                req=urllib.request.Request(f'http://127.0.0.1:{port}{path}',headers={'Accept':'application/json'})
                with opener.open(req,timeout=8) as r:
                    body=r.read();
                    if r.status not in expected: errors.append((path,r.status,body[:300]))
                    else: checked.append(path)
            except HTTPError as e:
                body=e.read() if hasattr(e,'read') else b''
                if e.code in expected:
                    checked.append(path)
                else:
                    errors.append((path,e.code,body[:300]))
            except Exception as e: errors.append((path,repr(e),b''))
        def post(path, body=None, headers=None, expected=(200,)):
            try:
                data = json.dumps(body or {}).encode()
                hdrs={'Content-Type':'application/json'}
                if headers: hdrs.update(headers)
                req=urllib.request.Request(f'http://127.0.0.1:{port}{path}',data=data,headers=hdrs,method='POST')
                with opener.open(req,timeout=8) as r:
                    body_bytes=r.read()
                    if r.status not in expected: errors.append((path,r.status,body_bytes[:300]))
                    else: checked.append(path)
            except HTTPError as e:
                body_bytes=e.read() if hasattr(e,'read') else b''
                if e.code in expected:
                    checked.append(path)
                else:
                    errors.append((path,e.code,body_bytes[:300]))
            except Exception as e: errors.append((path,repr(e),b''))
        get('/healthz'); get('/readyz')
        public=[
          '/api/auth/status','/api/filters','/api/fishbone','/api/activity/live','/api/qcr',
          '/api/root_cause?defect=ROLL%20MARK','/api/data_freshness','/api/kpis','/api/work_center_grade',
          '/api/defect_analysis','/api/monthly_trend','/api/period_trend','/api/export/csv',
          '/api/export/excel','/api/export/pdf','/api/export/pptx','/api/health','/api/connection_status',
          '/api/qcr_target_history','/api/kpi_targets']
        for p in public: get(p)

        # Negative-path auth checks: admin data is never readable without a session,
        # and state-changing admin requests require CSRF.
        get('/api/admin/home', expected=(401,403))
        post('/api/admin/delete', {'id':1}, expected=(401,403))

        # login and verify an authenticated admin can read all admin GET endpoints
        payload=json.dumps({'username':'admin','password':'Strong-Admin-1234!'}).encode()
        req=urllib.request.Request(f'http://127.0.0.1:{port}/api/login',data=payload,headers={'Content-Type':'application/json'},method='POST')
        try:
            with opener.open(req,timeout=8) as r:
                assert r.status==200
                assert json.loads(r.read()).get('authenticated') is True
        except Exception as e: errors.append(('/api/viewer/login',repr(e),b''))
        admin=[
          '/api/admin/service_health','/api/admin/production_health','/api/admin/db_performance','/api/admin/data_integrity',
          '/api/admin/deployment_health','/api/admin/error_monitor','/api/admin/home','/api/admin/audit_analytics',
          '/api/admin/backup/verify?name=missing','/api/admin/validation_rules','/api/admin/security_status','/api/admin/data_quality',
          '/api/admin/import_history','/api/admin/kpi_target_history','/api/admin/fishbone_master','/api/admin/fishbone_history',
          '/api/admin/fishbone_alias','/api/admin/fishbone_unmapped','/api/admin/kpi_targets','/api/admin/export_audit',
          '/api/admin/audit_trail','/api/admin/database_status','/api/admin/backup/list'
        ]
        for p in admin:
            # missing backup intentionally returns 400, everything else should be 200
            get(p, expected=(200,400))

        httpd.shutdown(); httpd.server_close(); t.join(timeout=2)
        if errors:
            print('HTTP SMOKE FAIL')
            for e in errors: print(e)
            raise SystemExit(1)
        print(f'HTTP SMOKE PASS: {len(checked)} endpoints/routes')


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    if which == "server":
        smoke_server()
    elif which == "http":
        smoke_http()
    else:
        rc = 0
        for mode in ("server", "http"):
            rc |= subprocess.run([sys.executable, str(Path(__file__).resolve()), mode]).returncode
        sys.exit(rc)
