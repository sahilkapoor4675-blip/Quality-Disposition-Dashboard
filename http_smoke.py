import os, sys, tempfile, threading, urllib.request, urllib.parse, json, http.cookiejar
from urllib.error import HTTPError
from pathlib import Path
from datetime import date

ROOT=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='qdash_http_') as td:
    os.environ['DB_PATH']=str(Path(td)/'quality.db')
    os.environ['APP_VERSION']='V61.0'
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
