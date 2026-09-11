#!/usr/bin/env python3
"""
Quality Disposition Control Dashboard
Pure Python built-in HTTP server + SQLite/PostgreSQL. No Flask. No external CDN.
Run:  python3 server.py [port]
Then open http://localhost:8000/  (default port 8000)
"""

import json
import math
import gzip
import os
import re
import difflib
import sqlite3

try:
    import psycopg2
    from psycopg2.extras import DictCursor
    from psycopg2.pool import SimpleConnectionPool
except ImportError:
    psycopg2 = None
    DictCursor = None
    SimpleConnectionPool = None
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
    from openpyxl.drawing.image import Image as XLImage
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
except ImportError:
    Workbook = None
try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
except Exception:
    plt = None

try:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_CENTER, TA_LEFT
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, Image as RLImage
except ImportError:
    SimpleDocTemplate = None

try:
    from pptx import Presentation
    from pptx.util import Inches, Pt
    from pptx.dml.color import RGBColor
    from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
    from pptx.enum.shapes import MSO_SHAPE
except ImportError:
    Presentation = None

APP_DIR = os.path.dirname(os.path.abspath(__file__))
# Recommended for Render Free: set DATABASE_URL to an external PostgreSQL
# database (Supabase/Neon/etc.). If DATABASE_URL is absent, the app falls
# back to SQLite for local use and development.
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
DB_PATH = os.environ.get("DB_PATH", os.path.join(APP_DIR, "quality.db"))
USE_POSTGRES = bool(DATABASE_URL)
PG_POOL = None
RESPONSE_CACHE = {}
RESPONSE_CACHE_TTL = 10

# 6M Fishbone (Man/Machine/Material/Method/Measurement/Environment) master
# data cache. The master list only changes when an admin re-imports the
# 6M master workbook, so it is cached in memory and invalidated on import.
FISHBONE_CACHE = {"rows": None, "aliases": None, "loaded_at": 0}
FISHBONE_CAUSE_FIELDS = ["man", "machine", "material", "method", "measurement", "environment"]
FISHBONE_FUZZY_CUTOFF = 0.80


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
REMOVED_KPIS = {"PPM Defective", "Intensity Tagging %", "Process Sigma Level (Approx.)", "Without Intensity %", "First Pass Yield %", "Prime %"}

DEFAULT_KPI_TARGETS = {
    "First Pass Yield % (Prime%)": {"target": 0.97, "warning": 0.90, "critical": 0.80, "direction": "higher"},
    "Hold for Decision % Qty": {"target": 0.01, "warning": 0.03, "critical": 0.05, "direction": "lower"},
    "Defect Rate": {"target": 0.01, "warning": 0.03, "critical": 0.05, "direction": "lower"},
    "Reject % Qty": {"target": 0.01, "warning": 0.03, "critical": 0.05, "direction": "lower"},
    "Salvage % Qty": {"target": 0.01, "warning": 0.03, "critical": 0.05, "direction": "lower"},
    "Rework % Qty": {"target": 0.01, "warning": 0.03, "critical": 0.05, "direction": "lower"},
}

def _target_rows():
    conn=get_conn(); rows=conn.execute("SELECT label,target,warning,critical,direction,updated_at FROM kpi_targets ORDER BY label").fetchall(); conn.close()
    return [dict(r) for r in rows]

def get_kpi_targets():
    # Hide all retired KPI targets from both public and admin APIs.
    rows={r["label"]:r for r in _target_rows() if r["label"] not in REMOVED_KPIS}
    out={}
    for label,cfg in DEFAULT_KPI_TARGETS.items():
        r=rows.get(label)
        out[label]=r or {"label":label,**cfg}
    for label,r in rows.items():
        out.setdefault(label,r)
    return out

def _kpi_target_status(label,value):
    cfg=get_kpi_targets().get(label)
    if not cfg or cfg.get("target") is None: return None
    try:
        v=float(value); t=float(cfg.get("target")); w=float(cfg.get("warning")); c=float(cfg.get("critical"))
    except Exception: return None
    d=(cfg.get("direction") or "higher").lower()
    if d=="lower":
        if v <= t: return "good"
        if v <= w: return "amber"
        return "bad"
    if d=="higher":
        if v >= t: return "good"
        if v >= w: return "amber"
        return "bad"
    return "neutral"

KPI_META_BY_LABEL = {
    "Total Coils":                   {"color": "#0f2a4a", "direction": "neutral",   "change": "pct"},
    "Defect Coils":                  {"color": "#DC2626", "direction": "down_good", "change": "pct"},
    "First Pass Yield % (Prime%)":            {"color": "#16A34A", "direction": "up_good",   "change": "pct"},
    "Hold for Decision % Qty":       {"color": "#D97706", "direction": "down_good", "change": "pct"},
    "Output Quantity (MT)":          {"color": "#0f2a4a", "direction": "neutral",   "change": "pct"},
    "Reject Qty (MT)":               {"color": "#DC2626", "direction": "down_good", "change": "pct"},
    "Salvage + Divert Qty (MT)":     {"color": "#7C3AED", "direction": "down_good", "change": "pct"},
    "Defect Rate":                   {"color": "#DC2626", "direction": "down_good", "change": "pct"},
    "Reject % Qty":                  {"color": "#DC2626", "direction": "down_good", "change": "pct"},
    "Hold For Decision Qty (MT)":    {"color": "#D97706", "direction": "down_good", "change": "pct"},
    "Salvage % Qty":                 {"color": "#7C3AED", "direction": "down_good", "change": "pct"},
    "Rework % Qty":                  {"color": "#D97706", "direction": "down_good", "change": "pct"},
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
    def __init__(self, conn, pooled=False): self.conn = conn; self.pooled = pooled
    def cursor(self): return _PGCursor(self.conn.cursor(cursor_factory=DictCursor))
    def execute(self, sql, params=None):
        c=self.cursor(); c.execute(sql, params); return c
    def commit(self): self.conn.commit()
    def close(self):
        if self.pooled and PG_POOL is not None:
            try: PG_POOL.putconn(self.conn)
            except Exception: self.conn.close()
        else: self.conn.close()

def get_conn():
    global PG_POOL
    if USE_POSTGRES:
        if psycopg2 is None or SimpleConnectionPool is None:
            raise RuntimeError("PostgreSQL support requires psycopg2-binary.")
        if PG_POOL is None:
            minconn = max(1, int(os.environ.get("PG_POOL_MIN", "1")))
            maxconn = max(minconn, int(os.environ.get("PG_POOL_MAX", "8")))
            PG_POOL = SimpleConnectionPool(minconn, maxconn, DATABASE_URL, connect_timeout=10, sslmode=os.environ.get("PGSSLMODE", "require"), application_name="quality-disposition-dashboard")
        return _PGConn(PG_POOL.getconn(), pooled=True)
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
    if USE_POSTGRES:
        for name, expr in [
            ("idx_disp_month_wc_grade", "month, work_center, grade"),
            ("idx_disp_month_decision", "month, quality_decision"),
            ("idx_disp_wc_decision", "work_center, quality_decision"),
            ("idx_disp_grade_decision", "grade, quality_decision"),
            ("idx_disp_heat_batch", "heat_no, batch_no"),
        ]:
            conn.execute(f"CREATE INDEX IF NOT EXISTS {name} ON disposition({expr})")
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


HEAT_KEY_SQL = "NULLIF(UPPER(TRIM(COALESCE(heat_no,''))), '')"

def _coil_count_sql(where_sql, params):
    """Count coils by unique HEAT NO within the current filter scope.
    Duplicate HEAT NO values are intentionally counted once, regardless of
    how many source rows/batches exist for that heat."""
    return f"SELECT COUNT(DISTINCT {HEAT_KEY_SQL}) FROM disposition {where_sql}", params

def kpi_threshold_color(label, value):
    status=_kpi_target_status(label,value)
    return {"good":"#16A34A","amber":"#D97706","bad":"#DC2626","neutral":"#118DFF"}.get(status)

def compute_kpis(filters, _skip_prev=False):
    conn = get_conn()
    cur = conn.cursor()
    where_sql, params = build_where(filters)

    # One aggregate scan for overall coils, defects and quantity.
    dc_expr = "CASE WHEN main_defect <> '' AND main_defect <> 'NO DEFECT' THEN " + HEAT_KEY_SQL + " END"
    cur.execute(f"SELECT COUNT(DISTINCT {HEAT_KEY_SQL}), COUNT(DISTINCT {dc_expr}), COALESCE(SUM(output_weight),0) FROM disposition {where_sql}", params)
    total_coils, defect_coils, output_qty = cur.fetchone()

    # One grouped scan for all decision counts and quantities.
    decision_qty = {d: 0.0 for d in DECISION_ORDER}
    decision_coils = {d: 0 for d in DECISION_ORDER}
    cur.execute(f"SELECT quality_decision, COUNT(DISTINCT {HEAT_KEY_SQL}), COALESCE(SUM(output_weight),0) FROM disposition {where_sql} GROUP BY quality_decision", params)
    for r in cur.fetchall():
        d = r[0]
        if d in decision_qty:
            decision_coils[d], decision_qty[d] = int(r[1] or 0), float(r[2] or 0)

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

    # Main Dashboard KPI display order — labels/names are intentionally unchanged.
    # Row 1: Total / Output / Defect / FPY
    # Row 2: Defect Rate / Reject % / Hold % / Salvage %
    # Row 3: Hold Qty / Reject Qty / Salvage+Divert Qty / Rework %
    kpis = [
        {"label": "Total Coils", "value": total_coils, "fmt": "int"},
        {"label": "Output Quantity (MT)", "value": output_qty, "fmt": "num2"},
        {"label": "Defect Coils", "value": defect_coils, "fmt": "int"},
        {"label": "First Pass Yield % (Prime%)", "value": first_pass_yield, "fmt": "pct"},
        {"label": "Defect Rate", "value": defect_rate, "fmt": "pct"},
        {"label": "Reject % Qty", "value": reject_pct_qty, "fmt": "pct"},
        {"label": "Hold for Decision % Qty", "value": hold_pct_qty, "fmt": "pct"},
        {"label": "Salvage % Qty", "value": salvage_pct_qty, "fmt": "pct"},
        {"label": "Hold For Decision Qty (MT)", "value": hold_qty, "fmt": "num2"},
        {"label": "Reject Qty (MT)", "value": reject_qty, "fmt": "num2"},
        {"label": "Salvage + Divert Qty (MT)", "value": salvage_divert_qty, "fmt": "num2"},
        {"label": "Rework % Qty", "value": rework_pct_qty, "fmt": "pct"},
    ]
    assert len(kpis) == 12, "KPI count must be exactly 12"

    # Apply threshold-based KPI value colors independently of period comparison.
    for k in kpis:
        threshold_color = kpi_threshold_color(k["label"], k["value"])
        if threshold_color:
            k["color"] = threshold_color

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
    intensity_map = {}
    cur.execute(f"SELECT CASE WHEN TRIM(COALESCE(defect_intensity,''))='' THEN 'WITHOUT INTENSITY' ELSE defect_intensity END, COUNT(DISTINCT {HEAT_KEY_SQL}), COALESCE(SUM(output_weight),0) FROM disposition {where_sql} GROUP BY 1", params)
    for r in cur.fetchall(): intensity_map[str(r[0])] = (int(r[1] or 0), float(r[2] or 0))
    intensity_table = []
    for level in ["LIGHT", "MEDIUM", "DEEP", "WITHOUT INTENSITY"]:
        cnt, qty = intensity_map.get(level, (0,0.0))
        intensity_table.append({"intensity": level, "coils": cnt, "qty": qty})

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
            "coils": total_coils,
            "pct_coils": 1.0 if total_coils else 0.0,
            "qty": output_qty,
            "pct_qty": 1.0 if output_qty else 0.0,
        },
        "top_defects": top_defects,
        "top_defects_total": {
            "defect": "Grand Total",
            "qty": total_defect_qty,
            "pct": 1.0 if total_defect_qty else 0.0,
            "cum_pct": 1.0 if total_defect_qty else 0.0,
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
            prev_values = [None] * 12
            result["period"]["previous"] = None

        for i, k in enumerate(kpis):
            meta = KPI_META_BY_LABEL[k["label"]]
            prev_v = prev_values[i]
            cur_v = k["value"]
            threshold_color = kpi_threshold_color(k["label"], cur_v)
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

    cur.execute(f"SELECT COUNT(DISTINCT {HEAT_KEY_SQL}), COALESCE(SUM(output_weight),0) FROM disposition {w2}", p2)
    coils, qty = cur.fetchone()

    dw = w2 + " AND main_defect <> '' AND main_defect <> 'NO DEFECT'"
    cur.execute(f"SELECT COUNT(DISTINCT {HEAT_KEY_SQL}) FROM disposition {dw}", p2)
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



def _overall_metrics_total(cur, where_sql, params, name="Grand Total"):
    """Calculate a true grand total directly from the filtered source rows.
    This intentionally does not sum displayed groups, because grouped tables
    may omit blank dimension values; direct aggregation keeps totals tied to
    the exact filter scope."""
    cur.execute(f"SELECT COUNT(DISTINCT {HEAT_KEY_SQL}), COALESCE(SUM(output_weight),0) FROM disposition {where_sql}", params)
    coils, qty = cur.fetchone()

    dw = where_sql + (" AND " if where_sql else "WHERE ") + "main_defect <> '' AND main_defect <> 'NO DEFECT'"
    cur.execute(f"SELECT COUNT(DISTINCT {HEAT_KEY_SQL}) FROM disposition {dw}", params)
    defect_coils = cur.fetchone()[0]

    rw = where_sql + (" AND " if where_sql else "WHERE ") + "quality_decision = ?"
    cur.execute(f"SELECT COALESCE(SUM(output_weight),0) FROM disposition {rw}", params + ["REJECT"])
    reject_qty = cur.fetchone()[0] or 0.0

    pw = where_sql + (" AND " if where_sql else "WHERE ") + "quality_decision = ?"
    cur.execute(f"SELECT COALESCE(SUM(output_weight),0) FROM disposition {pw}", params + ["PRIME"])
    prime_qty = cur.fetchone()[0] or 0.0

    return {
        "name": name,
        "coils": coils,
        "output_qty": qty or 0.0,
        "defect_coils": defect_coils,
        "defect_pct": (defect_coils / coils) if coils else 0.0,
        "reject_qty": reject_qty,
        "reject_pct_qty": (reject_qty / qty) if qty else 0.0,
        "first_pass_yield_pct": (prime_qty / qty) if qty else 0.0,
        "prime_qty": prime_qty,
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

    total_wc = _overall_metrics_total(cur, wc_where, wc_params)
    total_gr = _overall_metrics_total(cur, gr_where, gr_params)
    conn.close()
    return {
        "by_work_center": wc_rows, "by_grade": gr_rows,
        "total_work_center": total_wc,
        "total_grade": total_gr,
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
    cur.execute(f"SELECT COUNT(DISTINCT {HEAT_KEY_SQL}), COALESCE(SUM(output_weight),0) FROM disposition {dw}", params)
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
        cur.execute(f"SELECT COUNT(DISTINCT {HEAT_KEY_SQL}), COALESCE(SUM(output_weight),0) FROM disposition {w2}",
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
    other filters). The table Grand Total is calculated directly from the
    filtered source population: coils are DISTINCT HEAT NOs, while quantity
    measures are summed from source rows. This prevents the Grand Total from
    double-counting a heat that appears in more than one monthly group."""
    conn = get_conn()
    cur = conn.cursor()
    where_sql, params = build_where(filters, exclude={"month"})

    cur.execute("SELECT DISTINCT month FROM disposition WHERE month <> ''")
    months = sorted([r[0] for r in cur.fetchall()], key=_month_sort_key)

    rows = [_group_metrics(cur, where_sql, params, "month", m) for m in months]

    # IMPORTANT: do not sum monthly coil counts. A HEAT NO can occur in more
    # than one month; the WebApp definition of a coil is one unique HEAT NO.
    # Calculate the Grand Total from the exact filtered source population.
    total = _overall_metrics_total(cur, where_sql, params, name="Grand Total")

    conn.close()
    return {"rows": rows, "total": total}


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
    total = _overall_metrics_total(cur, where_sql, params)
    conn.close()
    return {"rows": rows, "total": total}


def compute_quarterly_trend(filters):
    """Trend across quarters (ignores the Quarter filter itself)."""
    conn = get_conn()
    cur = conn.cursor()
    where_sql, params = build_where(filters, exclude={"quarter"})

    cur.execute("SELECT DISTINCT quarter FROM disposition WHERE quarter <> '' ORDER BY 1")
    quarters = [r[0] for r in cur.fetchall()]
    rows = [_group_metrics(cur, where_sql, params, "quarter", q) for q in quarters]
    total = _overall_metrics_total(cur, where_sql, params)
    conn.close()
    return {"rows": rows, "total": total}


def compute_yearly_trend(filters):
    """Trend across financial years (ignores the Financial Year filter itself)."""
    conn = get_conn()
    cur = conn.cursor()
    where_sql, params = build_where(filters, exclude={"financial_year"})

    cur.execute("SELECT DISTINCT financial_year FROM disposition WHERE financial_year <> '' ORDER BY 1")
    fys = [r[0] for r in cur.fetchall()]
    rows = [_group_metrics(cur, where_sql, params, "financial_year", fy) for fy in fys]
    total = _overall_metrics_total(cur, where_sql, params)
    conn.close()
    return {"rows": rows, "total": total}



# ---------------------------------------------------------------------------
# Admin authentication / data-management layer
# ---------------------------------------------------------------------------
# V27.1: production credentials must come from environment variables.
# Empty values are allowed for local/dev only when an existing users-table
# account is already present. There is intentionally NO hard-coded password.
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "").strip()
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")
SESSION_TTL = 8 * 60 * 60
SESSIONS = {}
IMPORT_PREVIEWS = {}
IMPORT_PREVIEW_TTL = 30 * 60
VIEWER_SESSION_TTL = 12 * 60 * 60
LOGIN_WINDOW = 15 * 60
LOGIN_MAX_ATTEMPTS = 5
LOGIN_ATTEMPTS = {}
CSRF_COOKIE = "qdash_csrf"

# Security note: ADMIN_PASSWORD is optional only when an existing database user
# record is present. The insecure hard-coded bootstrap password is intentionally
# not accepted anymore. For new deployments set ADMIN_USERNAME + ADMIN_PASSWORD.


def _hash_password(password, salt=None):
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 180000)
    return salt.hex() + ":" + digest.hex()

def _strong_password(password):
    password = str(password or "")
    return (len(password) >= 12 and any(c.isupper() for c in password) and any(c.islower() for c in password) and any(c.isdigit() for c in password) and any(not c.isalnum() for c in password))

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

def _login_allowed(ip):
    now = time.time()
    rec = LOGIN_ATTEMPTS.get(ip, {"count": 0, "window": now})
    if now - rec.get("window", now) >= LOGIN_WINDOW:
        rec = {"count": 0, "window": now}
    if rec.get("count", 0) >= LOGIN_MAX_ATTEMPTS:
        LOGIN_ATTEMPTS[ip] = rec
        return False, int(max(1, LOGIN_WINDOW - (now - rec.get("window", now))))
    LOGIN_ATTEMPTS[ip] = rec
    return True, 0

def _record_login_failure(ip):
    now = time.time()
    rec = LOGIN_ATTEMPTS.get(ip, {"count": 0, "window": now})
    if now - rec.get("window", now) >= LOGIN_WINDOW:
        rec = {"count": 0, "window": now}
    rec["count"] = rec.get("count", 0) + 1
    LOGIN_ATTEMPTS[ip] = rec

def _clear_login_failures(ip):
    LOGIN_ATTEMPTS.pop(ip, None)

def _csrf_value(handler):
    return _cookie_value(handler.headers.get("Cookie", ""), CSRF_COOKIE)

def _admin_post_allowed(handler):
    if not _is_admin(handler):
        _auth_error(handler)
        return False
    expected = _csrf_value(handler)
    supplied = handler.headers.get("X-CSRF-Token", "")
    if not expected or not supplied or not hmac.compare_digest(expected, supplied):
        _auth_error(handler, "Security token missing or expired. Please sign in again.")
        return False
    return True


def _cookie_value(cookie_header, name):
    if not cookie_header:
        return ""
    for part in cookie_header.split(";"):
        part = part.strip()
        if part.startswith(name + "="):
            return part.split("=", 1)[1]
    return ""


def _admin_meta(handler):
    _cleanup_sessions()
    token = _cookie_value(handler.headers.get("Cookie", ""), "qdash_admin")
    meta = SESSIONS.get(token)
    if not meta:
        return None
    now = _dt.datetime.now().timestamp()
    if meta.get("expires", 0) < now:
        SESSIONS.pop(token, None)
        return None
    meta["expires"] = now + SESSION_TTL
    if meta.get("role") not in ("admin", "qa_manager", "qa_engineer", "importer", "auditor") or not bool(meta.get("active", True)):
        return None
    return meta

def _is_admin(handler):
    return _admin_meta(handler) is not None

def _audit(handler, action, record_id=None, details=None):
    """Immutable-style sensitive-action audit record with user, time, IP and optional record."""
    try:
        meta=_admin_meta(handler) or {}
        conn=get_conn()
        conn.execute("INSERT INTO audit_trail (user_id,username,role,action,record_id,details,ip_address,user_agent) VALUES (?,?,?,?,?,?,?,?)",
                     (meta.get("user_id"),meta.get("username","Anonymous"),meta.get("role",""),str(action),record_id,json.dumps(details or {},ensure_ascii=False),_client_ip(handler),handler.headers.get("User-Agent","")[:500]))
        conn.commit(); conn.close()
    except Exception:
        pass

def _role(handler):
    meta = _admin_meta(handler)
    return meta.get("role", "") if meta else ""

def _can(handler, *roles):
    return _role(handler) in roles

def _require_role(handler, *roles):
    if not _is_admin(handler):
        _auth_error(handler); return False
    if roles and _role(handler) not in roles:
        _auth_error(handler, "You do not have permission for this action.", status=403); return False
    return True


def _viewer_meta(handler):
    _cleanup_sessions()
    token = _cookie_value(handler.headers.get("Cookie", ""), "qdash_user")
    meta = SESSIONS.get(token)
    if not meta or meta.get("role") not in ("viewer", "admin", "qa_manager", "qa_engineer", "importer", "auditor"):
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

def _activity_event(handler, event_type, tab="", filters=None, visitor_id=""):
    # Activity is anonymous. visitor_id is a browser-generated random identifier
    # used only to count currently active dashboard users without requiring login.
    try:
        conn = get_conn()
        meta = _viewer_meta(handler)
        user_id = meta.get("user_id") if meta else None
        conn.execute("INSERT INTO activity_log (user_id,event_type,tab,filters_json,user_agent,ip_address,visitor_id) VALUES (?,?,?,?,?,?,?)",
                     (user_id, event_type, tab or "", json.dumps(filters or {}, separators=(",",":")),
                      (handler.headers.get("User-Agent", "")[:300]), _client_ip(handler), str(visitor_id or "")[:100]))
        conn.commit(); conn.close()
    except Exception:
        pass

def _viewer_auth_error(handler):
    # Retained for compatibility with older clients; current dashboard does not use it.
    handler._send_json({"error":"Viewer authentication is disabled","authenticated":True}, status=200)

def _json_body(handler):
    length = int(handler.headers.get("Content-Length", "0") or 0)
    raw = handler.rfile.read(length)
    return json.loads(raw.decode("utf-8")) if raw else {}


def _auth_error(handler, message="Admin login required", status=401):
    handler._send_json({"error": message, "authenticated": False}, status=status)


def _norm_header(v):
    return " ".join(str(v or "").strip().lower().replace("_", " ").split())


HEADER_ALIASES = {
    "heat_no": ["heat no", "heat number", "heat"],
    "batch_no": ["batch no", "batch number", "batch", "lot no", "lot number"],
    "work_center": ["work center", "workcentre", "work center name"],
    "grade": ["grade"],
    "output_weight": ["output weight", "output weight (mt)", "output qty", "quantity", "qty"],
    "main_defect": ["main defect", "defect", "main defect type"],
    "defect_intensity": ["defect intensity", "intensity", "defect intensity tag"],
    "quality_decision": ["quality decision", "decision"],
    "insp_lot_date": ["insp lot date", "inspection lot date", "date", "inspection date"],
    "ud_date": ["ud date", "ud_date", "update date", "decision date", "ud date/time", "ud date time"],
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
    ud_date = _parse_date(get("ud_date"))
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
        "batch_no": str(get("batch_no") or "").strip(),
        "work_center": str(get("work_center") or "").strip(),
        "grade": str(get("grade") or "").strip(),
        "output_weight": weight,
        "main_defect": str(get("main_defect") or "").strip(),
        "defect_intensity": str(get("defect_intensity") or "").strip().upper(),
        "quality_decision": str(get("quality_decision") or "").strip().upper(),
        "insp_lot_date": insp_date.isoformat() if insp_date else "",
        "ud_date": ud_date.isoformat() if ud_date else "",
        "month": month,
        "week": week,
        "quarter": quarter,
        "financial_year": fy,
    }


def _validate_record(r):
    if not r["heat_no"]:
        return "HEAT NO is required"
    if not r.get("batch_no"):
        return "BATCH NO is required"
    if not r["quality_decision"]:
        return "QUALITY DECISION is required"
    if r["output_weight"] < 0:
        return "Output Weight cannot be negative"
    if r["quality_decision"] not in DECISION_ORDER:
        return "Unknown QUALITY DECISION: " + r["quality_decision"]
    return ""


def _record_signature(r):
    keys = ["heat_no", "batch_no", "work_center", "grade", "output_weight", "main_defect", "defect_intensity",
            "quality_decision", "insp_lot_date", "ud_date", "month", "week", "quarter", "financial_year"]
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
    conn = get_conn(); cur = conn.cursor()
    existing = {}
    cur.execute("SELECT id,heat_no,batch_no,work_center,grade,output_weight,main_defect,defect_intensity,quality_decision,insp_lot_date,ud_date,month,week,quarter,financial_year FROM disposition")
    cols=["id","heat_no","batch_no","work_center","grade","output_weight","main_defect","defect_intensity","quality_decision","insp_lot_date","ud_date","month","week","quarter","financial_year"]
    for row in cur.fetchall():
        d=dict(zip(cols,row)); existing[(str(d.get("heat_no") or "").strip().upper(),str(d.get("batch_no") or "").strip().upper())]=d
    inserted=0; updated=0; duplicates=0; errors=[]; seen=set(); good=[]; updates=[]
    fields=["work_center","grade","output_weight","main_defect","defect_intensity","quality_decision","insp_lot_date","ud_date","month","week","quarter","financial_year"]
    for idx,r in enumerate(records,start=2):
        err=_validate_record(r); pair=(str(r.get("heat_no","")).strip().upper(),str(r.get("batch_no","")).strip().upper())
        if err: errors.append({"row":idx,"error":err}); continue
        if pair in seen: duplicates+=1; continue
        seen.add(pair); old=existing.get(pair)
        if old:
            changed=any(str(old.get(k) if old.get(k) is not None else "") != str(r.get(k) if r.get(k) is not None else "") for k in fields)
            if changed: updates.append((r,old["id"])); updated+=1
            else: duplicates+=1
        else: good.append(r)
    if good:
        cur.executemany("""INSERT INTO disposition (heat_no,batch_no,work_center,grade,output_weight,main_defect,defect_intensity,quality_decision,insp_lot_date,ud_date,month,week,quarter,financial_year) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", [tuple(r[k] for k in ["heat_no","batch_no"]+fields) for r in good]); inserted=len(good)
    for r,rid in updates:
        cur.execute("""UPDATE disposition SET work_center=?,grade=?,output_weight=?,main_defect=?,defect_intensity=?,quality_decision=?,insp_lot_date=?,ud_date=?,month=?,week=?,quarter=?,financial_year=? WHERE id=?""", tuple(r[k] for k in fields)+(rid,))
    conn.commit(); conn.close(); RESPONSE_CACHE.clear(); return {"inserted":inserted,"updated":updated,"duplicates":duplicates,"errors":errors}


def _norm_defect_key(s):
    """Normalize a defect name for matching: uppercase, letters/digits only.
    Used to match disposition.main_defect values (e.g. 'INTERWRAP SCRATCHES (R')
    against the 6M Fishbone master defect list (e.g. 'Interwrap Scratch (Rolled)'),
    since the two lists don't use identical spelling/abbreviations."""
    return re.sub(r"[^A-Z0-9]+", "", str(s or "").upper())


def _parse_fishbone_file(filename, data):
    """Parse an uploaded 6M Fishbone Defect Master workbook (.xlsx/.xlsm).
    Expected columns (any order, case-insensitive, matched by keyword):
    Defect List, Man Causes, Machine Causes, Material Causes, Method Causes,
    Measurement Causes, Environment Causes. Uses the 'Master_Data' sheet
    when present, otherwise the first sheet."""
    ext = os.path.splitext(filename.lower())[1]
    if ext not in (".xlsx", ".xlsm"):
        raise ValueError("6M Fishbone master must be uploaded as an .xlsx or .xlsm file")
    try:
        import openpyxl
    except ImportError:
        raise ValueError("Excel import requires openpyxl.")
    wb = openpyxl.load_workbook(io.BytesIO(data), data_only=True, read_only=True)
    ws = wb["Master_Data"] if "Master_Data" in wb.sheetnames else wb[wb.sheetnames[0]]
    iterator = ws.iter_rows(values_only=True)
    try:
        headers = list(next(iterator))
    except StopIteration:
        raise ValueError("The uploaded 6M master file is empty")
    col_map = {}
    keyword_map = {
        "defect": "defect_name", "man": "man", "machine": "machine",
        "material": "material", "method": "method", "measurement": "measurement",
        "environment": "environment",
    }
    for idx, h in enumerate(headers):
        key = str(h or "").strip().lower()
        for kw, field in keyword_map.items():
            if kw in key:
                col_map[field] = idx
                break
    if "defect_name" not in col_map:
        raise ValueError("Could not find a 'Defect List' column in the uploaded file")
    records = []
    for values in iterator:
        if not any(v not in (None, "") for v in values):
            continue
        name = str(values[col_map["defect_name"]] or "").strip() if col_map["defect_name"] < len(values) else ""
        if not name:
            continue
        rec = {"defect_name": name}
        for field in FISHBONE_CAUSE_FIELDS:
            i = col_map.get(field)
            rec[field] = str(values[i]).strip() if (i is not None and i < len(values) and values[i] is not None) else ""
        records.append(rec)
    wb.close()
    return records


def _replace_fishbone_master(records, filename, imported_by):
    """Replace the entire 6M Fishbone master table with a freshly-uploaded
    set of records. This is a full reference-list refresh (not a merge),
    matching the requirement that re-uploading the 6M master Excel should
    fully refresh what the QCR dashboard shows — no separate 'sync' step
    needed once the admin confirms the import."""
    if not records:
        raise ValueError("No defect rows were found in the uploaded file")
    conn = get_conn()
    seen = set()
    rows = []
    for r in records:
        norm = _norm_defect_key(r["defect_name"])
        if not norm or norm in seen:
            continue
        seen.add(norm)
        rows.append((r["defect_name"], norm) + tuple(r.get(f, "") for f in FISHBONE_CAUSE_FIELDS))
    conn.execute("DELETE FROM fishbone_master")
    conn.executemany(
        "INSERT INTO fishbone_master (defect_name,norm_name,man,machine,material,method,measurement,environment) VALUES (?,?,?,?,?,?,?,?)",
        rows,
    )
    conn.execute(
        "INSERT INTO fishbone_import_history (filename,detected,imported,imported_by) VALUES (?,?,?,?)",
        (filename, len(records), len(rows), imported_by),
    )
    conn.commit()
    conn.close()
    FISHBONE_CACHE["rows"] = None
    FISHBONE_CACHE["aliases"] = None
    return {"detected": len(records), "imported": len(rows)}


def _fishbone_master_rows(force=False):
    if FISHBONE_CACHE["rows"] is None or force:
        conn = get_conn()
        rows = conn.execute(
            "SELECT defect_name,norm_name,man,machine,material,method,measurement,environment,updated_at FROM fishbone_master"
        ).fetchall()
        conn.close()
        FISHBONE_CACHE["rows"] = [dict(r) for r in rows]
        FISHBONE_CACHE["loaded_at"] = time.time()
    return FISHBONE_CACHE["rows"]


def _fishbone_aliases(force=False):
    if FISHBONE_CACHE["aliases"] is None or force:
        conn = get_conn()
        rows = conn.execute("SELECT norm_disposition_defect,master_defect FROM fishbone_alias").fetchall()
        conn.close()
        FISHBONE_CACHE["aliases"] = {r[0]: r[1] for r in rows}
    return FISHBONE_CACHE["aliases"]


def _split_causes(text):
    """Split a single 6M master cell into a list of individual causes.
    A defect can have more than one reason under the same M — in the
    source Excel these are entered as separate lines inside the same
    cell (Alt+Enter) or separated by ';'. Falls back to a single-item
    list so a plain one-line cell still renders as a (one-item) list,
    exactly as it was entered in the sheet."""
    if not text:
        return []
    raw = str(text).replace("\r\n", "\n").replace("\r", "\n")
    parts = raw.split("\n") if "\n" in raw else raw.split(";")
    out = []
    for p in parts:
        p = p.strip()
        p = re.sub(r"^[\-\*\u2022]+\s*", "", p)
        p = re.sub(r"^\(?\d+[\.\)]\s*", "", p)
        if p:
            out.append(p)
    return out


def _fishbone_match(defect_name):
    """Match a disposition main_defect value to a 6M Fishbone master row.
    Order of precedence: manual admin alias -> exact normalized match ->
    high-confidence fuzzy match -> no match."""
    master = _fishbone_master_rows()
    if not master:
        return {"defect": defect_name, "matched": False, "match_type": "no_master", "matched_defect": None, "confidence": 0, "causes": None}
    by_norm = {r["norm_name"]: r for r in master}
    norm = _norm_defect_key(defect_name)
    aliases = _fishbone_aliases()
    if norm in aliases:
        target_norm = _norm_defect_key(aliases[norm])
        row = by_norm.get(target_norm)
        if row:
            return {"defect": defect_name, "matched": True, "match_type": "alias", "matched_defect": row["defect_name"], "confidence": 1.0, "causes": {f: _split_causes(row.get(f, "")) for f in FISHBONE_CAUSE_FIELDS}}
    if norm in by_norm:
        row = by_norm[norm]
        return {"defect": defect_name, "matched": True, "match_type": "exact", "matched_defect": row["defect_name"], "confidence": 1.0, "causes": {f: _split_causes(row.get(f, "")) for f in FISHBONE_CAUSE_FIELDS}}
    close = difflib.get_close_matches(norm, list(by_norm.keys()), n=1, cutoff=FISHBONE_FUZZY_CUTOFF)
    if close:
        row = by_norm[close[0]]
        score = difflib.SequenceMatcher(None, norm, close[0]).ratio()
        return {"defect": defect_name, "matched": True, "match_type": "fuzzy", "matched_defect": row["defect_name"], "confidence": round(score, 2), "causes": {f: _split_causes(row.get(f, "")) for f in FISHBONE_CAUSE_FIELDS}}
    return {"defect": defect_name, "matched": False, "match_type": "none", "matched_defect": None, "confidence": 0, "causes": None}


def _ensure_admin_schema():
    conn = get_conn()
    if USE_POSTGRES:
        conn.execute("""CREATE TABLE IF NOT EXISTS disposition (
            id BIGSERIAL PRIMARY KEY, heat_no TEXT, batch_no TEXT DEFAULT '', work_center TEXT, grade TEXT,
            output_weight DOUBLE PRECISION, main_defect TEXT, defect_intensity TEXT,
            quality_decision TEXT, insp_lot_date TEXT DEFAULT '', month TEXT, week TEXT,
            quarter TEXT, financial_year TEXT, ud_date TEXT DEFAULT ''
        )""")
    else:
        cols = {r[1] for r in conn.execute("PRAGMA table_info(disposition)").fetchall()}
        if "insp_lot_date" not in cols:
            conn.execute("ALTER TABLE disposition ADD COLUMN insp_lot_date TEXT DEFAULT ''")
        if "batch_no" not in cols:
            conn.execute("ALTER TABLE disposition ADD COLUMN batch_no TEXT DEFAULT ''")
        if "ud_date" not in cols:
            conn.execute("ALTER TABLE disposition ADD COLUMN ud_date TEXT DEFAULT ''")
    if USE_POSTGRES:
        conn.execute("ALTER TABLE disposition ADD COLUMN IF NOT EXISTS batch_no TEXT DEFAULT ''")
        conn.execute("ALTER TABLE disposition ADD COLUMN IF NOT EXISTS ud_date TEXT DEFAULT ''")
        conn.execute("""CREATE TABLE IF NOT EXISTS users (
            id BIGSERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL,
            password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'viewer', active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS activity_log (
            id BIGSERIAL PRIMARY KEY, user_id BIGINT, event_type TEXT NOT NULL, tab TEXT DEFAULT '',
            filters_json TEXT DEFAULT '{}', user_agent TEXT DEFAULT '', ip_address TEXT DEFAULT '', visitor_id TEXT DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""")
    else:
        conn.execute("""CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL,
            password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'viewer', active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS activity_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, event_type TEXT NOT NULL, tab TEXT DEFAULT '',
            filters_json TEXT DEFAULT '{}', user_agent TEXT DEFAULT '', ip_address TEXT DEFAULT '', visitor_id TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""")
    if USE_POSTGRES:
        conn.execute("""CREATE TABLE IF NOT EXISTS audit_trail (
            id BIGSERIAL PRIMARY KEY, user_id BIGINT, username TEXT, role TEXT, action TEXT NOT NULL,
            record_id BIGINT, details TEXT DEFAULT '{}', ip_address TEXT DEFAULT '', user_agent TEXT DEFAULT '',
            created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""")
    else:
        conn.execute("""CREATE TABLE IF NOT EXISTS audit_trail (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, username TEXT, role TEXT, action TEXT NOT NULL,
            record_id INTEGER, details TEXT DEFAULT '{}', ip_address TEXT DEFAULT '', user_agent TEXT DEFAULT '',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""")
    if USE_POSTGRES:
        conn.execute("ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS visitor_id TEXT DEFAULT ''")
    else:
        cols_al={r[1] for r in conn.execute("PRAGMA table_info(activity_log)").fetchall()}
        if "visitor_id" not in cols_al:
            conn.execute("ALTER TABLE activity_log ADD COLUMN visitor_id TEXT DEFAULT ''")
    if USE_POSTGRES:
        conn.execute("ALTER TABLE import_history ADD COLUMN IF NOT EXISTS updated INTEGER DEFAULT 0")
    else:
        cols_ih={r[1] for r in conn.execute("PRAGMA table_info(import_history)").fetchall()}
        if "updated" not in cols_ih:
            conn.execute("ALTER TABLE import_history ADD COLUMN updated INTEGER DEFAULT 0")
    if USE_POSTGRES:
        conn.execute("""CREATE TABLE IF NOT EXISTS kpi_targets (
            id BIGSERIAL PRIMARY KEY, label TEXT UNIQUE NOT NULL, target DOUBLE PRECISION, warning DOUBLE PRECISION, critical DOUBLE PRECISION, direction TEXT NOT NULL DEFAULT 'higher', updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""")
    else:
        conn.execute("""CREATE TABLE IF NOT EXISTS kpi_targets (
            id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT UNIQUE NOT NULL, target REAL, warning REAL, critical REAL, direction TEXT NOT NULL DEFAULT 'higher', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""")
    if USE_POSTGRES:
        conn.execute("""CREATE TABLE IF NOT EXISTS kpi_target_history (
            id BIGSERIAL PRIMARY KEY, label TEXT NOT NULL, old_target DOUBLE PRECISION, new_target DOUBLE PRECISION,
            old_warning DOUBLE PRECISION, new_warning DOUBLE PRECISION, old_critical DOUBLE PRECISION, new_critical DOUBLE PRECISION,
            old_direction TEXT, new_direction TEXT, effective_date TEXT DEFAULT '', changed_by TEXT DEFAULT '', changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS import_history (
            id BIGSERIAL PRIMARY KEY, filename TEXT, detected INTEGER DEFAULT 0, valid INTEGER DEFAULT 0, duplicates INTEGER DEFAULT 0, errors INTEGER DEFAULT 0, updated INTEGER DEFAULT 0,
            imported INTEGER DEFAULT 0, imported_by TEXT DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""")
    else:
        conn.execute("""CREATE TABLE IF NOT EXISTS kpi_target_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, old_target REAL, new_target REAL, old_warning REAL, new_warning REAL, old_critical REAL, new_critical REAL,
            old_direction TEXT, new_direction TEXT, effective_date TEXT DEFAULT '', changed_by TEXT DEFAULT '', changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS import_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT, detected INTEGER DEFAULT 0, valid INTEGER DEFAULT 0, duplicates INTEGER DEFAULT 0, errors INTEGER DEFAULT 0, updated INTEGER DEFAULT 0,
            imported INTEGER DEFAULT 0, imported_by TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""")
    # 6M Fishbone (Man/Machine/Material/Method/Measurement/Environment)
    # master reference data — imported by an admin from the 6M Defect
    # Master workbook, independent of the monthly disposition data import.
    if USE_POSTGRES:
        conn.execute("""CREATE TABLE IF NOT EXISTS fishbone_master (
            id BIGSERIAL PRIMARY KEY, defect_name TEXT NOT NULL, norm_name TEXT NOT NULL UNIQUE,
            man TEXT DEFAULT '', machine TEXT DEFAULT '', material TEXT DEFAULT '',
            method TEXT DEFAULT '', measurement TEXT DEFAULT '', environment TEXT DEFAULT '',
            updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS fishbone_alias (
            id BIGSERIAL PRIMARY KEY, disposition_defect TEXT NOT NULL, norm_disposition_defect TEXT NOT NULL UNIQUE,
            master_defect TEXT NOT NULL, created_by TEXT DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS fishbone_import_history (
            id BIGSERIAL PRIMARY KEY, filename TEXT, detected INTEGER DEFAULT 0, imported INTEGER DEFAULT 0,
            imported_by TEXT DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""")
    else:
        conn.execute("""CREATE TABLE IF NOT EXISTS fishbone_master (
            id INTEGER PRIMARY KEY AUTOINCREMENT, defect_name TEXT NOT NULL, norm_name TEXT NOT NULL UNIQUE,
            man TEXT DEFAULT '', machine TEXT DEFAULT '', material TEXT DEFAULT '',
            method TEXT DEFAULT '', measurement TEXT DEFAULT '', environment TEXT DEFAULT '',
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS fishbone_alias (
            id INTEGER PRIMARY KEY AUTOINCREMENT, disposition_defect TEXT NOT NULL, norm_disposition_defect TEXT NOT NULL UNIQUE,
            master_defect TEXT NOT NULL, created_by TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS fishbone_import_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT, detected INTEGER DEFAULT 0, imported INTEGER DEFAULT 0,
            imported_by TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""")

    # Remove the legacy KPI target name so the public/admin target APIs are
    # fully consistent with the renamed First Pass Yield % (Prime%) KPI. This is idempotent and
    # also cleans existing deployed databases during startup.
    try:
        conn.execute("DELETE FROM kpi_targets WHERE label IN (?, ?)", ("First Pass Yield %", "Prime %"))
    except Exception:
        pass
    for label,cfg in DEFAULT_KPI_TARGETS.items():
        try:
            conn.execute("INSERT INTO kpi_targets (label,target,warning,critical,direction) VALUES (?,?,?,?,?)",(label,cfg["target"],cfg["warning"],cfg["critical"],cfg["direction"]))
        except Exception:
            pass
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

    # V27.1: NEVER delete or reset the users table during startup.
    # If deployment credentials are explicitly supplied, provision the named
    # administrator only when that username does not already exist. Existing
    # users, passwords, roles and viewer accounts remain untouched.
    if ADMIN_USERNAME and ADMIN_PASSWORD:
        try:
            existing = conn.execute("SELECT id FROM users WHERE username=?", (ADMIN_USERNAME,)).fetchone()
            if not existing:
                conn.execute(
                    "INSERT INTO users (username,display_name,password_hash,role,active) VALUES (?,?,?,?,?)",
                    (ADMIN_USERNAME, "Administrator", _hash_password(ADMIN_PASSWORD), "admin", True)
                )
        except Exception:
            pass
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
        
        try:
            rows = src.execute("SELECT heat_no,batch_no,work_center,grade,output_weight,main_defect,defect_intensity,quality_decision,insp_lot_date,ud_date,month,week,quarter,financial_year FROM disposition").fetchall()
        except Exception:
            rows = src.execute("SELECT heat_no,work_center,grade,output_weight,main_defect,defect_intensity,quality_decision,month,week,quarter,financial_year FROM disposition").fetchall()
            rows = [dict(r, batch_no="", insp_lot_date="", ud_date="") for r in rows]
        src.close()
        if rows:
            conn.cursor().executemany("""INSERT INTO disposition
                (heat_no,batch_no,work_center,grade,output_weight,main_defect,defect_intensity,quality_decision,insp_lot_date,ud_date,month,week,quarter,financial_year)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", [tuple(r) for r in rows])
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

def _report_root_cause(filters, defect):
    if not defect: return []
    where_sql,params=build_where(filters); params=list(params)+[defect]
    conn=get_conn();
    rows=conn.execute(f"SELECT grade,work_center,heat_no,batch_no,output_weight FROM disposition {where_sql + (' AND ' if where_sql else 'WHERE ')}main_defect = ? ORDER BY output_weight DESC LIMIT 30",params).fetchall(); conn.close()
    return [dict(r) for r in rows]

def _export_data(filters):
    """Build a viewer-safe report payload from the same live filtered database used by the dashboard."""
    kpis = compute_kpis(filters)
    defects = compute_defect_analysis(filters)
    wcg = compute_work_center_grade(filters)
    monthly = compute_monthly_trend(filters)
    period = compute_period_trend(filters)
    quarterly = compute_quarterly_trend(filters)
    yearly = compute_yearly_trend(filters)
    intel = compute_qcr_intelligence(filters, monthly, defects, wcg, kpis)
    top_defect=(defects.get("register") or [{}])[0].get("defect","") if defects.get("register") else ""
    root_cause=_report_root_cause(filters,top_defect)
    target=float(get_kpi_targets().get("First Pass Yield % (Prime%)",{}).get("target") or 0.97)
    target_history=[{"period":r.get("name"),"target":target,"actual":float(r.get("first_pass_yield_pct") or 0),"attainment":(float(r.get("first_pass_yield_pct") or 0)/target if target else 0),"gap_pp":(float(r.get("first_pass_yield_pct") or 0)-target)*100} for r in monthly.get("rows",[])]
    return {"filters": filters, "kpis": kpis, "defects": defects, "wcg": wcg, "monthly": monthly, "period": period, "quarterly": quarterly, "yearly": yearly, "intel": intel, "root_cause": {"defect":top_defect,"rows":root_cause}, "target_history": {"target":target,"rows":target_history}}

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


def _export_display_value(value, fmt):
    """Format exported KPI values exactly like the web dashboard."""
    try: v=float(value or 0)
    except (TypeError, ValueError): return str(value if value is not None else "")
    if fmt == "pct": return f"{v*100:.3f}%"
    if fmt == "int": return f"{round(v):,}"
    if fmt == "num2": return f"{v:,.3f}"
    if fmt == "num3": return f"{v:.3f}"
    return str(value)

def _excel_number_format(fmt):
    return {"pct":"0.000%", "int":"#,##0", "num2":"#,##0.000", "num3":"0.000"}.get(fmt, "General")

def _chart_png(kind, title, labels, values, second=None, second_label=None, percent=False):
    """Create dashboard-style chart PNGs for Office/PDF exports. Returns bytes or None."""
    if plt is None:
        return None
    import numpy as np
    fig, ax = plt.subplots(figsize=(8.2, 3.65), dpi=150)
    fig.patch.set_facecolor("white"); ax.set_facecolor("white")
    navy="#0F2A4A"; blue="#118DFF"; red="#DC2626"; green="#16A34A"; orange="#D97706"; purple="#7C3AED"; grid="#DCE6EF"
    palette=["#118DFF","#16A34A","#D97706","#DC2626","#7C3AED","#DB2777","#0891B2","#CA8A04","#4F46E5","#059669","#EA580C","#BE185D"]
    labels=[str(x) for x in labels]
    vals=[float(x or 0) for x in values]
    if kind == "pie":
        nz=[(l,v) for l,v in zip(labels,vals) if v>0]
        if nz:
            labs,vs=zip(*nz)
            # Labels go in a side legend rather than on the wedges — on-slice category labels
            # overlap and become unreadable once a slice is small, same problem the legend-based
            # charts elsewhere in this file already avoid.
            wedges,_,_=ax.pie(vs, autopct=lambda p: f"{p:.1f}%" if p>=4 else "", startangle=90,
                   colors=[blue,green,orange,red,purple,"#64748B"][:len(vs)],
                   wedgeprops={"linewidth":1.2,"edgecolor":"white"}, pctdistance=0.72,
                   textprops={"fontsize":8,"color":"white","fontweight":"bold"})
            ax.legend(wedges, labs, loc="center left", bbox_to_anchor=(1.02,0.5), fontsize=8.5, frameon=False)
        ax.axis("equal")
    elif kind == "bar":
        x=np.arange(len(labels)); bar_colors=[palette[i%len(palette)] for i in range(len(labels))]
        ax.bar(x,vals,width=.62,color=bar_colors,edgecolor="none")
        ax.set_xticks(x); ax.set_xticklabels(labels,rotation=35 if len(labels)>6 else 0,ha="right" if len(labels)>6 else "center",fontsize=7.5)
        for i,v in enumerate(vals): ax.text(i,v + (max(vals)*.018 if max(vals) else .02), f"{v:.2f}" if percent else f"{v:,.2f}",ha="center",va="bottom",fontsize=7,fontweight="bold")
    elif kind == "line":
        x=np.arange(len(labels)); ax.plot(x,vals,marker="o",linewidth=2.4,markersize=4.5,color=blue,label="Value")
        if second is not None:
            ax.plot(x,[float(v or 0) for v in second],marker="o",linewidth=2.0,markersize=3.5,color=green,label=second_label or "Series 2")
            ax.legend(frameon=False,fontsize=7,loc="best")
        ax.set_xticks(x); ax.set_xticklabels(labels,rotation=35 if len(labels)>6 else 0,ha="right" if len(labels)>6 else "center",fontsize=7.5)
        for i,v in enumerate(vals): ax.text(i,v,f"{v:.2f}" if percent else f"{v:,.2f}",ha="center",va="bottom",fontsize=6.5,fontweight="bold")
    elif kind == "pareto":
        x=np.arange(len(labels)); ax.bar(x,vals,color=red,width=.62,label="Defect Qty")
        cum=[float(v or 0)*100 for v in (second or [])]
        ax2=ax.twinx(); ax2.plot(x,cum,color=purple,marker="o",linewidth=2.2,markersize=4,label="Cumulative %"); ax2.set_ylim(0,105); ax2.set_ylabel("Cumulative %",fontsize=8)
        ax2.axhline(80,color=orange,linestyle="--",linewidth=1.1)
        ax.set_xticks(x); ax.set_xticklabels(labels,rotation=38,ha="right",fontsize=7); ax.set_ylabel("Qty (MT)",fontsize=8)
    ax.set_title(title,loc="left",fontsize=13,fontweight="bold",color=navy,pad=10)
    ax.grid(axis="y",color=grid,linewidth=.7,alpha=.85); ax.set_axisbelow(True)
    for spine in ("top","right"): ax.spines[spine].set_visible(False)
    ax.spines["left"].set_color(grid); ax.spines["bottom"].set_color(grid)
    ax.tick_params(axis="y",labelsize=7.5)
    fig.tight_layout(pad=1.25)
    out=io.BytesIO(); fig.savefig(out,format="png",bbox_inches="tight",facecolor="white"); plt.close(fig); out.seek(0); return out.getvalue()

def _export_charts(payload):
    """Build the same set of dashboard charts shown in the webapp, as PNGs, for Excel/PDF/PPT exports.
    Reuses data already computed in the payload instead of re-querying the database — this is the
    main speed optimization for the export endpoints (previously issued an extra DB round trip)."""
    d=payload["defects"]; wc=payload["wcg"]["by_work_center"]; gr=payload["wcg"]["by_grade"]
    kp=payload.get("kpis",{}) or {}
    charts=[]
    decisions=[r for r in (kp.get("decision_table") or []) if r.get("qty")]
    if decisions:
        charts.append(("Decision Distribution",_chart_png("pie","Quality Decision Distribution",[r["decision"] for r in decisions],[r["qty"] for r in decisions])))
    if d.get("pareto"):
        charts.append(("Defect Pareto",_chart_png("pareto","Top Defect Pareto — Output Qty",[r["defect"] for r in d["pareto"]],[r["qty"] for r in d["pareto"]],[r["cum_pct"] for r in d["pareto"]])))
    it=[r for r in (kp.get("intensity_table") or []) if r.get("qty") or r.get("coils")]
    if it:
        charts.append(("Defect Intensity",_chart_png("bar","Defect Intensity — Output Qty (MT)",[r["intensity"] for r in it],[r["qty"] for r in it])))
    if wc:
        charts.append(("Work Center",_chart_png("bar","Output Quantity by Work Center",[r["name"] for r in wc],[r["output_qty"] for r in wc])))
    if gr:
        charts.append(("Grade",_chart_png("bar","Output Quantity by Grade",[r["name"] for r in gr],[r["output_qty"] for r in gr])))
    for title,key in [("Monthly Trend","monthly"),("Weekly Trend","period"),("Quarterly Trend","quarterly"),("Financial Year Trend","yearly")]:
        rows=payload[key]["rows"]
        if rows:
            charts.append((title,_chart_png("line",title,[r["name"] for r in rows],[r["output_qty"] for r in rows])))
    return [(n,b) for n,b in charts if b]

def _excel_report(payload):
    if Workbook is None:
        raise RuntimeError("Excel export requires openpyxl")
    wb=Workbook(); ws=wb.active; ws.title="Dashboard"
    navy="0F2A4A"; accent="118DFF"; white="FFFFFF"; light="EEF4FF"
    # Executive dashboard sheet: KPI cards + embedded charts, matching the web report structure.
    ws.merge_cells("A1:P2"); ws["A1"]="QUALITY INTELLIGENCE — Dashboard Export"; ws["A1"].font=Font(size=20,bold=True,color=white); ws["A1"].fill=PatternFill("solid",fgColor=navy); ws["A1"].alignment=Alignment(vertical="center")
    ws["A3"]="Generated"; ws["B3"]=datetime.now().strftime("%d-%b-%Y %H:%M:%S"); ws["D3"]="Filters"; ws["E3"]=", ".join(f"{k}: {v}" for k,v in _filter_summary(payload["filters"])) or "All"; ws.merge_cells("E3:P3")
    for c in range(1,17): ws.column_dimensions[chr(64+c) if c<=26 else "A"].width=13
    klist=payload["kpis"].get("kpis",[])
    for i,k in enumerate(klist[:16]):
        col=(i%4)*4+1; row=5+(i//4)*3
        ws.merge_cells(start_row=row,start_column=col,end_row=row,end_column=col+3)
        ws.merge_cells(start_row=row+1,start_column=col,end_row=row+1,end_column=col+3)
        ws.cell(row,col,k.get("label","")).font=Font(size=9,bold=True,color=navy); ws.cell(row,col).fill=PatternFill("solid",fgColor="EAF2FB"); ws.cell(row,col).alignment=Alignment(horizontal="center")
        value_cell=ws.cell(row+1,col,k.get("value",0))
        value_cell.font=Font(size=18,bold=True,color=navy); value_cell.alignment=Alignment(horizontal="center")
        value_cell.number_format=_excel_number_format(k.get("fmt",""))
    # Lay every chart out on a fixed 2-column grid so charts never overlap or get dropped,
    # regardless of how many are returned (previously a hard-coded 8-slot list).
    chart_top_row=18; row_span=21
    for i,(name,img) in enumerate(_export_charts(payload)):
        pos=("A" if i%2==0 else "I")+str(chart_top_row+(i//2)*row_span)
        try:
            xli=XLImage(io.BytesIO(img)); xli.width=560; xli.height=250; ws.add_image(xli,pos)
        except Exception: pass
    ws.freeze_panes="A5"
    ws.sheet_view.showGridLines=False

    ws=wb.create_sheet("KPI Summary")
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
    for i,r in enumerate(_kpi_rows(payload["kpis"]),6):
        ws.append(r)
        ws.cell(i,2).number_format=_excel_number_format(r[2])
        if isinstance(r[3], (int,float)): ws.cell(i,4).number_format=_excel_number_format(r[2])
        if isinstance(r[4], (int,float)): ws.cell(i,5).number_format="0.000%" if r[2]=="pct" else _excel_number_format(r[2])
    for c in ws["A5:E5"][0]: c.fill=PatternFill("solid",fgColor=accent)
    autofit(ws); ws.freeze_panes="A6"

    d=payload["defects"]; ws2=wb.create_sheet("Defect Analysis"); title(ws2,"Defect Analysis",1,5); header(ws2,3,["Rank","Defect","Records","Qty (MT)","% Records"])
    for r in d["register"]:
        ws2.append([r["rank"],r["defect"],r["records"],r["qty"],r["pct_records"]])
    ws2.append(["","Total",d["register_total"]["records"],d["register_total"]["qty"],d["register_total"]["pct_records"]])
    for rr in range(4, ws2.max_row+1):
        ws2.cell(rr,4).number_format="#,##0.000"
        ws2.cell(rr,5).number_format="0.000%"
    autofit(ws2)

    for sheet_name, rows, total in [("Work Center",payload["wcg"]["by_work_center"],payload["wcg"]["total_work_center"]),("Grade Analysis",payload["wcg"]["by_grade"],payload["wcg"]["total_grade"])]:
        w=wb.create_sheet(sheet_name); title(w,sheet_name,1,7); header(w,3,["Name","Coils","Output MT","Defect Coils","Defect %","Reject Qty MT","Reject % Qty"])
        for r in rows: w.append([r.get("name"),r.get("coils"),r.get("output_qty"),r.get("defect_coils"),r.get("defect_pct"),r.get("reject_qty"),r.get("reject_pct_qty")])
        if total: w.append(["Total",total.get("coils"),total.get("output_qty"),total.get("defect_coils"),total.get("defect_pct"),total.get("reject_qty"),total.get("reject_pct_qty")])
        for rr in range(4, w.max_row+1):
            w.cell(rr,3).number_format="#,##0.000"
            w.cell(rr,5).number_format="0.000%"
            w.cell(rr,6).number_format="#,##0.000"
            w.cell(rr,7).number_format="0.000%"
        autofit(w)

    for sheet_name, rows, total, labels in [("Monthly Trend",payload["monthly"]["rows"],payload["monthly"].get("total"),["Month","Coils","Output MT","Defect Coils","Defect %","Reject Qty MT","Reject % Qty","FPY %"]),("Weekly Trend",payload["period"]["rows"],payload["period"].get("total"),["Week","Coils","Output MT","Defect Coils","Defect %","Reject Qty MT","Reject % Qty","FPY %"]),("Quarterly Trend",payload["quarterly"]["rows"],payload["quarterly"].get("total"),["Quarter","Coils","Output MT","Defect Coils","Defect %","Reject Qty MT","Reject % Qty","FPY %"]),("Financial Year",payload["yearly"]["rows"],payload["yearly"].get("total"),["Financial Year","Coils","Output MT","Defect Coils","Defect %","Reject Qty MT","Reject % Qty","FPY %"])]:
        w=wb.create_sheet(sheet_name); title(w,sheet_name,1,len(labels)); header(w,3,labels)
        for r in rows:
            w.append([r.get("name"),r.get("coils"),r.get("output_qty"),r.get("defect_coils"),r.get("defect_pct"),r.get("reject_qty"),r.get("reject_pct_qty"),r.get("first_pass_yield_pct")])
        if total: w.append(["Total",total.get("coils"),total.get("output_qty"),total.get("defect_coils"),total.get("defect_pct"),total.get("reject_qty"),total.get("reject_pct_qty"),total.get("fpy")])
        for rr in range(4, w.max_row+1):
            w.cell(rr,3).number_format="#,##0.000"
            w.cell(rr,5).number_format="0.000%"
            w.cell(rr,6).number_format="#,##0.000"
            w.cell(rr,7).number_format="0.000%"
            w.cell(rr,8).number_format="0.000%"
        autofit(w)
    th=payload.get("target_history",{}); w=wb.create_sheet("Target vs Actual History"); title(w,"Target vs Actual History",1,5); header(w,3,["Period","Target","Actual","Attainment","Gap (pp)"])
    for r in th.get("rows",[]): w.append([r.get("period"),r.get("target"),r.get("actual"),r.get("attainment"),r.get("gap_pp")])
    for rr in range(4,w.max_row+1):
        for cc in (2,3,4): w.cell(rr,cc).number_format="0.00%"
        w.cell(rr,5).number_format="0.00"
    autofit(w)
    # Quality Control Room — consolidated export of every QCR section so the single header report truly covers the full webapp.
    intel=payload.get("intel",{})
    q=wb.create_sheet("Quality Control Room"); title(q,"Quality Control Room — Complete Export",1,8)
    header(q,3,["Section","Item","Detail","Action","Severity","Value","Grade","Work Center"])
    # Core QCR lists
    for k in payload.get("kpis",{}).get("kpis",[]):
        q.append(["Critical KPI",k.get("label",""),_export_display_value(k.get("value",0),k.get("fmt","")),"Review target/status","",k.get("value",0),"",""])
    for x in intel.get("kpi_ranking",[]) or []:
        q.append(["KPI Target Intelligence",x.get("label",x.get("kpi","")),x.get("status",x.get("detail","")),x.get("action","Review"),x.get("severity",x.get("status","")),x.get("value",x.get("actual","")),"",""])
    for x in intel.get("early_warnings",[]) or []:
        q.append(["Early Warning",x.get("title",""),x.get("detail",""),x.get("action",""),x.get("severity",""),x.get("value",""),"",""])
    for x in intel.get("recurring_patterns",[]) or []:
        q.append(["Recurring Quality Problem",x.get("defect",""),f'{x.get("period_count",0)} periods • {x.get("qty",0):.3f} MT',"Investigate",x.get("severity","high"),x.get("qty",0),x.get("grade",""),x.get("work_center","")])
    for x in intel.get("risk_matrix",{}).get("work_centers",[]) if isinstance(intel.get("risk_matrix"),dict) else []:
        q.append(["Work Center Risk",x.get("name",x.get("work_center","")),x.get("risk",""),x.get("action","Review"),x.get("severity",x.get("risk","")),x.get("score",x.get("reject_pct_qty","")),"",x.get("name",x.get("work_center",""))])
    for x in intel.get("risk_matrix",{}).get("grades",[]) if isinstance(intel.get("risk_matrix"),dict) else []:
        q.append(["Grade Risk",x.get("name",x.get("grade","")),x.get("risk",""),x.get("action","Review"),x.get("severity",x.get("risk","")),x.get("score",x.get("reject_pct_qty","")),x.get("name",x.get("grade","")),""])
    hs=intel.get("health_score",{}) or {}
    q.append(["Quality Health Score","Overall",hs.get("score",""),"Review reasons",hs.get("status",hs.get("level","")),hs.get("score",""),"",""])
    for r in hs.get("reasons",[]) or []:
        q.append(["Health Score Reason",r[0] if isinstance(r,(list,tuple)) and len(r)>0 else str(r),"Score deduction","Review","info",r[1] if isinstance(r,(list,tuple)) and len(r)>1 else "","",""])
    comp=intel.get("comparison",{}) or {}
    q.append(["Month vs Previous Month","Comparison",str(comp),"Review","","","",""])
    why=intel.get("why_changed",{}) or {}
    q.append(["Why Changed","Drivers",str(why),"Investigate","","","",""])
    opp=payload.get("monthly",{}).get("improvement_opportunities",[]) or []
    for x in opp:
        q.append(["Improvement Opportunity",x.get("title",x.get("issue","")),x.get("detail",x.get("evidence","")),x.get("action",x.get("recommended_action","Investigate")),x.get("severity",""),x.get("value",""),x.get("grade",""),x.get("work_center","")])
    rc=payload.get("root_cause",{}) or {}
    for x in rc.get("rows",[]) or []:
        q.append(["Pareto → Root Cause",rc.get("defect",""),f'Heat {x.get("heat_no","")} • Batch {x.get("batch_no","")} • {float(x.get("output_weight") or 0):.3f} MT',"Investigate", "",x.get("output_weight",""),x.get("grade",""),x.get("work_center","")])
    autofit(q)

    w=wb.create_sheet("Management Intelligence"); title(w,"Management Meeting Intelligence",1,6); header(w,3,["Section","Item","Detail","Action","Severity","Value"])
    for x in intel.get("early_warnings",[]): w.append(["Early Warning",x.get("title"),x.get("detail"),x.get("action"),x.get("severity"),""])
    for x in intel.get("recurring_patterns",[])[:20]: w.append(["Recurring Problem",f'{x.get("defect")} / {x.get("grade")} / {x.get("work_center")}',f'{x.get("period_count")} periods • {x.get("qty",0):.2f} MT',"Investigate","high",x.get("qty",0)])
    for x in intel.get("health_score",{}).get("reasons",[]): w.append(["Health Score",x[0],"Score deduction","Review","info",x[1]])
    autofit(w)

    # Consistent alignment pass across every sheet: first column left (labels/names),
    # every other column centered, all vertically centered — matches the web dashboard's
    # centered KPI/table styling instead of Excel's default left/general alignment.
    for sheet in wb.worksheets:
        for row in sheet.iter_rows():
            for c in row:
                if c.value is None: continue
                horiz = "center" if c.column > 1 or sheet.title == "Dashboard" else "left"
                wrap = sheet.title == "Quality Control Room" and c.column in (2,3,4)
                c.alignment=Alignment(horizontal=horiz, vertical="center", wrap_text=wrap)
        sheet.sheet_view.showGridLines=False
    bio=io.BytesIO(); wb.save(bio); return bio.getvalue()

def _pdf_report(payload):
    if SimpleDocTemplate is None:
        raise RuntimeError("PDF export requires reportlab")
    bio=io.BytesIO(); doc=SimpleDocTemplate(bio,pagesize=landscape(A4),rightMargin=22,leftMargin=22,topMargin=20,bottomMargin=20)
    styles=getSampleStyleSheet(); styles.add(ParagraphStyle(name="Small",parent=styles["BodyText"],fontSize=7.5,leading=9)); styles.add(ParagraphStyle(name="Title2",parent=styles["Title"],fontSize=20,textColor=colors.HexColor("#0F2A4A"),alignment=TA_LEFT))
    story=[Paragraph("QUALITY INTELLIGENCE",styles["Title2"]),Paragraph("Disposition & Defect Analytics — Dashboard Export",styles["Heading2"]),Paragraph("Generated: "+datetime.now().strftime("%d-%b-%Y %H:%M:%S"),styles["Small"]),Spacer(1,5)]
    fs=_filter_summary(payload["filters"]); story.append(Paragraph("Filters: "+("; ".join(f"{k}: {v}" for k,v in fs) if fs else "All"),styles["Small"])); story.append(Spacer(1,8))
    # KPI cards as a compact dashboard table.
    kl=payload["kpis"].get("kpis",[]); card_rows=[]
    for base in range(0,min(len(kl),16),4):
        card_rows.append([f'{k.get("label","")}\n{_export_display_value(k.get("value",0), k.get("fmt",""))}' for k in kl[base:base+4]])
    if card_rows:
        kt=Table(card_rows,colWidths=[185,185,185,185],rowHeights=[42]*len(card_rows)); kt.hAlign="CENTER"; kt.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),colors.HexColor("#EAF2FB")),("TEXTCOLOR",(0,0),(-1,-1),colors.HexColor("#0F2A4A")),("FONTNAME",(0,0),(-1,-1),"Helvetica-Bold"),("ALIGN",(0,0),(-1,-1),"CENTER"),("VALIGN",(0,0),(-1,-1),"MIDDLE"),("BOX",(0,0),(-1,-1),.5,colors.HexColor("#DCE6EF")),("INNERGRID",(0,0),(-1,-1),.5,colors.HexColor("#DCE6EF")),("FONTSIZE",(0,0),(-1,-1),8)])); story += [kt,Spacer(1,10)]
    charts=_export_charts(payload)
    # Two charts side-by-side per row in a centered table, so the layout reads like the
    # webapp's chart grid instead of one wide image with empty space beside it.
    if charts:
        story.append(Paragraph("Dashboard Charts",styles["Heading2"]))
        chart_rows=[]
        for i in range(0,len(charts),2):
            pair=charts[i:i+2]
            cells=[RLImage(io.BytesIO(img),width=375,height=167) for _,img in pair]
            if len(cells)<2: cells.append("")
            chart_rows.append(cells)
        cgrid=Table(chart_rows,colWidths=[389,389],hAlign="CENTER")
        cgrid.setStyle(TableStyle([("ALIGN",(0,0),(-1,-1),"CENTER"),("VALIGN",(0,0),(-1,-1),"MIDDLE"),("TOPPADDING",(0,0),(-1,-1),6),("BOTTOMPADDING",(0,0),(-1,-1),10)]))
        story += [cgrid]
    story.append(PageBreak())
    th=payload.get("target_history",{}); tr=[['Period','Target','Actual','Attainment','Gap pp']]+[[r.get('period'),f"{r.get('target',0)*100:.2f}%",f"{r.get('actual',0)*100:.2f}%",f"{r.get('attainment',0)*100:.1f}%",f"{r.get('gap_pp',0):+.2f}"] for r in th.get('rows',[])]
    tr_tbl=Table(tr,repeatRows=1,colWidths=[100,90,90,100,80],hAlign="CENTER",style=TableStyle([("BACKGROUND",(0,0),(-1,0),colors.HexColor("#118DFF")),("TEXTCOLOR",(0,0),(-1,0),colors.white),("FONTNAME",(0,0),(-1,0),"Helvetica-Bold"),("ALIGN",(0,0),(-1,-1),"CENTER"),("GRID",(0,0),(-1,-1),.3,colors.HexColor("#DCE6EF")),("FONTSIZE",(0,0),(-1,-1),8)]))
    story += [Paragraph("Target vs Actual History",styles["Heading2"]),tr_tbl,Spacer(1,10)]
    rc=payload.get("root_cause",{}); rcrows=rc.get("rows",[])
    if rcrows:
        rr=[["Defect","Grade","Work Center","Heat No","Batch No","Qty MT"]]+[[rc.get("defect",""),x.get("grade",""),x.get("work_center",""),x.get("heat_no",""),x.get("batch_no",""),f'{float(x.get("output_weight") or 0):.3f}'] for x in rcrows]
        rr_tbl=Table(rr,repeatRows=1,colWidths=[130,110,120,110,110,70],hAlign="CENTER",style=TableStyle([("BACKGROUND",(0,0),(-1,0),colors.HexColor("#118DFF")),("TEXTCOLOR",(0,0),(-1,0),colors.white),("FONTNAME",(0,0),(-1,0),"Helvetica-Bold"),("ALIGN",(0,0),(-1,-1),"CENTER"),("GRID",(0,0),(-1,-1),.3,colors.HexColor("#DCE6EF")),("FONTSIZE",(0,0),(-1,-1),7)]))
        story += [Paragraph("Root Cause Investigation — Top Defect",styles["Heading2"]),rr_tbl,Spacer(1,10)]
    intel=payload.get("intel",{}); opp=[]
    for x in intel.get("early_warnings",[]): opp.append([x.get("title",""),x.get("detail",""),x.get("action","")])
    for x in intel.get("recurring_patterns",[])[:8]: opp.append([f'Recurring: {x.get("defect")}',f'{x.get("grade")} • {x.get("work_center")} • {x.get("period_count")} periods',"Investigate"])
    if opp:
        opp_tbl=Table([["Issue","Evidence","Recommended Action"]]+opp,repeatRows=1,colWidths=[180,380,150],hAlign="CENTER",style=TableStyle([("BACKGROUND",(0,0),(-1,0),colors.HexColor("#118DFF")),("TEXTCOLOR",(0,0),(-1,0),colors.white),("FONTNAME",(0,0),(-1,0),"Helvetica-Bold"),("ALIGN",(0,0),(-1,-1),"LEFT"),("GRID",(0,0),(-1,-1),.3,colors.HexColor("#DCE6EF")),("FONTSIZE",(0,0),(-1,-1),7)]))
        story += [Paragraph("Root Cause / Improvement Opportunities",styles["Heading2"]),opp_tbl]
    story.append(PageBreak())
    d=payload["defects"]; rows=[["Rank","Defect","Records","Qty MT","% Records"]]+[[r["rank"],r["defect"],r["records"],f'{r["qty"]:.3f}',f'{r["pct_records"]*100:.2f}%'] for r in d["register"]]+[["","Total",d["register_total"]["records"],f'{d["register_total"]["qty"]:.3f}',f'{d["register_total"]["pct_records"]*100:.2f}%']]
    reg_tbl=Table(rows,repeatRows=1,colWidths=[45,300,70,80,80],hAlign="CENTER",style=TableStyle([("BACKGROUND",(0,0),(-1,0),colors.HexColor("#118DFF")),("TEXTCOLOR",(0,0),(-1,0),colors.white),("FONTNAME",(0,0),(-1,0),"Helvetica-Bold"),("ALIGN",(0,0),(-1,-1),"CENTER"),("ALIGN",(1,1),(1,-1),"LEFT"),("GRID",(0,0),(-1,-1),.3,colors.HexColor("#DCE6EF")),("FONTSIZE",(0,0),(-1,-1),7)]))
    story += [Paragraph("Defect Analysis Detail",styles["Heading2"]),reg_tbl]
    doc.build(story); return bio.getvalue()


def _pptx_report(payload):
    """Build a PowerPoint mirroring the webapp: title slide, KPI grid, one chart per slide
    (same PNGs used by the Excel/PDF exports), and the key data tables — all centered and
    consistently aligned so the deck reads like an exported version of the dashboard."""
    if Presentation is None:
        raise RuntimeError("PowerPoint export requires python-pptx")
    NAVY=RGBColor(0x0F,0x2A,0x4A); ACCENT=RGBColor(0x11,0x8D,0xFF); WHITE=RGBColor(0xFF,0xFF,0xFF)
    LIGHT=RGBColor(0xEA,0xF2,0xFB); BORDER=RGBColor(0xDC,0xE6,0xEF); SUBTLE=RGBColor(0xB8,0xD6,0xF7)

    prs=Presentation(); prs.slide_width=Inches(13.333); prs.slide_height=Inches(7.5)
    blank=prs.slide_layouts[6]

    def add_slide():
        return prs.slides.add_slide(blank)

    def band(slide, text, sub=None):
        box=slide.shapes.add_shape(MSO_SHAPE.RECTANGLE,0,0,prs.slide_width,Inches(1.05))
        box.fill.solid(); box.fill.fore_color.rgb=NAVY; box.line.fill.background(); box.shadow.inherit=False
        tf=box.text_frame; tf.margin_left=Inches(0.4); tf.margin_top=Inches(0.06); tf.word_wrap=True
        p=tf.paragraphs[0]; p.text=text; p.font.size=Pt(24); p.font.bold=True; p.font.color.rgb=WHITE; p.alignment=PP_ALIGN.LEFT
        if sub:
            p2=tf.add_paragraph(); p2.text=sub; p2.font.size=Pt(11); p2.font.color.rgb=SUBTLE; p2.alignment=PP_ALIGN.LEFT

    def add_table_slide(title_text, headers, rows, max_rows=14, note=None):
        chunks=[rows[i:i+max_rows] for i in range(0,len(rows),max_rows)] or [[]]
        for ci,chunk in enumerate(chunks):
            sub=note or (f"Rows {ci*max_rows+1}-{ci*max_rows+len(chunk)} of {len(rows)}" if len(rows)>max_rows else None)
            s=add_slide(); band(s,title_text,sub)
            left=Inches(0.4); top=Inches(1.4); width=prs.slide_width-Inches(0.8); height=Inches(5.6)
            gframe=s.shapes.add_table(len(chunk)+1,len(headers),left,top,width,height); table=gframe.table
            for cidx,h in enumerate(headers):
                cell=table.cell(0,cidx); cell.text=str(h); cell.fill.solid(); cell.fill.fore_color.rgb=ACCENT
                for para in cell.text_frame.paragraphs:
                    para.alignment=PP_ALIGN.CENTER
                    for run in para.runs: run.font.bold=True; run.font.color.rgb=WHITE; run.font.size=Pt(11)
            for ridx,r in enumerate(chunk,1):
                for cidx,val in enumerate(r):
                    cell=table.cell(ridx,cidx); cell.text=str(val); cell.vertical_anchor=MSO_ANCHOR.MIDDLE
                    for para in cell.text_frame.paragraphs:
                        para.alignment=PP_ALIGN.LEFT if cidx==0 else PP_ALIGN.CENTER
                        for run in para.runs: run.font.size=Pt(10); run.font.color.rgb=NAVY

    # Title slide
    s=add_slide()
    bg=s.shapes.add_shape(MSO_SHAPE.RECTANGLE,0,0,prs.slide_width,prs.slide_height)
    bg.fill.solid(); bg.fill.fore_color.rgb=NAVY; bg.line.fill.background(); bg.shadow.inherit=False
    tb=s.shapes.add_textbox(Inches(0.8),Inches(2.7),prs.slide_width-Inches(1.6),Inches(2.2)); tf=tb.text_frame; tf.word_wrap=True
    p=tf.paragraphs[0]; p.text="QUALITY INTELLIGENCE"; p.font.size=Pt(42); p.font.bold=True; p.font.color.rgb=WHITE; p.alignment=PP_ALIGN.CENTER
    p2=tf.add_paragraph(); p2.text="Disposition & Defect Analytics — Dashboard Export"; p2.font.size=Pt(18); p2.font.color.rgb=SUBTLE; p2.alignment=PP_ALIGN.CENTER
    fs=_filter_summary(payload["filters"])
    p3=tf.add_paragraph(); p3.text="Generated "+datetime.now().strftime("%d-%b-%Y %H:%M:%S")+"    |    Filters: "+("; ".join(f"{k}: {v}" for k,v in fs) if fs else "All"); p3.font.size=Pt(12); p3.font.color.rgb=RGBColor(0x9F,0xC2,0xEC); p3.alignment=PP_ALIGN.CENTER

    # KPI grid — 4x3, same 12 KPIs and order as the web dashboard cards.
    kl=payload["kpis"].get("kpis",[])
    for base in range(0,len(kl),12):
        chunk=kl[base:base+12]
        s=add_slide(); band(s,"Critical KPIs","Executive Summary")
        cols=4; margin_x=Inches(0.4); top=Inches(1.35); gap=Inches(0.18); cell_h=Inches(1.65)
        cell_w=int((prs.slide_width-2*margin_x-(cols-1)*gap)/cols)
        for i,k in enumerate(chunk):
            r=i//cols; c=i%cols
            x=int(margin_x+c*(cell_w+gap)); y=int(top+r*(cell_h+gap))
            box=s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,x,y,cell_w,cell_h)
            box.fill.solid(); box.fill.fore_color.rgb=LIGHT; box.line.color.rgb=BORDER; box.line.width=Pt(0.75); box.shadow.inherit=False
            tf=box.text_frame; tf.word_wrap=True; tf.vertical_anchor=MSO_ANCHOR.MIDDLE
            p=tf.paragraphs[0]; p.text=k.get("label",""); p.font.size=Pt(11); p.font.bold=True; p.font.color.rgb=NAVY; p.alignment=PP_ALIGN.CENTER
            p2=tf.add_paragraph(); p2.text=_export_display_value(k.get("value",0),k.get("fmt","")); p2.font.size=Pt(22); p2.font.bold=True; p2.font.color.rgb=NAVY; p2.alignment=PP_ALIGN.CENTER

    # One chart per slide, centered — identical PNGs to the Excel/PDF exports so all three
    # formats show the same charts as the webapp.
    for name,img in _export_charts(payload):
        s=add_slide(); band(s,name)
        pic_w=Inches(11.4); pic_h=Inches(5.05)
        left=int((prs.slide_width-pic_w)/2); top=Inches(1.65)
        s.shapes.add_picture(io.BytesIO(img),left,top,width=pic_w,height=pic_h)

    # Key data tables — mirrors the Defect Analysis / Work Center / Grade / Monthly sheets.
    d=payload["defects"]
    add_table_slide("Defect Analysis", ["Rank","Defect","Records","Qty (MT)","% Records"],
        [[r["rank"],r["defect"],r["records"],f'{r["qty"]:.3f}',f'{r["pct_records"]*100:.2f}%'] for r in d.get("register",[])])
    wc=payload["wcg"]["by_work_center"]; gr=payload["wcg"]["by_grade"]
    wcg_headers=["Name","Coils","Output MT","Defect Coils","Defect %","Reject Qty MT","Reject % Qty"]
    add_table_slide("Work Center Performance", wcg_headers,
        [[r.get("name"),r.get("coils"),f'{r.get("output_qty",0):.3f}',r.get("defect_coils"),f'{r.get("defect_pct",0)*100:.2f}%',f'{r.get("reject_qty",0):.3f}',f'{r.get("reject_pct_qty",0)*100:.2f}%'] for r in wc])
    add_table_slide("Grade Performance", wcg_headers,
        [[r.get("name"),r.get("coils"),f'{r.get("output_qty",0):.3f}',r.get("defect_coils"),f'{r.get("defect_pct",0)*100:.2f}%',f'{r.get("reject_qty",0):.3f}',f'{r.get("reject_pct_qty",0)*100:.2f}%'] for r in gr])
    monthly=payload["monthly"]["rows"]
    add_table_slide("Monthly Trend", ["Month","Coils","Output MT","Defect %","Reject % Qty","FPY %"],
        [[r.get("name"),r.get("coils"),f'{r.get("output_qty",0):.3f}',f'{r.get("defect_pct",0)*100:.2f}%',f'{r.get("reject_pct_qty",0)*100:.2f}%',f'{r.get("first_pass_yield_pct",0)*100:.2f}%'] for r in monthly])

    # Root cause / improvement opportunities — bullet slide.
    intel=payload.get("intel",{}); bullets=[]
    for x in intel.get("early_warnings",[]) or []: bullets.append(f'\u26a0 {x.get("title","")}: {x.get("detail","")}')
    for x in (intel.get("recurring_patterns",[]) or [])[:8]:
        bullets.append(f'\u21bb Recurring: {x.get("defect")} — {x.get("grade")} / {x.get("work_center")} ({x.get("period_count")} periods)')
    if bullets:
        s=add_slide(); band(s,"Root Cause & Improvement Opportunities")
        tb=s.shapes.add_textbox(Inches(0.6),Inches(1.5),prs.slide_width-Inches(1.2),Inches(5.5)); tf=tb.text_frame; tf.word_wrap=True
        for i,b in enumerate(bullets[:14]):
            p=tf.paragraphs[0] if i==0 else tf.add_paragraph()
            p.text=b; p.font.size=Pt(14); p.font.color.rgb=NAVY; p.alignment=PP_ALIGN.LEFT; p.space_after=Pt(8)

    bio=io.BytesIO(); prs.save(bio); return bio.getvalue()



def compute_qcr_intelligence(filters, monthly, defects, wcg, kpis=None):
    """QCR intelligence engine.

    Deterministic, auditable quality problem detection.  It combines target
    breaches, deterioration, spikes, recurrence, new/disappeared defects,
    contribution analysis, volume weighting and sample confidence.  No AI or
    external service is required.
    """
    rows=list((monthly or {}).get("rows") or [])
    selected=str(filters.get("month") or "All")
    idx=len(rows)-1
    if selected and selected!="All":
        for i,r in enumerate(rows):
            if str(r.get("name"))==selected: idx=i; break
    cur=rows[idx] if 0<=idx<len(rows) else None
    prev=rows[idx-1] if cur is not None and idx>0 else None

    def num(x):
        try:return float(x or 0)
        except:return 0.0
    def slope(vals):
        n=len(vals)
        if n<2:return 0.0
        xm=(n-1)/2; ym=sum(vals)/n; den=sum((i-xm)**2 for i in range(n))
        return sum((i-xm)*(y-ym) for i,y in enumerate(vals))/den if den else 0.0
    def pct_change(now,old):
        return ((now-old)/abs(old)*100.0) if abs(old)>1e-12 else (100.0 if now>0 else 0.0)
    def conf(records):
        n=int(records or 0)
        return "high" if n>30 else ("medium" if n>=10 else "low")

    recent=rows[-6:]
    fpy_vals=[num(r.get("first_pass_yield_pct")) for r in recent]
    rej_vals=[num(r.get("reject_pct_qty")) for r in recent]
    defect_vals=[num(r.get("defect_pct")) for r in recent]
    sf=slope(fpy_vals[-4:]); sr=slope(rej_vals[-4:]); sd=slope(defect_vals[-4:])
    baseline_rej=sum(rej_vals[:-1])/max(1,len(rej_vals)-1) if len(rej_vals)>1 else (rej_vals[-1] if rej_vals else 0)
    baseline_def=sum(defect_vals[:-1])/max(1,len(defect_vals)-1) if len(defect_vals)>1 else (defect_vals[-1] if defect_vals else 0)
    forecast={"period":"Next period",
              "fpy":max(0,min(1,(fpy_vals[-1]+slope(fpy_vals[-4:])) if fpy_vals else 0)),
              "reject_pct":max(0,min(1,(rej_vals[-1]+sr) if rej_vals else 0)),
              "defect_pct":max(0,min(1,(defect_vals[-1]+sd) if defect_vals else 0)),
              "periods_used":len(recent),"slope_fpy":sf,"slope_reject":sr,"slope_defect":sd}
    forecast["risk"]={"fpy":"high" if forecast["fpy"]<.90 else ("medium" if forecast["fpy"]<.97 else "low"),
                       "reject_pct":"high" if forecast["reject_pct"]>.05 else ("medium" if forecast["reject_pct"]>.03 else "low"),
                       "defect_pct":"high" if forecast["defect_pct"]>.05 else ("medium" if forecast["defect_pct"]>.03 else "low")}

    # KPI target intelligence / health score.
    klist=(kpis.get("kpis",[]) if isinstance(kpis,dict) else list(kpis or []))
    targets=get_kpi_targets(); ranking=[]
    for k in klist:
        label=k.get("label"); cfg=targets.get(label)
        if not cfg or cfg.get("target") is None: continue
        v=num(k.get("value")); t=num(cfg.get("target")); status=_kpi_target_status(label,v)
        gap=(v-t)*100; severity=3 if status=="bad" else 2 if status=="amber" else 1
        ranking.append({"label":label,"actual":v,"target":t,"gap_pp":gap,"status":status,"severity":severity})
    ranking.sort(key=lambda x:(-x["severity"],-abs(x["gap_pp"])))
    by={x["label"]:x["actual"] for x in ranking}
    def quality_component(label,weight,higher_good):
        if label not in by:return 0,weight,0
        v=by[label];t=num(targets.get(label,{}).get("target"))
        ratio=(v/t if t else 1) if higher_good else (t/v if v>0 else 1)
        return max(0,min(1,ratio))*weight,weight,v
    parts=[]
    for label,w,h in [("First Pass Yield % (Prime%)",30,True),("Defect Rate",20,False),("Reject % Qty",20,False),("Salvage % Qty",10,False)]:
        sc,wt,v=quality_component(label,w,h);parts.append((label,sc,wt,v))
    trend_penalty=min(10,(abs(sf)*1000 if sf<0 else 0)+(sr*1000 if sr>0 else 0))
    parts.append(("Trend",10-trend_penalty,10,(10-trend_penalty)/10))
    compliant=sum(1 for x in ranking if x["status"]=="good");parts.append(("Target compliance",10*compliant/max(1,len(ranking)),10,compliant/max(1,len(ranking))))
    health=round(sum(x[1] for x in parts),1); health_status="good" if health>=85 else ("amber" if health>=70 else "bad")
    reasons=sorted([(x[0],round(x[2]-x[1],1)) for x in parts if x[2]-x[1]>0],key=lambda x:x[1],reverse=True)[:3]

    # Dimension helpers.  Each dimension is evaluated against the same filtered
    # population while excluding its own filter, so risk is not circular.
    def dimension_rows(dim,key):
        conn=get_conn();c=conn.cursor()
        try:
            wh,pp=build_where(filters,exclude={dim})
            c.execute(f"SELECT {key}, COUNT(DISTINCT {HEAT_KEY_SQL}) coils, COALESCE(SUM(output_weight),0) qty, COALESCE(SUM(CASE WHEN quality_decision='REJECT' THEN output_weight ELSE 0 END),0) reject_qty FROM disposition {wh}{' AND ' if wh else 'WHERE '}{key}<>'' GROUP BY {key} ORDER BY reject_qty DESC, qty DESC LIMIT 30",pp)
            base=c.fetchall(); names=[r[0] for r in base]
            wh2,pp2=build_where(filters,exclude={dim,"month"})
            c.execute(f"SELECT {key}, month, COUNT(DISTINCT {HEAT_KEY_SQL}) coils, COALESCE(SUM(output_weight),0) qty, COALESCE(SUM(CASE WHEN quality_decision='REJECT' THEN output_weight ELSE 0 END),0) reject_qty FROM disposition {wh2}{' AND ' if wh2 else 'WHERE '}{key}<>'' AND month<>'' GROUP BY {key}, month ORDER BY month",pp2)
            hist={n:[] for n in names}
            for r in c.fetchall():
                q=num(r[3]);rq=num(r[4]);hist.setdefault(r[0],[]).append({"month":r[1],"coils":int(r[2] or 0),"qty":q,"reject":rq/q if q else 0})
            total_qty=sum(num(r[2]) for r in base); total_coils=sum(int(r[1] or 0) for r in base)
            out=[]
            for r in base:
                name=r[0] or "—";coils=int(r[1] or 0);qty=num(r[2]);rej=num(r[3]);rp=rej/qty if qty else 0
                hs=hist.get(name,[]);trend=slope([x["reject"] for x in hs[-4:]]) if hs else 0
                vol=min(1,qty/max(total_qty*.10,1))
                sev=min(1,rp/.05);tr=min(1,max(0,trend)*1000)
                recurrence=sum(1 for x in hs[-4:] if x["reject"]>0)
                rec=min(1,recurrence/3)
                score=round((sev*.40+vol*.25+tr*.20+rec*.15)*100,1)
                risk="High" if score>=65 else ("Medium" if score>=35 else "Low")
                out.append({"name":name,"coils":coils,"qty":qty,"reject_qty":rej,"reject_pct":rp,"trend":trend,"recurrence":recurrence,"score":score,"risk":risk,"confidence":conf(coils)})
            out.sort(key=lambda x:x["score"],reverse=True);return out
        finally:c.close();conn.close()
    risk={"work_centers":dimension_rows("work_center","work_center"),"grades":dimension_rows("grade","grade")}

    # Defect history used for top contributors, recurrence, first appearance and improvements.
    conn=get_conn();c=conn.cursor()
    defect_hist={}; wc_hist={}; grade_hist={}
    try:
        wh,pp=build_where(filters,exclude={"month"})
        c.execute(f"SELECT month, main_defect, COUNT(DISTINCT {HEAT_KEY_SQL}) coils, COALESCE(SUM(output_weight),0) qty FROM disposition {wh}{' AND ' if wh else 'WHERE '}month<>'' AND main_defect<>'' AND main_defect<>'NO DEFECT' GROUP BY month,main_defect ORDER BY month",pp)
        for r in c.fetchall():defect_hist.setdefault(r[1],[]).append({"month":r[0],"coils":int(r[2] or 0),"qty":num(r[3])})
        c.execute(f"SELECT month, work_center, COUNT(DISTINCT {HEAT_KEY_SQL}) coils, COALESCE(SUM(output_weight),0) qty, COALESCE(SUM(CASE WHEN quality_decision='REJECT' THEN output_weight ELSE 0 END),0) reject_qty FROM disposition {wh}{' AND ' if wh else 'WHERE '}month<>'' AND work_center<>'' GROUP BY month,work_center ORDER BY month",pp)
        for r in c.fetchall():wc_hist.setdefault(r[1],[]).append({"month":r[0],"coils":int(r[2] or 0),"qty":num(r[3]),"reject":num(r[4])})
        c.execute(f"SELECT month, grade, COUNT(DISTINCT {HEAT_KEY_SQL}) coils, COALESCE(SUM(output_weight),0) qty, COALESCE(SUM(CASE WHEN quality_decision='REJECT' THEN output_weight ELSE 0 END),0) reject_qty FROM disposition {wh}{' AND ' if wh else 'WHERE '}month<>'' AND grade<>'' GROUP BY month,grade ORDER BY month",pp)
        for r in c.fetchall():grade_hist.setdefault(r[1],[]).append({"month":r[0],"coils":int(r[2] or 0),"qty":num(r[3]),"reject":num(r[4])})
    finally:c.close();conn.close()

    # Current vs previous defect contribution.  The decomposition uses share of
    # total output for the defect and reject quantity for work-centre contribution.
    cur_def=[];prev_def=[]
    if cur:
        conn=get_conn();c=conn.cursor()
        try:
            for period,out in [(cur,"cur"),(prev,"prev")]:
                if not period: continue
                pf=dict(filters);pf["month"]=period.get("name");whx,px=build_where(pf)
                c.execute(f"SELECT main_defect,COALESCE(SUM(output_weight),0) qty FROM disposition {whx}{' AND ' if whx else 'WHERE '}main_defect<>'' AND main_defect<>'NO DEFECT' GROUP BY main_defect ORDER BY qty DESC",px)
                (cur_def if out=="cur" else prev_def).extend([{"name":r[0],"qty":num(r[1])} for r in c.fetchall()])
        finally:c.close();conn.close()
    def top_delta(now,old):
        oldmap={x["name"]:x["qty"] for x in old};totn=sum(x["qty"] for x in now);toto=sum(x["qty"] for x in old)
        arr=[]
        for x in now:
            ns=x["qty"]/totn if totn else 0;os=oldmap.get(x["name"],0)/toto if toto else 0
            arr.append({"name":x["name"],"share":ns,"change_pp":(ns-os)*100,"qty":x["qty"],"qty_change":x["qty"]-oldmap.get(x["name"],0)})
        positives=[max(0,x["qty_change"]) for x in arr];total_inc=sum(positives)
        for x in arr:x["contribution_pct"]=(max(0,x["qty_change"])/total_inc*100) if total_inc else 0
        return max(arr,key=lambda x:abs(x["change_pp"])) if arr else None
    top_def_delta=top_delta(cur_def,prev_def)

    # Recurrence and first appearance.
    recurring=[];new_issues=[];improvements=[]
    month_names=[r.get("name") for r in rows if r.get("name")]
    recent_names=month_names[-4:]
    for defect,hist in defect_hist.items():
        hist=sorted(hist,key=lambda x:_month_sort_key(x["month"]))
        by_month={x["month"]:x for x in hist}
        # Recurrence means the defect is present in every one of the last 3/4
        # available periods, not merely that it occurred three times in history.
        tail_names=recent_names[-4:] if len(recent_names)>=4 else recent_names[-3:]
        tail=[by_month[m] for m in tail_names if m in by_month and by_month[m]["qty"]>0]
        if len(tail)>=3 and len(tail)==len(tail_names):
            recurring.append({"defect":defect,"period_count":len(tail),"months":tail,"qty":sum(x["qty"] for x in tail),"coils":sum(x["coils"] for x in tail)})
        positive=[x for x in hist if x["qty"]>0]
        if positive:
            first=positive[0]
            # First appearance is only a new issue when the first occurrence is
            # in the currently selected/latest period.
            latest=month_names[-1] if month_names else None
            if first["month"]==latest:
                new_issues.append({"defect":defect,"month":first["month"],"qty":first["qty"],"coils":first["coils"],"records":first["coils"]})
        if len(positive)>=2:
            a,b=positive[-2],positive[-1]
            if a["qty"]>0 and b["qty"]<a["qty"]*.70:
                improvements.append({"type":"defect","name":defect,"change_pct":pct_change(b["qty"],a["qty"]),"detail":f"{defect} reduced {abs(pct_change(b['qty'],a['qty'])):.0f}% in {b['month']} vs {a['month']}."})
    recurring.sort(key=lambda x:(x["period_count"],x["qty"]),reverse=True);recurring=recurring[:8]
    # Attach the dominant Work Center / Grade for each recurring defect,
    # scoped to the SAME month later shown as its "period" (the last month
    # in that defect's own recurring window) — not the page's currently
    # selected month filter. Using a single shared month for every recurring
    # defect meant the reported Work Center/Grade and the displayed period
    # could refer to different months than the defect actually occurred in,
    # so "Investigate" combined a mismatched Work Center+Grade+Month+Defect
    # and returned zero records.
    if recurring:
        conn=get_conn();c=conn.cursor()
        try:
            for rr in recurring:
                period_month=rr["months"][-1]["month"]
                pf=dict(filters);pf["month"]=period_month;whx,px=build_where(pf)
                q=whx+((" AND " if whx else "WHERE ")+"main_defect = ?")
                pp=px+[rr["defect"]]
                c.execute(f"SELECT work_center,COUNT(DISTINCT {HEAT_KEY_SQL}) coils FROM disposition {q} GROUP BY work_center ORDER BY coils DESC LIMIT 1",pp)
                r=c.fetchone();rr["work_center"]=r[0] if r else "—"
                c.execute(f"SELECT grade,COUNT(DISTINCT {HEAT_KEY_SQL}) coils FROM disposition {q} GROUP BY grade ORDER BY coils DESC LIMIT 1",pp)
                r=c.fetchone();rr["grade"]=r[0] if r else "—"
        finally:c.close();conn.close()
    new_issues.sort(key=lambda x:x["qty"],reverse=True);new_issues=new_issues[:8]
    # Attach the dominant Work Center / Grade for each new-issue defect too,
    # scoped to the month it actually first appeared in (same approach as the
    # recurring-defect enrichment above). Without this, "Investigate" on a
    # new-issue finding fell back to the single riskiest Work Center/Grade in
    # the whole dataset, which usually has nothing to do with this defect and
    # produced zero matching records.
    if new_issues:
        conn=get_conn();c=conn.cursor()
        try:
            for nn in new_issues:
                pf=dict(filters);pf["month"]=nn.get("month");whx,px=build_where(pf)
                q=whx+((" AND " if whx else "WHERE ")+"main_defect = ?")
                pp=px+[nn["defect"]]
                c.execute(f"SELECT work_center,COUNT(DISTINCT {HEAT_KEY_SQL}) coils FROM disposition {q} GROUP BY work_center ORDER BY coils DESC LIMIT 1",pp)
                r=c.fetchone();nn["work_center"]=r[0] if r else "—"
                c.execute(f"SELECT grade,COUNT(DISTINCT {HEAT_KEY_SQL}) coils FROM disposition {q} GROUP BY grade ORDER BY coils DESC LIMIT 1",pp)
                r=c.fetchone();nn["grade"]=r[0] if r else "—"
        finally:c.close();conn.close()

    # Generic problem-finder.  Scores are intentionally transparent: severity,
    # deviation, quantity impact, recurrence and confidence all influence rank.
    problems=[]
    def add_problem(title,severity,change,driver,detail,score,typ,what,where=None,grade=None,defect=None,period=None,impact_qty=0,records=0,action="Investigate"):
        # "_*_locked" marks fields that were computed specifically FOR this
        # finding (e.g. the recurring/new-issue Work Center+Grade queries
        # above). Fields left as "—" get filled in below from independent,
        # dataset-wide "dominant" rankings purely for a readable driver_path
        # — those are not guaranteed to co-occur with each other, so they
        # must stay droppable if the combination turns out to have zero
        # matching records (see the verification pass below).
        problems.append({"title":title,"severity":severity,"change":change,"driver":driver,"detail":detail,"score":round(score,1),"type":typ,"what":what,"where":where or "—","grade":grade or "—","defect":defect or "—","period":period or "—","impact_qty":round(impact_qty,2),"records":int(records or 0),"confidence":conf(records),"action":action,
                         "_where_locked":bool(where),"_grade_locked":bool(grade),"_defect_locked":bool(defect)})
    # KPI target breaches
    for k in ranking:
        if k["status"]=="good":continue
        sev="Critical" if k["status"]=="bad" else "Attention"
        add_problem(f"{k['label']} below target" if k["label"] not in ("Reject % Qty","Defect Rate") else f"{k['label']} above target",sev,f"{k['gap_pp']:+.2f} pp","KPI target",f"Actual {k['actual']*100:.2f}% vs target {k['target']*100:.2f}%.",65 if sev=="Critical" else 45,"threshold",k["label"],impact_qty=0,records=(cur.get("coils") if cur else 0),action="Review KPI drivers")
    # Consecutive trends
    if len(rej_vals)>=3 and all(rej_vals[i]>rej_vals[i-1]+1e-9 for i in range(1,len(rej_vals))):
        add_problem("Reject is deteriorating consecutively","Critical" if rej_vals[-1]>.05 else "Attention",f"{(rej_vals[-1]-rej_vals[0])*100:+.2f} pp","Consecutive trend",f"Reject increased for {len(rej_vals)} consecutive available periods.",80,"trend","Reject %",period=recent[-1].get("name") if recent else None,records=cur.get("coils") if cur else 0)
    if len(fpy_vals)>=3 and all(fpy_vals[i]<fpy_vals[i-1]-1e-9 for i in range(1,len(fpy_vals))):
        add_problem("FPY is deteriorating consecutively","Attention",f"{(fpy_vals[-1]-fpy_vals[0])*100:+.2f} pp","Consecutive trend",f"FPY declined for {len(fpy_vals)} consecutive available periods.",65,"trend","FPY %",records=cur.get("coils") if cur else 0)
    if len(defect_vals)>=3 and all(defect_vals[i]>defect_vals[i-1]+1e-9 for i in range(1,len(defect_vals))):
        add_problem("Defect rate is deteriorating consecutively","Attention",f"{(defect_vals[-1]-defect_vals[0])*100:+.2f} pp","Consecutive trend",f"Defect rate increased for {len(defect_vals)} consecutive available periods.",62,"trend","Defect Rate",records=cur.get("coils") if cur else 0)
    # Spike
    if len(rej_vals)>=3 and baseline_rej>0 and rej_vals[-1]>=baseline_rej*1.5 and (rej_vals[-1]-baseline_rej)>.005:
        add_problem("Reject quality spike detected","Critical" if rej_vals[-1]>=.05 else "Attention",f"{pct_change(rej_vals[-1],baseline_rej):+.0f}% vs baseline","Recent baseline",f"Current Reject {rej_vals[-1]*100:.2f}% is {rej_vals[-1]/baseline_rej:.1f}× the recent baseline of {baseline_rej*100:.2f}%.",85,"spike","Reject %",records=cur.get("coils") if cur else 0)
    if len(defect_vals)>=3 and baseline_def>0 and defect_vals[-1]>=baseline_def*1.5 and (defect_vals[-1]-baseline_def)>.005:
        add_problem("Defect-rate spike detected","Attention",f"{pct_change(defect_vals[-1],baseline_def):+.0f}% vs baseline","Recent baseline",f"Current Defect Rate {defect_vals[-1]*100:.2f}% is {defect_vals[-1]/baseline_def:.1f}× the recent baseline.",72,"spike","Defect Rate",records=cur.get("coils") if cur else 0)
    # Recurring/new defects
    for r in recurring[:3]:
        add_problem(f"Recurring defect: {r['defect']}","Critical" if r["period_count"]>=4 else "Attention",f"{r['period_count']} periods","Recurrence",f"{r['defect']} has remained active across {r['period_count']} consecutive recent periods.",78+r["period_count"]*2,"recurrence","Defect",where=r.get("work_center"),grade=r.get("grade"),defect=r["defect"],period=r["months"][-1]["month"],impact_qty=r["qty"],records=r["coils"],action="Investigate recurring defect")
    for n in new_issues[:2]:
        add_problem(f"New quality issue: {n['defect']}","Critical",n["month"],"First appearance",f"{n['defect']} appeared after no prior recorded occurrence and is now {n['qty']:.2f} MT.",76,"new_issue","Defect",where=n.get("work_center"),grade=n.get("grade"),defect=n["defect"],period=n["month"],impact_qty=n["qty"],records=n["records"],action="Investigate first appearance")
    # Contribution: defect + work-center pair.
    if top_def_delta and top_def_delta["change_pp"]>5:
        topwc=next((x for x in risk["work_centers"] if x["risk"] in ("High","Medium")),None)
        wcname=topwc["name"] if topwc else None
        add_problem(f"{top_def_delta['name']} is driving the change","Critical" if top_def_delta["change_pp"]>=15 else "Attention",f"{top_def_delta['change_pp']:+.1f} pp share","Contribution analysis",f"Primary defect contributor accounts for the largest change in defect mix ({top_def_delta['change_pp']:+.1f} pp) and {top_def_delta.get('contribution_pct',0):.0f}% of positive defect-quantity increase.",82,"contribution","Defect",where=wcname,defect=top_def_delta["name"],period=cur.get("name") if cur else None,impact_qty=top_def_delta["qty"],records=cur.get("coils") if cur else 0,action="Open root-cause investigation")
    # Data-quality finding: incomplete Defect Intensity classification.  This is
    # intentionally a QCR finding because missing classification weakens defect
    # intelligence even when the production KPIs themselves look healthy.
    try:
        conn=get_conn();c=conn.cursor(); whq,pq=build_where(filters)
        c.execute(f"SELECT COUNT(*), SUM(CASE WHEN TRIM(COALESCE(defect_intensity,''))='' THEN 1 ELSE 0 END) FROM disposition {whq}",pq)
        dq_total,dq_missing=c.fetchone(); dq_total=int(dq_total or 0);dq_missing=int(dq_missing or 0)
    finally:
        try:c.close();conn.close()
        except Exception:pass
    dq_pct=(dq_missing/dq_total) if dq_total else 0
    if dq_total and dq_pct>=0.10:
        add_problem("Defect Intensity data quality gap","Warning",f"{dq_pct*100:.1f}% missing","Data completeness",f"{dq_missing:,} of {dq_total:,} filtered records have no Defect Intensity classification.",55+dq_pct*30,"data_quality","Defect Intensity",impact_qty=0,records=dq_total,action="Complete missing intensity classification")

    # Volume-weighted risk dimensions
    for typ,label,arr in [("work_center","Work Center",risk["work_centers"]),("grade","Grade",risk["grades"])]:
        if arr and arr[0]["risk"]=="High":
            x=arr[0];add_problem(f"{label} {x['name']} is high risk","Critical",f"Score {x['score']:.0f}/100",f"{label} risk score",f"Reject {x['reject_pct']*100:.2f}% • {x['qty']:.2f} MT • trend {x['trend']*100:+.2f} pp.",70+x["score"]*.25,"risk",f"{label} risk",where=x["name"] if typ=="work_center" else None,grade=x["name"] if typ=="grade" else None,impact_qty=x["qty"],records=x["coils"],action=f"Investigate {label.lower()}")

    # Build What → Where → Why enrichment for each problem.
    # Work-center / grade drivers are chosen from the risk population, then the
    # dominant defect is chosen from the filtered defect history.
    dominant_def=top_def_delta["name"] if top_def_delta else (recurring[0]["defect"] if recurring else None)
    dominant_wc=risk["work_centers"][0]["name"] if risk["work_centers"] else None
    dominant_grade=risk["grades"][0]["name"] if risk["grades"] else None
    for pr in problems:
        if pr["where"]=="—" and dominant_wc: pr["where"]=dominant_wc
        if pr["grade"]=="—" and dominant_grade: pr["grade"]=dominant_grade
        if pr["defect"]=="—" and dominant_def: pr["defect"]=dominant_def
        if pr["period"]=="—" and cur: pr["period"]=cur.get("name") or "—"
        if pr["defect"]!="—" and pr["where"]!="—":
            pr["driver_path"]=f"{pr['defect']} at {pr['where']}"
        else: pr["driver_path"]=pr["driver"]

    # Verify each finding's Where/Grade/Defect combination actually has
    # matching records for its period. The dominant_wc/dominant_grade/
    # dominant_def fallback above fills gaps from independent, dataset-wide
    # rankings — they were never checked to co-occur, so a finding could end
    # up pointing at a Work Center + Grade + Defect combination that never
    # existed together, and "Investigate" would come back with zero
    # records. Drop only the auto-filled (non-locked) dimensions, one at a
    # time, until the combination resolves to real records.
    conn=get_conn();c=conn.cursor()
    try:
        def _combo_has_records(pf_month,where_v,grade_v,defect_v):
            pf=dict(filters);pf["month"]=pf_month
            wh,pp=build_where(pf)
            if where_v and where_v!="—": wh=wh+(" AND " if wh else "WHERE ")+"work_center = ?"; pp=pp+[where_v]
            if grade_v and grade_v!="—": wh=wh+(" AND " if wh else "WHERE ")+"grade = ?"; pp=pp+[grade_v]
            if defect_v and defect_v!="—": wh=wh+(" AND " if wh else "WHERE ")+"main_defect = ? AND main_defect<>'' AND main_defect<>'NO DEFECT'"; pp=pp+[defect_v]
            c.execute(f"SELECT COUNT(*) FROM disposition {wh}",pp)
            return (c.fetchone()[0] or 0)>0
        for pr in problems:
            month_val=pr["period"] if pr["period"] and pr["period"]!="—" else str(filters.get("month") or "All")
            w,g,d=pr["where"],pr["grade"],pr["defect"]
            if _combo_has_records(month_val,w,g,d): continue
            if not pr.get("_defect_locked") and d!="—" and _combo_has_records(month_val,w,g,"—"):
                pr["defect"]="—"
            elif not pr.get("_grade_locked") and g!="—" and _combo_has_records(month_val,w,"—",d):
                pr["grade"]="—"
            elif not pr.get("_where_locked") and w!="—" and _combo_has_records(month_val,"—",g,d):
                pr["where"]="—"
            elif not pr.get("_defect_locked") and not pr.get("_grade_locked") and _combo_has_records(month_val,w,"—","—"):
                pr["grade"]="—";pr["defect"]="—"
            elif not pr.get("_defect_locked") and not pr.get("_where_locked") and _combo_has_records(month_val,"—",g,"—"):
                pr["where"]="—";pr["defect"]="—"
            elif not pr.get("_grade_locked") and not pr.get("_where_locked") and _combo_has_records(month_val,"—","—",d):
                pr["where"]="—";pr["grade"]="—"
            elif _combo_has_records(month_val,"—","—","—"):
                pr["where"]="—";pr["grade"]="—";pr["defect"]="—"
            pr["driver_path"]=f"{pr['defect']} at {pr['where']}" if pr["defect"]!="—" and pr["where"]!="—" else pr["driver"]
    finally:
        c.close();conn.close()
    for pr in problems:
        pr.pop("_where_locked",None);pr.pop("_grade_locked",None);pr.pop("_defect_locked",None)

    problems.sort(key=lambda x:(-x["score"], 0 if x["severity"]=="Critical" else 1 if x["severity"]=="Attention" else 2))
    # Deduplicate near-identical findings by title.
    seen=set();uniq=[]
    for p in problems:
        key=(p["title"],p["type"])
        if key not in seen:seen.add(key);uniq.append(p)
    problems=uniq[:10]

    # Why-changed decomposition, with explicit shares and a generated statement.
    why=None
    if cur and prev:
        fpyd=(num(cur.get("first_pass_yield_pct"))-num(prev.get("first_pass_yield_pct")))*100
        rejd=(num(cur.get("reject_pct_qty"))-num(prev.get("reject_pct_qty")))*100
        # Work center change by reject contribution.
        def wc_contributors():
            conn=get_conn();c=conn.cursor();arr=[]
            try:
                for period in (cur,prev):
                    pf=dict(filters);pf["month"]=period.get("name");whx,px=build_where(pf)
                    c.execute(f"SELECT work_center,COALESCE(SUM(output_weight),0) qty,COALESCE(SUM(CASE WHEN quality_decision='REJECT' THEN output_weight ELSE 0 END),0) rej FROM disposition {whx}{' AND ' if whx else 'WHERE '}work_center<>'' GROUP BY work_center",px)
                    arr.append({r[0]:num(r[2]) for r in c.fetchall()})
            finally:c.close();conn.close()
            a,b=arr[0],arr[1];ta=sum(a.values());tb=sum(b.values());out=[]
            for n,v in a.items():out.append({"name":n,"share":v/ta if ta else 0,"change_pp":((v/ta if ta else 0)-(b.get(n,0)/tb if tb else 0))*100,"qty_change":v-b.get(n,0)})
            inc=sum(max(0,x["qty_change"]) for x in out)
            for x in out:x["contribution_pct"]=(max(0,x["qty_change"])/inc*100) if inc else 0
            return sorted(out,key=lambda x:abs(x["change_pp"]),reverse=True)
        wc_changes=wc_contributors();wc_top=wc_changes[0] if wc_changes else None
        why={"current":cur,"previous":prev,"fpy_change_pp":fpyd,"reject_change_pp":rejd,
             "defect_contributor":top_def_delta,"wc_contributor":wc_top,
             "decomposition":{"work_center":wc_top,"grade":({"name":dominant_grade} if dominant_grade else None),"defect":top_def_delta},
             "statement":(f"Reject changed from {num(prev.get('reject_pct_qty'))*100:.2f}% to {num(cur.get('reject_pct_qty'))*100:.2f}% ({rejd:+.2f} pp). "
                           f"Primary visible driver is {top_def_delta['name'] if top_def_delta else 'no single defect'}"
                           f"{(' at '+dominant_wc) if dominant_wc else ''}." + (f" It accounts for about {top_def_delta.get('contribution_pct',0):.0f}% of the positive defect-quantity increase." if top_def_delta else ''))}

    # Recommended investigation is generated from the highest-ranked finding.
    top=problems[0] if problems else None
    investigation=[]
    if top:
        investigation=[x for x in [top.get("where"),top.get("grade"),top.get("defect"),top.get("period")] if x and x!="—"]
        investigation += ["Affected Heat / Batch","Defect Intensity"]
    story=""
    if top:
        story=f"Overall quality is {health_status}. {top['title']} is the highest-priority finding ({top['severity']}). {top['detail']}"
        if top.get("driver_path"): story += f" Main driver: {top['driver_path']}."
        if top.get("confidence")=="low": story += " Data confidence is low because the affected sample is small."
    elif improvements:
        story="Overall quality is stable with measurable improvement in the current selection. " + improvements[0]["detail"]
    else: story="No high-priority quality problem was detected in the current selection."

    # Good-news improvements from KPI changes.
    if cur and prev:
        if num(cur.get("first_pass_yield_pct"))>num(prev.get("first_pass_yield_pct"))+.005:
            improvements.append({"type":"kpi","name":"FPY","change_pct":(num(cur.get("first_pass_yield_pct"))-num(prev.get("first_pass_yield_pct")))*100,"detail":f"FPY improved {(num(cur.get('first_pass_yield_pct'))-num(prev.get('first_pass_yield_pct')))*100:.2f} pp in {cur.get('name','current period')} vs {prev.get('name','previous period')}."})
        if num(cur.get("reject_pct_qty"))<num(prev.get("reject_pct_qty"))-.005:
            improvements.append({"type":"kpi","name":"Reject %","change_pct":(num(cur.get("reject_pct_qty"))-num(prev.get("reject_pct_qty")))*100,"detail":f"Reject reduced {abs((num(cur.get('reject_pct_qty'))-num(prev.get('reject_pct_qty')))*100):.2f} pp in {cur.get('name','current period')} vs {prev.get('name','previous period')}."})
    improvements=improvements[:6]

    # Backward-compatible early warnings list plus new findings.
    warnings=[]
    for p in problems[:8]:
        warnings.append({"severity":"high" if p["severity"]=="Critical" else "medium","title":p["title"],"detail":p["detail"],"action":p["action"],"type":p["type"]})
    return {"comparison":{"current":cur,"previous":prev,"rows":rows},"why_changed":why,"forecast":forecast,
            "early_warnings":warnings,"kpi_ranking":ranking,"health_score":{"score":health,"status":health_status,"reasons":reasons,"components":parts},
            "risk_matrix":risk,"recurring_patterns":recurring,"new_issues":new_issues,"improvements":improvements,
            "problem_finder":problems,"quality_story":story,"recommended_investigation":investigation,
            "confidence_summary":{"filtered_records":int(cur.get("coils") or 0) if cur else 0,"level":conf(cur.get("coils") if cur else 0)},"data_quality":{"missing_intensity":dq_missing,"total_records":dq_total,"missing_intensity_pct":dq_pct}}


HTML_PAGE = None  # loaded lazily from index_template



def _drilldown_rows(filters, metric, drill_value=None, limit=5000, offset=0):
    """Return viewer-safe source records for KPI/chart drill-down using the same filters as dashboard."""
    where_sql, params = build_where(filters)
    metric = (metric or '').strip()
    clauses=[]; extra=[]
    if metric in {'Defect Coils','Defect Rate'}:
        clauses.append("main_defect <> '' AND main_defect <> 'NO DEFECT'")
    elif metric in {'First Pass Yield % (Prime%)'}:
        clauses.append("quality_decision = ?"); extra.append('PRIME')
    elif metric in {'Hold for Decision % Qty','Hold For Decision Qty (MT)'}:
        clauses.append("quality_decision = ?"); extra.append('HOLD FOR DECISION')
    elif metric in {'Reject Qty (MT)','Reject % Qty'}:
        clauses.append("quality_decision = ?"); extra.append('REJECT')
    elif metric in {'Salvage % Qty'}:
        clauses.append("quality_decision = ?"); extra.append('SALVAGE')
    elif metric in {'Salvage + Divert Qty (MT)'}:
        clauses.append("quality_decision IN (?,?)"); extra.extend(['SALVAGE','DIVERT'])
    elif metric in {'Rework % Qty'}:
        clauses.append("quality_decision = ?"); extra.append('RE-WORK')
    elif metric == 'decision_category':
        clauses.append("quality_decision = ?"); extra.append(drill_value or '')
    elif metric == 'defect_category':
        clauses.append("main_defect = ? AND main_defect <> '' AND main_defect <> 'NO DEFECT'"); extra.append(drill_value or '')
    elif metric == 'heat_detail':
        clauses.append("UPPER(TRIM(COALESCE(heat_no,''))) = UPPER(TRIM(?))"); extra.append(drill_value or '')
    elif metric == 'quality_investigation':
        # QCR one-click investigations may provide any combination of WC/Grade/Defect.
        wc = str(filters.get('work_center') or 'All').strip()
        grade = str(filters.get('grade') or 'All').strip()
        defect = str(drill_value or '').strip()
        if wc and wc.lower() != 'all':
            clauses.append("work_center = ?"); extra.append(wc)
        if grade and grade.lower() != 'all':
            clauses.append("grade = ?"); extra.append(grade)
        if defect and defect.lower() not in {'all','—','-'}:
            clauses.append("main_defect = ? AND main_defect <> '' AND main_defect <> 'NO DEFECT'"); extra.append(defect)
    # Total Coils / Output Quantity / unknown => current filtered selection.
    if clauses:
        where_sql = where_sql + (' AND ' if where_sql else 'WHERE ') + ' AND '.join(clauses)
        params = params + extra
    conn=get_conn(); cur=conn.cursor()
    sql=f"SELECT insp_lot_date, ud_date, heat_no, batch_no, work_center, grade, main_defect, defect_intensity, quality_decision, output_weight FROM disposition {where_sql} ORDER BY id DESC LIMIT ? OFFSET ?"
    cur.execute(sql, params+[limit,offset]); raw=cur.fetchall(); conn.close()
    rows=[]
    for r in raw:
        rows.append({'insp_lot_date':r[0] or '', 'ud_date':r[1] or '', 'heat_no':r[2] or '', 'batch_no':r[3] or '', 'coil_lot':r[3] or '', 'work_center':r[4] or '', 'grade':r[5] or '', 'main_defect':r[6] or '', 'defect_intensity':r[7] or '', 'quality_decision':r[8] or '', 'output_weight':float(r[9] or 0)})
    return rows

def compute_data_freshness(filters):
    # "Data Through" is based on the latest inspection/source date, not UD Date.
    # UD Date is a disposition field and must not be treated as a data-ingestion timestamp.
    conn=get_conn(); cur=conn.cursor()
    where_sql, params=build_where(filters)
    try:
        cur.execute(f"SELECT COUNT(*) FROM disposition {where_sql}", params)
        filtered_records=cur.fetchone()[0] or 0
        cur.execute("SELECT COUNT(*), MAX(NULLIF(TRIM(COALESCE(insp_lot_date,'')),'')) FROM disposition")
        total_records, max_insp=cur.fetchone()
    except Exception:
        cur.execute("SELECT COUNT(*), MAX(insp_lot_date) FROM disposition")
        total_records, max_insp=cur.fetchone()
    latest=max_insp or ''
    display=latest
    try:
        dt=_dt.datetime.strptime(str(latest)[:10], '%Y-%m-%d'); display=dt.strftime('%d-%b-%Y')
    except Exception: pass
    conn.close()
    return {
        'filtered_records': int(filtered_records or 0),
        'total_records': int(total_records or 0),
        'data_through': latest,
        'data_through_display': display,
        'updated_display': display,
        'latest_date': latest
    }

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # keep console quiet

    def _compression_allowed(self):
        return "gzip" in self.headers.get("Accept-Encoding", "").lower()

    def _write_body(self, body, compress=True):
        if compress and len(body) >= 512 and self._compression_allowed():
            encoded = gzip.compress(body, compresslevel=6, mtime=0)
            if len(encoded) < len(body):
                self.send_header("Content-Encoding", "gzip")
                self.send_header("Vary", "Accept-Encoding")
                body = encoded
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_json(self, payload, status=200):
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("X-Request-ID", secrets.token_hex(8))
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self._write_body(body)

    def _send_html(self, html, status=200):
        body = html.encode("utf-8")
        self.send_response(status)
        self.send_header("X-Request-ID", secrets.token_hex(8))
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self._write_body(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        qs = {k: v[0] for k, v in parse_qs(parsed.query).items()}

        # Versioned static CSS/JS: aggressively cached by browsers.
        if path in {"/app.css", "/app.js"}:
            asset = os.path.join(os.path.dirname(os.path.abspath(__file__)), path.lstrip("/"))
            if os.path.isfile(asset):
                mime = "text/css; charset=utf-8" if path.endswith(".css") else "application/javascript; charset=utf-8"
                with open(asset, "rb") as f:
                    body = f.read()
                self.send_response(200)
                self.send_header("Content-Type", mime)
                self.send_header("Cache-Control", "public, max-age=31536000, immutable")
                self.send_header("X-Content-Type-Options", "nosniff")
                self._write_body(body)
                return
            else:
                self.send_error(404)
        # Static browser identity assets (favicon / PWA manifest).
        # These must be served by the Python server; otherwise browser requests
        # for /favicon.ico and /favicon-*.png would fall through to a 404.
        if path in {"/favicon.ico", "/favicon-16.png", "/favicon-32.png", "/favicon-48.png",
                    "/favicon-64.png", "/favicon-128.png", "/favicon-180.png",
                    "/favicon-192.png", "/favicon-256.png", "/favicon-512.png",
                    "/site.webmanifest", "/jsl-header-logo.png", "/jsl-watermark.png"}:
            asset = os.path.join(os.path.dirname(os.path.abspath(__file__)), path.lstrip("/"))
            if os.path.isfile(asset):
                mime = "application/octet-stream"
                if path.endswith(".png"):
                    mime = "image/png"
                elif path.endswith(".ico"):
                    mime = "image/x-icon"
                elif path.endswith(".webmanifest"):
                    mime = "application/manifest+json"
                with open(asset, "rb") as f:
                    body = f.read()
                self.send_response(200)
                self.send_header("Content-Type", mime)
                cache_value = "public, max-age=31536000, immutable" if path.endswith((".png", ".ico")) else "public, max-age=3600"
                self.send_header("Cache-Control", cache_value)
                self.send_header("X-Content-Type-Options", "nosniff")
                self._write_body(body)
                return
            else:
                self.send_error(404)
        elif path == "/" or path == "/index.html":
            _activity_event(self, "dashboard_open", tab="dashboard")
            with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "index.html"),
                       "r", encoding="utf-8") as f:
                self._send_html(f.read())
        elif path in {"/admin", "/admin.html"}:
            # Admin shell is intentionally always served; authentication gates the API/data actions.
            # No-store prevents a stale authenticated/unauthenticated shell from being reused.
            with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "admin.html"), "r", encoding="utf-8") as f:
                body = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
            self.send_header("Pragma", "no-cache")
            self.send_header("X-Content-Type-Options", "nosniff")
            self._write_body(body.encode("utf-8"))
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
        elif path == "/api/fishbone":
            try:
                defects = [d for d in (qs.get("defects", "") or "").split("|") if d.strip()]
                master = _fishbone_master_rows()
                items = [_fishbone_match(d) for d in defects] if defects else []
                self._send_json({
                    "items": items,
                    "master_count": len(master),
                    "master_updated_at": master[0]["updated_at"] if master else None,
                })
            except Exception as e:
                self._send_json({"error": str(e)}, status=500)
        elif path == "/api/activity/live":
            try:
                conn = get_conn()
                if USE_POSTGRES:
                    row = conn.execute("SELECT COUNT(DISTINCT COALESCE(NULLIF(visitor_id,''), NULLIF(ip_address,''))) AS active FROM activity_log WHERE event_type='viewer_heartbeat' AND created_at >= CURRENT_TIMESTAMP - INTERVAL '75 seconds'").fetchone()
                else:
                    row = conn.execute("SELECT COUNT(DISTINCT CASE WHEN COALESCE(visitor_id,'')<>'' THEN visitor_id ELSE ip_address END) AS active FROM activity_log WHERE event_type='viewer_heartbeat' AND datetime(created_at) >= datetime('now','-75 seconds')").fetchone()
                conn.close()
                self._send_json({"active_users": int((row[0] if row else 0) or 0), "window_seconds": 75})
            except Exception as e:
                self._send_json({"active_users": 0, "error": str(e)}, status=200)
        elif path == "/api/drilldown":
            filters = {k: qs.get(k, "All") for k in FILTER_KEYS}
            try:
                metric = qs.get('metric',''); drill_value = qs.get('drill_value'); page=max(1,int(qs.get('page','1') or 1)); page_size=min(500,max(50,int(qs.get('page_size','250') or 250)))
                offset=(page-1)*page_size
                where_sql, base_params=build_where(filters); clauses=[]; extra=[]
                if metric in {'Defect Coils','Defect Rate'}: clauses.append("main_defect <> '' AND main_defect <> 'NO DEFECT'")
                elif metric in {'First Pass Yield % (Prime%)'}: clauses.append("quality_decision = ?"); extra.append('PRIME')
                elif metric in {'Hold for Decision % Qty','Hold For Decision Qty (MT)'}: clauses.append("quality_decision = ?"); extra.append('HOLD FOR DECISION')
                elif metric in {'Reject Qty (MT)','Reject % Qty'}: clauses.append("quality_decision = ?"); extra.append('REJECT')
                elif metric == 'decision_category': clauses.append("quality_decision = ?"); extra.append(drill_value or '')
                elif metric == 'defect_category': clauses.append("main_defect = ?"); extra.append(drill_value or '')
                elif metric == 'heat_detail': clauses.append("UPPER(TRIM(COALESCE(heat_no,''))) = UPPER(TRIM(?))"); extra.append(drill_value or '')
                elif metric == 'quality_investigation':
                    wc=str(qs.get('work_center','All') or 'All').strip(); grade=str(qs.get('grade','All') or 'All').strip(); defect=str(drill_value or '').strip()
                    if wc and wc.lower()!='all': clauses.append('work_center = ?'); extra.append(wc)
                    if grade and grade.lower()!='all': clauses.append('grade = ?'); extra.append(grade)
                    if defect and defect.lower() not in {'all','—','-'}: clauses.append("main_defect = ? AND main_defect <> '' AND main_defect <> 'NO DEFECT'"); extra.append(defect)
                if clauses: where_sql=where_sql+(' AND ' if where_sql else 'WHERE ')+' AND '.join(clauses); base_params+=extra
                conn=get_conn(); cur=conn.cursor(); cur.execute(f"SELECT COUNT(*), COUNT(DISTINCT {HEAT_KEY_SQL}), COALESCE(SUM(output_weight),0) FROM disposition {where_sql}",base_params); total_rows,total_coils,total_weight=cur.fetchone(); conn.close()
                rows=_drilldown_rows(filters, metric, drill_value, limit=page_size, offset=offset)
                self._send_json({'count':int(total_coils or 0),'row_count':int(total_rows or 0),'total_weight':float(total_weight or 0),'rows':rows,'scope':_filter_summary(filters),'page':page,'page_size':page_size,'total_pages':max(1,(int(total_rows or 0)+page_size-1)//page_size)})
            except Exception as e:
                self._send_json({'error':str(e)}, status=500)
        elif path == "/api/drilldown/export":
            try:
                filters = {k: qs.get(k, "All") for k in FILTER_KEYS}
                rows = _drilldown_rows(filters, qs.get('metric',''), qs.get('drill_value'), limit=50000)
                out=io.StringIO(newline=''); w=csv.writer(out)
                w.writerow(['Insp Lot Date','HEAT NO','BATCH NO','Work Center','Grade','Main Defect','Defect Intensity','Quality Decision','Output Weight (MT)'])
                for r in rows: w.writerow([r['insp_lot_date'],r['heat_no'],r['batch_no'],r['work_center'],r['grade'],r['main_defect'],r['defect_intensity'],r['quality_decision'],r['output_weight']])
                _activity_event(self, 'drilldown_export_csv', filters=filters)
                _send_bytes(self,out.getvalue().encode('utf-8-sig'),'text/csv; charset=utf-8','drilldown_records.csv')
            except Exception as e:
                self._send_json({'error':str(e)}, status=500)
        elif path == "/api/qcr":
            filters = {k: qs.get(k, "All") for k in FILTER_KEYS}
            cache_key = "qcr:" + json.dumps(filters, sort_keys=True, separators=(",", ":"))
            now = time.time(); hit = RESPONSE_CACHE.get(cache_key)
            if hit and now-hit[0] < RESPONSE_CACHE_TTL:
                self._send_json(hit[1]); return
            try:
                # Consolidated QCR endpoint: run the five SQLite reads sequentially.
                # The previous threaded fan-out could intermittently return empty/partial
                # QCR sections on SQLite deployments because multiple connections were
                # hitting the same database at once. Sequential reads are deterministic
                # and keep the QCR data identical to the main dashboard calculations.
                #
                # Each section is isolated: a failure computing any single section
                # (k/d/w/m/fr) must never blank the entire Control Room. Instead we
                # fall back to an empty-but-well-formed structure for that section
                # and record the error so the client can show a precise message.
                section_errors = {}

                def _safe(name, fn, default):
                    try:
                        return fn()
                    except Exception as exc:
                        section_errors[name] = str(exc)[:240]
                        print(f"QCR section '{name}' degraded:", section_errors[name])
                        return default

                k = _safe("k", lambda: compute_kpis(filters), {"kpis": []})
                d = _safe("d", lambda: compute_defect_analysis(filters), {
                    "register": [], "pareto": [], "totals": {"records": 0, "qty": 0},
                    "register_total": {"defect": "Grand Total", "records": 0, "qty": 0, "pct_records": 0.0},
                    "pareto_total": {"defect": "Total (Top 10)", "records": 0, "qty": 0, "pct": 0.0, "cum_pct": 0.0},
                })
                w = _safe("w", lambda: compute_work_center_grade(filters), {
                    "by_work_center": [], "by_grade": [], "total_work_center": {}, "total_grade": {},
                })
                m = _safe("m", lambda: compute_monthly_trend(filters), {"rows": []})
                fr = _safe("fr", lambda: compute_data_freshness(filters), {
                    "filtered_records": 0, "total_records": 0, "data_through": "",
                    "data_through_display": "—", "updated_display": "—", "latest_date": "",
                })
                # Intelligence is deliberately isolated from the core QCR payload.
                # A failure in an optional analytics calculation must never blank the
                # entire Control Room.
                try:
                    intel=compute_qcr_intelligence(filters, m, d, w, k.get("kpis", []))
                    intel_error = ""
                except Exception as intel_exc:
                    intel = {"comparison":{"current":None,"previous":None,"rows":[]},"why_changed":None,
                             "forecast":{},"early_warnings":[],"kpi_ranking":[],
                             "health_score":{"score":0,"status":"amber","reasons":[],"components":[]},
                             "risk_matrix":{"work_centers":[],"grades":[]},"recurring_patterns":[]}
                    intel_error = str(intel_exc)[:240]
                    print("QCR intelligence degraded:", intel_error)
                payload = {"k": k, "d": d, "w": w, "m": m, "fr": fr, "intel": intel,
                           "intel_error": intel_error, "section_errors": section_errors}
                # A payload with degraded sections is still real data for the sections
                # that succeeded, so it is safe (and useful) to cache and return as-is.
                RESPONSE_CACHE[cache_key] = (now, payload)
                if len(RESPONSE_CACHE) > 100:
                    oldest = sorted(RESPONSE_CACHE.items(), key=lambda x:x[1][0])[:20]
                    for k,_ in oldest: RESPONSE_CACHE.pop(k, None)
                self._send_json(payload)
            except Exception as e: self._send_json({"error": str(e)}, status=500)
        elif path == "/api/root_cause":
            filters = {k: qs.get(k, "All") for k in FILTER_KEYS}; defect = qs.get("defect", "").strip()
            if not defect: self._send_json({"error":"defect required"}, status=400); return
            try:
                where, params = build_where(filters)
                conn=get_conn(); cur=conn.cursor(); extra=(where + (" AND " if where else "WHERE ") + "main_defect = ?")
                p=params+[defect]
                cur.execute(f"SELECT grade, work_center, COUNT(DISTINCT {HEAT_KEY_SQL}) coils, COALESCE(SUM(output_weight),0) qty FROM disposition {extra} GROUP BY grade,work_center ORDER BY qty DESC LIMIT 10",p)
                paths=[{"grade":r[0] or "—","work_center":r[1] or "—","coils":int(r[2] or 0),"qty":float(r[3] or 0)} for r in cur.fetchall()]
                cur.execute(f"SELECT heat_no,batch_no,grade,work_center,COALESCE(SUM(output_weight),0) qty,COUNT(*) rows FROM disposition {extra} GROUP BY heat_no,batch_no,grade,work_center ORDER BY qty DESC LIMIT 20",p)
                records=[{"heat_no":r[0] or "","batch_no":r[1] or "","grade":r[2] or "—","work_center":r[3] or "—","qty":float(r[4] or 0),"rows":int(r[5] or 0)} for r in cur.fetchall()]
                conn.close(); self._send_json({"defect":defect,"paths":paths,"records":records})
            except Exception as e: self._send_json({"error":str(e)},status=500)
        elif path == "/api/data_freshness":
            filters = {k: qs.get(k, "All") for k in FILTER_KEYS}
            try: self._send_json(compute_data_freshness(filters))
            except Exception as e: self._send_json({"error": str(e)}, status=500)
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
        elif path == "/api/export/pptx":
            try:
                payload = _export_data(_export_filters(qs))
                _activity_event(self, "export_pptx", filters=payload["filters"])
                _send_bytes(self, _pptx_report(payload), "application/vnd.openxmlformats-officedocument.presentationml.presentation", _safe_filename(payload["filters"], ".pptx"))
            except Exception as e:
                self._send_json({"error": str(e)}, status=500)
        elif path == "/api/export/csv":
            try:
                filters = _export_filters(qs); where_sql, params = build_where(filters)
                conn = get_conn(); cur = conn.cursor(); cur.execute(f"SELECT insp_lot_date,heat_no,batch_no,work_center,grade,output_weight,main_defect,defect_intensity,quality_decision,month,week,quarter,financial_year FROM disposition {where_sql} ORDER BY id", params); rows=cur.fetchall(); conn.close()
                out=io.StringIO(newline=''); w=csv.writer(out); w.writerow(["Insp Lot Date","HEAT NO","BATCH NO","Work Center","Grade","Output Weight (MT)","Main Defect","Defect Intensity","Quality Decision","Month","Week","Quarter","Financial Year"]); [w.writerow(list(r)) for r in rows]
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
        elif path == "/api/qcr_target_history":
            try:
                filters={k: qs.get(k,"All") for k in FILTER_KEYS}
                monthly=compute_monthly_trend(filters)
                target=float(get_kpi_targets().get("First Pass Yield % (Prime%)",{}).get("target") or 0.97)
                history=[]
                for r in monthly.get("rows",[]):
                    actual=float(r.get("first_pass_yield_pct") or 0)
                    history.append({"period":r.get("name"),"target":target,"actual":actual,"attainment":(actual/target if target else 0),"gap_pp":(actual-target)*100})
                self._send_json({"target":target,"rows":history})
            except Exception as e: self._send_json({"error":str(e)},status=500)
        elif path == "/api/kpi_targets":
            try:
                self._send_json({"targets": get_kpi_targets()})
            except Exception as e:
                self._send_json({"error": str(e)}, status=500)
        elif path == "/api/admin/home":
            if not _is_admin(self): _auth_error(self)
            else:
                try:
                    conn=get_conn()
                    total=conn.execute("SELECT COUNT(*) FROM disposition").fetchone()[0]
                    last=conn.execute("SELECT MAX(created_at) FROM import_history").fetchone()[0] or conn.execute("SELECT MAX(insp_lot_date) FROM disposition WHERE insp_lot_date <> ''").fetchone()[0]
                    admins=conn.execute("SELECT COUNT(*) FROM users WHERE active=1 AND role='admin'").fetchone()[0]
                    last_login=conn.execute("SELECT MAX(created_at) FROM activity_log WHERE event_type='admin_login'").fetchone()[0]
                    failed=conn.execute("SELECT COUNT(*) FROM activity_log WHERE event_type='admin_login_failed'").fetchone()[0]
                    views=conn.execute("SELECT COUNT(*) FROM activity_log WHERE event_type='dashboard_open'").fetchone()[0]
                    imports=conn.execute("SELECT COUNT(*) FROM import_history").fetchone()[0]
                    conn.close()
                    ds=database_status()
                    self._send_json({"total_records":total,"last_data_update":last or "—","database_size_mb":ds.get("used_mb",0),"active_admins":admins,"dashboard_views":views,"last_login":last_login or "—","failed_login_attempts":failed,"imports":imports})
                except Exception as e: self._send_json({"error":str(e)},status=500)
        elif path == "/api/admin/data_quality":
            if not _is_admin(self): _auth_error(self)
            else:
                try:
                    conn=get_conn()
                    rows=conn.execute("SELECT id,heat_no,batch_no,grade,quality_decision,output_weight,insp_lot_date,defect_intensity,work_center,main_defect FROM disposition").fetchall()
                    conn.close()
                    valid_decisions={"PRIME","FOR NEXT PROCESS","SALVAGE","HOLD FOR DECISION","REJECT","RE-WORK","DIVERT"}
                    counts={k:0 for k in ["missing_heat_no","duplicate_heat_batch","missing_grade","missing_decision","missing_weight","invalid_dates","missing_intensity","invalid_values"]}
                    bad_ids=set(); pairs={}
                    for r in rows:
                        d=dict(r); rid=d.get("id")
                        heat=str(d.get("heat_no") or "").strip(); batch=str(d.get("batch_no") or "").strip()
                        if not heat: counts["missing_heat_no"]+=1; bad_ids.add(rid)
                        if not str(d.get("grade") or "").strip(): counts["missing_grade"]+=1; bad_ids.add(rid)
                        dec=str(d.get("quality_decision") or "").strip().upper()
                        if not dec: counts["missing_decision"]+=1; bad_ids.add(rid)
                        elif dec not in valid_decisions: counts["invalid_values"]+=1; bad_ids.add(rid)
                        wt=d.get("output_weight")
                        if wt is None or (isinstance(wt,(int,float)) and (not math.isfinite(float(wt)) or float(wt)<0)): counts["missing_weight"]+=1; bad_ids.add(rid)
                        datev=str(d.get("insp_lot_date") or "").strip()
                        invalid_date=False
                        if not datev: invalid_date=True
                        else:
                            try: datetime.strptime(datev[:10], "%Y-%m-%d")
                            except Exception: invalid_date=True
                        if invalid_date: counts["invalid_dates"]+=1; bad_ids.add(rid)
                        if not str(d.get("defect_intensity") or "").strip(): counts["missing_intensity"]+=1; bad_ids.add(rid)
                        if not str(d.get("work_center") or "").strip() or (not str(d.get("main_defect") or "").strip()): counts["invalid_values"]+=1; bad_ids.add(rid)
                        if heat and batch: pairs.setdefault((heat.upper(),batch.upper()),[]).append(rid)
                    dup_groups=[]
                    for key,ids in pairs.items():
                        if len(ids)>1:
                            counts["duplicate_heat_batch"] += len(ids)-1
                            bad_ids.update(ids[1:]); dup_groups.append({"heat_no":key[0],"batch_no":key[1],"count":len(ids)})
                    total=len(rows); corrections=len(bad_ids)
                    issue_total=sum(counts.values())
                    score=round(max(0,100*(1-(corrections/max(total,1)))),1)
                    self._send_json({"total":total,"score":score,"records_require_correction":corrections,"issues":counts,"duplicate_heat":[*sorted(dup_groups,key=lambda x:x["count"],reverse=True)[:20]]})
                except Exception as e: self._send_json({"error":str(e)},status=500)
        elif path == "/api/admin/import_history":
            if not _is_admin(self): _auth_error(self)
            else:
                try:
                    conn=get_conn(); rows=conn.execute("SELECT id,filename,detected,valid,duplicates,errors,updated,imported,imported_by,created_at FROM import_history ORDER BY id DESC LIMIT 100").fetchall(); conn.close(); self._send_json({"rows":[dict(r) for r in rows]})
                except Exception as e: self._send_json({"error":str(e)},status=500)
        elif path == "/api/admin/kpi_target_history":
            if not _is_admin(self): _auth_error(self)
            else:
                try:
                    conn=get_conn(); rows=conn.execute("SELECT label,old_target,new_target,changed_by,effective_date,changed_at FROM kpi_target_history ORDER BY id DESC LIMIT 100").fetchall(); conn.close(); self._send_json({"rows":[dict(r) for r in rows]})
                except Exception as e: self._send_json({"error":str(e)},status=500)
        elif path == "/api/admin/fishbone_master":
            if not _is_admin(self): _auth_error(self)
            else:
                try:
                    rows = _fishbone_master_rows(force=True)
                    self._send_json({"rows": rows, "count": len(rows)})
                except Exception as e: self._send_json({"error": str(e)}, status=500)
        elif path == "/api/admin/fishbone_history":
            if not _is_admin(self): _auth_error(self)
            else:
                try:
                    conn = get_conn()
                    rows = conn.execute("SELECT id,filename,detected,imported,imported_by,created_at FROM fishbone_import_history ORDER BY id DESC LIMIT 50").fetchall()
                    conn.close(); self._send_json({"rows": [dict(r) for r in rows]})
                except Exception as e: self._send_json({"error": str(e)}, status=500)
        elif path == "/api/admin/fishbone_alias":
            if not _is_admin(self): _auth_error(self)
            else:
                try:
                    conn = get_conn()
                    rows = conn.execute("SELECT id,disposition_defect,master_defect,created_by,created_at FROM fishbone_alias ORDER BY id DESC").fetchall()
                    conn.close(); self._send_json({"rows": [dict(r) for r in rows]})
                except Exception as e: self._send_json({"error": str(e)}, status=500)
        elif path == "/api/admin/fishbone_unmapped":
            # Top defects (by qty, last 12 months of data) that do not have a
            # confident 6M master match — helps the admin decide which manual
            # alias mappings are worth adding.
            if not _is_admin(self): _auth_error(self)
            else:
                try:
                    conn = get_conn(); cur = conn.cursor()
                    cur.execute("SELECT main_defect, COALESCE(SUM(output_weight),0) qty FROM disposition WHERE TRIM(COALESCE(main_defect,''))<>'' AND main_defect<>'NO DEFECT' GROUP BY main_defect ORDER BY qty DESC LIMIT 40")
                    rows = cur.fetchall(); conn.close()
                    master_names = [r["defect_name"] for r in _fishbone_master_rows()]
                    out = []
                    for r in rows:
                        m = _fishbone_match(r[0])
                        if not m["matched"] or m["match_type"] == "fuzzy":
                            out.append({"defect": r[0], "qty": float(r[1] or 0), "match_type": m["match_type"], "suggested": m.get("matched_defect")})
                    self._send_json({"rows": out, "master_defects": master_names})
                except Exception as e: self._send_json({"error": str(e)}, status=500)
        elif path == "/api/admin/kpi_targets":
            if not _is_admin(self): _auth_error(self)
            else:
                try: self._send_json({"targets": get_kpi_targets()})
                except Exception as e: self._send_json({"error":str(e)},status=500)
        elif path == "/api/admin/export_audit":
            if not _is_admin(self): _auth_error(self)
            else:
                try:
                    conn=get_conn(); rows=conn.execute("SELECT COALESCE(NULLIF(a.ip_address,''),'Unknown') ip_address,COALESCE(u.username,'Anonymous') username,a.event_type,a.tab,a.created_at,a.user_agent FROM activity_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 5000").fetchall(); conn.close()
                    out=io.StringIO(newline=''); w=csv.writer(out); w.writerow(["Time","User","IP Address","Action","Tab","User Agent"]); [w.writerow([r[4],r[1],r[0],r[2],r[3],r[5]]) for r in rows]
                    data=out.getvalue().encode('utf-8-sig'); self.send_response(200); self.send_header('Content-Type','text/csv; charset=utf-8'); self.send_header('Content-Disposition','attachment; filename="admin_audit_log.csv"'); self.send_header('Content-Length',str(len(data))); self.send_header('Cache-Control','no-store'); self.end_headers(); self.wfile.write(data)
                except Exception as e: self._send_json({"error":str(e)},status=500)
        elif path == "/api/admin/audit_trail":
            if not _require_role(self,"admin","auditor"): return
            try:
                conn=get_conn(); rows=conn.execute("SELECT username,role,action,record_id,details,ip_address,user_agent,created_at FROM audit_trail ORDER BY id DESC LIMIT 5000").fetchall(); conn.close(); self._send_json({"rows":[dict(r) for r in rows]})
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
                    rows = conn.execute("SELECT id,insp_lot_date,heat_no,batch_no,work_center,grade,output_weight,main_defect,defect_intensity,quality_decision,month,week,quarter,financial_year FROM disposition ORDER BY id").fetchall()
                    conn.close()
                    out = io.StringIO(newline='')
                    writer = csv.writer(out)
                    writer.writerow(["ID","Insp Lot Date","HEAT NO","BATCH NO","Work Center","Grade","Output Weight (MT)","Main Defect","Defect Intensity","Quality Decision","Month","Week","Quarter","Financial Year"])
                    for r in rows:
                        d = dict(r)
                        writer.writerow([d.get(k, "") for k in ["id","insp_lot_date","heat_no","batch_no","work_center","grade","output_weight","main_defect","defect_intensity","quality_decision","month","week","quarter","financial_year"]])
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
        if path.startswith("/api/admin/") and path not in ("/api/admin/login",):
            if not _admin_post_allowed(self):
                return

        if path == "/api/viewer/login":
            try:
                body = _json_body(self); username = str(body.get("username","")).strip(); password = str(body.get("password",""))
                conn=get_conn(); row=conn.execute("SELECT id,username,display_name,password_hash,role,active FROM users WHERE username=?",(username,)).fetchone()
                conn.close()
                env_login = bool(ADMIN_PASSWORD and hmac.compare_digest(username, ADMIN_USERNAME) and hmac.compare_digest(password, ADMIN_PASSWORD) and (not row or bool(row[5])))
                valid = env_login or bool(row and bool(row[5]) and row[4] in ("viewer", "admin") and _verify_password(password,row[3]))
                if valid:
                    role = "admin" if env_login else row[4]
                    uid = row[0] if row else None
                    display = "Administrator" if env_login else row[2]
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

        if path == "/api/admin/change_password":
            if not _is_admin(self): _auth_error(self); return
            try:
                body = _json_body(self)
                current = str(body.get("current_password", ""))
                new_password = str(body.get("new_password", ""))
                if not _strong_password(new_password):
                    raise ValueError("New password must be at least 12 characters and include uppercase, lowercase, number and special character")
                token = _cookie_value(self.headers.get("Cookie", ""), "qdash_admin")
                meta = SESSIONS.get(token, {})
                conn = get_conn(); row = conn.execute("SELECT id,password_hash FROM users WHERE username=?", (meta.get("username", ADMIN_USERNAME),)).fetchone()
                current_ok = bool(row and _verify_password(current, row[1]))
                if not current_ok and ADMIN_PASSWORD and hmac.compare_digest(current, ADMIN_PASSWORD) and meta.get("username") == ADMIN_USERNAME:
                    current_ok = True
                if not current_ok:
                    conn.close(); self._send_json({"error":"Current password is incorrect"}, status=401); return
                conn.execute("UPDATE users SET password_hash=? WHERE id=?", (_hash_password(new_password), row[0])); conn.commit(); conn.close()
                current_token = _cookie_value(self.headers.get("Cookie", ""), "qdash_admin")
                for tok, smeta in list(SESSIONS.items()):
                    if tok != current_token and smeta.get("username") == meta.get("username"):
                        SESSIONS.pop(tok, None)
                meta["expires"] = _dt.datetime.now().timestamp() + SESSION_TTL
                _activity_event(self, "admin_password_changed")
                self._send_json({"ok":True,"message":"Password changed. Please sign in again on other devices."})
            except Exception as e:
                self._send_json({"error":str(e)}, status=400)
            return

        if path == "/api/admin/users":
            if not _is_admin(self): _auth_error(self); return
            try:
                conn=get_conn(); rows=conn.execute("SELECT id,username,display_name,role,active,created_at FROM users ORDER BY role DESC,display_name").fetchall(); conn.close(); self._send_json({"rows":[dict(r) for r in rows]})
            except Exception as e: self._send_json({"error":str(e)},status=500)
            return

        if path == "/api/admin/user":
            if not _require_role(self, "admin"): return
            try:
                body=_json_body(self); username=str(body.get("username","")).strip(); display_name=str(body.get("display_name","")).strip() or username; password=str(body.get("password","")); role=str(body.get("role","viewer"))
                if not username or not password: raise ValueError("Username and password are required")
                if role not in ("viewer","admin","qa_manager","qa_engineer","importer","auditor"): raise ValueError("Invalid role")
                if not _strong_password(password): raise ValueError("Password must be at least 12 characters and include uppercase, lowercase, number and special character")
                conn=get_conn(); conn.execute("INSERT INTO users (username,display_name,password_hash,role,active) VALUES (?,?,?,?,?)",(username,display_name,_hash_password(password),role,True)); conn.commit(); conn.close(); _audit(self,"user_create",details={"username":username,"role":role}); self._send_json({"ok":True})
            except Exception as e: self._send_json({"error":str(e)},status=400)
            return

        if path == "/api/admin/user_toggle":
            if not _require_role(self, "admin"): return
            try:
                body=_json_body(self); uid=int(body.get("id")); active=bool(body.get("active")); conn=get_conn()
                row=conn.execute("SELECT id,username,role,active FROM users WHERE id=?",(uid,)).fetchone()
                if not row: conn.close(); self._send_json({"error":"User not found"},status=404); return
                if not active and row[2] == "admin":
                    admins=conn.execute("SELECT COUNT(*) FROM users WHERE role='admin' AND active=1").fetchone()[0]
                    if admins <= 1: conn.close(); self._send_json({"error":"At least one active administrator must remain."},status=400); return
                current_token=_cookie_value(self.headers.get("Cookie",""),"qdash_admin"); current_meta=SESSIONS.get(current_token,{})
                if not active and row[1] == current_meta.get("username"):
                    conn.close(); self._send_json({"error":"You cannot disable your own active administrator account."},status=400); return
                conn.execute("UPDATE users SET active=? WHERE id=?",(active,uid)); conn.commit(); conn.close(); _audit(self,"user_toggle",record_id=uid,details={"active":active}); self._send_json({"ok":True})
            except Exception as e: self._send_json({"error":str(e)},status=400)
            return

        if path == "/api/login":
            try:
                ip = _client_ip(self)
                allowed, retry_after = _login_allowed(ip)
                if not allowed:
                    self._send_json({"error": f"Too many failed login attempts. Try again in about {retry_after} seconds."}, status=429)
                    return
                body = _json_body(self)
                username = str(body.get("username", "")).strip()
                password = str(body.get("password", ""))
                conn = get_conn()
                row = conn.execute("SELECT id,username,display_name,password_hash,role,active FROM users WHERE username=?", (username,)).fetchone()
                conn.close()
                valid = bool(row and bool(row[5]) and row[4] in ("admin", "qa_manager", "qa_engineer", "importer", "auditor") and _verify_password(password, row[3]))
                if not valid and ADMIN_PASSWORD and hmac.compare_digest(username, ADMIN_USERNAME) and hmac.compare_digest(password, ADMIN_PASSWORD) and (not row or bool(row[5])):
                    valid = True
                if valid:
                    _clear_login_failures(ip)
                    token = secrets.token_urlsafe(32)
                    csrf = secrets.token_urlsafe(32)
                    now = _dt.datetime.now().timestamp()
                    display = row[2] if row else "Administrator"
                    SESSIONS[token] = {"username": username or ADMIN_USERNAME, "display_name": display, "role": (row[4] if row else "admin"), "user_id": (row[0] if row else None), "active": True, "expires": now + SESSION_TTL, "csrf": csrf}
                    secure = self.headers.get("X-Forwarded-Proto", "").lower() == "https"
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json; charset=utf-8")
                    self.send_header("Cache-Control", "no-store")
                    self.send_header("X-Content-Type-Options", "nosniff")
                    self.send_header("Set-Cookie", f"qdash_admin={token}; Path=/; HttpOnly; SameSite=Strict" + ("; Secure" if secure else ""))
                    self.send_header("Set-Cookie", f"{CSRF_COOKIE}={csrf}; Path=/; SameSite=Strict" + ("; Secure" if secure else ""))
                    data = json.dumps({"authenticated": True, "username": username or ADMIN_USERNAME, "display_name": display, "role": (row[4] if row else "admin")}).encode("utf-8")
                    self.send_header("Content-Length", str(len(data)))
                    self.end_headers(); self.wfile.write(data)
                    _activity_event(self, "admin_login")
                else:
                    _record_login_failure(ip)
                    _activity_event(self, "admin_login_failed", tab="Admin")
                    self._send_json({"error": "Invalid administrator credentials"}, status=401)
            except Exception as e:
                self._send_json({"error": str(e)}, status=400)
            return

        if path == "/api/logout":
            token = _cookie_value(self.headers.get("Cookie", ""), "qdash_admin")
            SESSIONS.pop(token, None)
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Set-Cookie", "qdash_admin=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict")
            self.send_header("Set-Cookie", f"{CSRF_COOKIE}=; Path=/; Max-Age=0; SameSite=Strict")
            self.end_headers()
            self.wfile.write(b'{"authenticated":false}')
            return

        if path == "/api/activity/event":
            if not _is_viewer(self): _viewer_auth_error(self); return
            try:
                body=_json_body(self); _activity_event(self,str(body.get("event_type","event")),str(body.get("tab","")),body.get("filters") or {},str(body.get("visitor_id",""))); self._send_json({"ok":True})
            except Exception as e: self._send_json({"error":str(e)},status=400)
            return

        if path == "/api/activity/heartbeat":
            if not _is_viewer(self): _viewer_auth_error(self); return
            try:
                body=_json_body(self); visitor_id=str(body.get("visitor_id","")).strip()
                if not visitor_id or len(visitor_id)>100:
                    self._send_json({"error":"visitor_id required"},status=400); return
                tab=str(body.get("tab","dashboard"))[:50]
                _activity_event(self,"viewer_heartbeat",tab,{},visitor_id)
                self._send_json({"ok":True})
            except Exception as e: self._send_json({"error":str(e)},status=400)
            return

        if not _is_admin(self):
            _auth_error(self)
            return

        if path == "/api/admin/kpi_target":
            if not _require_role(self, "admin", "qa_manager"): return
            try:
                body=_json_body(self); label=str(body.get("label","")).strip(); direction=str(body.get("direction","higher")).strip().lower()
                if not label: raise ValueError("KPI label is required")
                if direction not in ("higher","lower","neutral"): raise ValueError("Direction must be higher, lower or neutral")
                def num(v):
                    if v in (None,""): return None
                    return float(v)
                target,warning,critical=num(body.get("target")),num(body.get("warning")),num(body.get("critical"))
                if target is None or warning is None or critical is None: raise ValueError("Target, Warning and Critical are required")
                conn=get_conn(); oldrow=conn.execute("SELECT target,warning,critical,direction FROM kpi_targets WHERE label=?",(label,)).fetchone()
                conn.execute("""INSERT INTO kpi_targets(label,target,warning,critical,direction) VALUES(?,?,?,?,?) ON CONFLICT(label) DO UPDATE SET target=excluded.target,warning=excluded.warning,critical=excluded.critical,direction=excluded.direction,updated_at=CURRENT_TIMESTAMP""",(label,target,warning,critical,direction))
                meta=_admin_meta(self) or {}; changed_by=meta.get("username", "Admin")
                if oldrow:
                    conn.execute("""INSERT INTO kpi_target_history(label,old_target,new_target,old_warning,new_warning,old_critical,new_critical,old_direction,new_direction,effective_date,changed_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",(label,oldrow[0],target,oldrow[1],warning,oldrow[2],critical,oldrow[3],direction,str(body.get("effective_date", "")).strip(),changed_by))
                conn.commit(); conn.close(); _activity_event(self,"kpi_target_update",tab="Admin"); _audit(self,"kpi_target_update",details={"label":label,"target":target,"effective_date":str(body.get("effective_date",""))})
                self._send_json({"ok":True,"targets":get_kpi_targets()})
            except Exception as e: self._send_json({"error":str(e)},status=400)
            return

        if path == "/api/admin/record":
            if not _require_role(self, "admin", "qa_engineer", "importer"): return
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

        if path == "/api/admin/import_preview":
            if not _require_role(self, "admin", "qa_engineer", "importer"): return
            try:
                ctype=self.headers.get("Content-Type",""); length=int(self.headers.get("Content-Length","0") or 0); raw=self.rfile.read(length)
                msg=BytesParser(policy=default).parsebytes((f"Content-Type: {ctype}\r\nMIME-Version: 1.0\r\n\r\n").encode()+raw); uploaded=None
                if msg.is_multipart():
                    for part in msg.iter_parts():
                        if "filename=" in part.get("Content-Disposition",""): uploaded=(part.get_filename() or "upload",part.get_payload(decode=True) or b""); break
                if not uploaded: raise ValueError("No file was uploaded")
                records=_parse_uploaded_file(uploaded[0],uploaded[1])
                if len(records)>10000: raise ValueError("Import limited to 10,000 records per upload")
                conn=get_conn(); existing_rows=conn.execute("SELECT heat_no,batch_no,work_center,grade,output_weight,main_defect,defect_intensity,quality_decision,insp_lot_date,ud_date,month,week,quarter,financial_year FROM disposition").fetchall(); existing_map={(str(r[0] or "").strip().upper(),str(r[1] or "").strip().upper()):r for r in existing_rows}; existing_pairs=set(existing_map);
                wcs={str(r[0]).strip() for r in conn.execute("SELECT DISTINCT work_center FROM disposition WHERE TRIM(COALESCE(work_center,''))<>''").fetchall()}; grades={str(r[0]).strip() for r in conn.execute("SELECT DISTINCT grade FROM disposition WHERE TRIM(COALESCE(grade,''))<>''").fetchall()}; conn.close()
                valid=[]; errors=[]; duplicates=0; updated=0; seen=set(); missing_intensity=0; unknown_wc=0; unknown_grade=0; invalid_dates=0
                for idx,r in enumerate(records,start=2):
                    err=_validate_record(r); d=str(r.get("insp_lot_date","")).strip()
                    if d:
                        try: _dt.datetime.fromisoformat(d[:10])
                        except Exception: err=err or "Invalid date"; invalid_dates+=1
                    else: err=err or "Missing inspection date"; invalid_dates+=1
                    if not str(r.get("defect_intensity","")).strip(): missing_intensity+=1
                    if wcs and str(r.get("work_center","")).strip() and str(r.get("work_center")).strip() not in wcs: unknown_wc+=1
                    if grades and str(r.get("grade","")).strip() and str(r.get("grade")).strip() not in grades: unknown_grade+=1
                    pair=(str(r.get("heat_no","")).strip().upper(), str(r.get("batch_no","")).strip().upper())
                    if pair in seen: duplicates+=1
                    elif err: errors.append({"row":idx,"error":err})
                    else:
                        seen.add(pair)
                        if pair in existing_map:
                            oldrow=existing_map[pair]; newvals=[r.get(k,"") for k in ["work_center","grade","output_weight","main_defect","defect_intensity","quality_decision","insp_lot_date","ud_date","month","week","quarter","financial_year"]]
                            oldvals=list(oldrow[2:])
                            if any(str(a if a is not None else "") != str(b if b is not None else "") for a,b in zip(oldvals,newvals)):
                                updated+=1; valid.append(r)
                            else: duplicates+=1
                        else: valid.append(r)
                token=secrets.token_urlsafe(24); IMPORT_PREVIEWS[token]={"created":time.time(),"filename":uploaded[0],"records":valid,"summary":{"detected":len(records),"valid":len(valid),"duplicates":duplicates,"updated":updated,"errors":len(errors),"error_rows":errors[:100],"missing_intensity":missing_intensity,"invalid_dates":invalid_dates,"unknown_work_centers":unknown_wc,"unknown_grades":unknown_grade}}
                self._send_json({"ok":True,"preview_id":token,"filename":uploaded[0],**IMPORT_PREVIEWS[token]["summary"],"sample":[{k:r.get(k,"") for k in ["insp_lot_date","heat_no","work_center","grade","output_weight","main_defect","defect_intensity","quality_decision"]} for r in valid[:25]]})
            except Exception as e: self._send_json({"error":str(e)},status=400)
            return

        if path == "/api/admin/import_confirm":
            if not _require_role(self, "admin", "qa_engineer", "importer"): return
            try:
                body=_json_body(self); pid=str(body.get("preview_id","")); item=IMPORT_PREVIEWS.get(pid)
                if not item or time.time()-item.get("created",0)>IMPORT_PREVIEW_TTL: IMPORT_PREVIEWS.pop(pid,None); raise ValueError("Import preview expired. Please upload the file again.")
                result=_insert_records(item["records"]); meta=_admin_meta(self) or {};
                conn=get_conn(); conn.execute("INSERT INTO import_history(filename,detected,valid,duplicates,errors,updated,imported,imported_by) VALUES(?,?,?,?,?,?,?,?)",(item["filename"],item["summary"]["detected"],item["summary"]["valid"],item["summary"]["duplicates"],item["summary"]["errors"],result.get("updated",item["summary"].get("updated",0)),result["inserted"],meta.get("username","Admin"))); conn.commit(); conn.close(); IMPORT_PREVIEWS.pop(pid,None); _activity_event(self,"data_import_confirm",tab="Admin",filters={"filename":item["filename"],"inserted":result["inserted"]}); _audit(self,"data_import_confirm",details={"filename":item["filename"],"inserted":result["inserted"],"updated":result.get("updated",0)})
                self._send_json({"ok":True,"filename":item["filename"],"detected":item["summary"]["detected"],"inserted":result["inserted"],"updated":result.get("updated",item["summary"].get("updated",0)),"duplicates":item["summary"]["duplicates"],"errors":item["summary"]["errors"]})
            except Exception as e: self._send_json({"error":str(e)},status=400)
            return

        if path == "/api/admin/import":
            if not _require_role(self, "admin", "qa_engineer", "importer"): return
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
                _audit(self,"direct_import",details={"filename":uploaded[0],"detected":len(records),"inserted":result.get("inserted",0),"updated":result.get("updated",0)})
                self._send_json({"ok": True, "detected": len(records), **result})
            except Exception as e:
                self._send_json({"error": str(e)}, status=400)
            return

        if path == "/api/admin/fishbone_import":
            if not _require_role(self, "admin", "qa_engineer", "importer"): return
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
                records = _parse_fishbone_file(uploaded[0], uploaded[1])
                meta = _admin_meta(self) or {}
                result = _replace_fishbone_master(records, uploaded[0], meta.get("username", "Admin"))
                _audit(self, "fishbone_master_import", details={"filename": uploaded[0], "detected": result["detected"], "imported": result["imported"]})
                self._send_json({"ok": True, "filename": uploaded[0], **result})
            except Exception as e:
                self._send_json({"error": str(e)}, status=400)
            return

        if path == "/api/admin/fishbone_alias":
            if not _require_role(self, "admin", "qa_engineer", "importer"): return
            try:
                body = _json_body(self)
                disp_defect = str(body.get("disposition_defect", "")).strip()
                master_defect = str(body.get("master_defect", "")).strip()
                if not disp_defect or not master_defect:
                    raise ValueError("Both a defect name and a 6M master defect are required")
                norm = _norm_defect_key(disp_defect)
                meta = _admin_meta(self) or {}
                conn = get_conn()
                conn.execute("DELETE FROM fishbone_alias WHERE norm_disposition_defect=?", (norm,))
                conn.execute("INSERT INTO fishbone_alias (disposition_defect,norm_disposition_defect,master_defect,created_by) VALUES (?,?,?,?)",
                             (disp_defect, norm, master_defect, meta.get("username", "Admin")))
                conn.commit(); conn.close()
                FISHBONE_CACHE["aliases"] = None
                _audit(self, "fishbone_alias_set", details={"disposition_defect": disp_defect, "master_defect": master_defect})
                self._send_json({"ok": True})
            except Exception as e:
                self._send_json({"error": str(e)}, status=400)
            return

        if path == "/api/admin/fishbone_alias_delete":
            if not _require_role(self, "admin", "qa_engineer", "importer"): return
            try:
                body = _json_body(self)
                aid = int(body.get("id"))
                conn = get_conn()
                conn.execute("DELETE FROM fishbone_alias WHERE id=?", (aid,))
                conn.commit(); conn.close()
                FISHBONE_CACHE["aliases"] = None
                _audit(self, "fishbone_alias_delete", record_id=aid)
                self._send_json({"ok": True})
            except Exception as e:
                self._send_json({"error": str(e)}, status=400)
            return

        if path == "/api/admin/records":
            try:
                body = _json_body(self)
                limit = min(max(int(body.get("limit", 100)), 1), 500)
                conn = get_conn()
                rows = [dict(r) for r in conn.execute("SELECT id,insp_lot_date,heat_no,batch_no,work_center,grade,output_weight,main_defect,defect_intensity,quality_decision,month,week,quarter,financial_year FROM disposition ORDER BY id DESC LIMIT ?", (limit,)).fetchall()]
                total = conn.execute("SELECT COUNT(*) FROM disposition").fetchone()[0]
                conn.close()
                self._send_json({"rows": rows, "total": total})
            except Exception as e:
                self._send_json({"error": str(e)}, status=400)
            return

        if path == "/api/admin/delete":
            if not _require_role(self, "admin", "qa_engineer", "importer"): return
            try:
                body = _json_body(self)
                record_id = int(body.get("id"))
                conn = get_conn()
                cur = conn.execute("DELETE FROM disposition WHERE id=?", (record_id,))
                conn.commit()
                conn.close()
                _audit(self,"record_delete",record_id=record_id)
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
    if not (ADMIN_USERNAME and ADMIN_PASSWORD):
        print("INFO: ADMIN_USERNAME/ADMIN_PASSWORD are not set; administrator authentication will use the existing users table. Set both environment variables for first-time provisioning.")
    print(f"Quality Disposition Dashboard running on port {port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
