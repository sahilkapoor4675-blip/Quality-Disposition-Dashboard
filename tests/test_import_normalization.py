#!/usr/bin/env python3
"""Regression checks for the V66.1 audit fixes: disposition date/ID parsing, Work Center / Grade canonicalisation,
the 'NONE' intensity option, Quarter -> financial-year resolution and the duplicate-heat message.
Runs on a temporary copy of the bundled database. Run: python tests/test_import_normalization.py"""
import datetime as dt, os, shutil, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
tmp = Path(tempfile.mkdtemp(prefix="qdash_norm_"))
shutil.copy2(ROOT / "quality.db", tmp / "quality.db")
os.environ["DB_PATH"] = str(tmp / "quality.db"); os.environ["BACKUP_DIR"] = str(tmp / "b")
sys.argv = ["server.py"]
import server as S
import chem_spc as C

ERR = []
def check(c, m):
    if not c: ERR.append(m)

D = dt.date
for v, want in [("2026-04-12", D(2026, 4, 12)), ("12.04.2026", D(2026, 4, 12)), ("12.04.26", D(2026, 4, 12)), ("2026-04-12 00:00:00", D(2026, 4, 12)),
                ("2026-04-12T08:30:00", D(2026, 4, 12)), ("12 Apr 2026", D(2026, 4, 12)), ("2026/04/12", D(2026, 4, 12)), ("12/04/2026", D(2026, 4, 12)),
                ("04/13/2026", D(2026, 4, 13)), (46124, D(2026, 4, 12)), ("46124", D(2026, 4, 12)), ("12-Apr-2026", D(2026, 4, 12)),
                (dt.datetime(2026, 4, 12, 8, 30), D(2026, 4, 12)), ("", None), (None, None), ("not a date", None), ("31.02.2026", None), (7, None)]:
    check(S._parse_date(v) == want, f"_parse_date({v!r}) = {S._parse_date(v)!r}, expected {want!r}")

m = {"heat_no": 0, "batch_no": 1, "work_center": 2, "grade": 3, "output_weight": 4, "main_defect": 5, "defect_intensity": 6, "quality_decision": 7, "insp_lot_date": 8, "ud_date": 9}
r = S._record_from_values(["nbs 6348", 2000000001.0, " cnd_slt ", "NI-Brass   (Ni - 05)", "4.5", "scratch", "", "prime", "12.04.2026", "13.04.2026 10:00:00"], m)
check(r["heat_no"] == "NBS6348" and r["batch_no"] == "2000000001", f"IDs not normalised: {r['heat_no']!r} {r['batch_no']!r}")
check(r["insp_lot_date"] == "2026-04-12" and r["month"] == "Apr-2026" and r["quarter"] == "Q1", "SAP dd.mm.yyyy date not read")
check(r["grade"] == "NI-Brass (Ni - 05)", "grade whitespace not collapsed")
check(S._record_from_values(["H1", "2000000002.0", "", "", "1", "", "", "prime", "2026-04-12", ""], m)["batch_no"] == "2000000002", "'.0' batch suffix kept")
check(S._validate_record(r) == "", "a normalised record must validate: " + S._validate_record(r))

recs = S._canonicalize_dimensions([dict(r), dict(r, work_center="Brand New WC", grade="ni-brass (ni - 05)")])
check(recs[0]["work_center"] == "CND_SLT", f"work centre not matched to stored spelling: {recs[0]['work_center']!r}")
check(recs[1]["grade"] == "NI-Brass (Ni - 05)" and recs[1]["work_center"] == "Brand New WC", "grade case-match / unknown work centre kept as typed")

# 'NONE' intensity option only when such rows exist in scope
opts = S.get_filter_options({"quality_decision": "REJECT", "work_center": "All", "grade": "All", "month": "All", "week": "All", "quarter": "All", "financial_year": "All", "defect_intensity": "All"})
conn = S.get_conn(); blank = conn.execute("SELECT COUNT(*) FROM disposition WHERE quality_decision='REJECT' AND TRIM(COALESCE(defect_intensity,''))=''").fetchone()[0]; conn.close()
check(("NONE" in opts["defect_intensity"]) == (blank > 0), f"NONE offered={('NONE' in opts['defect_intensity'])} but blank rows={blank}")
check("NONE" in S.get_filter_options(None)["defect_intensity"], "NONE must be offered on the unfiltered list")

# Quarter without FY -> latest FY holding that quarter (only when several FYs exist)
conn = S.get_conn()
conn.execute("INSERT INTO disposition (heat_no,batch_no,work_center,grade,output_weight,main_defect,defect_intensity,quality_decision,insp_lot_date,ud_date,month,week,quarter,financial_year) VALUES ('NBS1','Z1','CND_SLT','G',1,'NO DEFECT','','PRIME','2025-05-05','2025-05-05','May-2025','Wk of 05-May-25','Q1','FY 2025-26')")
conn.commit(); conn.close()
f = S._filters_from_qs({"quarter": "Q1"})
check(f["financial_year"] == "FY 2026-27", f"Quarter=Q1 with two FYs must resolve to the latest FY, got {f['financial_year']}")
check(S._filters_from_qs({"quarter": "Q1", "financial_year": "FY 2025-26"})["financial_year"] == "FY 2025-26", "an explicit FY must win")
check(S._filters_from_qs({"month": "Apr-2026"})["financial_year"] == "All", "no quarter -> FY untouched")

# duplicate heat on two sheets with identical values: honest message
def row(i, sheet): return {"heat_no": "NBS1", "cast_date": "01.05.2026", "alloy": "NBS", "denomination": "5RS", "analyst": "S", "cu": 75.0, "ni": 5.0, "zn": 19.95, "_sheet": sheet, "_row": i}
res = C.validate_rows([row(2, "A"), row(2, "B")])
check(res["errors"] == 2 and "different sheets" in res["issues"][0]["message"], "same values on two sheets must say 'different sheets'")
res = C.validate_rows([row(2, "A"), dict(row(3, "A"), cu=74.0)])
check("different values" in res["issues"][0]["message"], "changed values keep the 'different values' message")

if ERR:
    print("FAIL"); [print(" -", e) for e in ERR]; sys.exit(1)
print("OK: import normalisation / filter-option / quarter-FY regression checks passed")
