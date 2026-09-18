import os, sys, tempfile, threading, json, gzip, shutil
from pathlib import Path
from datetime import date

ROOT = Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='qdash_v61_') as td:
    db = Path(td)/'quality.db'
    backups = Path(td)/'backups'
    os.environ['DB_PATH'] = str(db)
    os.environ['APP_VERSION'] = 'V61.0'
    os.environ['BACKUP_DIR'] = str(backups)
    os.environ.pop('RENDER', None)
    sys.path.insert(0, str(ROOT))
    import server

    # fresh schema
    server._ensure_admin_schema()
    server.ensure_fast_indexes()
    server.STARTUP_READY = True
    server.STARTUP_ERROR = ''

    # Validate date derivation / fixture contract
    rows = []
    for i, d in enumerate([date(2026,9,1), date(2026,9,2), date(2026,8,28)], start=1):
        m,w,q,fy = server._derive_period_fields(d)
        rows.append({
            'heat_no': f'H{i}', 'batch_no': f'B{i}', 'work_center': 'WC1', 'grade': 'A',
            'output_weight': 10.0+i, 'main_defect': 'ROLL MARK' if i < 3 else '',
            'defect_intensity': 'LIGHT' if i == 1 else '',
            'quality_decision': 'PRIME' if i < 3 else 'REJECT',
            'insp_lot_date': d.isoformat(), 'ud_date': '', 'month': m, 'week': w,
            'quarter': q, 'financial_year': fy,
        })

    # Basic insert and idempotent re-import
    r1 = server._insert_records(rows)
    assert r1['inserted'] == 3 and r1['updated'] == 0
    r2 = server._insert_records(rows)
    assert r2['inserted'] == 0 and r2['updated'] == 0 and r2['duplicates'] == 3

    # Update-by-batch behavior
    changed = dict(rows[0]); changed['quality_decision'] = 'RE-WORK'; changed['output_weight'] = 99.0
    r3 = server._insert_records([changed])
    assert r3['updated'] == 1 and r3['inserted'] == 0

    # Concurrent imports for the same new batch: exactly one insert
    d = date(2026,9,3); m,w,q,fy = server._derive_period_fields(d)
    race = dict(rows[0]); race.update({'heat_no':'HRACE','batch_no':'BRACE','output_weight':22.0,'quality_decision':'PRIME','insp_lot_date':d.isoformat(),'month':m,'week':w,'quarter':q,'financial_year':fy})
    results=[]; errors=[]
    def worker():
        try: results.append(server._insert_records([race]))
        except Exception as e: errors.append(e)
    ts=[threading.Thread(target=worker) for _ in range(6)]
    [t.start() for t in ts]; [t.join() for t in ts]
    assert not errors, errors
    conn=server.get_conn(); count=conn.execute('SELECT COUNT(*) FROM disposition WHERE batch_no=?',('BRACE',)).fetchone()[0]; conn.close()
    assert count == 1, count

    # KPI/analysis smoke
    filt = {k:'All' for k in server.FILTER_KEYS}
    kpi = server.compute_kpis(filt)
    assert len(kpi['kpis']) == 12
    assert kpi['totals']['total_coils'] >= 4
    assert server.compute_monthly_trend(filt)['rows']
    assert server.compute_period_trend(filt)['rows']
    assert server.compute_defect_analysis(filt)['register']
    wcg = server.compute_work_center_grade(filt)
    assert isinstance(wcg, dict) and wcg, wcg
    server.compute_qcr_intelligence(filt, server.compute_monthly_trend(filt), server.compute_defect_analysis(filt), wcg, kpi)

    # Cache invariants
    server._cache_clear()
    for i in range(150):
        server._cache_put((f'k{i}',), {'payload':'x'*1000})
    assert len(server.RESPONSE_CACHE) <= server.RESPONSE_CACHE_MAX_ENTRIES
    assert server.RESPONSE_CACHE_BYTES <= server.RESPONSE_CACHE_MAX_BYTES
    server._cache_clear(); assert server.RESPONSE_CACHE_BYTES == 0

    # Activity retention
    conn=server.get_conn()
    for i in range(10050):
        conn.execute('INSERT INTO activity_log (event_type,ip_address,visitor_id) VALUES (?,?,?)', ('dashboard_open', '127.0.0.1', str(i)))
    conn.commit(); conn.close()
    server._cleanup_activity_log(server.get_conn(), keep=10000)
    conn=server.get_conn(); ac=conn.execute('SELECT COUNT(*) FROM activity_log').fetchone()[0]; conn.close()
    assert ac <= 10000, ac

    # Backup create + integrity + tamper detection + restore
    server.BACKUP_DIR = str(backups); backups.mkdir(parents=True, exist_ok=True)
    out = server._write_backup_file('regression')
    assert out and out['filename']
    fpath = backups / out['filename']
    with gzip.open(fpath, 'rt', encoding='utf-8') as fh: payload=json.load(fh)
    ok, msg = server._backup_is_valid(payload)
    assert ok and 'verified' in msg.lower(), msg
    tampered=dict(payload); tampered['counts']=dict(tampered['counts']); tampered['counts']['disposition'] += 1
    ok, msg=server._backup_is_valid(tampered)
    assert not ok and 'mismatch' in msg.lower(), msg

    # Legacy backup compatibility remains available without weakening V4
    # validation for new full-state backups.
    legacy = dict(payload)
    legacy.pop('integrity_sha256', None)
    legacy['backup_version'] = 3
    legacy.pop('scope', None)
    for key in ('users','activity_log','audit_trail','fishbone_import_history'):
        legacy.pop(key, None)
    ok, msg = server._backup_is_valid(legacy)
    assert ok and 'legacy' in msg.lower(), msg

    # Safety-backup failure must block a mutation rather than silently continue.
    original_writer = server._write_backup_file
    try:
        server._write_backup_file = lambda reason: None
        blocked = False
        try:
            server._require_safety_backup('regression_block')
        except RuntimeError:
            blocked = True
        assert blocked
    finally:
        server._write_backup_file = original_writer

    # Restore failures must roll back the entire transaction.
    conn=server.get_conn()
    before_count=conn.execute("SELECT COUNT(*) FROM disposition").fetchone()[0]
    conn.close()
    bad_restore = dict(payload)
    bad_restore['disposition'] = list(payload['disposition'])
    bad_restore['disposition'].append(dict(payload['disposition'][0]))
    try:
        server._restore_backup_data(bad_restore)
        raise AssertionError('malformed restore unexpectedly succeeded')
    except ValueError:
        pass
    conn=server.get_conn()
    after_count=conn.execute("SELECT COUNT(*) FROM disposition").fetchone()[0]
    conn.close()
    assert after_count == before_count, (before_count, after_count)

    # Restore into changed DB snapshot, then verify rollback-safe path logic
    conn=server.get_conn(); conn.execute("DELETE FROM disposition WHERE batch_no='BRACE'"); conn.commit(); conn.close()
    counts=server._restore_backup_data(payload)
    assert counts['disposition'] >= 4
    assert counts['users'] is not None and counts['activity_log'] is not None
    assert counts['audit_trail'] is not None and counts['fishbone_import_history'] is not None
    assert payload.get('scope') == 'full_persistent_application_state'
    assert all(k in payload for k in ('users','activity_log','audit_trail','fishbone_import_history'))

    # Backup structural validation catches tampered row/count metadata even
    # when a legacy payload has no checksum.
    legacy = dict(payload)
    legacy.pop('integrity_sha256', None)
    legacy['counts'] = dict(legacy['counts'])
    legacy['counts']['users'] += 1
    ok, msg = server._backup_is_valid(legacy)
    assert not ok and 'count mismatch' in msg.lower(), msg

    # Input validation / CSV injection
    bad=dict(rows[0]); bad['batch_no']='BAD'; bad['output_weight']=float('nan')
    assert server._validate_record(bad) == 'Output Weight must be a finite number'
    assert server._csv_safe_value('=SUM(A1)') == "'=SUM(A1)"
    assert server._csv_safe_value(12.5) == 12.5

    # Report filenames must never inject HTTP header control characters or
    # quoted path separators into Content-Disposition.
    from reports import _safe_filename
    fn = _safe_filename({'Defect': 'A\\r\\nContent-Disposition: x', 'Grade': 'A/B"Q'}, '.xlsx')
    assert '\\r' not in fn and '\\n' not in fn and '"' not in fn and '\\\\' not in fn
    assert '/' not in fn and fn.endswith('.xlsx')

    # HTTP health/readiness smoke using an in-process server
    from http.server import ThreadingHTTPServer
    import urllib.request, urllib.error
    httpd = ThreadingHTTPServer(('127.0.0.1',0), server.Handler)
    port=httpd.server_address[1]
    th=threading.Thread(target=httpd.serve_forever, daemon=True); th.start()
    try:
        for path in ['/healthz','/readyz','/api/auth/status','/api/filters','/api/kpis']:
            with urllib.request.urlopen(f'http://127.0.0.1:{port}{path}', timeout=5) as resp:
                assert resp.status == 200, (path, resp.status)
                data=resp.read()
                assert data, path

        # Render ADMIN_PASSWORD is provisioning-only: once a DB user exists,
        # the old environment password must not continue to authenticate.
        server.ADMIN_USERNAME = 'render_admin'
        server.ADMIN_PASSWORD = 'EnvOnly-Strong-Password-1!'
        def post_json(path, body):
            req = urllib.request.Request(
                f'http://127.0.0.1:{port}{path}',
                data=json.dumps(body).encode(),
                headers={'Content-Type':'application/json'},
                method='POST'
            )
            try:
                with urllib.request.urlopen(req, timeout=5) as resp:
                    return resp.status, json.loads(resp.read().decode())
            except urllib.error.HTTPError as e:
                return e.code, json.loads(e.read().decode())
        status, body = post_json('/api/login', {'username':'render_admin','password':server.ADMIN_PASSWORD})
        assert status == 200 and body.get('authenticated') is True, (status, body)
        conn=server.get_conn()
        conn.execute("DELETE FROM users WHERE username=?", ('render_admin',))
        conn.execute("INSERT INTO users (username,display_name,password_hash,role,active,must_reset_password) VALUES (?,?,?,?,?,?)",
                     ('render_admin','Render Admin',server._hash_password('DatabaseOnly-Strong-Password-2!'),'admin',1,0))
        conn.commit(); conn.close()
        status, _ = post_json('/api/login', {'username':'render_admin','password':'EnvOnly-Strong-Password-1!'})
        assert status == 401, status
        status, body = post_json('/api/login', {'username':'render_admin','password':'DatabaseOnly-Strong-Password-2!'})
        assert status == 200 and body.get('authenticated') is True, (status, body)
    finally:
        httpd.shutdown(); httpd.server_close(); th.join(timeout=2)

    # Admin inline-handler hardening: dynamic strings must not be injected into
    # double-quoted HTML attributes through raw JSON.stringify()/HTML escaping.
    admin_html = (ROOT / 'admin.html').read_text(encoding='utf-8')
    assert 'function escAttrJs(value)' in admin_html
    assert 'revokeAdminSession(${JSON.stringify(s.username)})' not in admin_html
    assert "fbSaveAlias('${esc(r.defect)" not in admin_html
    assert 'loadRecords(${JSON.stringify(String(r.id))})' not in admin_html
    assert "resetUserPassword(${r.id},'${escAttrJs(r.username)}')" in admin_html

    # Security hardening invariants.
    src = (ROOT / 'server.py').read_text(encoding='utf-8')
    assert 'not row' in src[src.find('if path == "/api/login":'):src.find('if path == "/api/logout":')]
    assert 'before_disposition_import' in src
    assert 'before_record_delete' in src
    assert 'before_fishbone_alias_set' in src
    assert 'before_fishbone_alias_delete' in src
    assert 'TRUST_PROXY_HEADERS", "false"' in src
    assert 'scope": "full_persistent_application_state"' in src
    assert 'backup_version' in src and 'version >= 4' in src

    print('V61 DEEP REGRESSION PASS')
    print('rows_ok=1 import_concurrency=1 kpi=1 cache=1 activity_retention=1 backup_integrity=1 restore=1 restore_rollback=1 full_state_backup=1 safety_gate=1 report_filename=1 http=1 admin_handler_hardening=1 security_hardening=1')
