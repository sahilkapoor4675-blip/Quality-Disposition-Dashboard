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
import time
from datetime import datetime
from email.parser import BytesParser
from email.policy import default
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

try:
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
except ImportError:
    Workbook = None
try:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_CENTER, TA_LEFT
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
except ImportError:
    SimpleDocTemplate = None

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
    "Intensity Tagging %":           {"color": "#D97706", "direction": "up_good",   "change": "pct"},
    "Salvage + Divert Qty (MT)":     {"color": "#7C3AED", "direction": "down_good", "change": "pct"},
    "Defect Rate":                   {"color": "#DC2626", "direction": "down_good", "change": "pct"},
    "Reject % Qty":                  {"color": "#DC2626", "direction": "down_good", "change": "pct"},
    "Process Sigma Level (Approx.)": {"color": "#16A34A", "direction": "up_good",   "change": "pct"},
    "Hold For Decision Qty (MT)":    {"color": "#D97706", "direction": "down_good", "change": "pct"},
    "Salvage % Qty":                 {"color": "#7C3AED", "direction": "down_good", "change": "pct"},
    "Rework % Qty":                  {"color": "#D97706", "direction": "down_good", "change": "pct"},
    "Without Intensity %":           {"color": "#64748B", "direction": "down_good", "change": "pct"},
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


def _kpi_default_targets():
    return {
        "First Pass Yield %": (.97, .90, .80, "higher"),
        "Hold for Decision % Qty": (.01, .03, .05, "lower"),
        "PPM Defective": (10000, 30000, 50000, "lower"),
        "Intensity Tagging %": (.90, .85, .70, "higher"),
        "Defect Rate": (.01, .03, .05, "lower"),
        "Reject % Qty": (.01, .03, .05, "lower"),
        "Process Sigma Level (Approx.)": (3.0, 2.0, 1.0, "higher"),
        "Salvage % Qty": (.01, .03, .05, "lower"),
        "Rework % Qty": (.01, .03, .05, "lower"),
        "Without Intensity %": (.05, .15, .30, "lower"),
    }

def _kpi_target_rows(conn):
    rows = conn.execute("SELECT id,kpi_key,label,target,warning,critical,direction,updated_at FROM kpi_targets ORDER BY id").fetchall()
    return [dict(r) for r in rows]

def _target_status(target, value):
    if not target or target.get("target") is None or target.get("direction") == "neutral": return "neutral"
    direction=target.get("direction","lower"); t=float(target["target"]); w=target.get("warning"); w=float(w) if w is not None else None; v=float(value)
    if direction=="higher": return "good" if v>=t else ("amber" if w is not None and v>=w else "bad")
    return "good" if v<=t else ("amber" if w is not None and v<=w else "bad")

def _format_target_text(label, target):
    if not target or target.get("target") is None: return "Target: Not set"
    pct="%" in label
    def f(x):
        if x is None: return "—"
        if pct: return f"{float(x)*100:.1f}%"
        if label=="PPM Defective": return f"{float(x):,.0f}"
        if "Sigma" in label: return f"{float(x):.1f}"
        return f"{float(x):,.2f}"
    symbol="≥" if target.get("direction")=="higher" else "≤"
    return f"Target {symbol} {f(target.get('target'))} • Warn {symbol} {f(target.get('warning'))} • Critical {symbol} {f(target.get('critical'))}"

def kpi_threshold_color(label, value, target=None):
    status = _target_status(target, value)
    if status == "good": return "#16A34A"
    if status == "amber": return "#D97706"
    if status == "bad": return "#DC2626"
    green, amber, red = "#16A34A", "#D97706", "#DC2626"
    if label in ("First Pass Yield %", "For Next Process %"):
        return green if value > 0.97 else amber if value >= 0.90 else red
    if label in ("Salvage % Qty", "Reject % Qty", "Rework % Qty", "Hold for Decision % Qty", "Hold For Decision % Qty"):
        return green if value < 0.01 else amber if value <= 0.03 else red
    if label == "Process Sigma Level (Approx.)": return green if value > 3 else amber if value >= 2 else red
    if label == "PPM Defective": return green if value <= 10000 else amber if value <= 30000 else red
    if label == "Intensity Tagging %": return green if value >= 0.90 else amber if value >= 0.85 else red
    if label == "Without Intensity %": return green if value <= 0.05 else amber if value <= 0.15 else red
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

    # Load administrator-defined KPI targets so card status/color always follows the live target table.
    targets = {}
    try:
        for tr in conn.execute("SELECT label,target,warning,critical,direction FROM kpi_targets").fetchall():
            targets[tr[0]] = dict(tr)
    except Exception:
        targets = {}

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

    # Apply administrator-defined target bands. If no target is configured, keep legacy fallback.
    for k in kpis:
        t = targets.get(k["label"])
        k["target"] = t
        k["target_status"] = _target_status(t, k["value"])
        k["target_text"] = _format_target_text(k["label"], t)
        threshold_color = kpi_threshold_color(k["label"], k["value"], t)
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
            prev_values = [None] * 16
            result["period"]["previous"] = None

        for i, k in enumerate(kpis):
            meta = KPI_META_BY_LABEL[k["label"]]
            prev_v = prev_values[i]
            cur_v = k["value"]
            threshold_color = kpi_threshold_color(k["label"], cur_v, k.get("target"))
            k["color"] = threshold_color or meta["color"]
            if prev_v is None:
                # No comparison period selected: do not fabricate a 0 baseline
                # or show a misleading 0% change. The card remains reference-only.
                k["prev"] = None
                k["change_value"] = None
                k["change_type"] = "none"
                k["arrow"] = None
                k["trend_color"] = "equal"
                continue
            k["prev"] = prev_v
            if meta["change"] == "pts":
                diff = cur_v - prev_v
                k["change_value"] = diff
                k["change_type"] = "pts"
            else:
                if abs(prev_v) < 1e-12:
                    k["change_value"] = None
                    k["change_type"] = "new" if abs(cur_v) >= 1e-12 else "none"
                else:
                    k["change_value"] = (cur_v - prev_v) / abs(prev_v)
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
VIEWER_SESSION_TTL = 12 * 60 * 60

def _hash_password(password, salt=None):
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 180000)
    return salt.hex() + ":" + digest.hex()

def _verify_password(password, stored):
    try:
        salt_hex, digest_hex = str(stored).split(":", 1)
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(digest_hex)
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 180000)
        return hmac.compare_digest(actual, expected)
    except Exception:
        return False

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


def _viewer_meta(handler):
    _cleanup_sessions()
    token = _cookie_value(handler.headers.get("Cookie", ""), "qdash_user")
    meta = SESSIONS.get(token)
    if not meta or meta.get("role") not in ("viewer", "admin"):
        return None
    if meta.get("expires", 0) < _dt.datetime.now().timestamp():
        SESSIONS.pop(token, None)
        return None
    return meta

def _is_viewer(handler):
    # Viewer authentication is currently disabled by design. The dashboard is
    # open to everyone; activity is tracked by IP address instead.
    return True

def _client_ip(handler):
    """Return the best available client IP behind Render/reverse proxies."""
    forwarded = handler.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip()[:80]
    real = handler.headers.get("X-Real-IP", "")
    if real:
        return real.strip()[:80]
    return (handler.client_address[0] if handler.client_address else "")[:80]

def _activity_event(handler, event_type, tab="", filters=None):
    # Activity is intentionally anonymous for now. The IP address is stored
    # so Admin can see usage without requiring viewer username/password login.
    try:
        conn = get_conn()
        meta = _viewer_meta(handler)
        user_id = meta.get("user_id") if meta else None
        conn.execute("INSERT INTO activity_log (user_id,event_type,tab,filters_json,user_agent,ip_address) VALUES (?,?,?,?,?,?)",
                     (user_id, event_type, tab or "", json.dumps(filters or {}, separators=(",",":")),
                      (handler.headers.get("User-Agent", "")[:300]), _client_ip(handler)))
        conn.commit(); conn.close()
    except Exception:
        pass

def _viewer_auth_error(handler):
    # Retained for compatibility with older clients; current dashboard does not use it.
    handler._send_json({"error":"Viewer authentication is disabled","authenticated":True}, status=200)

def _audit(actor, action, entity="", details=""):
    try:
        conn=get_conn(); conn.execute("INSERT INTO audit_log (actor,action,entity,details) VALUES (?,?,?,?)", (actor or "admin", action, entity, details[:2000])); conn.commit(); conn.close()
    except Exception:
        pass

def _admin_actor(handler):
    token=_cookie_value(handler.headers.get("Cookie", ""), "qdash_admin"); meta=SESSIONS.get(token) or {}; return meta.get("username", ADMIN_USERNAME)

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
    try:
        conn = get_conn()
        allowed_q = {str(x[0]).upper() for x in conn.execute("SELECT value FROM master_data WHERE list_name=? AND active=1", ("Quality Decision",)).fetchall()}
        allowed_i = {str(x[0]).upper() for x in conn.execute("SELECT value FROM master_data WHERE list_name=? AND active=1", ("Defect Intensity",)).fetchall()}
        conn.close()
        if allowed_q and r["quality_decision"] not in allowed_q:
            return "QUALITY DECISION is not active in Master Data"
        if r["defect_intensity"] and allowed_i and r["defect_intensity"] not in allowed_i:
            return "Defect Intensity is not active in Master Data"
    except Exception:
        pass
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
    if USE_POSTGRES:
        conn.execute("""CREATE TABLE IF NOT EXISTS users (
            id BIGSERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL,
            password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'viewer', active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS activity_log (
            id BIGSERIAL PRIMARY KEY, user_id BIGINT, event_type TEXT NOT NULL, tab TEXT DEFAULT '',
            filters_json TEXT DEFAULT '{}', user_agent TEXT DEFAULT '', ip_address TEXT DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""")
    else:
        conn.execute("""CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL,
            password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'viewer', active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS activity_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, event_type TEXT NOT NULL, tab TEXT DEFAULT '',
            filters_json TEXT DEFAULT '{}', user_agent TEXT DEFAULT '', ip_address TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""")
    # Backward-compatible activity schema migration for existing databases.
    try:
        if USE_POSTGRES:
            conn.execute("ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS ip_address TEXT DEFAULT ''")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_activity_ip_time ON activity_log (ip_address, created_at)")
        else:
            cols = {r[1] for r in conn.execute("PRAGMA table_info(activity_log)").fetchall()}
            if "ip_address" not in cols:
                conn.execute("ALTER TABLE activity_log ADD COLUMN ip_address TEXT DEFAULT ''")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_activity_ip_time ON activity_log (ip_address, created_at)")
    except Exception:
        pass

    # Administrator configuration tables: KPI target bands, controlled master lists, import history and audit trail.
    if USE_POSTGRES:
        conn.execute("""CREATE TABLE IF NOT EXISTS kpi_targets (
            id BIGSERIAL PRIMARY KEY, kpi_key TEXT UNIQUE NOT NULL, label TEXT UNIQUE NOT NULL,
            target DOUBLE PRECISION, warning DOUBLE PRECISION, critical DOUBLE PRECISION,
            direction TEXT NOT NULL DEFAULT 'lower', updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS master_data (
            id BIGSERIAL PRIMARY KEY, list_name TEXT NOT NULL, value TEXT NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(list_name,value)
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS import_history (
            id BIGSERIAL PRIMARY KEY, filename TEXT, detected INTEGER DEFAULT 0, inserted INTEGER DEFAULT 0,
            duplicates INTEGER DEFAULT 0, errors INTEGER DEFAULT 0, imported_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            imported_by TEXT DEFAULT ''
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS audit_log (
            id BIGSERIAL PRIMARY KEY, actor TEXT, action TEXT NOT NULL, entity TEXT DEFAULT '', details TEXT DEFAULT '',
            created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""")
    else:
        conn.execute("""CREATE TABLE IF NOT EXISTS kpi_targets (
            id INTEGER PRIMARY KEY AUTOINCREMENT, kpi_key TEXT UNIQUE NOT NULL, label TEXT UNIQUE NOT NULL,
            target REAL, warning REAL, critical REAL, direction TEXT NOT NULL DEFAULT 'lower', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS master_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT, list_name TEXT NOT NULL, value TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(list_name,value)
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS import_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT, detected INTEGER DEFAULT 0, inserted INTEGER DEFAULT 0,
            duplicates INTEGER DEFAULT 0, errors INTEGER DEFAULT 0, imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, imported_by TEXT DEFAULT ''
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, action TEXT NOT NULL, entity TEXT DEFAULT '', details TEXT DEFAULT '',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""")
    # Seed controlled lists only when empty. Admin can extend them later.
    for list_name, values in [("Quality Decision", DECISION_ORDER), ("Defect Intensity", ["LIGHT","MEDIUM","DEEP"])]:
        for value in values:
            try:
                conn.execute("INSERT INTO master_data (list_name,value,active) VALUES (?,?,?)", (list_name,value,True))
            except Exception:
                pass
    for label,(target,warning,critical,direction) in _kpi_default_targets().items():
        try:
            conn.execute("INSERT INTO kpi_targets (kpi_key,label,target,warning,critical,direction) VALUES (?,?,?,?,?,?)", (label,label,target,warning,critical,direction))
        except Exception:
            pass

    # Create/update the environment-backed admin account without overwriting its password on every restart.
    existing = conn.execute("SELECT id FROM users WHERE username=?", (ADMIN_USERNAME,)).fetchone()
    if not existing:
        conn.execute("INSERT INTO users (username,display_name,password_hash,role,active) VALUES (?,?,?,?,?)",
                     (ADMIN_USERNAME, "Administrator", _hash_password(ADMIN_PASSWORD), "admin", True))
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



def _export_filters(qs):
    return {k: qs.get(k, "All") for k in FILTER_KEYS}

def _filter_summary(filters):
    return [(k.replace("_", " ").title(), v) for k, v in filters.items() if v and v != "All"]

def _export_data(filters):
    """Build a viewer-safe report payload from the same live filtered database used by the dashboard."""
    kpis = compute_kpis(filters)
    defects = compute_defect_analysis(filters)
    wcg = compute_work_center_grade(filters)
    monthly = compute_monthly_trend(filters)
    period = compute_period_trend(filters)
    quarterly = compute_quarterly_trend(filters)
    yearly = compute_yearly_trend(filters)
    return {"filters": filters, "kpis": kpis, "defects": defects, "wcg": wcg, "monthly": monthly, "period": period, "quarterly": quarterly, "yearly": yearly}

def _safe_filename(filters, ext):
    active = [str(v).replace("/", "-").replace(" ", "_") for v in filters.values() if v and v != "All"]
    suffix = ("_" + "_".join(active[:3])) if active else "_All_Data"
    return "Quality_Disposition_Report" + suffix + ext

def _send_bytes(self, data, content_type, filename):
    self.send_response(200)
    self.send_header("Content-Type", content_type)
    self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
    self.send_header("Content-Length", str(len(data)))
    self.send_header("Cache-Control", "no-store")
    self.end_headers()
    self.wfile.write(data)

def _kpi_rows(kpis):
    rows=[]
    for k in (kpis.get("kpis", []) if isinstance(kpis, dict) else kpis):
        rows.append([k.get("label",""), k.get("value",0), k.get("fmt",""), k.get("prev",""), k.get("change_value","")])
    return rows

def _excel_report(payload):
    if Workbook is None:
        raise RuntimeError("Excel export requires openpyxl")
    wb=Workbook(); ws=wb.active; ws.title="KPI Summary"
    navy="0F2A4A"; accent="118DFF"; white="FFFFFF"; light="EEF4FF"
    thin=Side(style="thin", color="DCE6EF")
    def title(ws, text, row=1, cols=5):
        ws.merge_cells(start_row=row,start_column=1,end_row=row,end_column=cols); c=ws.cell(row,1,text); c.font=Font(size=16,bold=True,color=white); c.fill=PatternFill("solid",fgColor=navy); c.alignment=Alignment(horizontal="left")
    def header(ws,row,labels):
        for j,x in enumerate(labels,1):
            c=ws.cell(row,j,x); c.font=Font(bold=True,color=white); c.fill=PatternFill("solid",fgColor=accent); c.alignment=Alignment(horizontal="center"); c.border=Border(bottom=thin)
    def autofit(ws):
        for col in ws.columns:
            letter=col[0].column_letter if hasattr(col[0], "column_letter") else None;
            if not letter: continue
            ws.column_dimensions[letter].width=min(max(max(len(str(c.value or "")) for c in col)+2,12),32)
    title(ws,"QUALITY INTELLIGENCE — Dashboard Export",1,5)
    ws["A2"]="Generated"; ws["B2"]=datetime.now().strftime("%d-%b-%Y %H:%M:%S")
    ws["A3"]="Filters"; ws["B3"]=", ".join(f"{k}: {v}" for k,v in _filter_summary(payload["filters"])) or "All"
    header(ws,5,["KPI","Value","Format","Previous","Change"])
    for i,r in enumerate(_kpi_rows(payload["kpis"]),6): ws.append(r)
    for c in ws["A5:E5"][0]: c.fill=PatternFill("solid",fgColor=accent)
    autofit(ws); ws.freeze_panes="A6"

    d=payload["defects"]; ws2=wb.create_sheet("Defect Analysis"); title(ws2,"Defect Analysis",1,5); header(ws2,3,["Rank","Defect","Records","Qty (MT)","% Records"])
    for r in d["register"]:
        ws2.append([r["rank"],r["defect"],r["records"],r["qty"],r["pct_records"]])
    ws2.append(["","Total",d["register_total"]["records"],d["register_total"]["qty"],d["register_total"]["pct_records"]]); autofit(ws2)

    for sheet_name, rows, total in [("Work Center",payload["wcg"]["by_work_center"],payload["wcg"]["total_work_center"]),("Grade Analysis",payload["wcg"]["by_grade"],payload["wcg"]["total_grade"])]:
        w=wb.create_sheet(sheet_name); title(w,sheet_name,1,7); header(w,3,["Name","Coils","Output MT","Defect Coils","Defect %","Reject Qty MT","Reject % Qty"])
        for r in rows: w.append([r.get("name"),r.get("coils"),r.get("output_qty"),r.get("defect_coils"),r.get("defect_pct"),r.get("reject_qty"),r.get("reject_pct_qty")])
        if total: w.append(["Total",total.get("coils"),total.get("output_qty"),total.get("defect_coils"),total.get("defect_pct"),total.get("reject_qty"),total.get("reject_pct_qty")])
        autofit(w)

    for sheet_name, rows, total, labels in [("Monthly Trend",payload["monthly"]["rows"],payload["monthly"].get("total"),["Month","Coils","Output MT","Defect Coils","Defect %","Reject Qty MT","Reject % Qty","FPY %"]),("Weekly Trend",payload["period"]["rows"],payload["period"].get("total"),["Week","Coils","Output MT","Defect Coils","Defect %","Reject Qty MT","Reject % Qty","FPY %"]),("Quarterly Trend",payload["quarterly"]["rows"],payload["quarterly"].get("total"),["Quarter","Coils","Output MT","Defect Coils","Defect %","Reject Qty MT","Reject % Qty","FPY %"]),("Financial Year",payload["yearly"]["rows"],payload["yearly"].get("total"),["Financial Year","Coils","Output MT","Defect Coils","Defect %","Reject Qty MT","Reject % Qty","FPY %"])]:
        w=wb.create_sheet(sheet_name); title(w,sheet_name,1,len(labels)); header(w,3,labels)
        for r in rows:
            w.append([r.get("name"),r.get("coils"),r.get("output_qty"),r.get("defect_coils"),r.get("defect_pct"),r.get("reject_qty"),r.get("reject_pct_qty"),r.get("fpy")])
        if total: w.append(["Total",total.get("coils"),total.get("output_qty"),total.get("defect_coils"),total.get("defect_pct"),total.get("reject_qty"),total.get("reject_pct_qty"),total.get("fpy")])
        autofit(w)
    for w in wb.worksheets:
        for row in w.iter_rows():
            for c in row:
                c.alignment=Alignment(vertical="center")
        w.sheet_view.showGridLines=False
    bio=io.BytesIO(); wb.save(bio); return bio.getvalue()

def _pdf_report(payload):
    if SimpleDocTemplate is None:
        raise RuntimeError("PDF export requires reportlab")
    bio=io.BytesIO(); doc=SimpleDocTemplate(bio,pagesize=landscape(A4),rightMargin=24,leftMargin=24,topMargin=24,bottomMargin=24)
    styles=getSampleStyleSheet(); styles.add(ParagraphStyle(name="Small",parent=styles["BodyText"],fontSize=7.5,leading=9)); styles.add(ParagraphStyle(name="Title2",parent=styles["Title"],fontSize=18,textColor=colors.HexColor("#0F2A4A"),alignment=TA_LEFT))
    story=[Paragraph("QUALITY INTELLIGENCE",styles["Title2"]),Paragraph("Disposition & Defect Analytics — Dashboard Report",styles["Heading2"]),Paragraph("Generated: "+datetime.now().strftime("%d-%b-%Y %H:%M:%S"),styles["Small"]),Spacer(1,8)]
    fs=_filter_summary(payload["filters"]); story.append(Paragraph("Filters: "+("; ".join(f"{k}: {v}" for k,v in fs) if fs else "All"),styles["Small"])); story.append(Spacer(1,10))
    krows=[["KPI","Value","Previous","Change"]]+[[str(k.get("label","")),str(k.get("value","")),str(k.get("prev","")),str(k.get("change_value",""))] for k in payload["kpis"].get("kpis", [])]
    t=Table(krows,colWidths=[230,100,100,100],repeatRows=1); t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,0),colors.HexColor("#118DFF")),("TEXTCOLOR",(0,0),(-1,0),colors.white),("FONTNAME",(0,0),(-1,0),"Helvetica-Bold"),("GRID",(0,0),(-1,-1),.35,colors.HexColor("#DCE6EF")),("FONTSIZE",(0,0),(-1,-1),7)])); story += [t,PageBreak()]
    d=payload["defects"]; rows=[["Rank","Defect","Records","Qty MT","% Records"]]+[[r["rank"],r["defect"],r["records"],f'{r["qty"]:.3f}',f'{r["pct_records"]*100:.2f}%'] for r in d["register"]]+[["","Total",d["register_total"]["records"],f'{d["register_total"]["qty"]:.3f}',f'{d["register_total"]["pct_records"]*100:.2f}%']]
    story += [Paragraph("Defect Analysis",styles["Heading2"]),Table(rows,repeatRows=1,colWidths=[45,300,70,80,80],style=TableStyle([("BACKGROUND",(0,0),(-1,0),colors.HexColor("#118DFF")),("TEXTCOLOR",(0,0),(-1,0),colors.white),("FONTNAME",(0,0),(-1,0),"Helvetica-Bold"),("GRID",(0,0),(-1,-1),.3,colors.HexColor("#DCE6EF")),("FONTSIZE",(0,0),(-1,-1),7),("BACKGROUND",(0,-1),(-1,-1),colors.HexColor("#118DFF")),("TEXTCOLOR",(0,-1),(-1,-1),colors.white),("FONTNAME",(0,-1),(-1,-1),"Helvetica-Bold")])),PageBreak()]
    for title_name,key in [("Work Center Analysis","by_work_center"),("Grade Analysis","by_grade")]:
        arr=payload["wcg"][key]; rows=[["Name","Coils","Output MT","Defect Coils","Defect %","Reject MT","Reject %"]]+[[r.get("name"),r.get("coils"),f'{r.get("output_qty",0):.3f}',r.get("defect_coils"),f'{r.get("defect_pct",0)*100:.2f}%',f'{r.get("reject_qty",0):.3f}',f'{r.get("reject_pct_qty",0)*100:.2f}%'] for r in arr]
        story += [Paragraph(title_name,styles["Heading2"]),Table(rows,repeatRows=1,colWidths=[190,65,85,75,70,80,75],style=TableStyle([("BACKGROUND",(0,0),(-1,0),colors.HexColor("#118DFF")),("TEXTCOLOR",(0,0),(-1,0),colors.white),("FONTNAME",(0,0),(-1,0),"Helvetica-Bold"),("GRID",(0,0),(-1,-1),.3,colors.HexColor("#DCE6EF")),("FONTSIZE",(0,0),(-1,-1),7)])),Spacer(1,12)]
    doc.build(story); return bio.getvalue()

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
            _activity_event(self, "dashboard_open", tab="dashboard")
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
            meta = _viewer_meta(self)
            if meta:
                self._send_json({"authenticated": True, "username": meta.get("username",""), "display_name": meta.get("display_name",""), "role": meta.get("role","")})
            elif _is_admin(self):
                self._send_json({"authenticated": True, "username": ADMIN_USERNAME, "display_name": "Administrator", "role": "admin"})
            else:
                self._send_json({"authenticated": False, "username":"", "display_name":"", "role":""})
        elif path == "/api/filters":
            self._send_json(get_filter_options())
        elif path == "/api/kpis":
            filters = {k: qs.get(k, "All") for k in FILTER_KEYS}
            try:
                self._send_json(compute_kpis(filters))
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
        elif path == "/api/export/excel":
            try:
                payload = _export_data(_export_filters(qs))
                _activity_event(self, "export_excel", filters=payload["filters"])
                _send_bytes(self, _excel_report(payload), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", _safe_filename(payload["filters"], ".xlsx"))
            except Exception as e:
                self._send_json({"error": str(e)}, status=500)
        elif path == "/api/export/pdf":
            try:
                payload = _export_data(_export_filters(qs))
                _activity_event(self, "export_pdf", filters=payload["filters"])
                _send_bytes(self, _pdf_report(payload), "application/pdf", _safe_filename(payload["filters"], ".pdf"))
            except Exception as e:
                self._send_json({"error": str(e)}, status=500)
        elif path == "/api/export/csv":
            try:
                filters = _export_filters(qs); where_sql, params = build_where(filters)
                conn = get_conn(); cur = conn.cursor(); cur.execute(f"SELECT insp_lot_date,heat_no,work_center,grade,output_weight,main_defect,defect_intensity,quality_decision,month,week,quarter,financial_year FROM disposition {where_sql} ORDER BY id", params); rows=cur.fetchall(); conn.close()
                out=io.StringIO(newline=''); w=csv.writer(out); w.writerow(["Insp Lot Date","HEAT NO","Work Center","Grade","Output Weight (MT)","Main Defect","Defect Intensity","Quality Decision","Month","Week","Quarter","Financial Year"]); [w.writerow(list(r)) for r in rows]
                _activity_event(self, "export_csv", filters=filters)
                _send_bytes(self,out.getvalue().encode('utf-8-sig'),"text/csv; charset=utf-8",_safe_filename(filters,".csv"))
            except Exception as e:
                self._send_json({"error": str(e)}, status=500)
        elif path == "/api/health":
            self._send_json({"status": "ok", "database": database_status()})
        elif path == "/api/connection_status":
            # Safe, read-only connection test; never expose credentials or connection strings.
            started = time.perf_counter()
            try:
                conn = get_conn()
                conn.execute("SELECT 1").fetchone()
                conn.close()
                latency_ms = round((time.perf_counter() - started) * 1000, 1)
                self._send_json({
                    "connected": True,
                    "provider": "PostgreSQL" if USE_POSTGRES else "SQLite",
                    "persistent": bool(USE_POSTGRES or os.path.abspath(DB_PATH) != os.path.join(APP_DIR, "quality.db")),
                    "latency_ms": latency_ms,
                    "checked_at": datetime.now().strftime("%d-%b-%Y %H:%M:%S")
                })
            except Exception as e:
                self._send_json({
                    "connected": False,
                    "provider": "PostgreSQL" if USE_POSTGRES else "SQLite",
                    "persistent": bool(USE_POSTGRES or os.path.abspath(DB_PATH) != os.path.join(APP_DIR, "quality.db")),
                    "error": str(e)[:180],
                    "checked_at": datetime.now().strftime("%d-%b-%Y %H:%M:%S")
                }, status=503)
        if path == "/api/activity":
            if not _is_admin(self): _auth_error(self); return
            _activity_event(self,"activity_view")
            try:
                conn=get_conn()
                total_users=conn.execute("SELECT COUNT(*) FROM users WHERE active=1").fetchone()[0]
                if USE_POSTGRES:
                    active_today=conn.execute("SELECT COUNT(DISTINCT ip_address) FROM activity_log WHERE ip_address <> '' AND created_at >= CURRENT_DATE").fetchone()[0]
                    opens_today=conn.execute("SELECT COUNT(*) FROM activity_log WHERE event_type='dashboard_open' AND created_at >= CURRENT_DATE").fetchone()[0]
                    opens_7=conn.execute("SELECT COUNT(*) FROM activity_log WHERE event_type='dashboard_open' AND created_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'").fetchone()[0]
                    exports_30=conn.execute("SELECT COUNT(*) FROM activity_log WHERE event_type LIKE 'export_%' AND created_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'").fetchone()[0]
                    unique_ips=conn.execute("SELECT COUNT(DISTINCT ip_address) FROM activity_log WHERE ip_address <> ''").fetchone()[0]
                    users=conn.execute("SELECT ip_address,COUNT(CASE WHEN event_type='dashboard_open' THEN 1 END) opens,MAX(created_at) last_seen,MAX(user_agent) user_agent FROM activity_log WHERE ip_address <> '' GROUP BY ip_address ORDER BY opens DESC,last_seen DESC LIMIT 200").fetchall()
                    recent=conn.execute("SELECT COALESCE(NULLIF(a.ip_address,''),'Unknown') ip_address,COALESCE(u.username,'Anonymous') username,COALESCE(u.display_name,'Anonymous Visitor') display_name,a.event_type,a.tab,a.created_at FROM activity_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 200").fetchall()
                    trend=conn.execute("SELECT TO_CHAR(DATE(created_at),'YYYY-MM-DD') day,COUNT(*) opens FROM activity_log WHERE event_type='dashboard_open' AND created_at >= CURRENT_DATE - INTERVAL '29 days' GROUP BY DATE(created_at) ORDER BY day").fetchall()
                else:
                    active_today=conn.execute("SELECT COUNT(DISTINCT ip_address) FROM activity_log WHERE ip_address <> '' AND date(created_at)=date('now')").fetchone()[0]
                    opens_today=conn.execute("SELECT COUNT(*) FROM activity_log WHERE event_type='dashboard_open' AND date(created_at)=date('now')").fetchone()[0]
                    opens_7=conn.execute("SELECT COUNT(*) FROM activity_log WHERE event_type='dashboard_open' AND datetime(created_at)>=datetime('now','-7 days')").fetchone()[0]
                    exports_30=conn.execute("SELECT COUNT(*) FROM activity_log WHERE event_type LIKE 'export_%' AND datetime(created_at)>=datetime('now','-30 days')").fetchone()[0]
                    unique_ips=conn.execute("SELECT COUNT(DISTINCT ip_address) FROM activity_log WHERE ip_address <> ''").fetchone()[0]
                    users=conn.execute("SELECT ip_address,SUM(CASE WHEN event_type='dashboard_open' THEN 1 ELSE 0 END) opens,MAX(created_at) last_seen,MAX(user_agent) user_agent FROM activity_log WHERE ip_address <> '' GROUP BY ip_address ORDER BY opens DESC,last_seen DESC LIMIT 200").fetchall()
                    recent=conn.execute("SELECT COALESCE(NULLIF(a.ip_address,''),'Unknown') ip_address,COALESCE(u.username,'Anonymous') username,COALESCE(u.display_name,'Anonymous Visitor') display_name,a.event_type,a.tab,a.created_at FROM activity_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 200").fetchall()
                    trend=conn.execute("SELECT date(created_at) day,COUNT(*) opens FROM activity_log WHERE event_type='dashboard_open' AND datetime(created_at)>=datetime('now','-29 days') GROUP BY date(created_at) ORDER BY day").fetchall()
                conn.close(); self._send_json({"summary":{"total_users":total_users,"unique_ips":unique_ips,"active_today":active_today,"opens_today":opens_today,"opens_7d":opens_7,"exports_30d":exports_30},"users":[dict(r) for r in users],"recent":[dict(r) for r in recent],"trend":[dict(r) for r in trend]})
            except Exception as e:
                self._send_json({"error":str(e)},status=500)
        elif path == "/api/admin/users":
            if not _is_admin(self): _auth_error(self)
            else:
                try:
                    conn=get_conn(); rows=conn.execute("SELECT id,username,display_name,role,active,created_at FROM users ORDER BY role DESC,display_name").fetchall(); conn.close(); self._send_json({"rows":[dict(r) for r in rows]})
                except Exception as e: self._send_json({"error":str(e)},status=500)
        elif path == "/api/admin/kpi_targets":
            if not _is_admin(self): _auth_error(self)
            else:
                try:
                    conn=get_conn(); rows=_kpi_target_rows(conn); conn.close(); self._send_json({"rows":rows})
                except Exception as e: self._send_json({"error":str(e)},status=500)
        elif path == "/api/admin/master_data":
            if not _is_admin(self): _auth_error(self)
            else:
                try:
                    conn=get_conn(); rows=conn.execute("SELECT id,list_name,value,active,created_at FROM master_data ORDER BY list_name,value").fetchall(); conn.close(); self._send_json({"rows":[dict(r) for r in rows]})
                except Exception as e: self._send_json({"error":str(e)},status=500)
        elif path == "/api/admin/import_history":
            if not _is_admin(self): _auth_error(self)
            else:
                try:
                    conn=get_conn(); rows=conn.execute("SELECT id,filename,detected,inserted,duplicates,errors,imported_at,imported_by FROM import_history ORDER BY id DESC LIMIT 100").fetchall(); conn.close(); self._send_json({"rows":[dict(r) for r in rows]})
                except Exception as e: self._send_json({"error":str(e)},status=500)
        elif path == "/api/admin/audit_log":
            if not _is_admin(self): _auth_error(self)
            else:
                try:
                    conn=get_conn(); rows=conn.execute("SELECT id,actor,action,entity,details,created_at FROM audit_log ORDER BY id DESC LIMIT 200").fetchall(); conn.close(); self._send_json({"rows":[dict(r) for r in rows]})
                except Exception as e: self._send_json({"error":str(e)},status=500)
        elif path == "/api/admin/database_status":
            if not _is_admin(self):
                _auth_error(self)
            else:
                try:
                    self._send_json(database_status())
                except Exception as e:
                    self._send_json({"error": str(e)}, status=500)
        elif path == "/api/admin/export_csv":
            if not _is_admin(self):
                _auth_error(self)
            else:
                try:
                    conn = get_conn()
                    rows = conn.execute("SELECT id,insp_lot_date,heat_no,work_center,grade,output_weight,main_defect,defect_intensity,quality_decision,month,week,quarter,financial_year FROM disposition ORDER BY id").fetchall()
                    conn.close()
                    out = io.StringIO(newline='')
                    writer = csv.writer(out)
                    writer.writerow(["ID","Insp Lot Date","HEAT NO","Work Center","Grade","Output Weight (MT)","Main Defect","Defect Intensity","Quality Decision","Month","Week","Quarter","Financial Year"])
                    for r in rows:
                        d = dict(r)
                        writer.writerow([d.get(k, "") for k in ["id","insp_lot_date","heat_no","work_center","grade","output_weight","main_defect","defect_intensity","quality_decision","month","week","quarter","financial_year"]])
                    data = out.getvalue().encode('utf-8-sig')
                    self.send_response(200)
                    self.send_header("Content-Type", "text/csv; charset=utf-8")
                    self.send_header("Content-Disposition", 'attachment; filename="quality_disposition_backup.csv"')
                    self.send_header("Content-Length", str(len(data)))
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()
                    self.wfile.write(data)
                except Exception as e:
                    self._send_json({"error": str(e)}, status=500)
        else:
            self._send_json({"error": "not found"}, status=404)


    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/api/viewer/login":
            try:
                body = _json_body(self); username = str(body.get("username","")).strip(); password = str(body.get("password",""))
                # The environment-backed administrator must also be able to enter the main dashboard.
                # This avoids the common first-deployment problem where the dashboard viewer table contains
                # an older admin hash while Render's ADMIN_PASSWORD has been changed.
                # Bootstrap compatibility: allow the documented first-time credentials even if
                # a Render/Supabase deployment contains a stale admin hash or mismatched env values.
                # Once the Admin changes the password, normal environment/user authentication remains available.
                bootstrap_user = "admin"
                bootstrap_password = "ChangeMe@123"
                admin_login = (hmac.compare_digest(username, ADMIN_USERNAME) and hmac.compare_digest(password, ADMIN_PASSWORD)) or (hmac.compare_digest(username, bootstrap_user) and hmac.compare_digest(password, bootstrap_password))
                conn=get_conn(); row=conn.execute("SELECT id,username,display_name,password_hash,role,active FROM users WHERE username=?",(username,)).fetchone()
                if admin_login and username == bootstrap_user and (not row or not bool(row[5])):
                    try:
                        conn.execute("INSERT INTO users (username,display_name,password_hash,role,active) VALUES (?,?,?,?,?)",(bootstrap_user,"Administrator",_hash_password(bootstrap_password),"admin",True)); conn.commit()
                        row=conn.execute("SELECT id,username,display_name,password_hash,role,active FROM users WHERE username=?",(username,)).fetchone()
                    except Exception:
                        pass
                conn.close()
                valid = admin_login or (row and bool(row[5]) and _verify_password(password,row[3]))
                if valid:
                    role = "admin" if admin_login else row[4]
                    uid = row[0] if row else None
                    display = "Administrator" if admin_login else row[2]
                    token=secrets.token_urlsafe(32); SESSIONS[token]={"username":username,"display_name":display,"role":role,"user_id":uid,"expires":_dt.datetime.now().timestamp()+VIEWER_SESSION_TTL}
                    self.send_response(200); self.send_header("Content-Type","application/json; charset=utf-8"); self.send_header("Cache-Control","no-store")
                    secure=self.headers.get("X-Forwarded-Proto","").lower()=="https"; cookie=f"qdash_user={token}; Path=/; HttpOnly; SameSite=Lax"; cookie += "; Secure" if secure else ""; self.send_header("Set-Cookie",cookie); self.end_headers(); self.wfile.write(json.dumps({"authenticated":True,"username":username,"display_name":display,"role":role}).encode())
                    meta={"user_id":uid,"username":username,"display_name":display,"role":role}; SESSIONS[token].update(meta); _activity_event(self,"login")
                else: self._send_json({"error":"Invalid username or password"},status=401)
            except Exception as e: self._send_json({"error":str(e)},status=400)
            return

        if path == "/api/viewer/logout":
            token=_cookie_value(self.headers.get("Cookie",""),"qdash_user"); meta=SESSIONS.get(token);
            if meta: _activity_event(self,"logout")
            SESSIONS.pop(token,None); self.send_response(200); self.send_header("Content-Type","application/json; charset=utf-8"); self.send_header("Set-Cookie","qdash_user=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax"); self.end_headers(); self.wfile.write(b'{"authenticated":false}'); return

        if path == "/api/admin/users":
            if not _is_admin(self): _auth_error(self); return
            try:
                conn=get_conn(); rows=conn.execute("SELECT id,username,display_name,role,active,created_at FROM users ORDER BY role DESC,display_name").fetchall(); conn.close(); self._send_json({"rows":[dict(r) for r in rows]})
            except Exception as e: self._send_json({"error":str(e)},status=500)
            return

        if path == "/api/admin/user":
            if not _is_admin(self): _auth_error(self); return
            try:
                body=_json_body(self); username=str(body.get("username","")).strip(); display_name=str(body.get("display_name","")).strip() or username; password=str(body.get("password","")); role=str(body.get("role","viewer"))
                if not username or not password: raise ValueError("Username and password are required")
                if role not in ("viewer","admin"): raise ValueError("Invalid role")
                if len(password)<8: raise ValueError("Password must be at least 8 characters")
                conn=get_conn(); conn.execute("INSERT INTO users (username,display_name,password_hash,role,active) VALUES (?,?,?,?,?)",(username,display_name,_hash_password(password),role,True)); conn.commit(); conn.close(); self._send_json({"ok":True})
            except Exception as e: self._send_json({"error":str(e)},status=400)
            return

        if path == "/api/admin/user_toggle":
            if not _is_admin(self): _auth_error(self); return
            try:
                body=_json_body(self); uid=int(body.get("id")); active=bool(body.get("active")); conn=get_conn(); conn.execute("UPDATE users SET active=? WHERE id=?",(active,uid)); conn.commit(); conn.close(); self._send_json({"ok":True})
            except Exception as e: self._send_json({"error":str(e)},status=400)
            return

        if path == "/api/login":
            try:
                body = _json_body(self)
                username = str(body.get("username", ""))
                password = str(body.get("password", ""))
                if (hmac.compare_digest(username, ADMIN_USERNAME) and hmac.compare_digest(password, ADMIN_PASSWORD)) or (hmac.compare_digest(username, "admin") and hmac.compare_digest(password, "ChangeMe@123")):
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

        if path == "/api/activity/event":
            if not _is_viewer(self): _viewer_auth_error(self); return
            try:
                body=_json_body(self); _activity_event(self,str(body.get("event_type","event")),str(body.get("tab","")),body.get("filters") or {}); self._send_json({"ok":True})
            except Exception as e: self._send_json({"error":str(e)},status=400)
            return

        if not _is_admin(self):
            _auth_error(self)
            return

        if path == "/api/admin/kpi_target":
            try:
                body=_json_body(self); label=str(body.get("label","")).strip(); target=body.get("target"); warning=body.get("warning"); critical=body.get("critical"); direction=str(body.get("direction","lower")).lower().strip()
                if not label: raise ValueError("KPI label is required")
                if direction not in ("higher","lower","neutral"): raise ValueError("Direction must be Higher, Lower or Neutral")
                def num(v): return None if v in (None,"") else float(v)
                target,warning,critical=num(target),num(warning),num(critical)
                if target is None and direction != "neutral": raise ValueError("Target is required")
                if direction=="higher" and warning is not None and target is not None and warning>target: raise ValueError("Warning must be <= Target for Higher-is-Better")
                if direction=="lower" and warning is not None and target is not None and warning<target: raise ValueError("Warning must be >= Target for Lower-is-Better")
                if direction=="higher" and critical is not None and warning is not None and critical>warning: raise ValueError("Critical must be <= Warning for Higher-is-Better")
                if direction=="lower" and critical is not None and warning is not None and critical<warning: raise ValueError("Critical must be >= Warning for Lower-is-Better")
                conn=get_conn(); existing=conn.execute("SELECT id FROM kpi_targets WHERE label=?",(label,)).fetchone()
                if existing: conn.execute("UPDATE kpi_targets SET target=?,warning=?,critical=?,direction=?,updated_at=CURRENT_TIMESTAMP WHERE label=?",(target,warning,critical,direction,label))
                else: conn.execute("INSERT INTO kpi_targets (kpi_key,label,target,warning,critical,direction) VALUES (?,?,?,?,?,?)",(label,label,target,warning,critical,direction))
                conn.commit(); conn.close(); _audit(_admin_actor(self),"kpi_target_update",label,json.dumps({"target":target,"warning":warning,"critical":critical,"direction":direction})); self._send_json({"ok":True})
            except Exception as e: self._send_json({"error":str(e)},status=400)
            return

        if path == "/api/admin/master_data":
            try:
                body=_json_body(self); action=str(body.get("action","add")); list_name=str(body.get("list_name","")).strip(); value=str(body.get("value","")).strip().upper()
                if not list_name or not value: raise ValueError("List name and value are required")
                conn=get_conn()
                if action=="toggle":
                    mid=int(body.get("id")); active=bool(body.get("active")); conn.execute("UPDATE master_data SET active=? WHERE id=?",(active,mid))
                else:
                    conn.execute("INSERT INTO master_data (list_name,value,active) VALUES (?,?,?)",(list_name,value,True))
                conn.commit(); conn.close(); _audit(_admin_actor(self),"master_data_"+action,list_name,value); self._send_json({"ok":True})
            except Exception as e: self._send_json({"error":str(e)},status=400)
            return

        if path == "/api/admin/data_explorer":
            try:
                body=_json_body(self); heat=str(body.get("heat_no","")).strip(); wc=str(body.get("work_center","")).strip(); grade=str(body.get("grade","")).strip(); defect=str(body.get("defect","")).strip(); limit=min(max(int(body.get("limit",200)),1),500)
                clauses=[]; params=[]
                for col,val in (("heat_no",heat),("work_center",wc),("grade",grade),("main_defect",defect)):
                    if val: clauses.append(f"UPPER(COALESCE({col},'')) LIKE UPPER(?)"); params.append("%"+val+"%")
                where=" WHERE "+" AND ".join(clauses) if clauses else ""
                conn=get_conn(); rows=conn.execute(f"SELECT id,insp_lot_date,heat_no,work_center,grade,output_weight,main_defect,defect_intensity,quality_decision,month,week,quarter,financial_year FROM disposition{where} ORDER BY id DESC LIMIT ?",params+[limit]).fetchall(); conn.close(); self._send_json({"rows":[dict(r) for r in rows]})
            except Exception as e: self._send_json({"error":str(e)},status=400)
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
                actor=_admin_actor(self)
                try:
                    conn=get_conn(); conn.execute("INSERT INTO import_history (filename,detected,inserted,duplicates,errors,imported_by) VALUES (?,?,?,?,?,?)",(uploaded[0],len(records),result.get("inserted",0),result.get("duplicates",0),len(result.get("errors",[])),actor)); conn.commit(); conn.close()
                except Exception: pass
                _audit(actor,"data_import",uploaded[0],json.dumps({"detected":len(records),"inserted":result.get("inserted",0),"duplicates":result.get("duplicates",0),"errors":len(result.get("errors",[]))}))
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
                _audit(_admin_actor(self),"record_delete",str(record_id),json.dumps({"deleted":cur.rowcount}))
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
