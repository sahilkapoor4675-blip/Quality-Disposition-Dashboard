"""V64.3 regression checks (isolated temp database; never touches production data).

Covers: one-response-per-request, malformed filter values, Data Quality Monitor
key alignment, intensity rule for NO DEFECT coils, drill-down totals, per-FY quarters.
"""
import os, sys, re, json, socket, tempfile, threading, http.client
from pathlib import Path
from datetime import date

ROOT = Path(__file__).resolve().parent
with tempfile.TemporaryDirectory(prefix='qdash_v643_') as td:
    os.environ.update(DB_PATH=str(Path(td) / 'quality.db'), APP_VERSION='test',
                      ADMIN_USERNAME='admin', ADMIN_PASSWORD='Strong-Admin-1234!')
    os.environ.pop('RENDER', None)
    sys.path.insert(0, str(ROOT))
    import server
    server._ensure_admin_schema(); server.ensure_fast_indexes(); server.STARTUP_READY = True
    _c = server.get_conn(); _c.execute('DELETE FROM disposition'); _c.commit(); _c.close()   # start from a known, tiny dataset

    def rec(batch, d, defect, intensity, decision='PRIME', w=5.0):
        m, wk, q, fy = server._derive_period_fields(d)
        return {'heat_no': 'H' + batch, 'batch_no': batch, 'work_center': 'WC1', 'grade': 'A', 'output_weight': w,
                'main_defect': defect, 'defect_intensity': intensity, 'quality_decision': decision,
                'insp_lot_date': d.isoformat(), 'ud_date': '', 'month': m, 'week': wk, 'quarter': q, 'financial_year': fy}
    server._insert_records([
        rec('B1', date(2026, 5, 4), 'NO DEFECT', ''),
        rec('B2', date(2026, 5, 5), 'STICKING', 'LIGHT', 'REJECT'),
        rec('B3', date(2026, 5, 6), 'STICKING', ''),            # the ONLY real intensity gap
        rec('B4', date(2027, 5, 4), 'NO DEFECT', ''),           # same quarter label, next FY
    ])
    from http.server import ThreadingHTTPServer
    httpd = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    errors = []

    def raw(path):
        s = socket.create_connection(('127.0.0.1', port))
        s.sendall(f'GET {path} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'.encode())
        data = b''
        while True:
            c = s.recv(65536)
            if not c: break
            data += c
        return data

    def get(path, cookie=''):
        c = http.client.HTTPConnection('127.0.0.1', port, timeout=20)
        c.request('GET', path, headers={'Cookie': cookie} if cookie else {})
        r = c.getresponse(); b = r.read(); c.close()
        return r.status, (json.loads(b) if b[:1] in (b'{', b'[') else b)

    # 1) exactly one HTTP response per request
    for p in ('/api/kpis', '/api/filters', '/api/export/csv', '/', '/api/nope'):
        n = raw(p).count(b'HTTP/1.')
        if n != 1: errors.append(f'{p}: {n} HTTP responses in one stream')

    # 2) malformed / odd-case filter values never produce a 500
    for q in ('month=garbage', 'week=garbage', 'financial_year=junk', 'month=ALL', 'quarter=X&financial_year=FY%202026-27'):
        for ep in ('/api/kpis', '/api/qcr', '/api/period_trend', '/api/drilldown?metric=Total%20Coils&'):
            url = ep + ('' if ep.endswith('&') else '?') + q
            s, d = get(url)
            if s != 200: errors.append(f'{url} -> {s}')
            if ep == '/api/qcr' and isinstance(d, dict) and d.get('section_errors'): errors.append(f'{url} section_errors {d["section_errors"]}')
    s, d = get('/api/kpis?month=ALL')
    if d['totals']['total_coils'] != 4: errors.append('month=ALL should behave like All')
    s, d = get('/api/drilldown?metric=Total%20Coils&page=abc&page_size=x')
    if s != 200 or d.get('page') != 1: errors.append('non-numeric page must fall back to defaults')

    # 3) drill-down count / rows agree, including the NO DEFECT edge case
    for m, v in (('defect_category', 'NO DEFECT'), ('defect_category', 'STICKING'), ('Reject Qty (MT)', None)):
        s, d = get('/api/drilldown?metric=' + m.replace(' ', '%20') + (('&drill_value=' + v.replace(' ', '%20')) if v else ''))
        if d['row_count'] != len(d['rows']): errors.append(f'drill {m}/{v}: row_count {d["row_count"]} != rows {len(d["rows"])}')

    # 4) quarters are grouped per financial year
    s, d = get('/api/period_trend')
    names = [r['name'] for r in d['quarterly']]
    if names != ['Q1 (FY 2026-27)', 'Q1 (FY 2027-28)']: errors.append(f'quarterly labels {names}')
    if [r['coils'] for r in d['quarterly']] != [3, 1]: errors.append('quarterly coil counts wrong')

    # 5) Data Quality Monitor: UI keys exist in the payload, NO DEFECT coils are not flagged
    import urllib.request
    login = urllib.request.Request(f'http://127.0.0.1:{port}/api/login', data=json.dumps({'username': 'admin', 'password': 'Strong-Admin-1234!'}).encode(), headers={'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(login) as r:
        cookie = '; '.join(h.split(';')[0] for h in r.headers.get_all('Set-Cookie'))
    s, dq = get('/api/admin/data_quality', cookie)
    html = (ROOT / 'admin.html').read_text(encoding='utf-8')
    fn = re.search(r'async function loadDataQuality\(\)\{.*?\n', html).group(0)
    for key in set(re.findall(r'\bi\.([a-z_]+)', fn)):
        if key not in dq['issues']: errors.append(f'admin.html loadDataQuality reads unknown key issues.{key}')
    if dq['issues']['missing_intensity'] != 1: errors.append(f'missing_intensity should be 1, got {dq["issues"]["missing_intensity"]}')
    if 'records_require_correction' not in dq or 'dqCorrections' not in fn: errors.append('records_require_correction not wired to the UI')

    # 6) KPI target validation
    import urllib.error
    def post(path, body):
        req = urllib.request.Request(f'http://127.0.0.1:{port}{path}', data=json.dumps(body).encode(), method='POST',
                                     headers={'Content-Type': 'application/json', 'Cookie': cookie, 'X-CSRF-Token': re.search(r'qdash_csrf=([^;]+)', cookie).group(1)})
        try:
            with urllib.request.urlopen(req) as r: return r.status
        except urllib.error.HTTPError as e: return e.code
    if post('/api/admin/kpi_target', {'label': 'Defect Rate', 'target': 'nan', 'warning': 0.03, 'critical': 0.05, 'direction': 'lower'}) != 400: errors.append('NaN KPI target accepted')
    if post('/api/admin/kpi_target', {'label': 'Defect Rate', 'target': 0.05, 'warning': 0.03, 'critical': 0.01, 'direction': 'lower'}) != 400: errors.append('reversed KPI bands accepted')

    # 9) the Defect Intensity Breakdown chart's drill-down (added after the
    #    scroll/fishbone fixes above) must return the same counts the chart
    #    itself displays, including the "WITHOUT INTENSITY" bucket which maps
    #    to a blank/NULL column value rather than a literal string match.
    for level, expect in (('LIGHT', 1), ('WITHOUT INTENSITY', 3)):
        s, d = get('/api/drilldown?metric=intensity_category&drill_value=' + level.replace(' ', '%20'))
        if s != 200 or d.get('count') != expect:
            errors.append(f'intensity_category drilldown for {level!r}: status={s} count={d.get("count")} expected={expect}')

    # 7) scroll-to-top on tab switch: no server-side check possible headlessly here,
    #    so assert the browser-facing contract in app.js instead - every activateTab
    #    call resets scroll unless it explicitly opts out for back/forward navigation.
    appjs = (ROOT / 'app.js').read_text(encoding='utf-8')
    if 'function resetPageScroll(' not in appjs: errors.append('resetPageScroll() helper missing from app.js')
    if 'if(!(opts && opts.keepScroll)) resetPageScroll();' not in appjs: errors.append('activateTab no longer resets scroll on switch')

    # 8) restoring a backup that contains fishbone import history must not 500
    #    (INSERT column count previously did not match the supplied values).
    try:
        import openpyxl
        wb = __import__('io').BytesIO()
        book = openpyxl.Workbook(); ws = book.active
        ws.append(["Defect Name", "Man", "Machine", "Material", "Method", "Measurement", "Environment"])
        ws.append(["STICKING", "Operator error", "Roll wear", "Batch impurity", "SOP gap", "Gauge drift", "Humidity"])
        book.save(wb); wb.seek(0)
        bundle = server._parse_fishbone_file('fb.xlsx', wb.read())
        server._replace_fishbone_master(bundle, 'fb.xlsx', 'admin')
    except ImportError:
        pass  # openpyxl not installed in this environment; the restore check below still runs against whatever history exists
    snap = server._backup_snapshot_transaction('test')
    try:
        server._restore_backup_data(snap)
    except Exception as e:
        errors.append(f'restoring a backup with fishbone_import_history failed: {e}')

    if errors:
        print('V64.3 REGRESSION FAIL'); [print(' -', e) for e in errors]; sys.exit(1)
    print('V64.3 REGRESSION PASS — single response, safe filters, drill totals, per-FY quarters, data-quality wiring, KPI validation, scroll-reset, fishbone-backup restore, intensity drilldown.')
