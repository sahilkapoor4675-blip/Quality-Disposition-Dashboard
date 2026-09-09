#!/usr/bin/env python3
"""Non-destructive HTTP regression suite for V27.3.
Starts the local app against the bundled SQLite DB and verifies core contracts.
"""
import json, os, sqlite3, subprocess, sys, time, urllib.parse, urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
PORT=8765
BASE=f"http://127.0.0.1:{PORT}"

def get(path):
    req=urllib.request.Request(BASE+path, headers={"Accept":"application/json"})
    with urllib.request.urlopen(req, timeout=8) as r:
        return r.status, json.loads(r.read().decode("utf-8")), dict(r.headers)

def post(path, body):
    data=json.dumps(body).encode()
    req=urllib.request.Request(BASE+path,data=data,method="POST",headers={"Content-Type":"application/json"})
    with urllib.request.urlopen(req, timeout=8) as r:
        return r.status, json.loads(r.read().decode("utf-8"))

def main():
    db=ROOT/"quality.db"
    con=sqlite3.connect(db)
    before=con.execute("select count(*) from disposition").fetchone()[0]
    fp=con.execute("select coalesce(sum(output_weight),0), min(id), max(id) from disposition").fetchone()
    con.close()
    env=os.environ.copy(); env["PORT"]=str(PORT); env.pop("ADMIN_USERNAME",None); env.pop("ADMIN_PASSWORD",None)
    p=subprocess.Popen([sys.executable,"server.py"],cwd=ROOT,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    try:
        for _ in range(40):
            try: get("/api/health"); break
            except Exception: time.sleep(.15)
        else: raise RuntimeError("server did not start")
        checks=[]
        for path in ["/api/health","/api/connection_status","/api/filters","/api/kpis","/api/qcr","/api/work_center_grade","/api/defect_analysis","/api/monthly_trend","/api/period_trend","/api/data_freshness"]:
            status,data,headers=get(path)
            assert status==200, (path,status)
            assert "X-Request-ID" in headers, path
            checks.append(path)
        # Verify the modular frontend assets are actually served by the built-in HTTP server.
        for asset in [
            '/css/01-foundation.css?v=27.3', '/css/02-components.css?v=27.3',
            '/css/03-tabs-charts.css?v=27.3', '/css/04-qcr-responsive.css?v=27.3',
            '/js/01-core-filters-kpi.js?v=27.3', '/js/02-charts.js?v=27.3',
            '/js/03-analysis-tabs.js?v=27.3', '/js/04-qcr.js?v=27.3',
            '/js/05-bootstrap.js?v=27.3']:
            req=urllib.request.Request(BASE+asset)
            with urllib.request.urlopen(req, timeout=8) as r:
                assert r.status == 200, asset

        # Exercise the real filter contract without changing data.
        params=urllib.parse.urlencode({"work_center":"CND_4HI"})
        status,_data,_=get("/api/kpis?"+params); assert status==200
        status,_data,_=get("/api/qcr?"+params); assert status==200
        con=sqlite3.connect(db)
        after=con.execute("select count(*) from disposition").fetchone()[0]
        fp2=con.execute("select coalesce(sum(output_weight),0), min(id), max(id) from disposition").fetchone()
        con.close()
        assert before==after and fp==fp2, (before,after,fp,fp2)
        print(f"V27.3 REGRESSION PASS — {before} disposition records unchanged; {len(checks)} core endpoints + filter contract OK.")
    finally:
        p.terminate();
        try: p.wait(timeout=3)
        except subprocess.TimeoutExpired: p.kill()

if __name__=="__main__": main()
