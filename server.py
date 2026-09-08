#!/usr/bin/env python3
"""
Quality Disposition Control Dashboard
Pure Python built-in HTTP server + SQLite/PostgreSQL. No Flask. No external CDN.
Run:  python3 server.py [port]
Then open http://localhost:8000/  (default port 8000)
"""

import json
import math
import os
import sqlite3

try:
    import psycopg2
    from psycopg2.extras import DictCursor
except ImportError:
    psycopg2 = None
    DictCursor = None
import secrets
import hashlib
import hmac
import csv
import io
import shutil
from email.parser import BytesParser
from email.policy import default
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

APP_DIR = os.path.dirname(os.path.abspath(__file__))
# Recommended for Render Free: set DATABASE_URL to an external PostgreSQL
# database (Supabase/Neon/etc.). If DATABASE_URL is absent, the app falls
# back to SQLite for local use and development.
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
DB_PATH = os.environ.get("DB_PATH", os.path.join(APP_DIR, "quality.db"))
USE_POSTGRES = bool(DATABASE_URL)

def _ensure_database():
    """Create the local SQLite DB from the bundled seed DB when needed."""
    if USE_POSTGRES:
        return
    if os.path.abspath(DB_PATH) == os.path.join(APP_DIR, "quality.db"):
        return
    parent = os.path.dirname(DB_PATH)
    os.makedirs(parent, exist_ok=True)
    if not os.path.exists(DB_PATH):
        seed = os.path.join(APP_DIR, "quality.db")
        if os.path.exists(seed):
            shutil.copy2(seed, DB_PATH)

_ensure_database()

FILTER_KEYS = [
    "month", "work_center", "grade", "quality_decision",
    "week", "quarter", "financial_year", "defect_intensity",
]

DECISION_ORDER = ["PRIME", "FOR NEXT PROCESS", "SALVAGE", "HOLD FOR DECISION",
                   "REJECT", "RE-WORK", "DIVERT"]

# Full canonical list of main-defect types (from the workbook's Lists sheet).
# Used so the Defect Analysis register always shows every defect type,
# even ones with zero occurrences in the current filter selection.
MAIN_DEFECTS_FULL_LIST = [
    "ACID STAINS", "BLACK PATCHES", "CASTING DEFECTS", "COOLANT PATCHES",
    "CRACKED EDGE", "DENT", "DENT MARK", "EDGE FOLD", "GAUGE VARIATION",
    "HIGH WEIGHT", "HOLE", "IMPROPER ANNEALING", "INTERWRAP SCRATCHES (R",
    "INTERWRAP SCRATCHES (U", "LESS WEIGHT COIL", "LINE SCRT (ROLLED)",
    "LINE SCRT (UNROLLED)", "MILLING TIP MARKS", "OTHERS", "PIN HOLE",
    "POOR BUILD UP", "POOR PICKLING", "REDISH SURFACE", "ROLL MARK",
    "ROLL PICK-UP", "ROLL SKIDDING MARK / R", "ROLL SOFT MARKS", "ROLL STOP",
    "SCOOPING SCRT (UNROLLE", "SCRATCH", "SHINING SCRATCH", "SLIVER-B",
    "STICKING", "SURFACE CRACKS", "SURFACE FOLD",
]

import datetime as _dt


def _month_sort_key(m):
    try:
        return _dt.datetime.strptime(m, "%b-%Y")
    except ValueError:
        return _dt.datetime.max


def _week_sort_key(w):
    try:
        # "Wk of 06-Apr-26" -> "06-Apr-26"
        date_part = w.replace("Wk of ", "").strip()
        return _dt.datetime.strptime(date_part, "%d-%b-%y")
    except ValueError:
        return _dt.datetime.max

def _week_display_label(w):
    """Convert stored week label (Monday start) to a full Monday-Sunday date range."""
    try:
        start = _dt.datetime.strptime(w.replace("Wk of ", "").strip(), "%d-%b-%y")
        end = start + _dt.timedelta(days=6)
        return f"{start.strftime('%d-%b-%Y')} to {end.strftime('%d-%b-%Y')}"
    except ValueError:
        return w


# ---------------------------------------------------------------------------
# Previous-period comparison engine (replicates the "KPI Comparison" sheet)
# ---------------------------------------------------------------------------

def _prev_month_label(m):
    dt = _dt.datetime.strptime(m, "%b-%Y")
    year, month = dt.year, dt.month - 1
    if month == 0:
        month = 12
        year -= 1
    return _dt.datetime(year, month, 1).strftime("%b-%Y")


def _prev_week_label(w):
    date_part = w.replace("Wk of ", "").strip()
    dt = _dt.datetime.strptime(date_part, "%d-%b-%y")
    prev_dt = dt - _dt.timedelta(days=7)
    return "Wk of " + prev_dt.strftime("%d-%b-%y")


def _prev_fy_label(fy):
    import re
    m = re.search(r"(\d{4})", fy)
    start = int(m.group(1))
    prev_start = start - 1
    prev_end = (prev_start + 1) % 100
    return f"FY {prev_start}-{prev_end:02d}"


def _prev_quarter_label(q, fy):
    qnum = int(q[1:])
    if qnum == 1:
        return "Q4", (_prev_fy_label(fy) if fy != "All" else "All")
    return f"Q{qnum-1}", fy


def compute_prev_filters(filters):
    """Return the filter dict representing the 'previous period', following
    the same priority as the workbook (Week > Month > Quarter > Year).
    Returns None if no single time filter is active (comparison undefined)."""
    if filters.get("week", "All") != "All":
        pf = dict(filters)
        pf["week"] = _prev_week_label(filters["week"])
        pf["month"] = "All"; pf["quarter"] = "All"; pf["financial_year"] = "All"
        return pf
    if filters.get("month", "All") != "All":
        pf = dict(filters)
        pf["month"] = _prev_month_label(filters["month"])
        pf["week"] = "All"; pf["quarter"] = "All"; pf["financial_year"] = "All"
        return pf
    if filters.get("quarter", "All") != "All":
        pf = dict(filters)
        prev_q, prev_fy = _prev_quarter_label(filters["quarter"], filters.get("financial_year", "All"))
        pf["quarter"] = prev_q; pf["financial_year"] = prev_fy
        pf["month"] = "All"; pf["week"] = "All"
        return pf
    if filters.get("financial_year", "All") != "All":
        pf = dict(filters)
        pf["financial_year"] = _prev_fy_label(filters["financial_year"])
        pf["month"] = "All"; pf["week"] = "All"; pf["quarter"] = "All"
        return pf
    return None


def current_period_label(filters):
    if filters.get("week", "All") != "All":
        return _week_display_label(filters["week"])
    if filters.get("month", "All") != "All":
        return filters["month"]
    if filters.get("quarter", "All") != "All":
        return f'{filters["quarter"]} ({filters.get("financial_year","All")})'
    if filters.get("financial_year", "All") != "All":
        return filters["financial_year"]
    return "All Periods"


# KPI metadata: card color + whether an increase is good/bad/neutral +
# whether the trend is shown as a relative % change or absolute points (pts).
# Colors match the original workbook exactly (extracted from its font colors).
# Keyed by label so metadata always travels with its metric, even if the
# metric's position in the kpis list is later swapped for display purposes.
KPI_META_BY_LABEL = {
    "Total Coils":                   {"color": "#0f2a4a", "direction": "neutral",   "change": "pct"},
    "Defect Coils":                  {"color": "#DC2626", "direction": "down_good", "change": "pct"},
    "First Pass Yield %":            {"color": "#16A34A", "direction": "up_good",   "change": "pct"},
    "Hold for Decision % Qty":       {"color": "#D97706", "direction": "down_good", "change": "pct"},
    "Output Quantity (MT)":          {"color": "#0f2a4a", "direction": "neutral",   "change": "pct"},
    "PPM Defective":                 {"color": "#DC2626", "direction": "down_good", "change": "pct"},
    "Reject Qty (MT)":               {"color": "#DC2626", "direction": "down_good", "change": "pct"},
    "Intensity Tagging %":           {"color": "#D97706", "direction": "down_good", "change": "pct"},
    "Salvage + Divert Qty (MT)":     {"color": "#7C3AED", "direction": "down_good", "change": "pct"},
    "Defect Rate":                   {"color": "#DC2626", "direction": "down_good", "change": "pct"},
    "Reject % Qty":                  {"color": "#DC2626", "direction": "down_good", "change": "pct"},
    "Process Sigma Level (Approx.)": {"color": "#16A34A", "direction": "up_good",   "change": "pct"},
    "Hold For Decision Qty (MT)":    {"color": "#D97706", "direction": "down_good", "change": "pct"},
    "Salvage % Qty":                 {"color": "#7C3AED", "direction": "down_good", "change": "pct"},
    "Rework % Qty":                  {"color": "#D97706", "direction": "down_good", "change": "pct"},
    "Without Intensity %":           {"color": "#64748B", "direction": "up_good",   "change": "pct"},
}


class _PGCursor:
    def __init__(self, cur):
        self.cur = cur
    def execute(self, sql, params=None):
        sql = sql.replace("?", "%s")
        return self.cur.execute(sql, params or ())
    def executemany(self, sql, seq):
        sql = sql.replace("?", "%s")
        return self.cur.executemany(sql, seq)
    def fetchone(self): return self.cur.fetchone()
    def fetchall(self): return self.cur.fetchall()
    @property
    def rowcount(self): return self.cur.rowcount

class _PGConn:
    def __init__(self, conn): self.conn = conn
    def cursor(self): return _PGCursor(self.conn.cursor(cursor_factory=DictCursor))
    def execute(self, sql, params=None):
        c=self.cursor(); c.execute(sql, params); return c
    def commit(self): self.conn.commit()
    def close(self): self.conn.close()

def get_conn():
    if USE_POSTGRES:
        if psycopg2 is None:
            raise RuntimeError("PostgreSQL support requires psycopg2-binary. Add DATABASE_URL only after dependencies are installed.")
        return _PGConn(psycopg2.connect(DATABASE_URL, connect_timeout=10, sslmode=os.environ.get("PGSSLMODE", "require")))
    conn = sqlite3.connect(DB_PATH, timeout=5, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=3000")
    conn.execute("PRAGMA temp_store=MEMORY")
    conn.execute("PRAGMA cache_size=-16000")
    return conn


def ensure_fast_indexes():
    """Create lightweight indexes used by dashboard filter/group queries."""
    conn = get_conn()
    indexes = [
        ("idx_disp_month", "month"), ("idx_disp_work_center", "work_center"),
        ("idx_disp_grade", "grade"), ("idx_disp_quality_decision", "quality_decision"),
        ("idx_disp_week", "week"), ("idx_disp_quarter", "quarter"),
        ("idx_disp_financial_year", "financial_year"),
        ("idx_disp_defect_intensity", "defect_intensity"),
        ("idx_disp_main_defect", "main_defect"),
    ]
    for name, col in indexes:
        conn.execute(f"CREATE INDEX IF NOT EXISTS {name} ON disposition({col})")
    conn.commit()
    conn.close()


def norm_sinv(p):
    """Inverse standard normal CDF (Acklam's algorithm) - no scipy needed."""
    if p <= 0:
        return -8.0
    if p >= 1:
        return 8.0
    a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
         1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00]
    b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
         6.680131188771972e+01, -1.328068155288572e+01]
    c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
         -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00]
    d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
         3.754408661907416e+00]
    p_low = 0.02425
    p_high = 1 - p_low
    if p < p_low:
        q = math.sqrt(-2 * math.log(p))
        return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / \
               ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)
    elif p <= p_high:
        q = p - 0.5
        r = q*q
        return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / \
               (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1)
    else:
        q = math.sqrt(-2 * math.log(1 - p))
        return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / \
                ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)


def build_where(filters, exclude=None):
    """Build SQL WHERE clause + params replicating the workbook's Full_Match logic.
    `exclude` is a set of filter keys to skip (used by analysis views where a
    dimension is the thing being broken down, e.g. Work Center in the
    Work Center analysis, or Month in the Monthly Trend)."""
    exclude = exclude or set()
    clauses = []
    params = []
    for key in FILTER_KEYS:
        if key in exclude:
            continue
        val = filters.get(key, "All")
        if not val or val == "All":
            continue
        if key == "defect_intensity" and val == "NONE":
            clauses.append("TRIM(COALESCE(defect_intensity,'')) = ''")
        else:
            clauses.append(f"{key} = ?")
            params.append(val)
    where = " AND ".join(clauses)
    return (f"WHERE {where}" if where else "", params)


def kpi_threshold_color(label, value):
    """Return KPI value color according to the requested operating bands."""
    green, amber, red = "#16A34A", "#D97706", "#DC2626"
    if label in ("First Pass Yield %", "For Next Process %"):
        return green if value > 0.97 else amber if value >= 0.90 else red
    if label in ("Salvage % Qty", "Reject % Qty", "Rework % Qty", "Hold for Decision % Qty", "Hold For Decision % Qty"):
        return green if value < 0.01 else amber if value <= 0.03 else red
    if label == "Process Sigma Level (Approx.)":
        return green if value > 3 else amber if value >= 2 else red
    if label == "PPM Defective":
        return green if value <= 10000 else amber if value <= 30000 else red
    if label == "Intensity Tagging %":
        return green if value < 0.05 else amber if value <= 0.10 else red
    if label == "Without Intensity %":
        return green if value > 0.90 else amber if value >= 0.85 else red
    return None


def compute_kpis(filters, _skip_prev=False):
    conn = get_conn()
    cur = conn.cursor()
    where_sql, params = build_where(filters)

    # Total Coils
    cur.execute(f"SELECT COUNT(*) FROM disposition {where_sql}", params)
    total_coils = cur.fetchone()[0]

    # Defect Coils: main_defect present and not 'NO DEFECT'
    dc_where = where_sql + (" AND " if where_sql else "WHERE ") + \
        "main_defect <> '' AND main_defect <> 'NO DEFECT'"
    cur.execute(f"SELECT COUNT(*) FROM disposition {dc_where}", params)
    defect_coils = cur.fetchone()[0]

    # Output Quantity (MT) = sum of output_weight for filtered rows
    cur.execute(f"SELECT COALESCE(SUM(output_weight),0) FROM disposition {where_sql}", params)
    output_qty = cur.fetchone()[0]

    # Per-decision sums (Qty MT) and coil counts for filtered rows
    decision_qty = {}
    decision_coils = {}
    for d in DECISION_ORDER:
        w2 = where_sql + (" AND " if where_sql else "WHERE ") + "quality_decision = ?"
        p2 = params + [d]
        cur.execute(f"SELECT COUNT(*), COALESCE(SUM(output_weight),0) FROM disposition {w2}", p2)
        cnt, qty = cur.fetchone()
        decision_coils[d] = cnt
        decision_qty[d] = qty

    prime_qty = decision_qty["PRIME"]
    reject_qty = decision_qty["REJECT"]
    salvage_qty = decision_qty["SALVAGE"]
    divert_qty = decision_qty["DIVERT"]
    hold_qty = decision_qty["HOLD FOR DECISION"]
    rework_qty = decision_qty["RE-WORK"]

    first_pass_yield = (prime_qty / output_qty) if output_qty else 0.0
    ppm_defective = (defect_coils / total_coils * 1_000_000) if total_coils else 0.0
    defect_rate = (defect_coils / total_coils) if total_coils else 0.0
    reject_pct_qty = (reject_qty / output_qty) if output_qty else 0.0
    salvage_divert_qty = salvage_qty + divert_qty
    hold_pct_qty = (hold_qty / output_qty) if output_qty else 0.0
    salvage_pct_qty = (salvage_qty / output_qty) if output_qty else 0.0
    rework_pct_qty = (rework_qty / output_qty) if output_qty else 0.0

    try:
        process_sigma = norm_sinv(1 - defect_rate) + 1.5
    except (ValueError, ZeroDivisionError):
        process_sigma = 0.0

    # Intensity Tagging % / Without Intensity %
    # Rule: classify EVERY record in the current filter context by the
    # Defect Intensity field itself. A value is tagged when intensity is
    # actually entered; a blank/NULL value is without intensity.
    # This intentionally does NOT depend on Main Defect / Defect Coils,
    # because the KPI is measuring completeness of intensity tagging across
    # the selected disposition data. Therefore: Tagged % + Without Intensity % = 100%.
    tagged_where = where_sql + (" AND " if where_sql else "WHERE ") + \
        "TRIM(COALESCE(defect_intensity,'')) <> ''"
    blank_where = where_sql + (" AND " if where_sql else "WHERE ") + \
        "TRIM(COALESCE(defect_intensity,'')) = ''"

    cur.execute(f"SELECT COUNT(*) FROM disposition {tagged_where}", params)
    tagged_intensity_count = cur.fetchone()[0]
    cur.execute(f"SELECT COUNT(*) FROM disposition {blank_where}", params)
    blank_intensity_count = cur.fetchone()[0]

    intensity_total_count = tagged_intensity_count + blank_intensity_count
    intensity_tagging_pct = (tagged_intensity_count / intensity_total_count) if intensity_total_count else 0.0
    without_intensity_pct = (blank_intensity_count / intensity_total_count) if intensity_total_count else 0.0

    kpis = [
        {"label": "Total Coils", "value": total_coils, "fmt": "int"},
        {"label": "Defect Coils", "value": defect_coils, "fmt": "int"},
        {"label": "First Pass Yield %", "value": first_pass_yield, "fmt": "pct"},
        {"label": "Hold for Decision % Qty", "value": hold_pct_qty, "fmt": "pct"},
        {"label": "Output Quantity (MT)", "value": output_qty, "fmt": "num2"},
        {"label": "PPM Defective", "value": ppm_defective, "fmt": "int"},
        {"label": "Reject Qty (MT)", "value": reject_qty, "fmt": "num2"},
        {"label": "Intensity Tagging %", "value": intensity_tagging_pct, "fmt": "pct"},
        {"label": "Salvage + Divert Qty (MT)", "value": salvage_divert_qty, "fmt": "num2"},
        {"label": "Defect Rate", "value": defect_rate, "fmt": "pct"},
        {"label": "Reject % Qty", "value": reject_pct_qty, "fmt": "pct"},
        {"label": "Process Sigma Level (Approx.)", "value": process_sigma, "fmt": "num3"},
        {"label": "Hold For Decision Qty (MT)", "value": hold_qty, "fmt": "num2"},
        {"label": "Salvage % Qty", "value": salvage_pct_qty, "fmt": "pct"},
        {"label": "Rework % Qty", "value": rework_pct_qty, "fmt": "pct"},
        {"label": "Without Intensity %", "value": without_intensity_pct, "fmt": "pct"},
    ]
    assert len(kpis) == 16, "KPI count must be exactly 16"

    # Apply threshold-based KPI value colors independently of period comparison.
    for k in kpis:
        threshold_color = kpi_threshold_color(k["label"], k["value"])
        if threshold_color:
            k["color"] = threshold_color

    # Swap display positions of "Reject Qty (MT)" (was index 6) and
    # "Salvage % Qty" (was index 13) per requested card layout — metadata
    # (color/direction) is looked up by label later, so it travels correctly
    # with whichever metric now sits in that position.
    kpis[6], kpis[13] = kpis[13], kpis[6]

    # Quality decision table
    decision_table = []
    for d in DECISION_ORDER:
        decision_table.append({
            "decision": d,
            "coils": decision_coils[d],
            "pct_coils": (decision_coils[d] / total_coils) if total_coils else 0.0,
            "qty": decision_qty[d],
            "pct_qty": (decision_qty[d] / output_qty) if output_qty else 0.0,
        })

    # Top 5 defects (Pareto) among filtered rows with a real defect
    dw = where_sql + (" AND " if where_sql else "WHERE ") + \
        "main_defect <> '' AND main_defect <> 'NO DEFECT'"
    cur.execute(f"""SELECT main_defect, COALESCE(SUM(output_weight),0) as qty
                    FROM disposition {dw}
                    GROUP BY main_defect ORDER BY qty DESC LIMIT 5""", params)
    top_defects_raw = cur.fetchall()
    cur.execute(f"SELECT COALESCE(SUM(output_weight),0) FROM disposition {dw}", params)
    total_defect_qty = cur.fetchone()[0] or 0.0
    top_defects = []
    cum = 0.0
    for r in top_defects_raw:
        pct = (r["qty"] / total_defect_qty) if total_defect_qty else 0.0
        cum += pct
        top_defects.append({"defect": r["main_defect"], "qty": r["qty"], "pct": pct, "cum_pct": cum})

    # Defect intensity breakdown
    intensity_table = []
    for level in ["LIGHT", "MEDIUM", "DEEP"]:
        iw = where_sql + (" AND " if where_sql else "WHERE ") + "defect_intensity = ?"
        ip = params + [level]
        cur.execute(f"SELECT COUNT(*), COALESCE(SUM(output_weight),0) FROM disposition {iw}", ip)
        cnt, qty = cur.fetchone()
        intensity_table.append({"intensity": level, "coils": cnt, "qty": qty})
    # WITHOUT INTENSITY row = ALL selected records with blank intensity
    wi_where = where_sql + (" AND " if where_sql else "WHERE ") + \
        "TRIM(COALESCE(defect_intensity,'')) = ''"
    cur.execute(f"SELECT COUNT(*), COALESCE(SUM(output_weight),0) FROM disposition {wi_where}", params)
    cnt, qty = cur.fetchone()
    intensity_table.append({"intensity": "WITHOUT INTENSITY", "coils": cnt, "qty": qty})

    it_total_coils = sum(r["coils"] for r in intensity_table)
    it_total_qty = sum(r["qty"] for r in intensity_table)
    for r in intensity_table:
        r["pct_coils"] = (r["coils"] / it_total_coils) if it_total_coils else 0.0
        r["pct_qty"] = (r["qty"] / it_total_qty) if it_total_qty else 0.0

    conn.close()
    result = {
        "kpis": kpis,
        "decision_table": decision_table,
        "decision_total": {
            "decision": "Grand Total",
            "coils": sum(r["coils"] for r in decision_table),
            "pct_coils": 1.0 if total_coils else 0.0,
            "qty": sum(r["qty"] for r in decision_table),
            "pct_qty": 1.0 if output_qty else 0.0,
        },
        "top_defects": top_defects,
        "top_defects_total": {
            "defect": "Total (Top 5)",
            "qty": sum(r["qty"] for r in top_defects),
            "pct": sum(r["pct"] for r in top_defects),
            "cum_pct": top_defects[-1]["cum_pct"] if top_defects else 0.0,
        },
        "intensity_table": intensity_table,
        "intensity_total": {
            "intensity": "Grand Total",
            "coils": it_total_coils,
            "pct_coils": 1.0 if it_total_coils else 0.0,
            "qty": it_total_qty,
            "pct_qty": 1.0 if it_total_qty else 0.0,
        },
        "totals": {"total_coils": total_coils, "output_qty": output_qty},
        "period": {"current": current_period_label(filters)},
    }

    # ---- Previous-period comparison (skip when computing the prev period
    # itself, to avoid infinite recursion) ----
    if not _skip_prev:
        prev_filters = compute_prev_filters(filters)
        if prev_filters is not None:
            prev_data = compute_kpis(prev_filters, _skip_prev=True)
            prev_values = [k["value"] for k in prev_data["kpis"]]
            result["period"]["previous"] = current_period_label(prev_filters)
        else:
            prev_values = [0] * 16
            result["period"]["previous"] = None

        for i, k in enumerate(kpis):
            meta = KPI_META_BY_LABEL[k["label"]]
            prev_v = prev_values[i]
            cur_v = k["value"]
            threshold_color = kpi_threshold_color(k["label"], cur_v)
            k["color"] = threshold_color or meta["color"]
            k["prev"] = prev_v
            if meta["change"] == "pts":
                diff = cur_v - prev_v
                k["change_value"] = diff
                k["change_type"] = "pts"
            else:
                diff_pct = ((cur_v - prev_v) / abs(prev_v)) if prev_v else 0.0
                k["change_value"] = diff_pct
                k["change_type"] = "pct"
            if cur_v > prev_v:
                arrow = "up"
            elif cur_v < prev_v:
                arrow = "down"
            else:
                arrow = "flat"
            k["arrow"] = arrow
            # Exact 4-state logic extracted from the workbook's real
            # conditional-formatting rules (x14 extLst on the Quality
            # Dashboard sheet, e.g. "D9<'KPI Comparison'!$B$21" -> green,
            # "D9>...' -> red, "D9=...' -> gray). Neutral-direction KPIs
            # (Total Coils, Output Quantity) only ever get the blue "info"
            # badge whenever the value changed at all — they never turn
            # green/red since there's no inherent "good" direction.
            if meta["direction"] == "neutral":
                k["trend_color"] = "info" if arrow != "flat" else "equal"
            elif arrow == "flat":
                k["trend_color"] = "equal"
            elif (meta["direction"] == "up_good" and arrow == "up") or \
                 (meta["direction"] == "down_good" and arrow == "down"):
                k["trend_color"] = "good"
            else:
                k["trend_color"] = "bad"

    return result


def get_filter_options():
    conn = get_conn()
    cur = conn.cursor()
    options = {}
    for key in FILTER_KEYS:
        cur.execute(f"SELECT DISTINCT {key} FROM disposition WHERE {key} <> ''")
        vals = [r[0] for r in cur.fetchall()]
        if key == "month":
            vals.sort(key=_month_sort_key)
        elif key == "week":
            vals.sort(key=_week_sort_key)
        else:
            vals.sort()
        if key == "defect_intensity":
            vals = vals + ["NONE"]
        if key == "week":
            options[key] = [{"value":"All", "label":"All"}] + [
                {"value": v, "label": _week_display_label(v)} for v in vals
            ]
        else:
            options[key] = ["All"] + vals
    conn.close()
    return options


def _group_metrics(cur, where_sql, params, group_col, group_val):
    """Compute Coils/Output Qty/Defect Coils/Defect%/Reject Qty/Reject%Qty/FPY%
    for rows where group_col = group_val, ANDed with an existing where_sql."""
    extra = f"{group_col} = ?"
    w2 = where_sql + (" AND " if where_sql else "WHERE ") + extra
    p2 = params + [group_val]

    cur.execute(f"SELECT COUNT(*), COALESCE(SUM(output_weight),0) FROM disposition {w2}", p2)
    coils, qty = cur.fetchone()

    dw = w2 + " AND main_defect <> '' AND main_defect <> 'NO DEFECT'"
    cur.execute(f"SELECT COUNT(*) FROM disposition {dw}", p2)
    defect_coils = cur.fetchone()[0]

    rw = w2 + " AND quality_decision = ?"
    cur.execute(f"SELECT COALESCE(SUM(output_weight),0) FROM disposition {rw}", p2 + ["REJECT"])
    reject_qty = cur.fetchone()[0]

    pw = w2 + " AND quality_decision = ?"
    cur.execute(f"SELECT COALESCE(SUM(output_weight),0) FROM disposition {pw}", p2 + ["PRIME"])
    prime_qty = cur.fetchone()[0]

    return {
        "name": group_val,
        "coils": coils,
        "output_qty": qty,
        "defect_coils": defect_coils,
        "defect_pct": (defect_coils / coils) if coils else 0.0,
        "reject_qty": reject_qty,
        "reject_pct_qty": (reject_qty / qty) if qty else 0.0,
        "first_pass_yield_pct": (prime_qty / qty) if qty else 0.0,
        "prime_qty": prime_qty,
    }


def _grand_total_row(rows, name="Grand Total"):
    """Aggregate a list of _group_metrics-shaped rows into one Grand Total
    row, recomputing percentages from the summed totals (not an average of
    averages)."""
    coils = sum(r["coils"] for r in rows)
    qty = sum(r["output_qty"] for r in rows)
    defect_coils = sum(r["defect_coils"] for r in rows)
    reject_qty = sum(r["reject_qty"] for r in rows)
    prime_qty = sum(r.get("prime_qty", 0) for r in rows)
    return {
        "name": name,
        "coils": coils,
        "output_qty": qty,
        "defect_coils": defect_coils,
        "defect_pct": (defect_coils / coils) if coils else 0.0,
        "reject_qty": reject_qty,
        "reject_pct_qty": (reject_qty / qty) if qty else 0.0,
        "first_pass_yield_pct": (prime_qty / qty) if qty else 0.0,
    }


def compute_work_center_grade(filters):
    """Work Center & Grade Analysis. Work Center and Grade filters do NOT
    apply to their own breakdown (they are the analysis dimension), matching
    the original workbook's behaviour."""
    conn = get_conn()
    cur = conn.cursor()

    wc_where, wc_params = build_where(filters, exclude={"work_center"})
    cur.execute(f"SELECT DISTINCT work_center FROM disposition WHERE work_center <> '' ORDER BY 1")
    work_centers = [r[0] for r in cur.fetchall()]
    wc_rows = [_group_metrics(cur, wc_where, wc_params, "work_center", wc) for wc in work_centers]

    gr_where, gr_params = build_where(filters, exclude={"grade"})
    cur.execute(f"SELECT DISTINCT grade FROM disposition WHERE grade <> '' ORDER BY 1")
    grades = [r[0] for r in cur.fetchall()]
    gr_rows = [_group_metrics(cur, gr_where, gr_params, "grade", g) for g in grades]

    conn.close()
    return {
        "by_work_center": wc_rows, "by_grade": gr_rows,
        "total_work_center": _grand_total_row(wc_rows),
        "total_grade": _grand_total_row(gr_rows),
    }


def compute_defect_analysis(filters):
    """Complete defect occurrence register (all canonical defect types) +
    Top 10 Pareto. All 8 filters apply here (defects are not a filter dim
    that needs excluding)."""
    conn = get_conn()
    cur = conn.cursor()
    where_sql, params = build_where(filters)

    dw = where_sql + (" AND " if where_sql else "WHERE ") + \
        "main_defect <> '' AND main_defect <> 'NO DEFECT'"
    cur.execute(f"SELECT COUNT(*), COALESCE(SUM(output_weight),0) FROM disposition {dw}", params)
    total_defect_records, total_defect_qty = cur.fetchone()

    # Include canonical defect names plus any new defect names present in the
    # live database (e.g. newly added monthly data), so new categories never
    # disappear from the register/charts.
    cur.execute("SELECT DISTINCT main_defect FROM disposition WHERE TRIM(COALESCE(main_defect,'')) <> '' AND UPPER(TRIM(main_defect)) <> 'NO DEFECT'")
    db_defects = {r[0].strip() for r in cur.fetchall() if r[0]}
    all_defects = sorted(set(MAIN_DEFECTS_FULL_LIST) | db_defects)

    register = []
    for defect in all_defects:
        w2 = where_sql + (" AND " if where_sql else "WHERE ") + "main_defect = ?"
        cur.execute(f"SELECT COUNT(*), COALESCE(SUM(output_weight),0) FROM disposition {w2}",
                    params + [defect])
        cnt, qty = cur.fetchone()
        register.append({
            "defect": defect, "records": cnt, "qty": qty,
            "pct_records": (cnt / total_defect_records) if total_defect_records else 0.0,
        })
    register.sort(key=lambda r: r["qty"], reverse=True)
    for i, r in enumerate(register, start=1):
        r["rank"] = i

    top10 = [r for r in register if r["qty"] > 0][:10]
    cum = 0.0
    pareto = []
    for r in top10:
        pct = (r["qty"] / total_defect_qty) if total_defect_qty else 0.0
        cum += pct
        pareto.append({"defect": r["defect"], "records": r["records"], "qty": r["qty"],
                        "pct": pct, "cum_pct": cum})

    conn.close()
    return {
        "register": register,
        "pareto": pareto,
        "totals": {"records": total_defect_records, "qty": total_defect_qty},
        "register_total": {
            "defect": "Grand Total", "records": total_defect_records,
            "qty": total_defect_qty, "pct_records": 1.0 if total_defect_records else 0.0,
        },
        "pareto_total": {
            "defect": "Total (Top 10)",
            "records": sum(r["records"] for r in pareto),
            "qty": sum(r["qty"] for r in pareto),
            "pct": sum(r["pct"] for r in pareto),
            "cum_pct": pareto[-1]["cum_pct"] if pareto else 0.0,
        },
    }


def compute_monthly_trend(filters):
    """Trend across months (ignores the Month filter itself, applies the
    other 7)."""
    conn = get_conn()
    cur = conn.cursor()
    where_sql, params = build_where(filters, exclude={"month"})

    cur.execute("SELECT DISTINCT month FROM disposition WHERE month <> ''")
    months = sorted([r[0] for r in cur.fetchall()], key=_month_sort_key)

    rows = [_group_metrics(cur, where_sql, params, "month", m) for m in months]
    conn.close()
    return {"rows": rows, "total": _grand_total_row(rows)}


def compute_period_trend(filters):
    """Trend across weeks (ignores the Week filter itself, applies the
    other 7)."""
    conn = get_conn()
    cur = conn.cursor()
    where_sql, params = build_where(filters, exclude={"week"})

    cur.execute("SELECT DISTINCT week FROM disposition WHERE week <> ''")
    weeks = sorted([r[0] for r in cur.fetchall()], key=_week_sort_key)

    rows = [_group_metrics(cur, where_sql, params, "week", w) for w in weeks]
    for row in rows:
        row["name"] = _week_display_label(row["name"])
    conn.close()
    return {"rows": rows, "total": _grand_total_row(rows)}


def compute_quarterly_trend(filters):
    """Trend across quarters (ignores the Quarter filter itself)."""
    conn = get_conn()
    cur = conn.cursor()
    where_sql, params = build_where(filters, exclude={"quarter"})

    cur.execute("SELECT DISTINCT quarter FROM disposition WHERE quarter <> '' ORDER BY 1")
    quarters = [r[0] for r in cur.fetchall()]
    rows = [_group_metrics(cur, where_sql, params, "quarter", q) for q in quarters]
    conn.close()
    return {"rows": rows, "total": _grand_total_row(rows)}


def compute_yearly_trend(filters):
    """Trend across financial years (ignores the Financial Year filter itself)."""
    conn = get_conn()
    cur = conn.cursor()
    where_sql, params = build_where(filters, exclude={"financial_year"})

    cur.execute("SELECT DISTINCT financial_year FROM disposition WHERE financial_year <> '' ORDER BY 1")
    fys = [r[0] for r in cur.fetchall()]
    rows = [_group_metrics(cur, where_sql, params, "financial_year", fy) for fy in fys]
    conn.close()
    return {"rows": rows, "total": _grand_total_row(rows)}



# ---------------------------------------------------------------------------
# Admin authentication / data-management layer
# ---------------------------------------------------------------------------
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "ChangeMe@123")
SESSION_TTL = 8 * 60 * 60
SESSIONS = {}


def _cleanup_sessions():
    now = _dt.datetime.now().timestamp()
    for token, meta in list(SESSIONS.items()):
        if meta.get("expires", 0) < now:
            SESSIONS.pop(token, None)


def _cookie_value(cookie_header, name):
    if not cookie_header:
        return ""
    for part in cookie_header.split(";"):
        part = part.strip()
        if part.startswith(name + "="):
            return part.split("=", 1)[1]
    return ""


def _is_admin(handler):
    _cleanup_sessions()
    token = _cookie_value(handler.headers.get("Cookie", ""), "qdash_admin")
    meta = SESSIONS.get(token)
    if not meta:
        return False
    if meta.get("expires", 0) < _dt.datetime.now().timestamp():
        SESSIONS.pop(token, None)
        return False
    return hmac.compare_digest(meta.get("username", ""), ADMIN_USERNAME)


def _json_body(handler):
    length = int(handler.headers.get("Content-Length", "0") or 0)
    raw = handler.rfile.read(length)
    return json.loads(raw.decode("utf-8")) if raw else {}


def _auth_error(handler, message="Admin login required"):
    handler._send_json({"error": message, "authenticated": False}, status=401)


def _norm_header(v):
    return " ".join(str(v or "").strip().lower().replace("_", " ").split())


HEADER_ALIASES = {
    "heat_no": ["heat no", "heat number", "heat"],
    "work_center": ["work center", "workcentre", "work center name"],
    "grade": ["grade"],
    "output_weight": ["output weight", "output weight (mt)", "output qty", "quantity", "qty"],
    "main_defect": ["main defect", "defect", "main defect type"],
    "defect_intensity": ["defect intensity", "intensity", "defect intensity tag"],
    "quality_decision": ["quality decision", "decision"],
    "insp_lot_date": ["insp lot date", "inspection lot date", "date", "inspection date"],
    "month": ["_sourcemmonth", "_source month", "source month", "month"],
    "week": ["week"],
    "quarter": ["quarter (fy)", "quarter", "qtr"],
    "financial_year": ["financial year", "fy", "fy year"],
}


def _map_headers(headers):
    normalized = {_norm_header(h): i for i, h in enumerate(headers)}
    mapping = {}
    for key, aliases in HEADER_ALIASES.items():
        for alias in aliases:
            if _norm_header(alias) in normalized:
                mapping[key] = normalized[_norm_header(alias)]
                break
    return mapping


def _parse_date(v):
    if v in (None, ""):
        return None
    if isinstance(v, (_dt.datetime, _dt.date)):
        return v.date() if isinstance(v, _dt.datetime) else v
    text = str(v).strip()
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%d-%b-%Y", "%d-%b-%y", "%d/%m/%y", "%m/%d/%Y"):
        try:
            return _dt.datetime.strptime(text, fmt).date()
        except ValueError:
            pass
    return None


def _derive_period_fields(insp_date):
    if not insp_date:
        return "", "", "", ""
    month = insp_date.strftime("%b-%Y")
    monday = insp_date - _dt.timedelta(days=insp_date.weekday())
    week = "Wk of " + monday.strftime("%d-%b-%y")
    # Apr-Jun Q1, Jul-Sep Q2, Oct-Dec Q3, Jan-Mar Q4.
    q = ((insp_date.month - 4) % 12) // 3 + 1
    fy_start = insp_date.year if insp_date.month >= 4 else insp_date.year - 1
    quarter = f"Q{q}"
    fy = f"FY {fy_start}-{(fy_start + 1) % 100:02d}"
    return month, week, quarter, fy


def _record_from_values(values, mapping):
    def get(key, default=""):
        idx = mapping.get(key)
        if idx is None or idx >= len(values):
            return default
        return values[idx]

    insp_date = _parse_date(get("insp_lot_date"))
    derived_month, derived_week, derived_quarter, derived_fy = _derive_period_fields(insp_date)
    month = str(get("month") or derived_month).strip()
    week = str(get("week") or derived_week).strip()
    quarter = str(get("quarter") or derived_quarter).strip()
    fy = str(get("financial_year") or derived_fy).strip()
    try:
        weight_raw = get("output_weight", 0)
        if isinstance(weight_raw, str):
            weight_raw = weight_raw.replace(",", "").strip()
        weight = float(weight_raw or 0)
    except (TypeError, ValueError):
        raise ValueError("Output Weight must be numeric")

    return {
        "heat_no": str(get("heat_no") or "").strip(),
        "work_center": str(get("work_center") or "").strip(),
        "grade": str(get("grade") or "").strip(),
        "output_weight": weight,
        "main_defect": str(get("main_defect") or "").strip(),
        "defect_intensity": str(get("defect_intensity") or "").strip().upper(),
        "quality_decision": str(get("quality_decision") or "").strip().upper(),
        "insp_lot_date": insp_date.isoformat() if insp_date else "",
        "month": month,
        "week": week,
        "quarter": quarter,
        "financial_year": fy,
    }


def _validate_record(r):
    if not r["heat_no"]:
        return "HEAT NO is required"
    if not r["quality_decision"]:
        return "QUALITY DECISION is required"
    if r["output_weight"] < 0:
        return "Output Weight cannot be negative"
    if r["quality_decision"] not in DECISION_ORDER:
        return "Unknown QUALITY DECISION: " + r["quality_decision"]
    return ""


def _record_signature(r):
    keys = ["heat_no", "work_center", "grade", "output_weight", "main_defect", "defect_intensity",
            "quality_decision", "insp_lot_date", "month", "week", "quarter", "financial_year"]
    raw = "|".join(str(r.get(k, "")) for k in keys)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _parse_uploaded_file(filename, data):
    ext = os.path.splitext(filename.lower())[1]
    rows = []
    if ext in (".xlsx", ".xlsm"):
        try:
            import openpyxl
        except ImportError:
            raise ValueError("Excel import requires openpyxl. Please use TSV/CSV or install openpyxl.")
        wb = openpyxl.load_workbook(io.BytesIO(data), data_only=True, read_only=True)
        ws = wb["Disposition Data"] if "Disposition Data" in wb.sheetnames else wb[wb.sheetnames[0]]
        iterator = ws.iter_rows(values_only=True)
        try:
            headers = list(next(iterator))
        except StopIteration:
            raise ValueError("The uploaded Excel file is empty")
        mapping = _map_headers(headers)
        if "heat_no" not in mapping:
            raise ValueError("Could not find HEAT NO column in the uploaded file")
        for values in iterator:
            if not any(v not in (None, "") for v in values):
                continue
            rows.append(_record_from_values(list(values), mapping))
        wb.close()
    else:
        text = data.decode("utf-8-sig")
        sample = text[:4096]
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters="\t,;")
        except csv.Error:
            dialect = csv.excel_tab if "\t" in sample else csv.excel
        reader = csv.reader(io.StringIO(text), dialect)
        try:
            headers = next(reader)
        except StopIteration:
            raise ValueError("The uploaded file is empty")
        mapping = _map_headers(headers)
        if "heat_no" not in mapping:
            raise ValueError("Could not find HEAT NO column in the uploaded file")
        for values in reader:
            if not any(str(v).strip() for v in values):
                continue
            rows.append(_record_from_values(values, mapping))
    return rows


def _insert_records(records):
    conn = get_conn()
    cur = conn.cursor()
    # Build signatures only for the imported rows and the current database.
    existing = set()
    cur.execute("SELECT heat_no,work_center,grade,output_weight,main_defect,defect_intensity,quality_decision,insp_lot_date,month,week,quarter,financial_year FROM disposition")
    for row in cur.fetchall():
        existing.add(_record_signature(dict(row)))
    inserted = 0
    duplicates = 0
    errors = []
    seen = set()
    good = []
    for idx, r in enumerate(records, start=2):
        err = _validate_record(r)
        sig = _record_signature(r)
        if err:
            errors.append({"row": idx, "error": err})
        elif sig in existing or sig in seen:
            duplicates += 1
        else:
            seen.add(sig)
            good.append(r)
    if good:
        cur.executemany("""
            INSERT INTO disposition
            (heat_no,work_center,grade,output_weight,main_defect,defect_intensity,quality_decision,
             insp_lot_date,month,week,quarter,financial_year)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        """, [tuple(r[k] for k in ["heat_no","work_center","grade","output_weight","main_defect","defect_intensity","quality_decision","insp_lot_date","month","week","quarter","financial_year"]) for r in good])
        inserted = len(good)
    conn.commit()
    conn.close()
    return {"inserted": inserted, "duplicates": duplicates, "errors": errors}


def _ensure_admin_schema():
    conn = get_conn()
    if USE_POSTGRES:
        conn.execute("""CREATE TABLE IF NOT EXISTS disposition (
            id BIGSERIAL PRIMARY KEY, heat_no TEXT, work_center TEXT, grade TEXT,
            output_weight DOUBLE PRECISION, main_defect TEXT, defect_intensity TEXT,
            quality_decision TEXT, insp_lot_date TEXT DEFAULT '', month TEXT, week TEXT,
            quarter TEXT, financial_year TEXT
        )""")
    else:
        cols = {r[1] for r in conn.execute("PRAGMA table_info(disposition)").fetchall()}
        if "insp_lot_date" not in cols:
            conn.execute("ALTER TABLE disposition ADD COLUMN insp_lot_date TEXT DEFAULT ''")
    conn.commit()
    conn.close()

def _seed_postgres_if_empty():
    """On first PostgreSQL deployment, copy bundled SQLite seed rows once. Never overwrite existing PG data."""
    if not USE_POSTGRES:
        return
    seed = os.path.join(APP_DIR, "quality.db")
    if not os.path.exists(seed):
        return
    conn = get_conn()
    count = conn.execute("SELECT COUNT(*) FROM disposition").fetchone()[0]
    if count == 0:
        src = sqlite3.connect(seed)
        src.row_factory = sqlite3.Row
        rows = src.execute("SELECT heat_no,work_center,grade,output_weight,main_defect,defect_intensity,quality_decision,month,week,quarter,financial_year FROM disposition").fetchall()
        src.close()
        if rows:
            conn.cursor().executemany("""INSERT INTO disposition
                (heat_no,work_center,grade,output_weight,main_defect,defect_intensity,quality_decision,month,week,quarter,financial_year)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)""", [tuple(r) for r in rows])
            conn.commit()
    conn.close()

def database_status():
    conn = get_conn()
    total = conn.execute("SELECT COUNT(*) FROM disposition").fetchone()[0]
    if USE_POSTGRES:
        size = conn.execute("SELECT pg_database_size(current_database())").fetchone()[0]
        # Supabase/Neon free database target is commonly 500 MB; make it configurable.
        limit_mb = float(os.environ.get("DB_LIMIT_MB", "500"))
        used_mb = size / (1024*1024)
        pct = (used_mb / limit_mb * 100) if limit_mb else 0
        provider = "PostgreSQL"
        persistent = True
    else:
        size = os.path.getsize(DB_PATH) if os.path.exists(DB_PATH) else 0
        used_mb = size / (1024*1024)
        limit_mb = float(os.environ.get("DB_LIMIT_MB", "500"))
        pct = (used_mb / limit_mb * 100) if limit_mb else 0
        provider = "SQLite"
        persistent = bool(os.path.abspath(DB_PATH) != os.path.join(APP_DIR, "quality.db"))
    if pct >= 95: status = "critical"
    elif pct >= 85: status = "action"
    elif pct >= 70: status = "warning"
    else: status = "healthy"
    conn.close()
    return {"provider": provider, "persistent": persistent, "records": total, "used_mb": round(used_mb,2), "limit_mb": round(limit_mb,2), "usage_pct": round(pct,2), "status": status}


HTML_PAGE = None  # loaded lazily from index_template


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # keep console quiet

    def _send_json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_html(self, html, status=200):
        body = html.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        qs = {k: v[0] for k, v in parse_qs(parsed.query).items()}

        if path == "/" or path == "/index.html":
            with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "index.html"),
                       "r", encoding="utf-8") as f:
                self._send_html(f.read())
        elif path == "/admin":
            if not _is_admin(self):
                # Serve the login/admin shell; the page itself never exposes write APIs without auth.
                with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "admin.html"), "r", encoding="utf-8") as f:
                    self._send_html(f.read())
            else:
                with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "admin.html"), "r", encoding="utf-8") as f:
                    self._send_html(f.read())
        elif path == "/api/auth/status":
            self._send_json({"authenticated": _is_admin(self), "username": ADMIN_USERNAME if _is_admin(self) else ""})
        elif path == "/api/filters":
            self._send_json(get_filter_options())
        elif path == "/api/kpis":
            filters = {k: qs.get(k, "All") for k in FILTER_KEYS}
            try:
                data = compute_kpis(filters)
                self._send_json(data)
            except Exception as e:
                self._send_json({"error": str(e)}, status=500)
        elif path == "/api/work_center_grade":
            filters = {k: qs.get(k, "All") for k in FILTER_KEYS}
            try:
                self._send_json(compute_work_center_grade(filters))
            except Exception as e:
                self._send_json({"error": str(e)}, status=500)
        elif path == "/api/defect_analysis":
            filters = {k: qs.get(k, "All") for k in FILTER_KEYS}
            try:
                self._send_json(compute_defect_analysis(filters))
            except Exception as e:
                self._send_json({"error": str(e)}, status=500)
        elif path == "/api/monthly_trend":
            filters = {k: qs.get(k, "All") for k in FILTER_KEYS}
            try:
                self._send_json(compute_monthly_trend(filters))
            except Exception as e:
                self._send_json({"error": str(e)}, status=500)
        elif path == "/api/period_trend":
            filters = {k: qs.get(k, "All") for k in FILTER_KEYS}
            try:
                weekly_d = compute_period_trend(filters)
                quarterly_d = compute_quarterly_trend(filters)
                yearly_d = compute_yearly_trend(filters)
                self._send_json({
                    "weekly": weekly_d["rows"], "weekly_total": weekly_d["total"],
                    "quarterly": quarterly_d["rows"], "quarterly_total": quarterly_d["total"],
                    "yearly": yearly_d["rows"], "yearly_total": yearly_d["total"],
                })
            except Exception as e:
                self._send_json({"error": str(e)}, status=500)
        elif path == "/api/health":
            self._send_json({"status": "ok", "database": database_status()})
        elif path == "/api/admin/database_status":
            if not _is_admin(self):
                _auth_error(self)
            else:
                try:
                    self._send_json(database_status())
                except Exception as e:
                    self._send_json({"error": str(e)}, status=500)
        else:
            self._send_json({"error": "not found"}, status=404)


    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/api/login":
            try:
                body = _json_body(self)
                username = str(body.get("username", ""))
                password = str(body.get("password", ""))
                if hmac.compare_digest(username, ADMIN_USERNAME) and hmac.compare_digest(password, ADMIN_PASSWORD):
                    token = secrets.token_urlsafe(32)
                    SESSIONS[token] = {"username": ADMIN_USERNAME, "expires": _dt.datetime.now().timestamp() + SESSION_TTL}
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json; charset=utf-8")
                    self.send_header("Cache-Control", "no-store")
                    secure = self.headers.get("X-Forwarded-Proto", "").lower() == "https"
                    cookie = f"qdash_admin={token}; Path=/; HttpOnly; SameSite=Lax"
                    if secure:
                        cookie += "; Secure"
                    self.send_header("Set-Cookie", cookie)
                    self.end_headers()
                    self.wfile.write(json.dumps({"authenticated": True, "username": ADMIN_USERNAME}).encode("utf-8"))
                else:
                    self._send_json({"error": "Invalid username or password"}, status=401)
            except Exception as e:
                self._send_json({"error": str(e)}, status=400)
            return

        if path == "/api/logout":
            token = _cookie_value(self.headers.get("Cookie", ""), "qdash_admin")
            SESSIONS.pop(token, None)
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Set-Cookie", "qdash_admin=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax")
            self.end_headers()
            self.wfile.write(b'{"authenticated":false}')
            return

        if not _is_admin(self):
            _auth_error(self)
            return

        if path == "/api/admin/record":
            try:
                body = _json_body(self)
                r = _record_from_values([body.get(k, "") for k in ["heat_no","work_center","grade","output_weight","main_defect","defect_intensity","quality_decision","insp_lot_date","month","week","quarter","financial_year"]], {k:i for i,k in enumerate(["heat_no","work_center","grade","output_weight","main_defect","defect_intensity","quality_decision","insp_lot_date","month","week","quarter","financial_year"])})
                result = _insert_records([r])
                if result["errors"]:
                    self._send_json({"error": result["errors"][0]["error"]}, status=400)
                elif result["duplicates"]:
                    self._send_json({"error": "This record already exists"}, status=409)
                else:
                    self._send_json({"ok": True, **result})
            except Exception as e:
                self._send_json({"error": str(e)}, status=400)
            return

        if path == "/api/admin/import":
            try:
                ctype = self.headers.get("Content-Type", "")
                length = int(self.headers.get("Content-Length", "0") or 0)
                raw = self.rfile.read(length)
                msg = BytesParser(policy=default).parsebytes((f"Content-Type: {ctype}\r\nMIME-Version: 1.0\r\n\r\n").encode() + raw)
                uploaded = None
                if msg.is_multipart():
                    for part in msg.iter_parts():
                        disp = part.get("Content-Disposition", "")
                        if "filename=" in disp:
                            uploaded = (part.get_filename() or "upload", part.get_payload(decode=True) or b"")
                            break
                if not uploaded:
                    raise ValueError("No file was uploaded")
                records = _parse_uploaded_file(uploaded[0], uploaded[1])
                if len(records) > 10000:
                    raise ValueError("Import limited to 10,000 records per upload")
                result = _insert_records(records)
                self._send_json({"ok": True, "detected": len(records), **result})
            except Exception as e:
                self._send_json({"error": str(e)}, status=400)
            return

        if path == "/api/admin/records":
            try:
                body = _json_body(self)
                limit = min(max(int(body.get("limit", 100)), 1), 500)
                conn = get_conn()
                rows = [dict(r) for r in conn.execute("SELECT id,insp_lot_date,heat_no,work_center,grade,output_weight,main_defect,defect_intensity,quality_decision,month,week,quarter,financial_year FROM disposition ORDER BY id DESC LIMIT ?", (limit,)).fetchall()]
                total = conn.execute("SELECT COUNT(*) FROM disposition").fetchone()[0]
                conn.close()
                self._send_json({"rows": rows, "total": total})
            except Exception as e:
                self._send_json({"error": str(e)}, status=400)
            return

        if path == "/api/admin/delete":
            try:
                body = _json_body(self)
                record_id = int(body.get("id"))
                conn = get_conn()
                cur = conn.execute("DELETE FROM disposition WHERE id=?", (record_id,))
                conn.commit()
                conn.close()
                self._send_json({"ok": True, "deleted": cur.rowcount})
            except Exception as e:
                self._send_json({"error": str(e)}, status=400)
            return

        self._send_json({"error": "not found"}, status=404)


def main():
    import sys
    # Cloud hosts (Render, Railway, etc.) provide the port via the PORT
    # environment variable. Fall back to a CLI arg, then default 8000
    # for local use.
    port = int(os.environ.get("PORT", sys.argv[1] if len(sys.argv) > 1 else 8000))
    _ensure_admin_schema()
    _seed_postgres_if_empty()
    ensure_fast_indexes()
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    if ADMIN_PASSWORD == "ChangeMe@123":
        print("WARNING: using the default admin password. Set ADMIN_PASSWORD before sharing this app publicly.")
    print(f"Quality Disposition Dashboard running on port {port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
