import uuid
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
import sys
import re
import difflib
import traceback
import threading

# Safety valve: report/export generation (compute_qcr_intelligence + chart
# rendering + reportlab/openpyxl/python-pptx building) can legitimately need
# a deeper call stack than Python's default 1000-frame limit once several of
# these layers are nested together on a request with a lot of distinct
# grades/work-centers/defects. Raising the ceiling costs nothing on the happy
# path and avoids a spurious "maximum recursion depth exceeded" on otherwise
# well-formed exports.
#
# Raising sys.setrecursionlimit() on its own is not enough to make this safe:
# each Python stack frame also consumes real OS thread-stack memory, and this
# app serves every request on its own thread (ThreadingHTTPServer). If a
# thread's native stack runs out before the higher Python-level limit is
# reached, the interpreter can crash with a hard segfault instead of raising
# a catchable RecursionError -- silently, with no log line and no JSON error
# for the browser to show. threading.stack_size() must be set (BEFORE any
# thread is created) to give every request thread enough real stack headroom
# to safely support the higher recursionlimit below. 64 MiB comfortably
# covers a 10,000-frame Python stack.
try:
    threading.stack_size(64 * 1024 * 1024)
except (ValueError, RuntimeError):
    # Some platforms (or a thread already started before this runs) reject
    # an explicit stack size -- fall back to the platform default rather
    # than crash startup over it.
    pass
if sys.getrecursionlimit() < 10000:
    sys.setrecursionlimit(10000)

# Export concurrency guard: Excel/PDF/PPTX generation is the heaviest thing
# this process does per request -- it holds a DB connection through ~9
# sequential queries, renders several matplotlib figures, and (for PDF/PPTX)
# builds the whole document in memory, all inside a thread that has reserved
# 64 MiB of real stack (see above). On a memory-constrained host, letting an
# unbounded number of these run at once is exactly what turns "one export,
# alone" (fine) into "one export while other people are using the dashboard"
# (RecursionError / OOM-flavored failures) -- the failure mode this was
# actually reported as. Cap how many heavy report builds run at the same
# time; extra requests wait briefly for a slot instead of piling on.
EXPORT_CONCURRENCY = max(1, int(os.environ.get("EXPORT_CONCURRENCY", "2")))
EXPORT_WAIT_TIMEOUT_S = float(os.environ.get("EXPORT_WAIT_TIMEOUT_S", "20"))
_EXPORT_SEMAPHORE = threading.BoundedSemaphore(EXPORT_CONCURRENCY)

import sqlite3

try:
    import psycopg2
    from psycopg2.extras import DictCursor
    from psycopg2.pool import ThreadedConnectionPool
except ImportError:
    psycopg2 = None
    DictCursor = None
    ThreadedConnectionPool = None
import secrets
import hashlib
import hmac
import csv
import io
import zipfile
import shutil
import time
import threading
PG_POOL_INIT_LOCK = threading.RLock()
from datetime import datetime
from email.parser import BytesParser
from email.policy import default
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

from reports import _filter_summary, _safe_filename, _send_bytes, _excel_report, _pdf_report, _pptx_report

def _safe_header_filename(value):
    text = str(value or "download").replace("\r", " ").replace("\n", " ")
    text = re.sub(r"[^A-Za-z0-9._-]+", "_", text).strip("._-")
    return text[:160] or "download"

def _csv_safe_value(value):
    """Return CSV text that spreadsheet programs treat as literal text.
    Numeric values remain numeric; externally supplied strings beginning with
    formula/control prefixes are prefixed with an apostrophe.
    """
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@"):
        return "'" + value
    return value


SERVER_STARTED_AT = time.time()
APP_VERSION = os.environ.get("APP_VERSION", "V60.0")
ADMIN_BUILD_VERSION = APP_VERSION

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
    from matplotlib.patches import FancyBboxPatch
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
USE_POSTGRES = bool(DATABASE_URL)
if os.environ.get("RENDER") and not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is required on Render; refusing silent SQLite fallback")

# IMPORTANT — data persistence: when running on SQLite (no DATABASE_URL), the live
# database must NOT be the same file that ships inside the app bundle
# (APP_DIR/quality.db), and ideally not even inside the app folder at all. This app
# is typically updated by replacing the whole qcr_app folder with a freshly
# extracted zip — which would wipe anything stored inside that folder, including a
# `data/` subfolder. To survive that, the live database defaults to a folder that
# lives OUTSIDE and alongside the app folder (a sibling directory), so replacing
# qcr_app's contents never touches it. If that parent location isn't writable
# (e.g. restrictive hosting permissions), it falls back to a `data/` folder inside
# the app directory. The bundled quality.db is used purely as a one-time seed the
# very first time the app runs with no existing persistent database yet.
_BUNDLED_SEED_DB = os.path.join(APP_DIR, "quality.db")

def _pick_persistent_dir():
    sibling = os.path.join(os.path.dirname(APP_DIR), "qcr_app_persistent_data")
    try:
        os.makedirs(sibling, exist_ok=True)
        probe = os.path.join(sibling, ".write_test")
        with open(probe, "w") as f:
            f.write("ok")
        os.remove(probe)
        return sibling
    except Exception:
        return os.path.join(APP_DIR, "data")

_PERSISTENT_DIR = _pick_persistent_dir()
_DEFAULT_PERSISTENT_DB = os.path.join(_PERSISTENT_DIR, "quality.db")
DB_PATH = os.environ.get("DB_PATH", _DEFAULT_PERSISTENT_DB)
PG_POOL = None
RESPONSE_CACHE = {}
RESPONSE_CACHE_TTL = 10
RESPONSE_CACHE_MAX_ENTRIES = 100
RESPONSE_CACHE_MAX_BYTES = 2 * 1024 * 1024
RESPONSE_CACHE_BYTES = 0
RESPONSE_CACHE_LOCK = threading.RLock()
SESSION_LOCK = threading.RLock()
LOGIN_LOCK = threading.RLock()
ACTIVITY_RATE_LOCK = threading.RLock()
ACTIVITY_RATE = {}
IMPORT_PREVIEW_LOCK = threading.RLock()
DISPOSITION_WRITE_LOCK = threading.RLock()
ACTIVITY_CLEANUP_LOCK = threading.RLock()
ACTIVITY_CLEANUP_LAST = 0.0
BACKUP_WRITE_LOCK = threading.RLock()
AUDIT_CLEANUP_LOCK = threading.RLock()
AUDIT_CLEANUP_LAST = 0.0
MAX_SESSIONS = 5000
MAX_LOGIN_TRACKED_IPS = 10000
MAX_IMPORT_PREVIEWS = 100

# 6M Fishbone (Man/Machine/Material/Method/Measurement/Environment) master
# data cache. The master list only changes when an admin re-imports the
# 6M master workbook, so it is cached in memory and invalidated on import.
FISHBONE_CACHE = {"rows": None, "aliases": None, "loaded_at": 0}
FISHBONE_CAUSE_FIELDS = ["man", "machine", "material", "method", "measurement", "environment"]
FISHBONE_FUZZY_CUTOFF = 0.80

# RCA (Root Cause Analysis / Why-Why) library — imported from the 2nd sheet
# ("RCA_RootCause_Library") of the same 6M Defect Master workbook, one row
# per defect x 6M category. Cached the same way as the fishbone master.
RCA_CACHE = {"rows": None, "loaded_at": 0}
RCA_WHY_FIELDS = ["why1", "why2", "why3", "why4", "why5"]

# 6M icon/color style — imported from the 3rd sheet ("Icon Color Coding") of
# the same workbook. Falls back to these defaults (the diagram's original
# look) until an admin imports a workbook that carries its own colors/icons.
FISHBONE_STYLE_DEFAULTS = {
    "man":         {"label": "Man",         "icon": "👤", "color": "#118DFF"},
    "machine":     {"label": "Machine",     "icon": "⚙️", "color": "#16A34A"},
    "material":    {"label": "Material",    "icon": "📦", "color": "#D97706"},
    "method":      {"label": "Method",      "icon": "📋", "color": "#7C3AED"},
    "measurement": {"label": "Measurement", "icon": "📏", "color": "#DB2777"},
    "environment": {"label": "Environment", "icon": "🌍", "color": "#0891B2"},
}
FISHBONE_STYLE_CACHE = {"rows": None, "loaded_at": 0}


def _ensure_database():
    """Create the persistent local SQLite DB from the bundled seed DB — but only the
    very first time (when it doesn't exist yet). Once created, this file is never
    touched again by app startup, so admin-uploaded disposition data and the 6M
    Fishbone Master survive every future code update/redeploy instead of reverting
    back to the seed data bundled with the app."""
    if USE_POSTGRES:
        return
    if os.path.abspath(DB_PATH) == os.path.abspath(_BUNDLED_SEED_DB):
        # DB_PATH was explicitly pointed at the bundled file itself (env override) —
        # respect that choice, but warn: this file ships with the app and WILL be
        # overwritten by the next code update/redeploy.
        print("WARNING: DB_PATH points at the app-bundled quality.db. This file is "
              "replaced on every app update/redeploy, so uploaded data (disposition "
              "imports, 6M Fishbone Master) will be lost then. Set DB_PATH to a path "
              "outside the app folder, or DATABASE_URL to an external Postgres "
              "database, for data that survives updates.")
        return
    parent = os.path.dirname(DB_PATH)
    if parent:
        os.makedirs(parent, exist_ok=True)
    if not os.path.exists(DB_PATH):
        if os.path.exists(_BUNDLED_SEED_DB):
            shutil.copy2(_BUNDLED_SEED_DB, DB_PATH)
            print(f"Seeded persistent database at {DB_PATH} from bundled quality.db (first run).")
    else:
        print(f"Using existing persistent database at {DB_PATH} (not re-seeded).")

_ensure_database()

# ---- Free, no-extra-service backup system -------------------------------------------
# Since this app may run without a paid persistent disk or external database, backups
# are the safety net: a point-in-time snapshot (disposition + 6M Fishbone Master +
# aliases + KPI targets) is written automatically after every data-changing import, so
# even if the live database is ever lost, the last known-good state can be restored
# from a small JSON file — and the admin can also download/keep copies off-server at
# no cost. Backups live next to the database (inside the persistent `data/` folder),
# never inside the app's bundled files, and old ones are pruned automatically.
BACKUP_DIR = os.path.join(os.path.dirname(DB_PATH) if not USE_POSTGRES else _PERSISTENT_DIR, "backups")
BACKUP_KEEP = int(os.environ.get("BACKUP_KEEP", "20"))
try:
    os.makedirs(BACKUP_DIR, exist_ok=True)
except Exception:
    pass

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
        if filters.get("financial_year", "All") == "All":
            return None
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

def _period_end_date(period_name):
    try:
        dt=_dt.datetime.strptime(str(period_name), "%b-%Y")
        return (_dt.date(dt.year + 1, 1, 1) if dt.month == 12 else _dt.date(dt.year, dt.month + 1, 1)) - _dt.timedelta(days=1)
    except Exception:
        return None

def _historical_kpi_target(label, period_name):
    cfg=get_kpi_targets().get(label) or {}
    default=float(cfg.get("target") or 0)
    end_date=_period_end_date(period_name)
    if not end_date:
        return default
    conn=get_conn()
    try:
        rows=conn.execute("SELECT new_target,effective_date,changed_at,id FROM kpi_target_history WHERE label=? ORDER BY id ASC",(label,)).fetchall()
    finally:
        conn.close()
    best=None
    for row in rows:
        raw=str(row[1] or '').strip() or str(row[2] or '')[:10]
        try:
            changed=_dt.date.fromisoformat(raw[:10])
        except Exception:
            continue
        if changed <= end_date and row[0] is not None:
            best=float(row[0])
    return default if best is None else best

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
    def close(self):
        try: self.cur.close()
        except Exception: pass
    @property
    def rowcount(self): return self.cur.rowcount

class _PGConn:
    def __init__(self, conn, pooled=False): self.conn = conn; self.pooled = pooled
    def cursor(self): return _PGCursor(self.conn.cursor(cursor_factory=DictCursor))
    def execute(self, sql, params=None):
        c=self.cursor(); c.execute(sql, params); return c
    def executemany(self, sql, seq):
        c=self.cursor(); c.executemany(sql, seq); return c
    def commit(self): self.conn.commit()
    def rollback(self): self.conn.rollback()
    def close(self):
        if self.pooled and PG_POOL is not None:
            # If the last statement on this connection raised (bad SQL, a
            # lock_timeout, a dropped network link, etc.), Postgres leaves the
            # session in "current transaction is aborted" state. Returning
            # that connection to the pool as-is means the NEXT unrelated
            # request to borrow it fails immediately too — one transient
            # error then quietly cascades into random, hard-to-reproduce
            # failures anywhere else in the app (exactly the kind of "works
            # here, breaks there" mismatch this was causing). Roll back
            # before returning it so every connection goes back to the pool
            # clean.
            try: self.conn.rollback()
            except Exception:
                try: self.conn.close()
                except Exception: pass
                return
            try: PG_POOL.putconn(self.conn)
            except Exception:
                try: self.conn.close()
                except Exception: pass
        else: self.conn.close()

class _SafeSQLiteCursor(sqlite3.Cursor):
    """A cursor that rolls back its connection the moment a statement fails.

    Without this, a single failed write (a UNIQUE-constraint violation, a bad
    value, anything) leaves SQLite's implicit transaction open but neither
    committed nor rolled back. Every write everywhere else in the app then
    fails with "database is locked" until the process restarts -- a single
    bad request can take down writes for every user until a redeploy. The
    Postgres path already guards against the equivalent failure mode (see
    _PGConn.close() above); this gives SQLite the same guarantee."""
    def execute(self, sql, params=()):
        try:
            return super().execute(sql, params)
        except Exception:
            try: self.connection.rollback()
            except Exception: pass
            raise
    def executemany(self, sql, seq):
        try:
            return super().executemany(sql, seq)
        except Exception:
            try: self.connection.rollback()
            except Exception: pass
            raise

class _SafeSQLiteConnection(sqlite3.Connection):
    def cursor(self, *a, **kw):
        return super().cursor(_SafeSQLiteCursor)
    def execute(self, sql, params=()):
        try:
            return super().execute(sql, params)
        except Exception:
            try: self.rollback()
            except Exception: pass
            raise
    def executemany(self, sql, seq):
        try:
            return super().executemany(sql, seq)
        except Exception:
            try: self.rollback()
            except Exception: pass
            raise

def get_conn():
    global PG_POOL
    if USE_POSTGRES:
        if psycopg2 is None or ThreadedConnectionPool is None:
            raise RuntimeError("PostgreSQL support requires psycopg2-binary.")
        # The HTTP server is multi-threaded. psycopg2's SimpleConnectionPool is
        # explicitly single-threaded; use the thread-safe pool and serialize
        # lazy initialization so two first requests cannot create competing
        # pools. This is a connection-layer fix only; it does not alter any
        # existing data.
        with PG_POOL_INIT_LOCK:
            if PG_POOL is None:
                minconn = max(1, int(os.environ.get("PG_POOL_MIN", "1")))
                maxconn = max(minconn, int(os.environ.get("PG_POOL_MAX", "8")))
                PG_POOL = ThreadedConnectionPool(
                    minconn, maxconn, DATABASE_URL, connect_timeout=10,
                    sslmode=os.environ.get("PGSSLMODE", "require"),
                    application_name="quality-disposition-dashboard",
                    options="-c lock_timeout=8000"
                )
        return _PGConn(PG_POOL.getconn(), pooled=True)
    conn = sqlite3.connect(DB_PATH, timeout=5, check_same_thread=False, factory=_SafeSQLiteConnection)
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
        if key == "defect_intensity" and str(val).strip().upper() == "NONE":
            clauses.append("TRIM(COALESCE(defect_intensity,'')) IN ('', 'NONE')")
        else:
            clauses.append(f"{key} = ?")
            params.append(val)
    where = " AND ".join(clauses)
    return (f"WHERE {where}" if where else "", params)


BATCH_KEY_SQL = "NULLIF(UPPER(TRIM(COALESCE(batch_no,''))), '')"

def _coil_count_sql(where_sql, params):
    """Count coils by unique BATCH NO within the current filter scope.
    Duplicate BATCH NO values are intentionally counted once, regardless of
    how many source rows/heats exist for that batch — BATCH NO is the
    unique coil identifier, whereas one HEAT NO can span several coils."""
    return f"SELECT COUNT(DISTINCT {BATCH_KEY_SQL}) FROM disposition {where_sql}", params

def kpi_threshold_color(label, value):
    status=_kpi_target_status(label,value)
    return {"good":"#16A34A","amber":"#D97706","bad":"#DC2626","neutral":"#118DFF"}.get(status)

def compute_kpis(filters, _skip_prev=False):
    conn = get_conn()
    cur = conn.cursor()
    where_sql, params = build_where(filters)

    # One aggregate scan for overall coils, defects and quantity.
    dc_expr = "CASE WHEN main_defect <> '' AND main_defect <> 'NO DEFECT' THEN " + BATCH_KEY_SQL + " END"
    cur.execute(f"SELECT COUNT(DISTINCT {BATCH_KEY_SQL}), COUNT(DISTINCT {dc_expr}), COALESCE(SUM(output_weight),0) FROM disposition {where_sql}", params)
    total_coils, defect_coils, output_qty = cur.fetchone()

    # One grouped scan for all decision counts and quantities.
    decision_qty = {d: 0.0 for d in DECISION_ORDER}
    decision_coils = {d: 0 for d in DECISION_ORDER}
    cur.execute(f"SELECT quality_decision, COUNT(DISTINCT {BATCH_KEY_SQL}), COALESCE(SUM(output_weight),0) FROM disposition {where_sql} GROUP BY quality_decision", params)
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
    cur.execute(f"SELECT CASE WHEN TRIM(COALESCE(defect_intensity,''))='' THEN 'WITHOUT INTENSITY' ELSE defect_intensity END, COUNT(DISTINCT {BATCH_KEY_SQL}), COALESCE(SUM(output_weight),0) FROM disposition {where_sql} GROUP BY 1", params)
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
        vals = list(dict.fromkeys(vals))
        if key == "month":
            vals.sort(key=_month_sort_key)
        elif key == "week":
            vals.sort(key=_week_sort_key)
        else:
            vals.sort()
        if key == "defect_intensity":
            vals = [v for v in vals if str(v or "").strip().upper() != "NONE"] + ["NONE"]
            vals = list(dict.fromkeys(vals))
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

    cur.execute(f"SELECT COUNT(DISTINCT {BATCH_KEY_SQL}), COALESCE(SUM(output_weight),0) FROM disposition {w2}", p2)
    coils, qty = cur.fetchone()

    dw = w2 + " AND main_defect <> '' AND main_defect <> 'NO DEFECT'"
    cur.execute(f"SELECT COUNT(DISTINCT {BATCH_KEY_SQL}) FROM disposition {dw}", p2)
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
    cur.execute(f"SELECT COUNT(DISTINCT {BATCH_KEY_SQL}), COALESCE(SUM(output_weight),0) FROM disposition {where_sql}", params)
    coils, qty = cur.fetchone()

    dw = where_sql + (" AND " if where_sql else "WHERE ") + "main_defect <> '' AND main_defect <> 'NO DEFECT'"
    cur.execute(f"SELECT COUNT(DISTINCT {BATCH_KEY_SQL}) FROM disposition {dw}", params)
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
    cur.execute(f"SELECT COUNT(DISTINCT {BATCH_KEY_SQL}), COALESCE(SUM(output_weight),0) FROM disposition {dw}", params)
    total_defect_records, total_defect_qty = cur.fetchone()

    # Include canonical defect names plus any new defect names present in the
    # live database (e.g. newly added monthly data), so new categories never
    # disappear from the register/charts.
    #
    # Manually-entered free text is inconsistent in casing/spacing ("Scab",
    # "SCAB ", " scab") -- comparing on TRIM alone let every spelling variant
    # of the same defect count as its own row, so an otherwise small defect
    # list could balloon into thousands of near-duplicate register rows on
    # the full (unfiltered) dataset specifically -- one row per query below,
    # and one more oversized table in every export that includes this
    # register. Normalize on (upper+trim) so variants of the same defect
    # collapse to a single canonical row, keeping the register's size tied
    # to the number of REAL defect categories rather than to typos.
    cur.execute("SELECT DISTINCT main_defect FROM disposition WHERE TRIM(COALESCE(main_defect,'')) <> '' AND UPPER(TRIM(main_defect)) <> 'NO DEFECT'")
    seen_norm = {}
    for r in cur.fetchall():
        raw = r[0]
        if not raw:
            continue
        norm = raw.strip().upper()
        # Prefer a nicely-cased spelling for display, first one wins.
        seen_norm.setdefault(norm, raw.strip())
    canonical_norm = {d.strip().upper(): d for d in MAIN_DEFECTS_FULL_LIST}
    merged = dict(canonical_norm)
    merged.update(seen_norm)  # DB spelling wins for display if it differs in case only
    for norm, display in canonical_norm.items():
        merged[norm] = display  # ...but keep the canonical label itself authoritative
    all_defects = sorted(merged.values())

    register = []
    for defect in all_defects:
        # Match case/whitespace-insensitively (see normalization above) so a
        # canonical defect's count includes every raw spelling variant on
        # file, instead of only the one exact string this loop happens to be
        # holding.
        w2 = where_sql + (" AND " if where_sql else "WHERE ") + "UPPER(TRIM(main_defect)) = UPPER(TRIM(?))"
        cur.execute(f"SELECT COUNT(DISTINCT {BATCH_KEY_SQL}), COALESCE(SUM(output_weight),0) FROM disposition {w2}",
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
    filtered source population: coils are DISTINCT BATCH NOs, while quantity
    measures are summed from source rows. This prevents the Grand Total from
    double-counting a batch that appears in more than one monthly group."""
    conn = get_conn()
    cur = conn.cursor()
    where_sql, params = build_where(filters, exclude={"month"})

    month_clause = where_sql + (" AND " if where_sql else "WHERE ") + "TRIM(COALESCE(month,'')) <> ''"
    cur.execute(f"SELECT DISTINCT month FROM disposition {month_clause}", params)
    months = sorted([r[0] for r in cur.fetchall()], key=_month_sort_key)

    rows = [_group_metrics(cur, where_sql, params, "month", m) for m in months]

    # IMPORTANT: do not sum monthly coil counts. A BATCH NO can occur in more
    # than one month; the WebApp definition of a coil is one unique BATCH NO.
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

    week_clause = where_sql + (" AND " if where_sql else "WHERE ") + "TRIM(COALESCE(week,'')) <> ''"
    cur.execute(f"SELECT DISTINCT week FROM disposition {week_clause}", params)
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

    quarter_clause = where_sql + (" AND " if where_sql else "WHERE ") + "TRIM(COALESCE(quarter,'')) <> ''"
    cur.execute(f"SELECT DISTINCT quarter FROM disposition {quarter_clause} ORDER BY 1", params)
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

    fy_clause = where_sql + (" AND " if where_sql else "WHERE ") + "TRIM(COALESCE(financial_year,'')) <> ''"
    cur.execute(f"SELECT DISTINCT financial_year FROM disposition {fy_clause} ORDER BY 1", params)
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
# Hard cap on any incoming request body (JSON or file upload). Without this, an
# unauthenticated request (e.g. to /api/login, which has no auth check yet at the
# point its body is read) with a large Content-Length could make the server try to
# buffer the whole thing into memory — a simple, effective denial-of-service. This
# is checked once, globally, before ANY handler touches the body.
MAX_REQUEST_BYTES = 30 * 1024 * 1024  # 30 MB — comfortably covers xlsx/csv imports
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

def _generate_temp_password():
    """One-time temporary password for the admin-initiated reset flow. Built from
    secrets.choice (CSPRNG) and guaranteed to pass _strong_password so the user
    is never handed a temp password the app would itself reject."""
    alphabet_upper, alphabet_lower = "ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnpqrstuvwxyz"
    alphabet_digit, alphabet_special = "23456789", "!@#$%&*?-"
    parts = [secrets.choice(alphabet_upper), secrets.choice(alphabet_lower), secrets.choice(alphabet_digit), secrets.choice(alphabet_special)]
    remaining_pool = alphabet_upper + alphabet_lower + alphabet_digit + alphabet_special
    parts += [secrets.choice(remaining_pool) for _ in range(10)]
    secrets.SystemRandom().shuffle(parts)
    return "".join(parts)

def _verify_password(password, stored):
    try:
        salt_hex, digest_hex = str(stored).split(":", 1)
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(digest_hex)
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 180000)
        return hmac.compare_digest(actual, expected)
    except Exception:
        return False

def _activity_allowed(ip, limit=120):
    now = time.time()
    with ACTIVITY_RATE_LOCK:
        rec = ACTIVITY_RATE.get(ip)
        if not rec or now - rec[0] >= 60:
            ACTIVITY_RATE[ip] = [now, 1]
            if len(ACTIVITY_RATE) > 10000:
                victims = sorted(ACTIVITY_RATE.items(), key=lambda kv: kv[1][0])[:2000]
                for k, _ in victims:
                    ACTIVITY_RATE.pop(k, None)
            return True
        rec[1] += 1
        return rec[1] <= limit

def _cleanup_sessions():
    now = _dt.datetime.now().timestamp()
    with SESSION_LOCK:
        for token, meta in list(SESSIONS.items()):
            if meta.get("expires", 0) < now:
                SESSIONS.pop(token, None)
        # Hard cap protects a long-lived process from unbounded anonymous/session
        # growth. Prefer removing the oldest-expiring entries; never touch live
        # sessions unless the configured cap is actually exceeded.
        if len(SESSIONS) > MAX_SESSIONS:
            excess = len(SESSIONS) - MAX_SESSIONS
            victims = sorted(SESSIONS.items(), key=lambda kv: kv[1].get("expires", 0))[:excess]
            for token, _ in victims:
                SESSIONS.pop(token, None)

def _login_allowed(ip):
    now = time.time()
    with LOGIN_LOCK:
        rec = LOGIN_ATTEMPTS.get(ip, {"count": 0, "window": now})
        if now - rec.get("window", now) >= LOGIN_WINDOW:
            rec = {"count": 0, "window": now}
        if rec.get("count", 0) >= LOGIN_MAX_ATTEMPTS:
            LOGIN_ATTEMPTS[ip] = rec
            return False, int(max(1, LOGIN_WINDOW - (now - rec.get("window", now))))
        LOGIN_ATTEMPTS[ip] = rec
        if len(LOGIN_ATTEMPTS) > MAX_LOGIN_TRACKED_IPS:
            oldest = sorted(LOGIN_ATTEMPTS.items(), key=lambda kv: kv[1].get("window", now))[:len(LOGIN_ATTEMPTS)-MAX_LOGIN_TRACKED_IPS]
            for key, _ in oldest:
                LOGIN_ATTEMPTS.pop(key, None)
        return True, 0

def _record_login_failure(ip):
    now = time.time()
    with LOGIN_LOCK:
        rec = LOGIN_ATTEMPTS.get(ip, {"count": 0, "window": now})
        if now - rec.get("window", now) >= LOGIN_WINDOW:
            rec = {"count": 0, "window": now}
        rec["count"] = rec.get("count", 0) + 1
        LOGIN_ATTEMPTS[ip] = rec

def _clear_login_failures(ip):
    with LOGIN_LOCK:
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
    with SESSION_LOCK:
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
        return dict(meta)

def _is_admin(handler):
    return _admin_meta(handler) is not None

def _cleanup_activity_log(conn, keep=10000):
    """Bound activity history without allowing retention cleanup to break writes."""
    try:
        limit_n = max(100, min(int(keep), 1000000))
        conn.execute(
            f"DELETE FROM activity_log WHERE id NOT IN "
            f"(SELECT id FROM activity_log ORDER BY id DESC LIMIT {limit_n})"
        )
        conn.commit()
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass

def _cleanup_audit_trail(keep=None):
    global AUDIT_CLEANUP_LAST
    keep_n = max(1000, min(int(keep or os.environ.get("AUDIT_RETENTION_MAX", "100000")), 1000000))
    now = time.time()
    with AUDIT_CLEANUP_LOCK:
        if now - AUDIT_CLEANUP_LAST < 300:
            return
        AUDIT_CLEANUP_LAST = now
    conn = None
    try:
        conn = get_conn()
        conn.execute("DELETE FROM audit_trail WHERE id NOT IN (SELECT id FROM audit_trail ORDER BY id DESC LIMIT ?)", (keep_n,))
        conn.commit()
    except Exception:
        try:
            if conn is not None: conn.rollback()
        except Exception:
            pass
    finally:
        try:
            if conn is not None: conn.close()
        except Exception:
            pass

def _audit(handler, action, record_id=None, details=None):
    """Immutable-style sensitive-action audit record with user, time, IP and optional record."""
    try:
        meta=_admin_meta(handler) or {}
        conn=get_conn()
        conn.execute("INSERT INTO audit_trail (user_id,username,role,action,record_id,details,ip_address,user_agent) VALUES (?,?,?,?,?,?,?,?)",
                     (meta.get("user_id"),meta.get("username","Anonymous"),meta.get("role",""),str(action),record_id,json.dumps(details or {},ensure_ascii=False),_client_ip(handler),handler.headers.get("User-Agent","")[:500]))
        conn.commit(); conn.close()
        _cleanup_audit_trail()
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
    with SESSION_LOCK:
        meta = SESSIONS.get(token)
        if not meta or meta.get("role") not in ("viewer", "admin", "qa_manager", "qa_engineer", "importer", "auditor"):
            return None
        if meta.get("expires", 0) < _dt.datetime.now().timestamp():
            SESSIONS.pop(token, None)
            return None
        return dict(meta)

def _is_viewer(handler):
    # Viewer authentication is currently disabled by design. The dashboard is
    # open to everyone; activity is tracked by IP address instead.
    return True

def _client_ip(handler):
    """Return the client IP. Forwarded headers are trusted only when the app
    is configured behind a trusted reverse proxy (Render by default)."""
    trust_proxy = str(os.environ.get("TRUST_PROXY_HEADERS", "false")).lower() in ("1","true","yes","on")
    if trust_proxy:
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
    global ACTIVITY_CLEANUP_LAST
    try:
        conn = get_conn()
        meta = _viewer_meta(handler)
        user_id = meta.get("user_id") if meta else None
        conn.execute("INSERT INTO activity_log (user_id,event_type,tab,filters_json,user_agent,ip_address,visitor_id) VALUES (?,?,?,?,?,?,?)",
                     (user_id, event_type, tab or "", json.dumps(filters or {}, separators=(",",":")),
                      (handler.headers.get("User-Agent", "")[:300]), _client_ip(handler), str(visitor_id or "")[:100]))
        conn.commit(); conn.close()
        now = time.time(); should_cleanup = False
        with ACTIVITY_CLEANUP_LOCK:
            if now - ACTIVITY_CLEANUP_LAST >= 300:
                ACTIVITY_CLEANUP_LAST = now; should_cleanup = True
        if should_cleanup:
            cleanup_conn = None
            try:
                cleanup_conn = get_conn(); _cleanup_activity_log(cleanup_conn, keep=10000)
            except Exception:
                pass
            finally:
                if cleanup_conn is not None:
                    try: cleanup_conn.close()
                    except Exception: pass
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
    supplied_month = str(get("month") or "").strip()
    supplied_week = str(get("week") or "").strip()
    supplied_quarter = str(get("quarter") or "").strip()
    supplied_fy = str(get("financial_year") or "").strip()
    # insp_lot_date is the canonical source for period reporting. Keep the
    # supplied period fields only long enough for validation; _validate_record
    # rejects contradictions. Existing DB rows are untouched.
    month = supplied_month or derived_month
    week = supplied_week or derived_week
    quarter = supplied_quarter or derived_quarter
    fy = supplied_fy or derived_fy
    try:
        weight_raw = get("output_weight", "")
        # A coil always has some real output weight in practice — a blank
        # cell is missing data, not a genuine zero. Flag it the same way as
        # non-numeric garbage (below) so _validate_record reports it as a
        # per-row "required" error instead of silently recording it as 0,
        # which would quietly understate weight-based KPIs.
        blank = (weight_raw is None) or (isinstance(weight_raw, str) and weight_raw.strip() == "")
        if isinstance(weight_raw, str):
            weight_raw = weight_raw.replace(",", "").strip()
        weight = None if blank else float(weight_raw)
    except (TypeError, ValueError):
        # Don't raise here: one row with garbage in this column (a stray "N/A",
        # a typo) used to abort the ENTIRE import with a generic error and no
        # row number, discarding every other valid row in the file too. Flag
        # it as None instead so _validate_record reports it as a per-row
        # error — same as a missing BATCH NO or HEAT NO — and every other row
        # still imports normally.
        weight = None

    return {
        "heat_no": str(get("heat_no") or "").strip(),
        "batch_no": str(get("batch_no") or "").strip(),
        "work_center": str(get("work_center") or "").strip(),
        "grade": str(get("grade") or "").strip(),
        "output_weight": weight,
        "main_defect": str(get("main_defect") or "").strip().upper(),
        "defect_intensity": ("" if str(get("defect_intensity") or "").strip().upper() == "NONE" else str(get("defect_intensity") or "").strip().upper()),
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
    if r["output_weight"] is None:
        return "Output Weight is required and must be numeric"
    if not isinstance(r["output_weight"], (int, float)) or not math.isfinite(float(r["output_weight"])):
        return "Output Weight must be a finite number"
    if r["output_weight"] <= 0:
        return "Output Weight must be greater than zero"
    insp = r.get("insp_lot_date") or ""
    if not insp:
        return "INSP LOT DATE is required"
    try:
        insp_date = _dt.date.fromisoformat(insp)
        exp_month, exp_week, exp_q, exp_fy = _derive_period_fields(insp_date)
        for field, supplied, expected in (("month", r.get("month", ""), exp_month),
                                           ("week", r.get("week", ""), exp_week),
                                           ("quarter", r.get("quarter", ""), exp_q),
                                           ("financial_year", r.get("financial_year", ""), exp_fy)):
            if supplied and supplied != expected:
                return f"{field.upper()} does not match INSP LOT DATE ({expected})"
    except ValueError:
        return "Invalid INSP LOT DATE"
    if r["quality_decision"] not in DECISION_ORDER:
        return "Unknown QUALITY DECISION: " + r["quality_decision"]
    return ""


def _record_signature(r):
    keys = ["heat_no", "batch_no", "work_center", "grade", "output_weight", "main_defect", "defect_intensity",
            "quality_decision", "insp_lot_date", "ud_date", "month", "week", "quarter", "financial_year"]
    raw = "|".join(str(r.get(k, "")) for k in keys)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _reject_zip_bomb(data, max_ratio=200, max_uncompressed=300 * 1024 * 1024):
    """Cheap pre-check against a decompression-bomb style .xlsx/.xlsm upload: xlsx
    files are ZIP archives, so a tiny file can be crafted to expand to gigabytes in
    memory once opened. This inspects the ZIP central directory (no decompression
    needed) and rejects anything with an implausible compression ratio or a huge
    declared uncompressed size, before openpyxl ever touches the content."""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            total_uncompressed = sum(i.file_size for i in zf.infolist())
            total_compressed = max(1, sum(i.compress_size for i in zf.infolist()))
            if total_uncompressed > max_uncompressed:
                raise ValueError("The uploaded file is too large once decompressed and was rejected.")
            if total_uncompressed / total_compressed > max_ratio:
                raise ValueError("The uploaded file's compression ratio is abnormally high and was rejected as a possible decompression bomb.")
    except zipfile.BadZipFile:
        raise ValueError("The uploaded file is not a valid Excel (.xlsx/.xlsm) file.")

def _parse_uploaded_file(filename, data):
    ext = os.path.splitext(filename.lower())[1]
    rows = []
    if ext in (".xlsx", ".xlsm"):
        try:
            import openpyxl
        except ImportError:
            raise ValueError("Excel import requires openpyxl. Please use TSV/CSV or install openpyxl.")
        _reject_zip_bomb(data)
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


def _cache_clear():
    global RESPONSE_CACHE_BYTES
    with RESPONSE_CACHE_LOCK:
        RESPONSE_CACHE.clear()
        RESPONSE_CACHE_BYTES = 0

def _cache_get(key):
    global RESPONSE_CACHE_BYTES
    now = time.time()
    with RESPONSE_CACHE_LOCK:
        hit = RESPONSE_CACHE.get(key)
        if hit and now - hit[0] < RESPONSE_CACHE_TTL:
            return hit[1]
        if hit:
            RESPONSE_CACHE.pop(key, None)
            RESPONSE_CACHE_BYTES = max(0, RESPONSE_CACHE_BYTES - int(hit[2]))
    return None

def _cache_put(key, payload):
    global RESPONSE_CACHE_BYTES
    now = time.time()
    try:
        estimated = len(json.dumps(payload, ensure_ascii=False, separators=(",", ":"), default=str).encode("utf-8"))
    except Exception:
        return
    if estimated <= 0 or estimated > RESPONSE_CACHE_MAX_BYTES:
        return
    with RESPONSE_CACHE_LOCK:
        old = RESPONSE_CACHE.pop(key, None)
        if old:
            RESPONSE_CACHE_BYTES = max(0, RESPONSE_CACHE_BYTES - int(old[2]))
        RESPONSE_CACHE[key] = (now, payload, estimated)
        RESPONSE_CACHE_BYTES += estimated
        while len(RESPONSE_CACHE) > RESPONSE_CACHE_MAX_ENTRIES or RESPONSE_CACHE_BYTES > RESPONSE_CACHE_MAX_BYTES:
            oldest_key, oldest = min(RESPONSE_CACHE.items(), key=lambda x: x[1][0])
            RESPONSE_CACHE.pop(oldest_key, None)
            RESPONSE_CACHE_BYTES = max(0, RESPONSE_CACHE_BYTES - int(oldest[2]))

def _insert_records(records):
    """Insert/update disposition records under a serialized transaction.

    Normalized non-empty BATCH NO identifies one coil. Legacy duplicate groups are
    preserved. PostgreSQL uses a transaction-scoped advisory lock; SQLite uses
    BEGIN IMMEDIATE. This prevents concurrent imports from racing on new batches.
    """
    with DISPOSITION_WRITE_LOCK:
        conn = get_conn(); cur = conn.cursor()
        try:
            if USE_POSTGRES:
                conn.execute("SELECT pg_advisory_xact_lock(hashtext('quality-disposition-import'))")
            else:
                conn.execute("BEGIN IMMEDIATE")
            existing = {}
            cur.execute("SELECT id,heat_no,batch_no,work_center,grade,output_weight,main_defect,defect_intensity,quality_decision,insp_lot_date,ud_date,month,week,quarter,financial_year FROM disposition")
            cols=["id","heat_no","batch_no","work_center","grade","output_weight","main_defect","defect_intensity","quality_decision","insp_lot_date","ud_date","month","week","quarter","financial_year"]
            for row in cur.fetchall():
                d=dict(zip(cols,row)); key=str(d.get("batch_no") or "").strip().upper()
                if key: existing.setdefault(key, d)
            inserted=0; updated=0; duplicates=0; errors=[]; seen=set(); good=[]; updates=[]
            fields=["heat_no","work_center","grade","output_weight","main_defect","defect_intensity","quality_decision","insp_lot_date","ud_date","month","week","quarter","financial_year"]
            for idx,r in enumerate(records,start=2):
                err=_validate_record(r); key=str(r.get("batch_no","")).strip().upper()
                if err: errors.append({"row":idx,"error":err}); continue
                if key in seen: duplicates+=1; continue
                seen.add(key); old=existing.get(key)
                if old:
                    changed=any(str(old.get(k) if old.get(k) is not None else "") != str(r.get(k) if r.get(k) is not None else "") for k in fields)
                    if changed: updates.append((r,old["id"])); updated+=1
                    else: duplicates+=1
                else: good.append(r)
            if good:
                cur.executemany("""INSERT INTO disposition (batch_no,heat_no,work_center,grade,output_weight,main_defect,defect_intensity,quality_decision,insp_lot_date,ud_date,month,week,quarter,financial_year) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", [tuple(r[k] for k in ["batch_no"]+fields) for r in good])
                inserted=len(good)
            for r,rid in updates:
                cur.execute("""UPDATE disposition SET heat_no=?,work_center=?,grade=?,output_weight=?,main_defect=?,defect_intensity=?,quality_decision=?,insp_lot_date=?,ud_date=?,month=?,week=?,quarter=?,financial_year=? WHERE id=?""", tuple(r[k] for k in fields)+(rid,))
            conn.commit()
            result={"inserted":inserted,"updated":updated,"duplicates":duplicates,"errors":errors}
        except Exception:
            try: conn.rollback()
            except Exception: pass
            raise
        finally:
            try: conn.close()
            except Exception: pass
        _cache_clear(); return result

def _norm_defect_key(s):
    """Normalize a defect name for matching: uppercase, letters/digits only.
    Used to match disposition.main_defect values (e.g. 'INTERWRAP SCRATCHES (R')
    against the 6M Fishbone master defect list (e.g. 'Interwrap Scratch (Rolled)'),
    since the two lists don't use identical spelling/abbreviations."""
    return re.sub(r"[^A-Z0-9]+", "", str(s or "").upper())


def _norm_category_key(s):
    """Normalize a 6M category cell (e.g. '👤Man', '📋METHOD', '🌍Mother Nature')
    down to one of our six canonical keys."""
    key = re.sub(r"[^A-Za-z ]+", "", str(s or "")).strip().lower()
    if "man" in key and "nature" not in key and "human" not in key:
        return "man"
    if "machine" in key:
        return "machine"
    if "material" in key:
        return "material"
    if "method" in key:
        return "method"
    if "measur" in key:
        return "measurement"
    if "mother nature" in key or "environment" in key or "nature" in key:
        return "environment"
    return None


def _extract_leading_icon(s):
    """Pull the leading emoji/symbol prefix off a category cell like '👤Man' or
    '📋METHOD', so the workbook's own icon can be reused as-is on the dashboard."""
    m = re.match(r"^([^A-Za-z0-9]+)", str(s or "").strip())
    icon = (m.group(1).strip() if m else "").strip()
    return icon or None


def _parse_fishbone_file(filename, data):
    """Parse an uploaded 6M Defect Master workbook (.xlsx/.xlsm). Returns a dict
    with three parts, each optional except 'master':
      - master: Defect List + 6M cause columns, from the 'Master_Data' sheet
        (or the first sheet, for older single-sheet workbooks).
      - rca: Defect List, CATEGORY (6M, with its own icon), WHY-1..WHY-5/Root
        Cause, ACTION, PREVENTIVE ACTION, ROLE, RESPONSIBILITY — one row per
        defect x category — from a sheet whose name contains 'RCA'.
      - style: 6M category -> recommended color (+ icon carried over from the
        RCA sheet) — from a sheet whose name contains 'Icon' and 'Color'.
    """
    ext = os.path.splitext(filename.lower())[1]
    if ext not in (".xlsx", ".xlsm"):
        raise ValueError("6M Fishbone master must be uploaded as an .xlsx or .xlsm file")
    try:
        import openpyxl
    except ImportError:
        raise ValueError("Excel import requires openpyxl.")
    _reject_zip_bomb(data)
    wb = openpyxl.load_workbook(io.BytesIO(data), data_only=True, read_only=True)

    def _find_sheet(*needles):
        for name in wb.sheetnames:
            key = name.strip().lower()
            if all(n in key for n in needles):
                return name
        return None

    # ---- 1) Master_Data: Defect List + 6M cause columns ----
    master_sheet = "Master_Data" if "Master_Data" in wb.sheetnames else wb.sheetnames[0]
    ws = wb[master_sheet]
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

    # ---- 2) RCA_RootCause_Library: Defect List, CATEGORY, WHY-1..5, ACTION, ... ----
    rca_records = []
    icons_seen = {}
    rca_sheet_name = _find_sheet("rca") or _find_sheet("root", "cause")
    if rca_sheet_name:
        rws = wb[rca_sheet_name]
        rit = rws.iter_rows(values_only=True)
        try:
            rheaders = list(next(rit))
        except StopIteration:
            rheaders = []
        rcol = {}
        rkeyword_map = [
            ("defect", "defect_name"), ("category", "category"),
            ("why-1", "why1"), ("why1", "why1"), ("why 1", "why1"),
            ("why-2", "why2"), ("why2", "why2"), ("why 2", "why2"),
            ("why-3", "why3"), ("why3", "why3"), ("why 3", "why3"),
            ("why-4", "why4"), ("why4", "why4"), ("why 4", "why4"),
            ("why-5", "why5"), ("why5", "why5"), ("why 5", "why5"), ("root cause", "why5"),
            ("preventive", "preventive_action"), ("action", "action"),
            ("role", "role"), ("responsib", "responsibility"),
        ]
        for idx, h in enumerate(rheaders):
            key = str(h or "").strip().lower()
            if not key:
                continue
            for kw, field in rkeyword_map:
                if kw in key and field not in rcol:
                    rcol[field] = idx
                    break
        if "defect_name" in rcol and "category" in rcol:
            for values in rit:
                if not any(v not in (None, "") for v in values):
                    continue
                def _cell(field):
                    i = rcol.get(field)
                    return str(values[i]).strip() if (i is not None and i < len(values) and values[i] is not None) else ""
                name = _cell("defect_name")
                cat_raw = _cell("category")
                if not name or not cat_raw:
                    continue
                cat_key = _norm_category_key(cat_raw)
                if not cat_key:
                    continue
                icon = _extract_leading_icon(cat_raw)
                if icon and cat_key not in icons_seen:
                    icons_seen[cat_key] = icon
                rec = {"defect_name": name, "category": cat_key}
                for field in RCA_WHY_FIELDS + ["action", "preventive_action", "role", "responsibility"]:
                    rec[field] = _cell(field)
                # Skip categories left completely blank in the workbook (the
                # sheet has a placeholder row for every 6M category even when
                # only 1-2 actually have an RCA filled in).
                if any(rec[f] for f in RCA_WHY_FIELDS + ["action", "preventive_action", "role", "responsibility"]):
                    rca_records.append(rec)

    # ---- 3) Icon Color Coding: 6M -> Recommended Color / HEX ----
    style_records = []
    style_sheet_name = _find_sheet("icon", "color") or _find_sheet("color", "coding")
    if style_sheet_name:
        sws = wb[style_sheet_name]
        for row in sws.iter_rows(values_only=True):
            vals = [v for v in row if v is not None]
            if len(vals) < 2:
                continue
            cat_key = None
            hexval = None
            for v in row:
                if v is None:
                    continue
                sv = str(v).strip()
                if cat_key is None:
                    k = _norm_category_key(sv)
                    if k:
                        cat_key = k
                        continue
                if re.match(r"^#?[0-9A-Fa-f]{6}$", sv):
                    hexval = sv if sv.startswith("#") else "#" + sv
            if cat_key and hexval:
                style_records.append({"category": cat_key, "color": hexval, "icon": icons_seen.get(cat_key)})
    # Even without a dedicated style sheet, carry over any icons discovered on
    # the RCA sheet so the workbook's own symbols are used where possible.
    for cat_key, icon in icons_seen.items():
        if not any(s["category"] == cat_key for s in style_records):
            style_records.append({"category": cat_key, "color": None, "icon": icon})

    wb.close()
    return {"master": records, "rca": rca_records, "style": style_records}


def _replace_fishbone_master(bundle, filename, imported_by):
    """Replace the 6M Fishbone master, RCA library and icon/color style tables
    with a freshly-uploaded workbook's contents. This is a full reference-list
    refresh (not a merge) for each part that was present in the workbook —
    matching the requirement that re-uploading the 6M master Excel should
    fully refresh what the QCR dashboard shows, no separate 'sync' step needed."""
    records = bundle.get("master") or []
    rca_records = bundle.get("rca") or []
    style_records = bundle.get("style") or []
    if not records:
        raise ValueError("No defect rows were found in the uploaded file")
    _require_safety_backup("before_fishbone_import")  # fail closed on backup failure
    conn = get_conn()
    seen = set()
    rows = []
    for r in records:
        norm = _norm_defect_key(r["defect_name"])
        if not norm or norm in seen:
            continue
        seen.add(norm)
        rows.append((r["defect_name"], norm) + tuple(r.get(f, "") for f in FISHBONE_CAUSE_FIELDS))
    conn.execute("DELETE FROM fishbone_style")
    conn.execute("DELETE FROM fishbone_master")
    conn.executemany(
        "INSERT INTO fishbone_master (defect_name,norm_name,man,machine,material,method,measurement,environment) VALUES (?,?,?,?,?,?,?,?)",
        rows,
    )

    rca_rows = []
    for r in rca_records:
        norm = _norm_defect_key(r["defect_name"])
        cat = r.get("category")
        if not norm or not cat:
            continue
        # A defect can have MULTIPLE Why-Why/root-cause rows under the same
        # 6M category (e.g. two separate "Man" causes) — every one of them
        # must survive the import, so no de-duplication by (norm, category)
        # here anymore (that used to silently keep only the first).
        rca_rows.append((r["defect_name"], norm, cat) + tuple(r.get(f, "") for f in RCA_WHY_FIELDS + ["action", "preventive_action", "role", "responsibility"]))
    if rca_records:
        conn.execute("DELETE FROM rca_master")
        conn.executemany(
            "INSERT INTO rca_master (defect_name,norm_name,category,why1,why2,why3,why4,why5,action,preventive_action,role,responsibility) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            rca_rows,
        )

    style_updated = 0
    existing_cats = {r[0] for r in conn.execute("SELECT category FROM fishbone_style").fetchall()}
    for s in style_records:
        cat = s.get("category")
        if not cat:
            continue
        defaults = FISHBONE_STYLE_DEFAULTS.get(cat, {})
        color = s.get("color") or defaults.get("color")
        icon = s.get("icon") or defaults.get("icon")
        label = defaults.get("label", cat.title())
        if cat in existing_cats:
            conn.execute(
                "UPDATE fishbone_style SET label=?, icon=COALESCE(?,icon), color=COALESCE(?,color), updated_at=CURRENT_TIMESTAMP WHERE category=?",
                (label, icon, color, cat),
            )
        else:
            conn.execute("INSERT INTO fishbone_style (category,label,icon,color) VALUES (?,?,?,?)", (cat, label, icon, color))
            existing_cats.add(cat)
        style_updated += 1

    conn.execute(
        "INSERT INTO fishbone_import_history (filename,detected,imported,imported_by,rca_detected,rca_imported,style_imported) VALUES (?,?,?,?,?,?,?)",
        (filename, len(records), len(rows), imported_by, len(rca_records), len(rca_rows), style_updated),
    )
    conn.commit()
    conn.close()
    FISHBONE_CACHE["rows"] = None
    FISHBONE_CACHE["aliases"] = None
    RCA_CACHE["rows"] = None
    FISHBONE_STYLE_CACHE["rows"] = None
    _write_backup_file("after_fishbone_import")
    return {"detected": len(records), "imported": len(rows), "rca_detected": len(rca_records), "rca_imported": len(rca_rows), "style_imported": style_updated}


def _backup_jsonable(value):
    """Convert DB-native date/time values to JSON-safe ISO strings without
    changing the live database representation."""
    if isinstance(value, (_dt.datetime, _dt.date)):
        return value.isoformat()
    return value


def _backup_rows_jsonable(rows):
    return [{k: _backup_jsonable(v) for k, v in dict(r).items()} for r in rows]


def _backup_snapshot_data():
    """Gather everything a backup needs to fully restore the app's data: every
    disposition row, the 6M Fishbone Master + aliases, and KPI targets."""
    conn = get_conn()
    try:
        disposition = [dict(r) for r in conn.execute(
            "SELECT heat_no,batch_no,work_center,grade,output_weight,main_defect,defect_intensity,quality_decision,insp_lot_date,ud_date,month,week,quarter,financial_year FROM disposition"
        ).fetchall()]
        fishbone_master = [dict(r) for r in conn.execute(
            "SELECT defect_name,norm_name,man,machine,material,method,measurement,environment FROM fishbone_master"
        ).fetchall()]
        try:
            fishbone_alias = [dict(r) for r in conn.execute("SELECT disposition_defect,master_defect,created_by FROM fishbone_alias").fetchall()]
        except Exception:
            fishbone_alias = []
        try:
            kpi_targets = [dict(r) for r in conn.execute("SELECT label,target,warning,critical,direction FROM kpi_targets").fetchall()]
        except Exception:
            kpi_targets = []
        try:
            rca_master = [dict(r) for r in conn.execute(
                "SELECT defect_name,norm_name,category,why1,why2,why3,why4,why5,action,preventive_action,role,responsibility FROM rca_master"
            ).fetchall()]
        except Exception:
            rca_master = []
        try:
            fishbone_style = [dict(r) for r in conn.execute("SELECT category,label,icon,color FROM fishbone_style").fetchall()]
        except Exception:
            fishbone_style = []
        try:
            kpi_target_history = [dict(r) for r in conn.execute("SELECT label,old_target,new_target,old_warning,new_warning,old_critical,new_critical,old_direction,new_direction,effective_date,changed_by,changed_at FROM kpi_target_history ORDER BY id").fetchall()]
        except Exception:
            kpi_target_history = []
        try:
            import_history = [dict(r) for r in conn.execute("SELECT filename,detected,valid,duplicates,errors,updated,imported,imported_by,created_at FROM import_history ORDER BY id").fetchall()]
        except Exception:
            import_history = []
        disposition = _backup_rows_jsonable(disposition)
        fishbone_master = _backup_rows_jsonable(fishbone_master)
        fishbone_alias = _backup_rows_jsonable(fishbone_alias)
        kpi_targets = _backup_rows_jsonable(kpi_targets)
        rca_master = _backup_rows_jsonable(rca_master)
        fishbone_style = _backup_rows_jsonable(fishbone_style)
        kpi_target_history = _backup_rows_jsonable(kpi_target_history)
        import_history = _backup_rows_jsonable(import_history)
    finally:
        conn.close()
    return {
        "backup_version": 2,
        "created_at": datetime.now().isoformat(),
        "counts": {"disposition": len(disposition), "fishbone_master": len(fishbone_master), "fishbone_alias": len(fishbone_alias), "kpi_targets": len(kpi_targets), "rca_master": len(rca_master), "fishbone_style": len(fishbone_style), "kpi_target_history": len(kpi_target_history), "import_history": len(import_history)},
        "disposition": disposition,
        "fishbone_master": fishbone_master,
        "fishbone_alias": fishbone_alias,
        "kpi_targets": kpi_targets,
        "rca_master": rca_master,
        "fishbone_style": fishbone_style,
        "kpi_target_history": kpi_target_history,
        "import_history": import_history,
    }

def _backup_prune():
    try:
        files = sorted(
            (f for f in os.listdir(BACKUP_DIR) if f.startswith("backup_") and f.endswith(".json.gz")),
            key=lambda f: os.path.getmtime(os.path.join(BACKUP_DIR, f)),
        )
        while len(files) > BACKUP_KEEP:
            os.remove(os.path.join(BACKUP_DIR, files.pop(0)))
    except Exception:
        pass

def _require_safety_backup(reason="safety"):
    path = _write_backup_file(reason)
    if not path:
        raise RuntimeError("Safety backup failed; database mutation aborted")
    return path

def _backup_snapshot_transaction(reason="manual"):
    """Create a consistent application snapshot from one read transaction.

    Contract: the returned envelope is the exact JSON shape consumed by the
    backup writer, backup validator and restore routine. Keeping the metadata
    and table sections together prevents drift between snapshot creation and
    file serialization.
    """
    conn = get_conn()
    # Full persistent application state. Runtime session/cache state is
    # process-local and intentionally recreated after restore.
    tables = [
        "disposition", "users", "activity_log", "audit_trail",
        "fishbone_master", "fishbone_alias", "fishbone_import_history",
        "kpi_targets", "rca_master", "fishbone_style",
        "kpi_target_history", "import_history"
    ]
    try:
        if USE_POSTGRES:
            conn.execute("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        else:
            conn.execute("BEGIN")

        snap = {
            "backup_version": 4,
            "created_at": datetime.now().isoformat(),
            "reason": str(reason or "manual"),
            "database_backend": "postgres" if USE_POSTGRES else "sqlite",
            "scope": "full_persistent_application_state",
            "excluded_runtime_state": ["sessions", "response_cache", "import_previews"],
        }
        counts = {}
        for table in tables:
            fetched = conn.execute(f"SELECT * FROM {table}").fetchall()
            normalized = _backup_rows_jsonable(fetched)
            snap[table] = normalized
            counts[table] = len(normalized)
        snap["counts"] = counts
        conn.rollback()
        return snap
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    finally:
        try:
            conn.close()
        except Exception:
            pass

def _backup_integrity_payload(data):
    unsigned = dict(data)
    unsigned.pop("integrity_sha256", None)
    return json.dumps(unsigned, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")

def _backup_integrity_sha256(data):
    return hashlib.sha256(_backup_integrity_payload(data)).hexdigest()

def _backup_is_valid(data, require_integrity=False):
    if not isinstance(data, dict):
        return False, "Backup payload is not an object"
    required = ("backup_version","created_at","counts","disposition","fishbone_master","fishbone_alias","kpi_targets","rca_master","fishbone_style","kpi_target_history","import_history")
    missing = [k for k in required if k not in data]
    try:
        version = int(data.get("backup_version") or 0)
    except (TypeError, ValueError):
        return False, "Backup version is invalid"
    if version >= 4:
        missing.extend(k for k in ("users","activity_log","audit_trail","fishbone_import_history","scope") if k not in data)
        if data.get("scope") != "full_persistent_application_state":
            return False, "Backup scope is invalid"
    if missing:
        return False, "Missing sections: " + ", ".join(sorted(set(missing)))
    counts = data.get("counts")
    if not isinstance(counts, dict):
        return False, "Backup counts section is invalid"
    required_sections = ("disposition","fishbone_master","fishbone_alias","kpi_targets","rca_master","fishbone_style","kpi_target_history","import_history")
    if version >= 4:
        required_sections += ("users","activity_log","audit_trail","fishbone_import_history")
    for section in required_sections:
        rows = data.get(section)
        if not isinstance(rows, list):
            return False, f"Backup section '{section}' is invalid"
        recorded_count = counts.get(section)
        if recorded_count is not None:
            try:
                if int(recorded_count) != len(rows):
                    return False, f"Backup count mismatch for {section}"
            except (TypeError, ValueError):
                return False, f"Backup count for {section} is invalid"
    recorded = str(data.get("integrity_sha256") or "")
    if not recorded:
        if require_integrity:
            return False, "Backup integrity checksum is missing"
        return True, "Legacy backup: no embedded checksum"
    calculated = _backup_integrity_sha256(data)
    if not hmac.compare_digest(recorded, calculated):
        return False, "Backup integrity checksum mismatch"
    return True, "Integrity checksum verified"

def _write_backup_file(reason="manual"):
    """Create an atomic, gzip-compressed backup with an embedded integrity checksum."""
    try:
        with BACKUP_WRITE_LOCK:
            os.makedirs(BACKUP_DIR, exist_ok=True)
            data = _backup_snapshot_transaction(reason)
            ts = datetime.now().strftime("%Y%m%d_%H%M%S")
            safe_reason = re.sub(r"[^a-zA-Z0-9_-]", "", reason)[:40] or "manual"
            fname = f"backup_{ts}_{safe_reason}_{uuid.uuid4().hex[:8]}.json.gz"
            fpath = os.path.join(BACKUP_DIR, fname)
            data["app_version"] = APP_VERSION
            data["database_backend"] = "postgres" if USE_POSTGRES else "sqlite"
            data["integrity_sha256"] = _backup_integrity_sha256(data)
            tmp_path = fpath + ".tmp"
            with open(tmp_path, "wb") as raw:
                with gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as gz:
                    gz.write(json.dumps(data, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
                    gz.flush()
                raw.flush()
                os.fsync(raw.fileno())
            os.replace(tmp_path, fpath)
            _backup_prune()
            return {"filename": fname, "counts": data["counts"], "created_at": data["created_at"], "app_version": APP_VERSION}
    except Exception as e:
        try:
            if 'tmp_path' in locals() and os.path.exists(tmp_path): os.remove(tmp_path)
        except Exception:
            pass
        print(f"WARNING: backup failed ({reason}): {e}")
        return None

# How often a backup happens automatically even with no import activity at all
# (imports already trigger their own backup — this is the safety net for the
# gaps between them). Override with the BACKUP_SCHEDULE_HOURS env var; set to
# "0" to disable.
BACKUP_SCHEDULE_HOURS = float(os.environ.get("BACKUP_SCHEDULE_HOURS", "24") or "0")

def _seconds_since_last_backup():
    try:
        files = [f for f in os.listdir(BACKUP_DIR) if f.startswith("backup_") and f.endswith(".json.gz")]
        if not files:
            return None
        newest = max(os.path.getmtime(os.path.join(BACKUP_DIR, f)) for f in files)
        return time.time() - newest
    except Exception:
        return None

def _scheduled_backup_loop():
    """Background safety net: even if nobody imports data for a while, take a
    periodic snapshot anyway (default every 24h) so a quiet stretch between
    imports never becomes a gap in backup coverage. An import-triggered backup
    counts too — this only fires once the configured interval has genuinely
    elapsed since the most recent backup of any kind."""
    if BACKUP_SCHEDULE_HOURS <= 0:
        return
    interval_seconds = BACKUP_SCHEDULE_HOURS * 3600
    check_every = min(interval_seconds, 3600)  # re-check at least hourly
    # This runs on its own thread, started at the same time as (not after)
    # _run_startup_tasks — on a fresh database the tables this backs up may
    # not exist yet for the first second or two. Wait for schema setup to
    # finish (or bail out after a generous ceiling, so a genuinely stuck
    # schema step can't wedge this loop forever) before the first snapshot
    # attempt, instead of racing it and logging a spurious "no such table"
    # warning on every cold start.
    while not STARTUP_READY:
        if STARTUP_ERROR:
            print(f"Scheduled backup disabled for this process because startup failed: {STARTUP_ERROR}", flush=True)
            return
        time.sleep(1)
    while True:
        try:
            age = _seconds_since_last_backup()
            if age is None or age >= interval_seconds:
                result = _write_backup_file("scheduled")
                if result:
                    print(f"Scheduled backup created: {result['filename']}")
        except Exception as e:
            print(f"WARNING: scheduled backup loop error: {e}")
        time.sleep(check_every)

def _list_backups():
    try:
        out = []
        for f in os.listdir(BACKUP_DIR):
            if not (f.startswith("backup_") and f.endswith(".json.gz")):
                continue
            fp = os.path.join(BACKUP_DIR, f)
            m = re.match(r"backup_(\d{8})_(\d{6})_(.+)\.json\.gz", f)
            reason = m.group(3) if m else "unknown"
            valid = True
            backup_version = None
            try:
                with gzip.open(fp, "rt", encoding="utf-8") as bf:
                    obj = json.load(bf)
                backup_version = obj.get("backup_version")
                valid, _why = _backup_is_valid(obj)
            except Exception:
                valid = False
            out.append({"filename": f, "reason": reason, "size_kb": round(os.path.getsize(fp)/1024, 1), "modified_at": datetime.fromtimestamp(os.path.getmtime(fp)).strftime("%d-%b-%Y %H:%M:%S"), "valid": valid, "backup_version": backup_version})
        out.sort(key=lambda x: x["filename"], reverse=True)
        return out
    except Exception:
        return []

def _restore_backup_data(data):
    """Atomically restore all snapshot sections.

    Data-safety rule: if *any* section fails, rollback the entire restore so the
    live database is left exactly as it was before the operation. We never
    swallow restore exceptions and report a false success.
    """
    required_keys = {"disposition", "fishbone_master", "fishbone_alias", "kpi_targets", "rca_master", "fishbone_style", "kpi_target_history", "import_history"}
    missing = sorted(k for k in required_keys if k not in data)
    version = int(data.get("backup_version") or 0)
    if version >= 4:
        missing.extend(k for k in ("users","activity_log","audit_trail","fishbone_import_history") if k not in data)
    if missing:
        raise ValueError("Backup is incomplete; missing sections: " + ", ".join(sorted(set(missing))))

    disp_rows = data.get("disposition") or []
    seen_batches=set()
    for i,r in enumerate(disp_rows, start=1):
        batch=str(r.get("batch_no") or "").strip().upper()
        if not batch: raise ValueError(f"Backup disposition row {i} has no BATCH NO")
        if batch in seen_batches: raise ValueError(f"Backup contains duplicate BATCH NO: {batch}")
        seen_batches.add(batch)
        try: weight=float(r.get("output_weight"))
        except Exception: raise ValueError(f"Backup disposition row {i} has invalid Output Weight")
        if not math.isfinite(weight) or weight<=0: raise ValueError(f"Backup disposition row {i} has invalid Output Weight")
        if not str(r.get("insp_lot_date") or "").strip(): raise ValueError(f"Backup disposition row {i} is missing INSP LOT DATE")

    conn = get_conn()
    try:
        conn.execute("DELETE FROM disposition")
        if disp_rows:
            cols = ["heat_no","batch_no","work_center","grade","output_weight","main_defect","defect_intensity","quality_decision","insp_lot_date","ud_date","month","week","quarter","financial_year"]
            conn.executemany(
                f"INSERT INTO disposition ({','.join(cols)}) VALUES ({','.join(['?']*len(cols))})",
                [tuple(r.get(c, "") for c in cols) for r in disp_rows],
            )

        fb_rows = data.get("fishbone_master") or []
        conn.execute("DELETE FROM fishbone_master")
        if fb_rows:
            conn.executemany(
                "INSERT INTO fishbone_master (defect_name,norm_name,man,machine,material,method,measurement,environment) VALUES (?,?,?,?,?,?,?,?)",
                [(r.get("defect_name",""), r.get("norm_name",""), r.get("man",""), r.get("machine",""), r.get("material",""), r.get("method",""), r.get("measurement",""), r.get("environment","")) for r in fb_rows],
            )

        alias_rows = data.get("fishbone_alias") or []
        conn.execute("DELETE FROM fishbone_alias")
        if alias_rows:
            conn.executemany(
                "INSERT INTO fishbone_alias (disposition_defect,norm_disposition_defect,master_defect,created_by) VALUES (?,?,?,?)",
                [(r.get("disposition_defect",""), _norm_defect_key(r.get("disposition_defect","")), r.get("master_defect",""), r.get("created_by","")) for r in alias_rows],
            )

        kpi_rows = data.get("kpi_targets") or []
        # True snapshot semantics: remove targets absent from the backup instead
        # of leaving post-backup additions behind. This happens in the same
        # transaction, so a failure rolls the delete back too.
        conn.execute("DELETE FROM kpi_targets")
        if kpi_rows:
            conn.executemany(
                "INSERT INTO kpi_targets(label,target,warning,critical,direction) VALUES(?,?,?,?,?)",
                [(r.get("label",""), r.get("target"), r.get("warning"), r.get("critical"), r.get("direction","higher")) for r in kpi_rows],
            )

        rca_rows = data.get("rca_master") or []
        conn.execute("DELETE FROM rca_master")
        if rca_rows:
            conn.executemany(
                "INSERT INTO rca_master (defect_name,norm_name,category,why1,why2,why3,why4,why5,action,preventive_action,role,responsibility) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                [(r.get("defect_name",""), r.get("norm_name",""), r.get("category",""), r.get("why1",""), r.get("why2",""), r.get("why3",""), r.get("why4",""), r.get("why5",""), r.get("action",""), r.get("preventive_action",""), r.get("role",""), r.get("responsibility","")) for r in rca_rows],
            )

        style_rows = data.get("fishbone_style") or []
        conn.execute("DELETE FROM fishbone_style")
        if style_rows:
            conn.executemany(
                "INSERT INTO fishbone_style (category,label,icon,color) VALUES (?,?,?,?)",
                [(r.get("category",""), r.get("label",""), r.get("icon",""), r.get("color","")) for r in style_rows],
            )

        history_rows = data.get("kpi_target_history") or []
        conn.execute("DELETE FROM kpi_target_history")
        if history_rows:
            conn.executemany(
                "INSERT INTO kpi_target_history(label,old_target,new_target,old_warning,new_warning,old_critical,new_critical,old_direction,new_direction,effective_date,changed_by,changed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                [(r.get("label",""),r.get("old_target"),r.get("new_target"),r.get("old_warning"),r.get("new_warning"),r.get("old_critical"),r.get("new_critical"),r.get("old_direction"),r.get("new_direction"),r.get("effective_date",""),r.get("changed_by",""),r.get("changed_at")) for r in history_rows],
            )

        import_rows = data.get("import_history") or []
        conn.execute("DELETE FROM import_history")
        if import_rows:
            conn.executemany(
                "INSERT INTO import_history(filename,detected,valid,duplicates,errors,updated,imported,imported_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
                [(r.get("filename",""),r.get("detected",0),r.get("valid",0),r.get("duplicates",0),r.get("errors",0),r.get("updated",0),r.get("imported",0),r.get("imported_by",""),r.get("created_at")) for r in import_rows],
            )

        if version >= 4:
            user_rows = data.get("users") or []
            conn.execute("DELETE FROM users")
            if user_rows:
                conn.executemany(
                    "INSERT INTO users (id,username,display_name,password_hash,role,active,must_reset_password,created_at) VALUES (?,?,?,?,?,?,?,?)",
                    [(r.get("id"),r.get("username",""),r.get("display_name",""),r.get("password_hash",""),
                      r.get("role","viewer"),r.get("active",True),r.get("must_reset_password",False),r.get("created_at")) for r in user_rows],
                )

            activity_rows = data.get("activity_log") or []
            conn.execute("DELETE FROM activity_log")
            if activity_rows:
                conn.executemany(
                    "INSERT INTO activity_log (id,user_id,event_type,tab,filters_json,user_agent,ip_address,visitor_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
                    [(r.get("id"),r.get("user_id"),r.get("event_type",""),r.get("tab",""),r.get("filters_json","{}"),
                      r.get("user_agent",""),r.get("ip_address",""),r.get("visitor_id",""),r.get("created_at")) for r in activity_rows],
                )

            audit_rows = data.get("audit_trail") or []
            conn.execute("DELETE FROM audit_trail")
            if audit_rows:
                conn.executemany(
                    "INSERT INTO audit_trail (id,user_id,username,role,action,record_id,details,ip_address,user_agent,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                    [(r.get("id"),r.get("user_id"),r.get("username",""),r.get("role",""),r.get("action",""),r.get("record_id"),
                      r.get("details","{}"),r.get("ip_address",""),r.get("user_agent",""),r.get("created_at")) for r in audit_rows],
                )

            fishbone_history_rows = data.get("fishbone_import_history") or []
            conn.execute("DELETE FROM fishbone_import_history")
            if fishbone_history_rows:
                conn.executemany(
                    "INSERT INTO fishbone_import_history (id,filename,detected,imported,imported_by,created_at,rca_detected,rca_imported,style_imported) VALUES (?,?,?,?,?,?,?,?,?)",
                    [(r.get("id"),r.get("filename",""),r.get("detected",0),r.get("imported",0),r.get("created_at"),
                      r.get("rca_detected",0),r.get("rca_imported",0),r.get("style_imported",0)) for r in fishbone_history_rows],
                )

            if USE_POSTGRES:
                for table in ("users", "activity_log", "audit_trail", "fishbone_import_history"):
                    conn.execute(
                        "SELECT setval(pg_get_serial_sequence(%s, 'id'), COALESCE((SELECT MAX(id) FROM %s), 1), (SELECT COUNT(*) > 0 FROM %s))"
                        % (repr(table), table, table)
                    )

        conn.commit()
    except Exception:
        try:
            conn.rollback()
        finally:
            conn.close()
        raise
    else:
        conn.close()

    FISHBONE_CACHE["rows"] = None
    FISHBONE_CACHE["aliases"] = None
    RCA_CACHE["rows"] = None
    FISHBONE_STYLE_CACHE["rows"] = None
    _cache_clear()
    with SESSION_LOCK:
        SESSIONS.clear()
    with LOGIN_LOCK:
        LOGIN_ATTEMPTS.clear()
    return {
        "disposition": len(disp_rows),
        "users": len(data.get("users") or []) if version >= 4 else None,
        "activity_log": len(data.get("activity_log") or []) if version >= 4 else None,
        "audit_trail": len(data.get("audit_trail") or []) if version >= 4 else None,
        "fishbone_import_history": len(data.get("fishbone_import_history") or []) if version >= 4 else None,
        "fishbone_master": len(fb_rows),
        "fishbone_alias": len(alias_rows),
        "kpi_targets": len(kpi_rows),
        "rca_master": len(rca_rows),
        "fishbone_style": len(style_rows),
        "kpi_target_history": len(history_rows),
        "import_history": len(import_rows),
    }

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


def _rca_master_rows(force=False):
    if RCA_CACHE["rows"] is None or force:
        conn = get_conn()
        try:
            rows = conn.execute(
                "SELECT defect_name,norm_name,category,why1,why2,why3,why4,why5,action,preventive_action,role,responsibility,updated_at FROM rca_master"
            ).fetchall()
        except Exception:
            rows = []
        conn.close()
        RCA_CACHE["rows"] = [dict(r) for r in rows]
        RCA_CACHE["loaded_at"] = time.time()
    return RCA_CACHE["rows"]


def _fishbone_style(force=False):
    """6M category -> {label, icon, color}, imported from the 'Icon Color
    Coding' sheet (falls back to FISHBONE_STYLE_DEFAULTS for anything not
    yet in the DB, e.g. a brand-new install)."""
    if FISHBONE_STYLE_CACHE["rows"] is None or force:
        conn = get_conn()
        try:
            rows = conn.execute("SELECT category,label,icon,color FROM fishbone_style").fetchall()
        except Exception:
            rows = []
        conn.close()
        style = {k: dict(v) for k, v in FISHBONE_STYLE_DEFAULTS.items()}
        for r in rows:
            d = dict(r)
            cat = d.get("category")
            if cat in style:
                style[cat] = {"label": d.get("label") or style[cat]["label"], "icon": d.get("icon") or style[cat]["icon"], "color": d.get("color") or style[cat]["color"]}
        FISHBONE_STYLE_CACHE["rows"] = style
    return FISHBONE_STYLE_CACHE["rows"]


def _rca_for_norm(norm_name):
    """RCA rows for a matched master defect, keyed by 6M category. Each
    category maps to a LIST of entries (not a single one) because a defect
    can legitimately have more than one Why-Why/root-cause/action recorded
    under the same category (e.g. two different "Man" causes) — every entry
    imported for that category must show up, not just the last one read.
    Each entry has a 'chain' (only the filled Why steps, in order) and the
    CAPA fields. Categories with nothing filled in the workbook are omitted."""
    rows = [r for r in _rca_master_rows() if r["norm_name"] == norm_name]
    out = {}
    for r in rows:
        chain = [r.get(f, "") for f in RCA_WHY_FIELDS if (r.get(f, "") or "").strip()]
        if not chain and not (r.get("action") or r.get("preventive_action")):
            continue
        entry = {
            "why_chain": chain,
            "root_cause": chain[-1] if chain else "",
            "action": r.get("action", ""),
            "preventive_action": r.get("preventive_action", ""),
            "role": r.get("role", ""),
            "responsibility": r.get("responsibility", ""),
        }
        out.setdefault(r["category"], []).append(entry)
    return out


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
    """Match a disposition main_defect value to a 6M Fishbone master row, and
    attach the matching RCA (Why-Why/CAPA) data per 6M category, if any is on
    file for that master defect. Order of precedence: manual admin alias ->
    exact normalized match -> high-confidence fuzzy match -> no match."""
    master = _fishbone_master_rows()
    no_match = {"defect": defect_name, "matched": False, "match_type": "no_master", "matched_defect": None, "confidence": 0, "causes": None, "rca": None}
    if not master:
        return no_match

    def _build(row, match_type, confidence):
        return {
            "defect": defect_name, "matched": True, "match_type": match_type,
            "matched_defect": row["defect_name"], "confidence": confidence,
            "causes": {f: _split_causes(row.get(f, "")) for f in FISHBONE_CAUSE_FIELDS},
            "rca": _rca_for_norm(row["norm_name"]),
        }

    by_norm = {r["norm_name"]: r for r in master}
    norm = _norm_defect_key(defect_name)
    aliases = _fishbone_aliases()
    if norm in aliases:
        target_norm = _norm_defect_key(aliases[norm])
        row = by_norm.get(target_norm)
        if row:
            return _build(row, "alias", 1.0)
    if norm in by_norm:
        return _build(by_norm[norm], "exact", 1.0)
    close = difflib.get_close_matches(norm, list(by_norm.keys()), n=1, cutoff=FISHBONE_FUZZY_CUTOFF)
    if close:
        row = by_norm[close[0]]
        score = difflib.SequenceMatcher(None, norm, close[0]).ratio()
        return _build(row, "fuzzy", round(score, 2))
    no_match["match_type"] = "none"
    return no_match


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
        # CREATE TABLE IF NOT EXISTS so a brand-new SQLite install (no bundled
        # seed database and no existing persistent DB_PATH file) gets a working
        # disposition table on first boot too, instead of relying entirely on
        # a seed file being present.
        conn.execute("""CREATE TABLE IF NOT EXISTS disposition (
            id INTEGER PRIMARY KEY AUTOINCREMENT, heat_no TEXT, batch_no TEXT DEFAULT '', work_center TEXT, grade TEXT,
            output_weight REAL, main_defect TEXT, defect_intensity TEXT,
            quality_decision TEXT, insp_lot_date TEXT DEFAULT '', month TEXT, week TEXT,
            quarter TEXT, financial_year TEXT, ud_date TEXT DEFAULT ''
        )""")
        cols = {r[1] for r in conn.execute("PRAGMA table_info(disposition)").fetchall()}
        if "insp_lot_date" not in cols:
            conn.execute("ALTER TABLE disposition ADD COLUMN insp_lot_date TEXT DEFAULT ''")
        if "batch_no" not in cols:
            conn.execute("ALTER TABLE disposition ADD COLUMN batch_no TEXT DEFAULT ''")
        if "ud_date" not in cols:
            conn.execute("ALTER TABLE disposition ADD COLUMN ud_date TEXT DEFAULT ''")
    if USE_POSTGRES:
        # Guarded: these two ADD COLUMN IF NOT EXISTS calls are idempotent
        # and (going by earlier successful deploys) have very likely already
        # run before. If a stray locked/orphaned session on Supabase is
        # still holding a lock on `disposition` (leftover from an earlier
        # crashed deploy attempt), this statement can hang until Postgres's
        # own statement_timeout cancels it — which used to crash the whole
        # app before it ever got to start. Skipping past a timeout here
        # (columns almost certainly already exist) lets startup continue
        # instead of dying on what is, at worst, a no-op.
        try:
            conn.execute("ALTER TABLE disposition ADD COLUMN IF NOT EXISTS batch_no TEXT DEFAULT ''")
            conn.execute("ALTER TABLE disposition ADD COLUMN IF NOT EXISTS ud_date TEXT DEFAULT ''")
            conn.commit()
        except Exception:
            conn.rollback()
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
    # Commit before attempting the guarded ALTER below: if that ALTER times
    # out and gets rolled back, the rollback must not also wipe out the
    # CREATE TABLE IF NOT EXISTS statements for users/activity_log/audit_trail
    # above (Postgres rolls back everything since the last commit, not just
    # the failing statement) — same reasoning as the "Commit here" comment
    # a few lines down.
    conn.commit()
    if USE_POSTGRES:
        # Guarded like the disposition/ip_address migrations above: this
        # column has very likely already been added by an earlier deploy.
        # activity_log is written to on every dashboard visit/action, so
        # under concurrent writes this ALTER can sit waiting for a table
        # lock until Postgres's own statement_timeout cancels it — which
        # used to crash the whole app before it ever finished starting.
        # Skipping past a timeout here (the column almost certainly
        # already exists) lets startup continue instead of dying on what
        # is, at worst, a no-op.
        try:
            conn.execute("ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS visitor_id TEXT DEFAULT ''")
            conn.commit()
        except Exception:
            conn.rollback()
    else:
        cols_al={r[1] for r in conn.execute("PRAGMA table_info(activity_log)").fetchall()}
        if "visitor_id" not in cols_al:
            conn.execute("ALTER TABLE activity_log ADD COLUMN visitor_id TEXT DEFAULT ''")
    # Guarded the same way as the activity_log.visitor_id migration above:
    # adds the "must change password on next login" flag used by the
    # admin-initiated password reset flow, without crashing startup if the
    # column already exists or the ALTER can't get a lock in time.
    if USE_POSTGRES:
        try:
            conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS must_reset_password BOOLEAN NOT NULL DEFAULT FALSE")
            conn.commit()
        except Exception:
            conn.rollback()
    else:
        cols_u={r[1] for r in conn.execute("PRAGMA table_info(users)").fetchall()}
        if "must_reset_password" not in cols_u:
            conn.execute("ALTER TABLE users ADD COLUMN must_reset_password INTEGER NOT NULL DEFAULT 0")
    # Commit here: disposition/users/activity_log/audit_trail are now safely
    # created. Everything below this point runs its own try/except with a
    # conn.rollback() on failure — without committing first, that rollback
    # would silently undo these CREATE TABLEs too (Postgres rolls back
    # everything since the last commit, not just the failing statement).
    conn.commit()
    # Guarded with try/except: on a brand-new database (first-ever connection
    # to a fresh Postgres instance, e.g. a just-created Supabase project) the
    # import_history table doesn't exist yet at this point in startup — it
    # only gets created a few lines below. Without the guard this ALTER
    # crashes the whole app before it ever reaches that CREATE TABLE.
    try:
        if USE_POSTGRES:
            conn.execute("ALTER TABLE import_history ADD COLUMN IF NOT EXISTS updated INTEGER DEFAULT 0")
        else:
            cols_ih={r[1] for r in conn.execute("PRAGMA table_info(import_history)").fetchall()}
            if "updated" not in cols_ih:
                conn.execute("ALTER TABLE import_history ADD COLUMN updated INTEGER DEFAULT 0")
    except Exception:
        # On Postgres a failed statement poisons the rest of the transaction
        # (every later command errors with "current transaction is aborted")
        # until a ROLLBACK is issued — so every caught error in this startup
        # routine must roll back before continuing, or later, unrelated
        # CREATE TABLE statements start failing too.
        conn.rollback()
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
    # Enforce the business rule that a non-empty BATCH NO identifies one coil.
    # Safety-first: if legacy duplicates exist, do not alter/delete anything and
    # do not fail startup; surface the condition for the admin data-integrity view.
    try:
        dup_sql = (
            "SELECT COUNT(*) FROM (SELECT UPPER(TRIM(batch_no)) b, COUNT(*) c "
            "FROM disposition WHERE TRIM(COALESCE(batch_no,''))<>'' "
            "GROUP BY UPPER(TRIM(batch_no)) HAVING COUNT(*)>1) x"
        )
        dup_count = int(conn.execute(dup_sql).fetchone()[0] or 0)
        if dup_count == 0:
            idx_sql = (
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_disposition_batch_norm "
                "ON disposition (UPPER(TRIM(batch_no))) "
                "WHERE TRIM(COALESCE(batch_no,''))<>''"
            )
            conn.execute(idx_sql)
            conn.commit()
        else:
            print(f"WARNING: normalized BATCH NO uniqueness not enabled; {dup_count} duplicate group(s) require review", flush=True)
    except Exception as e:
        try: conn.rollback()
        except Exception: pass
        print(f"WARNING: batch uniqueness index check skipped: {e}", flush=True)

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
            imported_by TEXT DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            rca_detected INTEGER DEFAULT 0, rca_imported INTEGER DEFAULT 0, style_imported INTEGER DEFAULT 0
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS rca_master (
            id BIGSERIAL PRIMARY KEY, defect_name TEXT NOT NULL, norm_name TEXT NOT NULL, category TEXT NOT NULL,
            why1 TEXT DEFAULT '', why2 TEXT DEFAULT '', why3 TEXT DEFAULT '', why4 TEXT DEFAULT '', why5 TEXT DEFAULT '',
            action TEXT DEFAULT '', preventive_action TEXT DEFAULT '', role TEXT DEFAULT '', responsibility TEXT DEFAULT '',
            updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS fishbone_style (
            category TEXT PRIMARY KEY, label TEXT DEFAULT '', icon TEXT DEFAULT '', color TEXT DEFAULT '',
            updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
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
            imported_by TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            rca_detected INTEGER DEFAULT 0, rca_imported INTEGER DEFAULT 0, style_imported INTEGER DEFAULT 0
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS rca_master (
            id INTEGER PRIMARY KEY AUTOINCREMENT, defect_name TEXT NOT NULL, norm_name TEXT NOT NULL, category TEXT NOT NULL,
            why1 TEXT DEFAULT '', why2 TEXT DEFAULT '', why3 TEXT DEFAULT '', why4 TEXT DEFAULT '', why5 TEXT DEFAULT '',
            action TEXT DEFAULT '', preventive_action TEXT DEFAULT '', role TEXT DEFAULT '', responsibility TEXT DEFAULT '',
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS fishbone_style (
            category TEXT PRIMARY KEY, label TEXT DEFAULT '', icon TEXT DEFAULT '', color TEXT DEFAULT '',
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""")

    # Commit the kpi_targets/import_history/fishbone_*/rca_master CREATE
    # TABLEs before the guarded migration blocks below (same reasoning as
    # above — a later rollback must never be able to undo a CREATE TABLE).
    conn.commit()
    # Older databases created before RCA/style support was added won't have
    # these columns on fishbone_import_history yet — add them if missing.
    for coldef in ("rca_detected INTEGER DEFAULT 0", "rca_imported INTEGER DEFAULT 0", "style_imported INTEGER DEFAULT 0"):
        try:
            if USE_POSTGRES:
                conn.execute(f"ALTER TABLE fishbone_import_history ADD COLUMN IF NOT EXISTS {coldef}")
            else:
                conn.execute(f"ALTER TABLE fishbone_import_history ADD COLUMN {coldef}")
            conn.commit()
        except Exception:
            conn.rollback()
    # Seed fishbone_style with defaults so the API always has a full 6-category
    # style config, even before any admin has imported an Icon Color Coding sheet.
    try:
        existing_style = {r[0] for r in conn.execute("SELECT category FROM fishbone_style").fetchall()}
    except Exception:
        conn.rollback()
        existing_style = set()
    for cat, cfg in FISHBONE_STYLE_DEFAULTS.items():
        if cat not in existing_style:
            try:
                conn.execute("INSERT INTO fishbone_style (category,label,icon,color) VALUES (?,?,?,?)", (cat, cfg["label"], cfg["icon"], cfg["color"]))
                conn.commit()
            except Exception:
                conn.rollback()

    # Remove the legacy KPI target name so the public/admin target APIs are
    # fully consistent with the renamed First Pass Yield % (Prime%) KPI. This is idempotent and
    # also cleans existing deployed databases during startup.
    conn.commit()
    try:
        conn.execute("DELETE FROM kpi_targets WHERE label IN (?, ?)", ("First Pass Yield %", "Prime %"))
    except Exception:
        conn.rollback()
    for label,cfg in DEFAULT_KPI_TARGETS.items():
        try:
            # ON CONFLICT DO NOTHING / OR IGNORE instead of a bare INSERT:
            # this loop reruns on every app restart, and once a label already
            # exists a plain INSERT raises a duplicate-key error — which,
            # combined with the transaction-wide rollback() below, was
            # wiping out OTHER labels inserted earlier in this same loop on
            # that run (Postgres rolls back everything since the last
            # commit, not just the failing statement). Committing after each
            # row, plus skipping duplicates instead of erroring on them,
            # makes every target independent of the others.
            if USE_POSTGRES:
                conn.execute("INSERT INTO kpi_targets (label,target,warning,critical,direction) VALUES (?,?,?,?,?) ON CONFLICT (label) DO NOTHING",(label,cfg["target"],cfg["warning"],cfg["critical"],cfg["direction"]))
            else:
                conn.execute("INSERT OR IGNORE INTO kpi_targets (label,target,warning,critical,direction) VALUES (?,?,?,?,?)",(label,cfg["target"],cfg["warning"],cfg["critical"],cfg["direction"]))
            conn.commit()
        except Exception:
            conn.rollback()
    # Backward-compatible activity schema migration for existing databases.
    conn.commit()
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
        conn.rollback()

    # Migrate rca_master off its old UNIQUE(norm_name, category) constraint.
    # A defect can legitimately have MORE THAN ONE Why-Why/root-cause entry
    # under the same 6M category (e.g. two different "Man" causes for one
    # defect) — the old constraint silently dropped every row after the
    # first one imported for a given (defect, category) pair. This runs on
    # every startup but is a no-op once a database has already been migrated.
    conn.commit()
    try:
        if USE_POSTGRES:
            conn.execute("ALTER TABLE rca_master DROP CONSTRAINT IF EXISTS rca_master_norm_name_category_key")
        else:
            ddl_row = conn.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='rca_master'").fetchone()
            ddl = ddl_row[0] if ddl_row else ""
            if ddl and "UNIQUE(norm_name, category)" in ddl:
                conn.execute("ALTER TABLE rca_master RENAME TO rca_master_old")
                conn.execute("""CREATE TABLE rca_master (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, defect_name TEXT NOT NULL, norm_name TEXT NOT NULL, category TEXT NOT NULL,
                    why1 TEXT DEFAULT '', why2 TEXT DEFAULT '', why3 TEXT DEFAULT '', why4 TEXT DEFAULT '', why5 TEXT DEFAULT '',
                    action TEXT DEFAULT '', preventive_action TEXT DEFAULT '', role TEXT DEFAULT '', responsibility TEXT DEFAULT '',
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                )""")
                conn.execute("""INSERT INTO rca_master (id,defect_name,norm_name,category,why1,why2,why3,why4,why5,action,preventive_action,role,responsibility,updated_at)
                    SELECT id,defect_name,norm_name,category,why1,why2,why3,why4,why5,action,preventive_action,role,responsibility,updated_at FROM rca_master_old""")
                conn.execute("DROP TABLE rca_master_old")
    except Exception:
        conn.rollback()

    # V27.1: NEVER delete or reset the users table during startup.
    # If deployment credentials are explicitly supplied, provision the named
    # administrator only when that username does not already exist. Existing
    # users, passwords, roles and viewer accounts remain untouched.
    if ADMIN_USERNAME and ADMIN_PASSWORD:
        conn.commit()
        try:
            existing = conn.execute("SELECT id FROM users WHERE username=?", (ADMIN_USERNAME,)).fetchone()
            if not existing:
                conn.execute(
                    "INSERT INTO users (username,display_name,password_hash,role,active) VALUES (?,?,?,?,?)",
                    (ADMIN_USERNAME, "Administrator", _hash_password(ADMIN_PASSWORD), "admin", True)
                )
        except Exception:
            conn.rollback()
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
        persistent = bool(os.path.abspath(DB_PATH) != os.path.abspath(_BUNDLED_SEED_DB))
    if pct >= 95: status = "critical"
    elif pct >= 85: status = "action"
    elif pct >= 70: status = "warning"
    else: status = "healthy"
    conn.close()
    return {"provider": provider, "persistent": persistent, "records": total, "used_mb": round(used_mb,2), "limit_mb": round(limit_mb,2), "usage_pct": round(pct,2), "status": status}



def _export_filters(qs):
    return {k: qs.get(k, "All") for k in FILTER_KEYS}


def _export_recursion_response(kind, exc):
    """Handle a RecursionError that made it all the way out of an export
    endpoint (i.e. survived the recursion-limit increase + real stack-size
    increase applied at startup, and the capped-payload retry). Logs, and
    also returns to the browser:
      - the deepest frames + the most-repeated (file, function) pair,
      - the last frame of OUR OWN code (server.py/reports.py) before the
        library call chain took over -- i.e. the actual call site responsible,
      - a live sample of the real object being copied at the point of
        failure, read directly off the still-attached traceback frames
        (tb_frame.f_locals persist for every frame that was on the stack,
        even though the stack itself has since unwound) -- its type and a
        short repr, which identifies the actual runaway data structure
        instead of just the library function name."""
    diag = ""
    try:
        tb = exc.__traceback__
        frames = traceback.extract_tb(tb)
        print(f"EXPORT {kind} FAILED — RecursionError (limit={sys.getrecursionlimit()}, stack depth={len(frames)})", flush=True)
        if frames:
            print(f"RECURSION {kind}: deepest frames —", flush=True)
            for f in frames[-10:]:
                print(f"  {f.filename}:{f.lineno} in {f.name}", flush=True)
            from collections import Counter
            counts = Counter((os.path.basename(f.filename), f.name) for f in frames)
            print(f"RECURSION {kind}: most-repeated frames across full stack —", flush=True)
            for (fn, name), c in counts.most_common(5):
                print(f"  {name} ({fn}) — {c} occurrences", flush=True)
            top_fn, top_name = counts.most_common(1)[0][0]
            top_count = counts.most_common(1)[0][1]
            deepest = frames[-1]

            # Last frame that's OUR code (not a library) -- the actual call site.
            our_frame = None
            for f in frames:
                if f.filename.endswith(("server.py", "reports.py")):
                    our_frame = f
            our_site = f"{os.path.basename(our_frame.filename)}:{our_frame.lineno} in {our_frame.name}()" if our_frame else "not found in traceback"
            print(f"RECURSION {kind}: last call site in our own code — {our_site}", flush=True)

            # Sample the real object at the point of failure straight off the live frames.
            # Describe it SHALLOWLY (keys/length only, never a full repr) -- repr() on a
            # deeply-nested dict/list recurses through every value and can itself hit the
            # same recursion limit while we're trying to diagnose it.
            def _shallow_describe(v):
                try:
                    if isinstance(v, dict):
                        return f"dict(len={len(v)}, keys={list(v.keys())[:8]})"
                    if isinstance(v, (list, tuple, set)):
                        first = next(iter(v)) if v else None
                        return f"{type(v).__name__}(len={len(v)}, first_elem_type={type(first).__name__ if first is not None else None})"
                    r = repr(v)
                    return r if len(r) <= 200 else r[:200] + "…"
                except RecursionError:
                    return f"<{type(v).__name__}: too deep to repr>"
                except Exception:
                    return f"<{type(v).__name__}: unreprable>"
            sample_info = ""
            try:
                nodes = []
                node = tb
                while node is not None:
                    nodes.append(node); node = node.tb_next
                for node in reversed(nodes[-8:]):
                    fr = node.tb_frame
                    loc = fr.f_locals
                    for key in ("x", "self", "obj", "y", "d", "a", "n"):
                        if key in loc:
                            v = loc[key]
                            desc = _shallow_describe(v)
                            line = f"  sample local in {fr.f_code.co_name} ({os.path.basename(fr.f_code.co_filename)}:{fr.f_lineno}): {key} = {type(v).__name__}: {desc}"
                            print(line, flush=True)
                            if not sample_info:
                                sample_info = f"{type(v).__name__}: {desc}"
                            break
            except Exception:
                traceback.print_exc()

            diag = (f" [diagnostic: stack depth {len(frames)}; deepest frame "
                    f"{os.path.basename(deepest.filename)}:{deepest.lineno} in {deepest.name}(); "
                    f"most-repeated frame {top_name}() in {top_fn} — {top_count} occurrences; "
                    f"our call site — {our_site}"
                    + (f"; sample object — {sample_info}" if sample_info else "") + "]")
    except Exception:
        traceback.print_exc()
    return ("This report hit an unexpectedly deep processing limit and could not be generated "
            "even after an automatic retry with a reduced dataset. This has been logged for "
            "diagnosis. Please try again with a narrower filter (e.g. a single month) — if it "
            "still fails, contact support with the time of this attempt." + diag)


def _capped_export_payload(payload, register_limit=150, list_limit=50):
    """Best-effort shrink of the biggest optional lists in an export payload.
    Used as an automatic one-time retry after a RecursionError so a full/
    unfiltered report still comes back to the user -- with its largest,
    least-essential lists capped -- instead of failing outright. The
    defect register in particular has no natural upper bound: it grows with
    the number of distinct defect labels on file, which normally tracks a
    fixed set of defect categories but can balloon on messy data."""
    capped = dict(payload)
    defects = payload.get("defects") or {}
    register = defects.get("register") or []
    if len(register) > register_limit:
        defects = dict(defects)
        defects["register"] = register[:register_limit]  # already sorted by qty desc
        defects["register_truncated_from"] = len(register)
        capped["defects"] = defects
    intel = payload.get("intel") or {}
    trimmed_intel = None
    for key in ("recurring_patterns", "early_warnings", "kpi_ranking", "problem_finder"):
        vals = intel.get(key)
        if isinstance(vals, list) and len(vals) > list_limit:
            if trimmed_intel is None:
                trimmed_intel = dict(intel)
            trimmed_intel[key] = vals[:list_limit]
    if trimmed_intel is not None:
        capped["intel"] = trimmed_intel
    return capped


def _build_export_with_retry(kind, builder, payload):
    """Build one export format. If the first attempt hits the recursion
    safety valve, retry exactly once with a capped payload (see
    _capped_export_payload) before giving up -- so a full/unfiltered report
    still comes back to the user in the common case where an oversized list
    was the actual cause, rather than an outright failure. Diagnostic
    logging (deepest/most-repeated frames) is left to the caller's final
    RecursionError handler, so it reflects whichever attempt actually fails."""
    try:
        return builder(payload)
    except RecursionError:
        print(f"EXPORT {kind}: hit the recursion safety valve on the first attempt — "
              f"retrying once with a capped payload before giving up.", flush=True)
        return builder(_capped_export_payload(payload))

def _report_root_cause(filters, defect):
    if not defect: return []
    where_sql,params=build_where(filters); params=list(params)+[defect]
    conn=get_conn();
    rows=conn.execute(f"SELECT grade,work_center,heat_no,batch_no,output_weight FROM disposition {where_sql + (' AND ' if where_sql else 'WHERE ')}UPPER(TRIM(main_defect)) = UPPER(TRIM(?)) ORDER BY output_weight DESC LIMIT 30",params).fetchall(); conn.close()
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
    # Intelligence is the most complex/optional part of the report (deep,
    # closure-heavy analysis over every grade/work-center/defect combo). A
    # failure here — including a runaway RecursionError on an unusual data
    # shape — must never block the rest of the export, which is otherwise
    # perfectly good data the viewer is waiting on. Isolate it the same way
    # /api/qcr already isolates it for the live dashboard, and log the real
    # traceback server-side so a recurrence is actually diagnosable instead
    # of surfacing only a bare "maximum recursion depth exceeded" string.
    try:
        intel = compute_qcr_intelligence(filters, monthly, defects, wcg, kpis)
    except Exception:
        print("EXPORT: intelligence section degraded —", flush=True)
        traceback.print_exc()
        intel = {"comparison":{"current":None,"previous":None,"rows":[]},"why_changed":None,
                 "forecast":{},"early_warnings":[],"kpi_ranking":[],
                 "health_score":{"score":0,"status":"amber","reasons":[],"components":[]},
                 "risk_matrix":{"work_centers":[],"grades":[]},"recurring_patterns":[]}
    top_defect=(defects.get("register") or [{}])[0].get("defect","") if defects.get("register") else ""
    root_cause=_report_root_cause(filters,top_defect)
    fishbone = _fishbone_match(top_defect) if top_defect else None
    target=float(get_kpi_targets().get("First Pass Yield % (Prime%)",{}).get("target") or 0.97)
    target_history=[]
    for r in monthly.get("rows",[]):
        actual=float(r.get("first_pass_yield_pct") or 0)
        period_target=float(_historical_kpi_target("First Pass Yield % (Prime%)", r.get("name")) or target)
        target_history.append({"period":r.get("name"),"target":period_target,"actual":actual,"attainment":(actual/period_target if period_target else 0),"gap_pp":(actual-period_target)*100})
    return {"filters": filters, "kpis": kpis, "defects": defects, "wcg": wcg, "monthly": monthly, "period": period, "quarterly": quarterly, "yearly": yearly, "intel": intel, "root_cause": {"defect":top_defect,"rows":root_cause}, "target_history": {"target":target,"rows":target_history}, "fishbone": fishbone, "fishbone_style": _fishbone_style()}

def compute_qcr_intelligence(filters, monthly, defects, wcg, kpis=None):
    """Owns a single DB connection for the whole intelligence computation.

    The function below (_compute_qcr_intelligence) used to open and close a
    fresh connection ~8 separate times per call (once per internal query
    block). On a hosted Postgres connection pool this made QCR intelligence
    by far the most connection-hungry code path in the app: under any real
    concurrent load it was the first thing to hit "connection pool
    exhausted" — an error the caller catches and silently replaces with a
    fake 0/100 health score + empty problem list, which is why the Quality
    Health / Biggest Problem cards would intermittently show a contradictory
    "no issue" result while Target Breaches (computed elsewhere, on its own
    connection) kept showing real data. One shared connection, opened once
    and reused for every query in this function, removes that failure mode.
    """
    conn = get_conn()
    try:
        return _compute_qcr_intelligence(conn, filters, monthly, defects, wcg, kpis)
    finally:
        conn.close()


def _compute_qcr_intelligence(conn, filters, monthly, defects, wcg, kpis=None):
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
    def forecast_risk(label, value):
        cfg=get_kpi_targets().get(label) or {}
        direction=(cfg.get("direction") or "higher").lower()
        target=num(cfg.get("target")); warning=num(cfg.get("warning"))
        if direction=="lower":
            return "low" if value <= target else ("medium" if value <= warning else "high")
        if direction=="higher":
            return "low" if value >= target else ("medium" if value >= warning else "high")
        return "low"
    forecast["risk"]={"fpy":forecast_risk("First Pass Yield % (Prime%)",forecast["fpy"]),
                       "reject_pct":forecast_risk("Reject % Qty",forecast["reject_pct"]),
                       "defect_pct":forecast_risk("Defect Rate",forecast["defect_pct"])}
    forecast["thresholds"]={k:get_kpi_targets().get(v,{}) for k,v in {"fpy":"First Pass Yield % (Prime%)","reject_pct":"Reject % Qty","defect_pct":"Defect Rate"}.items()}

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
        c=conn.cursor()
        try:
            wh,pp=build_where(filters,exclude={dim})
            c.execute(f"SELECT {key}, COUNT(DISTINCT {BATCH_KEY_SQL}) coils, COALESCE(SUM(output_weight),0) qty, COALESCE(SUM(CASE WHEN quality_decision='REJECT' THEN output_weight ELSE 0 END),0) reject_qty FROM disposition {wh}{' AND ' if wh else 'WHERE '}{key}<>'' GROUP BY {key} ORDER BY reject_qty DESC, qty DESC LIMIT 30",pp)
            base=c.fetchall(); names=[r[0] for r in base]
            wh2,pp2=build_where(filters,exclude={dim,"month"})
            c.execute(f"SELECT {key}, month, COUNT(DISTINCT {BATCH_KEY_SQL}) coils, COALESCE(SUM(output_weight),0) qty, COALESCE(SUM(CASE WHEN quality_decision='REJECT' THEN output_weight ELSE 0 END),0) reject_qty FROM disposition {wh2}{' AND ' if wh2 else 'WHERE '}{key}<>'' AND month<>'' GROUP BY {key}, month ORDER BY month",pp2)
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
                confidence_level=conf(coils)
                risk="High" if score>=65 else ("Medium" if score>=35 else "Low")
                if confidence_level=="low" and risk=="High": risk="Medium"
                out.append({"name":name,"coils":coils,"qty":qty,"reject_qty":rej,"reject_pct":rp,"trend":trend,"recurrence":recurrence,"score":score,"risk":risk,"confidence":confidence_level})
            out.sort(key=lambda x:x["score"],reverse=True);return out
        finally:c.close()
    risk={"work_centers":dimension_rows("work_center","work_center"),"grades":dimension_rows("grade","grade")}

    # Defect history used for top contributors, recurrence, first appearance and improvements.
    c=conn.cursor()
    defect_hist={}; wc_hist={}; grade_hist={}
    try:
        wh,pp=build_where(filters,exclude={"month"})
        c.execute(f"SELECT month, main_defect, COUNT(DISTINCT {BATCH_KEY_SQL}) coils, COALESCE(SUM(output_weight),0) qty FROM disposition {wh}{' AND ' if wh else 'WHERE '}month<>'' AND main_defect<>'' AND main_defect<>'NO DEFECT' GROUP BY month,main_defect ORDER BY month",pp)
        for r in c.fetchall():defect_hist.setdefault(r[1],[]).append({"month":r[0],"coils":int(r[2] or 0),"qty":num(r[3])})
        c.execute(f"SELECT month, work_center, COUNT(DISTINCT {BATCH_KEY_SQL}) coils, COALESCE(SUM(output_weight),0) qty, COALESCE(SUM(CASE WHEN quality_decision='REJECT' THEN output_weight ELSE 0 END),0) reject_qty FROM disposition {wh}{' AND ' if wh else 'WHERE '}month<>'' AND work_center<>'' GROUP BY month,work_center ORDER BY month",pp)
        for r in c.fetchall():wc_hist.setdefault(r[1],[]).append({"month":r[0],"coils":int(r[2] or 0),"qty":num(r[3]),"reject":num(r[4])})
        c.execute(f"SELECT month, grade, COUNT(DISTINCT {BATCH_KEY_SQL}) coils, COALESCE(SUM(output_weight),0) qty, COALESCE(SUM(CASE WHEN quality_decision='REJECT' THEN output_weight ELSE 0 END),0) reject_qty FROM disposition {wh}{' AND ' if wh else 'WHERE '}month<>'' AND grade<>'' GROUP BY month,grade ORDER BY month",pp)
        for r in c.fetchall():grade_hist.setdefault(r[1],[]).append({"month":r[0],"coils":int(r[2] or 0),"qty":num(r[3]),"reject":num(r[4])})
    finally:c.close()

    # Current vs previous defect contribution.  The decomposition uses share of
    # total output for the defect and reject quantity for work-centre contribution.
    cur_def=[];prev_def=[]
    if cur:
        c=conn.cursor()
        try:
            for period,out in [(cur,"cur"),(prev,"prev")]:
                if not period: continue
                pf=dict(filters);pf["month"]=period.get("name");whx,px=build_where(pf)
                c.execute(f"SELECT main_defect,COALESCE(SUM(output_weight),0) qty FROM disposition {whx}{' AND ' if whx else 'WHERE '}main_defect<>'' AND main_defect<>'NO DEFECT' GROUP BY main_defect ORDER BY qty DESC",px)
                (cur_def if out=="cur" else prev_def).extend([{"name":r[0],"qty":num(r[1])} for r in c.fetchall()])
        finally:c.close()
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
        c=conn.cursor()
        try:
            for rr in recurring:
                period_month=rr["months"][-1]["month"]
                pf=dict(filters);pf["month"]=period_month;whx,px=build_where(pf)
                q=whx+((" AND " if whx else "WHERE ")+"main_defect = ?")
                pp=px+[rr["defect"]]
                c.execute(f"SELECT work_center,COUNT(DISTINCT {BATCH_KEY_SQL}) coils FROM disposition {q} GROUP BY work_center ORDER BY coils DESC LIMIT 1",pp)
                r=c.fetchone();rr["work_center"]=r[0] if r else "—"
                c.execute(f"SELECT grade,COUNT(DISTINCT {BATCH_KEY_SQL}) coils FROM disposition {q} GROUP BY grade ORDER BY coils DESC LIMIT 1",pp)
                r=c.fetchone();rr["grade"]=r[0] if r else "—"
        finally:c.close()
    new_issues.sort(key=lambda x:x["qty"],reverse=True);new_issues=new_issues[:8]
    # Attach the dominant Work Center / Grade for each new-issue defect too,
    # scoped to the month it actually first appeared in (same approach as the
    # recurring-defect enrichment above). Without this, "Investigate" on a
    # new-issue finding fell back to the single riskiest Work Center/Grade in
    # the whole dataset, which usually has nothing to do with this defect and
    # produced zero matching records.
    if new_issues:
        c=conn.cursor()
        try:
            for nn in new_issues:
                pf=dict(filters);pf["month"]=nn.get("month");whx,px=build_where(pf)
                q=whx+((" AND " if whx else "WHERE ")+"main_defect = ?")
                pp=px+[nn["defect"]]
                c.execute(f"SELECT work_center,COUNT(DISTINCT {BATCH_KEY_SQL}) coils FROM disposition {q} GROUP BY work_center ORDER BY coils DESC LIMIT 1",pp)
                r=c.fetchone();nn["work_center"]=r[0] if r else "—"
                c.execute(f"SELECT grade,COUNT(DISTINCT {BATCH_KEY_SQL}) coils FROM disposition {q} GROUP BY grade ORDER BY coils DESC LIMIT 1",pp)
                r=c.fetchone();nn["grade"]=r[0] if r else "—"
        finally:c.close()

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
        c=conn.cursor(); whq,pq=build_where(filters)
        c.execute(f"SELECT COUNT(*), SUM(CASE WHEN TRIM(COALESCE(defect_intensity,''))='' OR UPPER(TRIM(defect_intensity))='NONE' THEN 1 ELSE 0 END) FROM disposition {whq}",pq)
        dq_total,dq_missing=c.fetchone(); dq_total=int(dq_total or 0);dq_missing=int(dq_missing or 0)
    finally:
        try:c.close()
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
    c=conn.cursor()
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
        c.close()
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
            c=conn.cursor();arr=[]
            try:
                for period in (cur,prev):
                    pf=dict(filters);pf["month"]=period.get("name");whx,px=build_where(pf)
                    c.execute(f"SELECT work_center,COALESCE(SUM(output_weight),0) qty,COALESCE(SUM(CASE WHEN quality_decision='REJECT' THEN output_weight ELSE 0 END),0) rej FROM disposition {whx}{' AND ' if whx else 'WHERE '}work_center<>'' GROUP BY work_center",px)
                    arr.append({r[0]:num(r[2]) for r in c.fetchall()})
            finally:c.close()
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
    elif metric == 'month_category':
        clauses.append("month = ?"); extra.append(drill_value or '')
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
    # Guards against a slow/stalled client (e.g. a slowloris-style attack) holding a
    # connection — and its thread — open indefinitely.
    timeout = 30

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
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            # The client (a flaky mobile connection, a closed browser tab, a
            # cancelled export download) disconnected before we finished
            # writing. The response is already computed and any DB
            # connection used to build it was already closed above this
            # call, so there's nothing left to clean up or roll back --
            # just don't let it explode into a per-request traceback in
            # the server log.
            pass

    def _security_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        # Restricts script/style/font/connect sources to this app and the Google
        # Fonts CDN it uses; blocks framing and third-party base URIs. 'unsafe-inline'
        # is required because the app's UI relies on inline <script>/<style> — this
        # is not a full XSS mitigation on its own, but it still blocks an injected
        # payload from loading an external attacker script, exfiltrating data to a
        # third-party endpoint, or framing the app on another site.
        self.send_header("Content-Security-Policy",
            "default-src 'self'; script-src 'self' 'unsafe-inline'; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; "
            "connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'")
        if self.headers.get("X-Forwarded-Proto", "").lower() == "https":
            self.send_header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")

    def _send_json(self, payload, status=200):
        # default=str: Postgres returns TIMESTAMPTZ columns as native Python
        # datetime objects (SQLite returned them as plain TEXT strings, so
        # this never came up there). json.dumps can't serialize a datetime
        # on its own — it needs an explicit fallback, or the whole response
        # throws "Object of type datetime is not JSON serializable" and the
        # endpoint returns nothing. This affects any endpoint that touches a
        # timestamp column (KPI targets, fishbone/RCA data, disposition
        # rows, etc.), so fixing it here once covers all of them.
        body = json.dumps(payload, separators=(",", ":"), default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("X-Request-ID", secrets.token_hex(8))
        self.send_header("X-App-Version", APP_VERSION)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self._security_headers()
        self._write_body(body)

    def _send_html(self, html, status=200):
        body = html.encode("utf-8")
        self.send_response(status)
        self.send_header("X-Request-ID", secrets.token_hex(8))
        self.send_header("X-App-Version", APP_VERSION)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self._security_headers()
        self._write_body(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        qs = {k: v[0] for k, v in parse_qs(parsed.query).items()}

        # Health probe. Deliberately the first thing checked and it touches
        # nothing — no database, no auth, no disk — so it answers immediately
        # even while background initialisation is still running.
        if path in {"/healthz", "/readyz"}:
            # /healthz only answers whether the Python process is alive.
            # /readyz is the deployment gate and must return 503 until every
            # startup task succeeds. This prevents Render from marking a
            # deployment healthy when the database schema/seed/index setup
            # failed. No data is changed by this check.
            payload = {
                "ok": True if path == "/healthz" else STARTUP_READY,
                "ready": STARTUP_READY,
                "startup_error": STARTUP_ERROR or None,
                "backend": "postgres" if USE_POSTGRES else "sqlite",
            }
            self._send_json(payload, status=(200 if path == "/healthz" or STARTUP_READY else 503))
            return

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
                self.send_header("X-App-Version", APP_VERSION)
                self.send_header("X-Content-Type-Options", "nosniff")
                self._write_body(body)
                return
            else:
                self.send_error(404)
        # Intro video (dashboard splash screen). Served with HTTP Range support
        # so browsers/mobile Safari can seek and start playback immediately;
        # without Range support some browsers refuse to play the file at all.
        # This was previously missing entirely, which made every request for
        # the video 404 and left the intro screen blank/black.
        if path == "/quality_nonferrous_intro_light.mp4":
            asset = os.path.join(os.path.dirname(os.path.abspath(__file__)), path.lstrip("/"))
            if os.path.isfile(asset):
                file_size = os.path.getsize(asset)
                range_header = self.headers.get("Range")
                if range_header:
                    try:
                        units, _, rng = range_header.partition("=")
                        start_s, _, end_s = rng.partition("-")
                        start = int(start_s) if start_s else 0
                        end = int(end_s) if end_s else file_size - 1
                        end = min(end, file_size - 1)
                        if start > end or start >= file_size:
                            self.send_response(416)
                            self.send_header("Content-Range", f"bytes */{file_size}")
                            self.end_headers()
                            return
                        with open(asset, "rb") as f:
                            f.seek(start)
                            chunk = f.read(end - start + 1)
                        self.send_response(206)
                        self.send_header("Content-Type", "video/mp4")
                        self.send_header("Accept-Ranges", "bytes")
                        self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
                        self.send_header("Content-Length", str(len(chunk)))
                        self.send_header("Cache-Control", "public, max-age=31536000, immutable")
                        self.send_header("X-Content-Type-Options", "nosniff")
                        self.end_headers()
                        self.wfile.write(chunk)
                        return
                    except (ValueError, IndexError):
                        pass
                with open(asset, "rb") as f:
                    body = f.read()
                self.send_response(200)
                self.send_header("Content-Type", "video/mp4")
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("Cache-Control", "public, max-age=31536000, immutable")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            else:
                self.send_error(404)
                return
        # Static browser identity assets (favicon / PWA manifest).
        # These must be served by the Python server; otherwise browser requests
        # for /favicon.ico and /favicon-*.png would fall through to a 404.
        if path in {"/favicon.ico", "/favicon-16.png", "/favicon-32.png", "/favicon-48.png",
                    "/favicon-64.png", "/favicon-128.png", "/favicon-180.png",
                    "/favicon-192.png", "/favicon-256.png", "/favicon-512.png",
                    "/site.webmanifest", "/jsl-header-logo.png", "/jsl-watermark.png",
                    "/quality_nonferrous_intro_endcard.png"}:
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
            self._security_headers()
            self._write_body(body.encode("utf-8"))
        elif path == "/api/auth/status":
            meta = _viewer_meta(self)
            admin_meta = _admin_meta(self)
            if meta:
                self._send_json({"authenticated": True, "username": meta.get("username",""), "display_name": meta.get("display_name",""), "role": meta.get("role","")})
            elif admin_meta:
                self._send_json({"authenticated": True, "username": admin_meta.get("username",ADMIN_USERNAME), "display_name": admin_meta.get("display_name","Administrator"), "role": admin_meta.get("role","admin"), "must_reset_password": bool(admin_meta.get("must_reset"))})
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
                    "style": _fishbone_style(),
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
                elif metric in {'Salvage % Qty'}: clauses.append("quality_decision = ?"); extra.append('SALVAGE')
                elif metric in {'Salvage + Divert Qty (MT)'}: clauses.append("quality_decision IN (?,?)"); extra.extend(['SALVAGE','DIVERT'])
                elif metric in {'Rework % Qty'}: clauses.append("quality_decision = ?"); extra.append('RE-WORK')
                elif metric == 'decision_category': clauses.append("quality_decision = ?"); extra.append(drill_value or '')
                elif metric == 'defect_category': clauses.append("main_defect = ?"); extra.append(drill_value or '')
                elif metric == 'month_category': clauses.append("month = ?"); extra.append(drill_value or '')
                elif metric == 'heat_detail': clauses.append("UPPER(TRIM(COALESCE(heat_no,''))) = UPPER(TRIM(?))"); extra.append(drill_value or '')
                elif metric == 'quality_investigation':
                    wc=str(qs.get('work_center','All') or 'All').strip(); grade=str(qs.get('grade','All') or 'All').strip(); defect=str(drill_value or '').strip()
                    if wc and wc.lower()!='all': clauses.append('work_center = ?'); extra.append(wc)
                    if grade and grade.lower()!='all': clauses.append('grade = ?'); extra.append(grade)
                    if defect and defect.lower() not in {'all','—','-'}: clauses.append("main_defect = ? AND main_defect <> '' AND main_defect <> 'NO DEFECT'"); extra.append(defect)
                if clauses: where_sql=where_sql+(' AND ' if where_sql else 'WHERE ')+' AND '.join(clauses); base_params+=extra
                conn=get_conn(); cur=conn.cursor(); cur.execute(f"SELECT COUNT(*), COUNT(DISTINCT {BATCH_KEY_SQL}), COALESCE(SUM(output_weight),0) FROM disposition {where_sql}",base_params); total_rows,total_coils,total_weight=cur.fetchone(); conn.close()
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
                for r in rows: w.writerow([_csv_safe_value(r['insp_lot_date']),_csv_safe_value(r['heat_no']),_csv_safe_value(r['batch_no']),_csv_safe_value(r['work_center']),_csv_safe_value(r['grade']),_csv_safe_value(r['main_defect']),_csv_safe_value(r['defect_intensity']),_csv_safe_value(r['quality_decision']),r['output_weight']])
                _activity_event(self, 'drilldown_export_csv', filters=filters)
                _send_bytes(self,out.getvalue().encode('utf-8-sig'),'text/csv; charset=utf-8','drilldown_records.csv')
            except Exception as e:
                self._send_json({'error':str(e)}, status=500)
        elif path == "/api/qcr":
            filters = {k: qs.get(k, "All") for k in FILTER_KEYS}
            cache_key = "qcr:" + json.dumps(filters, sort_keys=True, separators=(",", ":"))
            hit = _cache_get(cache_key)
            if hit is not None:
                self._send_json(hit); return
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
                _cache_put(cache_key, payload)
                self._send_json(payload)
            except Exception as e: self._send_json({"error": str(e)}, status=500)
        elif path == "/api/root_cause":
            filters = {k: qs.get(k, "All") for k in FILTER_KEYS}; defect = qs.get("defect", "").strip()
            if not defect: self._send_json({"error":"defect required"}, status=400); return
            try:
                where, params = build_where(filters)
                conn=get_conn(); cur=conn.cursor(); extra=(where + (" AND " if where else "WHERE ") + "main_defect = ?")
                p=params+[defect]
                cur.execute(f"SELECT grade, work_center, COUNT(DISTINCT {BATCH_KEY_SQL}) coils, COALESCE(SUM(output_weight),0) qty FROM disposition {extra} GROUP BY grade,work_center ORDER BY qty DESC LIMIT 10",p)
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
            except Exception as e:
                print("EXPORT excel FAILED (assembling data) —", flush=True); traceback.print_exc()
                self._send_json({"error": str(e)}, status=500); return
            if not _EXPORT_SEMAPHORE.acquire(timeout=EXPORT_WAIT_TIMEOUT_S):
                self._send_json({"error": f"The server is already generating {EXPORT_CONCURRENCY} other report(s). Please retry in a few seconds."}, status=503); return
            try:
                data = _build_export_with_retry("excel", _excel_report, payload)
                _activity_event(self, "export_excel", filters=payload["filters"])
                _send_bytes(self, data, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", _safe_filename(payload["filters"], ".xlsx"))
            except RecursionError as e:
                self._send_json({"error": _export_recursion_response("excel", e)}, status=500)
            except Exception as e:
                print("EXPORT excel FAILED —", flush=True); traceback.print_exc()
                self._send_json({"error": str(e)}, status=500)
            finally:
                _EXPORT_SEMAPHORE.release()
        elif path == "/api/export/pdf":
            try:
                payload = _export_data(_export_filters(qs))
            except Exception as e:
                print("EXPORT pdf FAILED (assembling data) —", flush=True); traceback.print_exc()
                self._send_json({"error": str(e)}, status=500); return
            if not _EXPORT_SEMAPHORE.acquire(timeout=EXPORT_WAIT_TIMEOUT_S):
                self._send_json({"error": f"The server is already generating {EXPORT_CONCURRENCY} other report(s). Please retry in a few seconds."}, status=503); return
            try:
                data = _build_export_with_retry("pdf", _pdf_report, payload)
                _activity_event(self, "export_pdf", filters=payload["filters"])
                _send_bytes(self, data, "application/pdf", _safe_filename(payload["filters"], ".pdf"))
            except RecursionError as e:
                self._send_json({"error": _export_recursion_response("pdf", e)}, status=500)
            except Exception as e:
                print("EXPORT pdf FAILED —", flush=True); traceback.print_exc()
                self._send_json({"error": str(e)}, status=500)
            finally:
                _EXPORT_SEMAPHORE.release()
        elif path == "/api/export/pptx":
            try:
                payload = _export_data(_export_filters(qs))
            except Exception as e:
                print("EXPORT pptx FAILED (assembling data) —", flush=True); traceback.print_exc()
                self._send_json({"error": str(e)}, status=500); return
            if not _EXPORT_SEMAPHORE.acquire(timeout=EXPORT_WAIT_TIMEOUT_S):
                self._send_json({"error": f"The server is already generating {EXPORT_CONCURRENCY} other report(s). Please retry in a few seconds."}, status=503); return
            try:
                data = _build_export_with_retry("pptx", _pptx_report, payload)
                _activity_event(self, "export_pptx", filters=payload["filters"])
                _send_bytes(self, data, "application/vnd.openxmlformats-officedocument.presentationml.presentation", _safe_filename(payload["filters"], ".pptx"))
            except RecursionError as e:
                self._send_json({"error": _export_recursion_response("pptx", e)}, status=500)
            except Exception as e:
                print("EXPORT pptx FAILED —", flush=True); traceback.print_exc()
                self._send_json({"error": str(e)}, status=500)
            finally:
                _EXPORT_SEMAPHORE.release()
        elif path == "/api/export/csv":
            try:
                filters = _export_filters(qs); where_sql, params = build_where(filters)
                conn = get_conn(); cur = conn.cursor(); cur.execute(f"SELECT insp_lot_date,heat_no,batch_no,work_center,grade,output_weight,main_defect,defect_intensity,quality_decision,month,week,quarter,financial_year FROM disposition {where_sql} ORDER BY id", params); rows=cur.fetchall(); conn.close()
                out=io.StringIO(newline=''); w=csv.writer(out); w.writerow(["Insp Lot Date","HEAT NO","BATCH NO","Work Center","Grade","Output Weight (MT)","Main Defect","Defect Intensity","Quality Decision","Month","Week","Quarter","Financial Year"]); [w.writerow([_csv_safe_value(v) for v in r]) for r in rows]
                _activity_event(self, "export_csv", filters=filters)
                _send_bytes(self,out.getvalue().encode('utf-8-sig'),"text/csv; charset=utf-8",_safe_filename(filters,".csv"))
            except Exception as e:
                print("EXPORT csv FAILED —", flush=True); traceback.print_exc()
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
                    "persistent": bool(USE_POSTGRES or os.path.abspath(DB_PATH) != os.path.abspath(_BUNDLED_SEED_DB)),
                    "latency_ms": latency_ms,
                    "checked_at": datetime.now().strftime("%d-%b-%Y %H:%M:%S")
                })
            except Exception as e:
                self._send_json({
                    "connected": False,
                    "provider": "PostgreSQL" if USE_POSTGRES else "SQLite",
                    "persistent": bool(USE_POSTGRES or os.path.abspath(DB_PATH) != os.path.abspath(_BUNDLED_SEED_DB)),
                    "error": str(e)[:180],
                    "checked_at": datetime.now().strftime("%d-%b-%Y %H:%M:%S")
                }, status=503)
        if path == "/api/activity":
            if not _is_admin(self): _auth_error(self); return
            _activity_event(self,"activity_view")
            try:
                conn=get_conn()
                total_users=conn.execute("SELECT COUNT(*) FROM users WHERE active=TRUE").fetchone()[0]
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
                current_target=float(get_kpi_targets().get("First Pass Yield % (Prime%)",{}).get("target") or 0.97)
                history=[]
                for r in monthly.get("rows",[]):
                    actual=float(r.get("first_pass_yield_pct") or 0)
                    target=_historical_kpi_target("First Pass Yield % (Prime%)", r.get("name"))
                    history.append({"period":r.get("name"),"target":target,"actual":actual,"attainment":(actual/target if target else 0),"gap_pp":(actual-target)*100})
                self._send_json({"target":current_target,"rows":history})
            except Exception as e: self._send_json({"error":str(e)},status=500)
        elif path == "/api/kpi_targets":
            try:
                self._send_json({"targets": get_kpi_targets()})
            except Exception as e:
                self._send_json({"error": str(e)}, status=500)
        elif path == "/api/admin/service_health":
            if not _is_admin(self): _auth_error(self)
            else:
                conn=None
                try:
                    started=time.perf_counter(); conn=get_conn(); conn.execute("SELECT 1").fetchone(); db_ms=round((time.perf_counter()-started)*1000,2)
                    total=int(conn.execute("SELECT COUNT(*) FROM disposition").fetchone()[0] or 0)
                    latest_import=None
                    try:
                        latest_import=conn.execute("SELECT MAX(created_at) FROM import_history").fetchone()[0]
                    except Exception:
                        conn.rollback()
                    latest_activity=None
                    try:
                        latest_activity=conn.execute("SELECT MAX(created_at) FROM activity_log").fetchone()[0]
                    except Exception:
                        conn.rollback()
                    conn.close(); conn=None
                    backups=_list_backups()
                    session_ok=bool(_cookie_value(self.headers.get("Cookie",""),"qdash_admin"))
                    checks=[
                        {"key":"database","label":"Database","status":"healthy","detail":f"{total:,} live records · {db_ms} ms"},
                        {"key":"authentication","label":"Authentication","status":"healthy" if session_ok else "warning","detail":"Admin session active" if session_ok else "Session check unavailable"},
                        {"key":"backup","label":"Backup","status":"healthy" if backups else "warning","detail":f"{len(backups)} snapshot(s) available" if backups else "No snapshot available"},
                        {"key":"monitoring","label":"Monitoring","status":"healthy","detail":"Read-only checks active"},
                    ]
                    latest_candidates=[x for x in (latest_import, latest_activity) if x]
                    latest_dt=max(latest_candidates) if latest_candidates else None
                    freshness_status="unknown"; freshness_age_hours=None
                    if latest_dt:
                        try:
                            txt=str(latest_dt).replace("Z","+00:00")
                            dt=_dt.datetime.fromisoformat(txt)
                            if dt.tzinfo is None: dt=dt.replace(tzinfo=_dt.timezone.utc)
                            freshness_age_hours=round(max(0,(_dt.datetime.now(_dt.timezone.utc)-dt.astimezone(_dt.timezone.utc)).total_seconds()/3600),1)
                            freshness_status="fresh" if freshness_age_hours < 24 else ("stale" if freshness_age_hours < 72 else "very_stale")
                        except Exception:
                            freshness_status="unknown"
                    freshness_detail=(f"Last activity {freshness_age_hours:.1f}h ago" if freshness_age_hours is not None else "No import/activity timestamp")
                    if freshness_status in ("stale","very_stale"): freshness_detail += " · review freshness"
                    checks.append({"key":"freshness","label":"Data freshness","status":"healthy" if freshness_status in ("fresh","unknown") else "warning","detail":freshness_detail})
                    self._send_json({"ok":True,"provider":"PostgreSQL" if USE_POSTGRES else "SQLite","checks":checks,"record_count":total,"db_latency_ms":db_ms,"latest_import":str(latest_import) if latest_import is not None else "","latest_activity":str(latest_activity) if latest_activity is not None else "","freshness_status":freshness_status,"freshness_age_hours":freshness_age_hours,"checked_at":datetime.now().strftime("%d-%b-%Y %H:%M:%S")})
                except Exception as e:
                    try:
                        if conn: conn.close()
                    except Exception: pass
                    self._send_json({"ok":False,"error":str(e)[:180]},status=503)
        elif path == "/api/admin/production_health":
            if not _is_admin(self): _auth_error(self)
            else:
                started=time.perf_counter(); conn=None
                try:
                    conn=get_conn()
                    conn.execute("SELECT 1").fetchone()
                    latency=round((time.perf_counter()-started)*1000,1)
                    provider="PostgreSQL" if USE_POSTGRES else "SQLite"
                    version=""
                    if USE_POSTGRES:
                        row=conn.execute("SELECT current_database(), version()").fetchone()
                        version=str(row[1]).split(',')[0] if row else ""
                    else:
                        row=conn.execute("SELECT sqlite_version()").fetchone(); version="SQLite "+str(row[0]) if row else ""
                    self._send_json({"ok":True,"provider":provider,"latency_ms":latency,"status":"healthy" if latency<500 else ("warning" if latency<1500 else "slow"),"version":version,"render_service":os.environ.get("RENDER_SERVICE_NAME", ""),"git_commit":os.environ.get("RENDER_GIT_COMMIT", os.environ.get("RENDER_GIT_COMMIT_SHORT", "")),"deploy_id":os.environ.get("RENDER_INSTANCE_ID", "")})
                except Exception as e:
                    self._send_json({"ok":False,"status":"unavailable","error":str(e)[:300]},status=503)
                finally:
                    if conn is not None:
                        try: conn.close()
                        except Exception: pass
        elif path == "/api/admin/db_performance":
            if not _is_admin(self): _auth_error(self)
            else:
                conn=None
                try:
                    conn=get_conn()
                    lat=[]
                    provider="PostgreSQL" if USE_POSTGRES else "SQLite"
                    for _ in range(2):
                        started=time.perf_counter()
                        conn.execute("SELECT 1").fetchone()
                        lat.append(round((time.perf_counter()-started)*1000,1))
                    avg=round(sum(lat)/len(lat),1)
                    status="healthy" if avg<250 else ("warning" if avg<1000 else "slow")
                    self._send_json({"ok":True,"provider":provider,"latency_ms":lat[0],"second_latency_ms":lat[1],"avg_latency_ms":avg,"status":status,"checked_at":_dt.datetime.now(_dt.timezone.utc).isoformat().replace("+00:00","Z")})
                except Exception as e:
                    self._send_json({"ok":False,"error":str(e)[:300]},status=503)
                finally:
                    if conn is not None:
                        try: conn.close()
                        except Exception: pass
        elif path == "/api/admin/data_integrity":
            if not _is_admin(self): _auth_error(self)
            else:
                conn=None
                try:
                    conn=get_conn()
                    def q1(sql):
                        r=conn.execute(sql).fetchone(); return int(r[0] or 0) if r else 0
                    total=q1("SELECT COUNT(*) FROM disposition")
                    missing_heat=q1("SELECT COUNT(*) FROM disposition WHERE TRIM(COALESCE(heat_no,''))='' ")
                    missing_batch=q1("SELECT COUNT(*) FROM disposition WHERE TRIM(COALESCE(batch_no,''))='' ")
                    missing_grade=q1("SELECT COUNT(*) FROM disposition WHERE TRIM(COALESCE(grade,''))='' ")
                    missing_decision=q1("SELECT COUNT(*) FROM disposition WHERE TRIM(COALESCE(quality_decision,''))='' ")
                    missing_date=q1("SELECT COUNT(*) FROM disposition WHERE TRIM(COALESCE(insp_lot_date,''))='' ")
                    duplicate_batch_groups=q1("SELECT COUNT(*) FROM (SELECT TRIM(batch_no) b, COUNT(*) c FROM disposition WHERE TRIM(COALESCE(batch_no,''))<>'' GROUP BY TRIM(batch_no) HAVING COUNT(*)>1) x")
                    if USE_POSTGRES:
                        invalid_weight=q1("SELECT COUNT(*) FROM disposition WHERE output_weight IS NULL OR output_weight::text IN ('NaN','Infinity','-Infinity') OR output_weight<=0")
                        missing_intensity=q1("SELECT COUNT(*) FROM disposition WHERE TRIM(COALESCE(defect_intensity,''))='' OR UPPER(TRIM(defect_intensity))='NONE'")
                    else:
                        invalid_weight=q1("SELECT COUNT(*) FROM disposition WHERE output_weight IS NULL OR output_weight<=0 OR output_weight!=output_weight")
                        missing_intensity=q1("SELECT COUNT(*) FROM disposition WHERE TRIM(COALESCE(defect_intensity,''))='' OR UPPER(TRIM(defect_intensity))='NONE'")
                    issue_total=missing_heat+missing_batch+missing_grade+missing_decision+missing_date+duplicate_batch_groups+invalid_weight+missing_intensity
                    self._send_json({"ok":True,"records":total,"issues":issue_total,"checks":{"missing_heat":missing_heat,"missing_batch":missing_batch,"missing_grade":missing_grade,"missing_decision":missing_decision,"missing_date":missing_date,"missing_intensity":missing_intensity,"duplicate_batch_groups":duplicate_batch_groups,"invalid_weight":invalid_weight}})
                except Exception as e:
                    self._send_json({"ok":False,"error":str(e)[:300]},status=500)
                finally:
                    if conn is not None:
                        try: conn.close()
                        except Exception: pass

        elif path == "/api/admin/deployment_health":
            if not _is_admin(self): _auth_error(self)
            else:
                try:
                    now=time.time()
                    commit=os.environ.get("RENDER_GIT_COMMIT", os.environ.get("RENDER_GIT_COMMIT_SHORT", ""))
                    service=os.environ.get("RENDER_SERVICE_NAME", "")
                    instance=os.environ.get("RENDER_INSTANCE_ID", "")
                    env_name=os.environ.get("RENDER_SERVICE_TYPE", "") or ("render" if service or commit or instance else "local")
                    deploy_ts=os.environ.get("RENDER_DEPLOY_TIMESTAMP", os.environ.get("DEPLOY_TIMESTAMP", ""))
                    self._send_json({"ok":True,"app_version":ADMIN_BUILD_VERSION,"environment":env_name,"service":service,"commit":commit,"commit_short":commit[:10] if commit else "","instance":instance,"deploy_timestamp":deploy_ts,"uptime_seconds":round(max(0,now-SERVER_STARTED_AT)),"python_version":sys.version.split()[0],"pid":os.getpid()})
                except Exception as e:
                    self._send_json({"ok":False,"error":str(e)[:240]},status=500)
        elif path == "/api/admin/error_monitor":
            if not _is_admin(self): _auth_error(self)
            else:
                conn=None
                try:
                    conn=get_conn()
                    # Read-only operational signals. Do not add tables, mutate rows, or alter schema.
                    patterns=("%error%","%fail%","%exception%")
                    clauses=[]; params=[]
                    for pat in patterns:
                        clauses.append("LOWER(event_type) LIKE %s" if USE_POSTGRES else "LOWER(event_type) LIKE ?"); params.append(pat)
                    where=" OR ".join(clauses)
                    recent_sql=f"SELECT event_type,created_at,tab FROM activity_log WHERE ({where}) ORDER BY created_at DESC LIMIT 25"
                    recent=conn.execute(recent_sql,tuple(params)).fetchall()
                    import_errors=conn.execute("SELECT COUNT(*) FROM import_history WHERE COALESCE(errors,0)>0").fetchone()[0]
                    import_recent=conn.execute("SELECT filename,errors,updated,imported,created_at FROM import_history WHERE COALESCE(errors,0)>0 ORDER BY created_at DESC LIMIT 10").fetchall()
                    if USE_POSTGRES:
                        last24=conn.execute("SELECT COUNT(*) FROM activity_log WHERE (LOWER(event_type) LIKE %s OR LOWER(event_type) LIKE %s OR LOWER(event_type) LIKE %s) AND created_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'",patterns).fetchone()[0]
                    else:
                        last24=conn.execute("SELECT COUNT(*) FROM activity_log WHERE (LOWER(event_type) LIKE ? OR LOWER(event_type) LIKE ? OR LOWER(event_type) LIKE ?) AND datetime(created_at) >= datetime('now','-24 hours')",patterns).fetchone()[0]
                    conn.close(); conn=None
                    self._send_json({"ok":True,"last_24h":int(last24 or 0),"recent":[dict(r) for r in recent],"import_error_events":int(import_errors or 0),"import_recent":[dict(r) for r in import_recent]})
                except Exception as e:
                    self._send_json({"ok":False,"error":str(e)[:300]},status=500)
                finally:
                    if conn is not None:
                        try: conn.close()
                        except Exception: pass
        elif path == "/api/admin/home":
            if not _is_admin(self): _auth_error(self)
            else:
                try:
                    conn=get_conn()
                    total=conn.execute("SELECT COUNT(*) FROM disposition").fetchone()[0]
                    last=conn.execute("SELECT MAX(created_at) FROM import_history").fetchone()[0] or conn.execute("SELECT MAX(insp_lot_date) FROM disposition WHERE insp_lot_date <> ''").fetchone()[0]
                    admins=conn.execute("SELECT COUNT(*) FROM users WHERE active=TRUE AND role='admin'").fetchone()[0]
                    last_login=conn.execute("SELECT MAX(created_at) FROM activity_log WHERE event_type='admin_login'").fetchone()[0]
                    failed=conn.execute("SELECT COUNT(*) FROM activity_log WHERE event_type='admin_login_failed'").fetchone()[0]
                    views=conn.execute("SELECT COUNT(*) FROM activity_log WHERE event_type='dashboard_open'").fetchone()[0]
                    imports=conn.execute("SELECT COUNT(*) FROM import_history").fetchone()[0]
                    conn.close()
                    ds=database_status()
                    self._send_json({"total_records":total,"last_data_update":last or "—","database_size_mb":ds.get("used_mb",0),"active_admins":admins,"dashboard_views":views,"last_login":last_login or "—","failed_login_attempts":failed,"imports":imports})
                except Exception as e: self._send_json({"error":str(e)},status=500)
        elif path == "/api/admin/audit_analytics":
            if not _is_admin(self): _auth_error(self)
            else:
                try:
                    conn=get_conn()
                    total=conn.execute("SELECT COUNT(*) FROM audit_trail").fetchone()[0]
                    actions=conn.execute("SELECT action,COUNT(*) c FROM audit_trail GROUP BY action ORDER BY c DESC LIMIT 12").fetchall()
                    users=conn.execute("SELECT COALESCE(username,'Unknown') username,COUNT(*) c FROM audit_trail GROUP BY username ORDER BY c DESC LIMIT 10").fetchall()
                    recent=conn.execute("SELECT COUNT(*) FROM audit_trail WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'").fetchone()[0] if USE_POSTGRES else conn.execute("SELECT COUNT(*) FROM audit_trail WHERE datetime(created_at) >= datetime('now','-24 hours')").fetchone()[0]
                    conn.close()
                    self._send_json({"total":total,"last_24h":recent,"actions":[dict(r) for r in actions],"users":[dict(r) for r in users]})
                except Exception as e: self._send_json({"error":str(e)},status=500)
        elif path == "/api/admin/backup/verify":
            if not _is_admin(self): _auth_error(self)
            else:
                try:
                    name=os.path.basename(str(qs.get("name",""))); fpath=os.path.join(BACKUP_DIR,name)
                    if not name.startswith("backup_") or not name.endswith(".json.gz") or not os.path.isfile(fpath): raise ValueError("Backup file not found")
                    with gzip.open(fpath,"rt",encoding="utf-8") as f: data=json.load(f)
                    valid, reason = _backup_is_valid(data)
                    self._send_json({"valid":bool(valid),"filename":name,"reason":reason,"counts":data.get("counts",{}),"backup_version":data.get("backup_version"),"size_bytes":os.path.getsize(fpath)})
                except Exception as e: self._send_json({"valid":False,"error":str(e)},status=400)
        elif path == "/api/admin/validation_rules":
            if not _is_admin(self): _auth_error(self)
            else:
                self._send_json({"rules":[
                    {"id":"required_heat","name":"Heat No required","severity":"High","field":"heat_no","description":"Every disposition record should contain a Heat No."},
                    {"id":"unique_batch","name":"Batch No unique","severity":"High","field":"batch_no","description":"A Batch No should map to one disposition record."},
                    {"id":"valid_grade","name":"Grade required","severity":"Medium","field":"grade","description":"Grade must be populated."},
                    {"id":"valid_decision","name":"Decision controlled","severity":"High","field":"quality_decision","description":"Decision must use an approved disposition value."},
                    {"id":"valid_weight","name":"Weight greater than zero","severity":"Medium","field":"output_weight","description":"Output weight must be present and greater than zero."},
                    {"id":"valid_date","name":"Inspection date valid","severity":"High","field":"insp_lot_date","description":"Inspection date must be present and YYYY-MM-DD compatible."},
                    {"id":"defect_intensity","name":"Defect intensity required","severity":"Medium","field":"defect_intensity","description":"Defect intensity should be populated for traceability."},
                    {"id":"workcenter_defect","name":"Work Center + Defect required","severity":"Medium","field":"work_center/main_defect","description":"Work Center and Main Defect should be populated."}
                ]})
        elif path == "/api/admin/security_status":
            if not _is_admin(self): _auth_error(self)
            else:
                try:
                    _cleanup_sessions()
                    now=time.time(); current=_cookie_value(self.headers.get("Cookie",""),"qdash_admin")
                    sessions=[]
                    for tok,meta in list(SESSIONS.items()):
                        if meta.get("expires",0)>now and meta.get("role") in ("admin","qa_engineer","importer","auditor"):
                            sessions.append({"current":tok==current,"username":meta.get("username",""),"display_name":meta.get("display_name","") or meta.get("username",""),"role":meta.get("role",""),"expires_in":max(0,int(meta.get("expires",0)-now))})
                    sessions.sort(key=lambda x:(not x["current"],x["username"]))
                    self._send_json({"active_sessions":len(sessions),"sessions":sessions[:50],"session_ttl_hours":SESSION_TTL/3600,"login_max_attempts":LOGIN_MAX_ATTEMPTS})
                except Exception as e: self._send_json({"error":str(e)},status=500)
        elif path == "/api/admin/data_quality":
            if not _is_admin(self): _auth_error(self)
            else:
                try:
                    conn=get_conn()
                    rows=conn.execute("SELECT id,heat_no,batch_no,grade,quality_decision,output_weight,insp_lot_date,defect_intensity,work_center,main_defect FROM disposition").fetchall()
                    conn.close()
                    valid_decisions={"PRIME","FOR NEXT PROCESS","SALVAGE","HOLD FOR DECISION","REJECT","RE-WORK","DIVERT"}
                    counts={k:0 for k in ["missing_heat_no","missing_batch_no","duplicate_batch","missing_grade","missing_decision","missing_weight","invalid_dates","missing_intensity","invalid_values"]}
                    bad_ids=set(); batches={}
                    for r in rows:
                        d=dict(r); rid=d.get("id")
                        heat=str(d.get("heat_no") or "").strip(); batch=str(d.get("batch_no") or "").strip()
                        if not heat: counts["missing_heat_no"]+=1; bad_ids.add(rid)
                        if not batch: counts["missing_batch_no"]+=1; bad_ids.add(rid)
                        if not str(d.get("grade") or "").strip(): counts["missing_grade"]+=1; bad_ids.add(rid)
                        dec=str(d.get("quality_decision") or "").strip().upper()
                        if not dec: counts["missing_decision"]+=1; bad_ids.add(rid)
                        elif dec not in valid_decisions: counts["invalid_values"]+=1; bad_ids.add(rid)
                        wt=d.get("output_weight")
                        try:
                            wt_num = float(wt) if wt is not None else None
                        except Exception:
                            wt_num = None
                        if wt_num is None or not math.isfinite(wt_num) or wt_num <= 0: counts["missing_weight"]+=1; bad_ids.add(rid)
                        datev=str(d.get("insp_lot_date") or "").strip()
                        invalid_date=False
                        if not datev: invalid_date=True
                        else:
                            try: datetime.strptime(datev[:10], "%Y-%m-%d")
                            except Exception: invalid_date=True
                        if invalid_date: counts["invalid_dates"]+=1; bad_ids.add(rid)
                        if not str(d.get("defect_intensity") or "").strip() or str(d.get("defect_intensity") or "").strip().upper() == "NONE": counts["missing_intensity"]+=1; bad_ids.add(rid)
                        if not str(d.get("work_center") or "").strip() or (not str(d.get("main_defect") or "").strip()): counts["invalid_values"]+=1; bad_ids.add(rid)
                        if batch: batches.setdefault(batch.upper(),[]).append(rid)  # BATCH NO must be unique — one coil, one batch
                    dup_groups=[]
                    for key,ids in batches.items():
                        if len(ids)>1:
                            counts["duplicate_batch"] += len(ids)-1
                            bad_ids.update(ids[1:]); dup_groups.append({"batch_no":key,"count":len(ids)})
                    total=len(rows); corrections=len(bad_ids)
                    issue_total=sum(counts.values())
                    score=round(max(0,100*(1-(corrections/max(total,1)))),1)
                    self._send_json({"total":total,"score":score,"records_require_correction":corrections,"issues":counts,"duplicate_batch_rows":[*sorted(dup_groups,key=lambda x:x["count"],reverse=True)[:20]]})
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
                    out=io.StringIO(newline=''); w=csv.writer(out); w.writerow(["Time","User","IP Address","Action","Tab","User Agent"]); [w.writerow([_csv_safe_value(r[4]),_csv_safe_value(r[1]),_csv_safe_value(r[0]),_csv_safe_value(r[2]),_csv_safe_value(r[3]),_csv_safe_value(r[5])]) for r in rows]
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
        elif path == "/api/admin/backup/list":
            if not _is_admin(self):
                _auth_error(self)
            else:
                try:
                    self._send_json({"backups": _list_backups(), "backup_dir": BACKUP_DIR, "keep": BACKUP_KEEP})
                except Exception as e:
                    self._send_json({"error": str(e)}, status=500)
        elif path == "/api/admin/backup/download":
            if not _is_admin(self):
                _auth_error(self)
            else:
                try:
                    name = os.path.basename(str(qs.get("name", "")))
                    fpath = os.path.join(BACKUP_DIR, name)
                    if not name.startswith("backup_") or not name.endswith(".json.gz") or not os.path.isfile(fpath):
                        raise ValueError("Backup file not found")
                    with open(fpath, "rb") as f:
                        data = f.read()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/gzip")
                    self.send_header("Content-Disposition", f'attachment; filename="{name}"')
                    self.send_header("Content-Length", str(len(data)))
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()
                    self.wfile.write(data)
                except Exception as e:
                    self._send_json({"error": str(e)}, status=404)
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
                        writer.writerow([_csv_safe_value(d.get(k, "")) for k in ["id","insp_lot_date","heat_no","batch_no","work_center","grade","output_weight","main_defect","defect_intensity","quality_decision","month","week","quarter","financial_year"]])
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
        try:
            declared_length = int(self.headers.get("Content-Length", "0") or 0)
        except ValueError:
            declared_length = 0
        if declared_length > MAX_REQUEST_BYTES:
            self._send_json({"error": f"Request body too large (max {MAX_REQUEST_BYTES // (1024*1024)} MB)."}, status=413)
            return
        transfer_encoding = str(self.headers.get("Transfer-Encoding", "")).lower()
        if transfer_encoding and transfer_encoding != "identity":
            self._send_json({"error": "Transfer-Encoding is not supported; send a Content-Length body."}, status=411)
            return
        if path.startswith("/api/admin/") and path not in ("/api/admin/login",):
            if not _admin_post_allowed(self):
                return
            if path != "/api/admin/change_password":
                _meta_for_reset_check = _admin_meta(self)
                if _meta_for_reset_check and _meta_for_reset_check.get("must_reset"):
                    self._send_json({"error": "A new password has been set for your account. Please set your own password before continuing.", "must_reset_password": True}, status=403)
                    return

        if path == "/api/viewer/login":
            try:
                ip = _client_ip(self)
                allowed, retry_after = _login_allowed(ip)
                if not allowed:
                    self._send_json({"error": f"Too many failed login attempts. Try again in about {retry_after} seconds."}, status=429)
                    return
                body = _json_body(self); username = str(body.get("username","")).strip(); password = str(body.get("password",""))
                conn=get_conn(); row=conn.execute("SELECT id,username,display_name,password_hash,role,active FROM users WHERE username=?",(username,)).fetchone()
                conn.close()
                # Environment credentials are provisioning-only. Once a users-table
                # row exists, the database password is the sole authentication source.
                env_login = bool(ADMIN_PASSWORD and hmac.compare_digest(username, ADMIN_USERNAME) and hmac.compare_digest(password, ADMIN_PASSWORD) and not row)
                valid = env_login or bool(row and bool(row[5]) and row[4] in ("viewer", "admin") and _verify_password(password,row[3]))
                if valid:
                    role = "admin" if env_login else row[4]
                    uid = row[0] if row else None
                    display = "Administrator" if env_login else row[2]
                    token=secrets.token_urlsafe(32)
                    with SESSION_LOCK:
                        SESSIONS[token]={"username":username,"display_name":display,"role":role,"user_id":uid,"expires":_dt.datetime.now().timestamp()+VIEWER_SESSION_TTL}
                    self.send_response(200); self.send_header("Content-Type","application/json; charset=utf-8"); self.send_header("Cache-Control","no-store")
                    secure=self.headers.get("X-Forwarded-Proto","").lower()=="https"; cookie=f"qdash_user={token}; Path=/; HttpOnly; SameSite=Lax"; cookie += "; Secure" if secure else ""; self.send_header("Set-Cookie",cookie); self.end_headers(); self.wfile.write(json.dumps({"authenticated":True,"username":username,"display_name":display,"role":role}).encode())
                    meta={"user_id":uid,"username":username,"display_name":display,"role":role}
                    with SESSION_LOCK:
                        if token in SESSIONS:
                            SESSIONS[token].update(meta)
                    _activity_event(self,"login")
                else:
                    _record_login_failure(ip)
                    self._send_json({"error":"Invalid username or password"},status=401)
            except Exception as e: self._send_json({"error":str(e)},status=400)
            return

        if path == "/api/viewer/logout":
            token=_cookie_value(self.headers.get("Cookie",""),"qdash_user")
            with SESSION_LOCK:
                meta=dict(SESSIONS.get(token) or {})
                SESSIONS.pop(token,None)
            if meta: _activity_event(self,"logout")
            self.send_response(200); self.send_header("Content-Type","application/json; charset=utf-8"); self.send_header("Set-Cookie","qdash_user=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax"); self.end_headers(); self.wfile.write(b'{"authenticated":false}'); return

        if path == "/api/admin/revoke_session":
            if not _require_role(self,"admin"): return
            try:
                body=_json_body(self); target=str(body.get("username","")).strip(); current=_cookie_value(self.headers.get("Cookie",""),"qdash_admin")
                removed=0
                with SESSION_LOCK:
                    for tok,meta in list(SESSIONS.items()):
                        if tok!=current and meta.get("username")==target:
                            SESSIONS.pop(tok,None); removed+=1
                _audit(self,"session_revoked",details={"username":target,"count":removed})
                self._send_json({"ok":True,"removed":removed})
            except Exception as e: self._send_json({"error":str(e)},status=400)
            return

        if path == "/api/admin/change_password":
            if not _is_admin(self): _auth_error(self); return
            try:
                body = _json_body(self)
                current = str(body.get("current_password", ""))
                new_password = str(body.get("new_password", ""))
                if not _strong_password(new_password):
                    raise ValueError("New password must be at least 12 characters and include uppercase, lowercase, number and special character")
                token = _cookie_value(self.headers.get("Cookie", ""), "qdash_admin")
                with SESSION_LOCK:
                    meta = dict(SESSIONS.get(token) or {})
                conn = get_conn(); row = conn.execute("SELECT id,password_hash FROM users WHERE username=?", (meta.get("username", ADMIN_USERNAME),)).fetchone()
                current_ok = bool(row and _verify_password(current, row[1]))
                if not current_ok:
                    conn.close(); self._send_json({"error":"Current password is incorrect"}, status=401); return
                conn.execute("UPDATE users SET password_hash=?, must_reset_password=? WHERE id=?", (_hash_password(new_password), (0 if not USE_POSTGRES else False), row[0])); conn.commit(); conn.close()
                current_token = _cookie_value(self.headers.get("Cookie", ""), "qdash_admin")
                with SESSION_LOCK:
                    for tok, smeta in list(SESSIONS.items()):
                        if tok != current_token and smeta.get("username") == meta.get("username"):
                            SESSIONS.pop(tok, None)
                    if current_token in SESSIONS:
                        SESSIONS[current_token]["expires"] = _dt.datetime.now().timestamp() + SESSION_TTL
                        SESSIONS[current_token]["must_reset"] = False
                _activity_event(self, "admin_password_changed")
                self._send_json({"ok":True,"message":"Password changed. Please sign in again on other devices."})
            except Exception as e:
                self._send_json({"error":str(e)}, status=400)
            return

        if path == "/api/admin/users":
            if not _is_admin(self): _auth_error(self); return
            try:
                conn=get_conn(); rows=conn.execute("SELECT id,username,display_name,role,active,created_at,must_reset_password FROM users ORDER BY role DESC,display_name").fetchall(); conn.close(); self._send_json({"rows":[dict(r) for r in rows]})
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
                    admins=conn.execute("SELECT COUNT(*) FROM users WHERE role='admin' AND active=TRUE").fetchone()[0]
                    if admins <= 1: conn.close(); self._send_json({"error":"At least one active administrator must remain."},status=400); return
                current_token=_cookie_value(self.headers.get("Cookie",""),"qdash_admin")
                with SESSION_LOCK:
                    current_meta=dict(SESSIONS.get(current_token) or {})
                if not active and row[1] == current_meta.get("username"):
                    conn.close(); self._send_json({"error":"You cannot disable your own active administrator account."},status=400); return
                conn.execute("UPDATE users SET active=? WHERE id=?",(active,uid)); conn.commit(); conn.close(); _audit(self,"user_toggle",record_id=uid,details={"active":active}); self._send_json({"ok":True})
            except Exception as e: self._send_json({"error":str(e)},status=400)
            return

        if path == "/api/admin/reset_user_password":
            # Admin-initiated recovery path for a locked-out or forgotten-password
            # user: a super admin generates a one-time temporary password, hands
            # it to the user through a secure channel outside this app, and the
            # user is forced to set their own password the next time they touch
            # anything in the admin panel (enforced above via must_reset_password
            # and the "/api/admin/" gate near the top of do_POST).
            if not _require_role(self, "admin"): return
            try:
                body=_json_body(self); uid=int(body.get("id"))
                conn=get_conn(); row=conn.execute("SELECT id,username,role FROM users WHERE id=?",(uid,)).fetchone()
                if not row: conn.close(); self._send_json({"error":"User not found"},status=404); return
                temp_password=_generate_temp_password()
                conn.execute("UPDATE users SET password_hash=?, must_reset_password=? WHERE id=?", (_hash_password(temp_password), (True if USE_POSTGRES else 1), uid)); conn.commit(); conn.close()
                with SESSION_LOCK:
                    for tok, smeta in list(SESSIONS.items()):
                        if smeta.get("username") == row[1]:
                            SESSIONS.pop(tok, None)
                _audit(self,"admin_password_reset",record_id=uid,details={"username":row[1]})
                self._send_json({"ok":True,"username":row[1],"temp_password":temp_password,"message":"Temporary password generated. Share it with the user through a secure channel — it will not be shown again — and they must set their own password on next admin login."})
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
                row = conn.execute("SELECT id,username,display_name,password_hash,role,active,must_reset_password FROM users WHERE username=?", (username,)).fetchone()
                conn.close()
                # ADMIN_USERNAME/ADMIN_PASSWORD provision the first admin at
                # startup; authentication thereafter is always database-backed.
                valid = bool(row and bool(row[5]) and row[4] in ("admin", "qa_manager", "qa_engineer", "importer", "auditor") and _verify_password(password, row[3]))
                if not valid and ADMIN_PASSWORD and hmac.compare_digest(username, ADMIN_USERNAME) and hmac.compare_digest(password, ADMIN_PASSWORD) and not row:
                    valid = True
                if valid:
                    _clear_login_failures(ip)
                    token = secrets.token_urlsafe(32)
                    csrf = secrets.token_urlsafe(32)
                    now = _dt.datetime.now().timestamp()
                    display = row[2] if row else "Administrator"
                    must_reset = bool(row[6]) if row else False
                    with SESSION_LOCK:
                        SESSIONS[token] = {"username": username or ADMIN_USERNAME, "display_name": display, "role": (row[4] if row else "admin"), "user_id": (row[0] if row else None), "active": True, "expires": now + SESSION_TTL, "csrf": csrf, "must_reset": must_reset}
                    secure = self.headers.get("X-Forwarded-Proto", "").lower() == "https"
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json; charset=utf-8")
                    self.send_header("Cache-Control", "no-store")
                    self.send_header("X-Content-Type-Options", "nosniff")
                    self.send_header("Set-Cookie", f"qdash_admin={token}; Path=/; HttpOnly; SameSite=Strict" + ("; Secure" if secure else ""))
                    self.send_header("Set-Cookie", f"{CSRF_COOKIE}={csrf}; Path=/; SameSite=Strict" + ("; Secure" if secure else ""))
                    data = json.dumps({"authenticated": True, "username": username or ADMIN_USERNAME, "display_name": display, "role": (row[4] if row else "admin"), "must_reset_password": must_reset}).encode("utf-8")
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
            if not _activity_allowed(f"{_client_ip(self)}|event", limit=120):
                self._send_json({"ok": False, "error": "Activity event rate limit exceeded"}, status=429); return
            try:
                body=_json_body(self)
                event_type=str(body.get("event_type","event")).strip()[:80] or "event"
                tab=str(body.get("tab","")).strip()[:80]
                _activity_event(self,event_type,tab,body.get("filters") or {},str(body.get("visitor_id","")))
                self._send_json({"ok":True})
            except Exception as e: self._send_json({"error":str(e)},status=400)
            return

        if path == "/api/activity/heartbeat":
            if not _is_viewer(self): _viewer_auth_error(self); return
            if not _activity_allowed(f"{_client_ip(self)}|heartbeat", limit=60):
                self._send_json({"ok": False, "error": "Activity heartbeat rate limit exceeded"}, status=429); return
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
                conn.commit(); conn.close(); _cache_clear(); _activity_event(self,"kpi_target_update",tab="Admin"); _audit(self,"kpi_target_update",details={"label":label,"target":target,"effective_date":str(body.get("effective_date",""))})
                self._send_json({"ok":True,"targets":get_kpi_targets()})
            except Exception as e: self._send_json({"error":str(e)},status=400)
            return

        if path == "/api/admin/record":
            if not _require_role(self, "admin", "qa_engineer", "importer"): return
            try:
                body = _json_body(self)
                r = _record_from_values([body.get(k, "") for k in ["heat_no","batch_no","work_center","grade","output_weight","main_defect","defect_intensity","quality_decision","insp_lot_date","month","week","quarter","financial_year"]], {k:i for i,k in enumerate(["heat_no","batch_no","work_center","grade","output_weight","main_defect","defect_intensity","quality_decision","insp_lot_date","month","week","quarter","financial_year"])})
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
                conn=get_conn(); existing_rows=conn.execute("SELECT heat_no,batch_no,work_center,grade,output_weight,main_defect,defect_intensity,quality_decision,insp_lot_date,ud_date,month,week,quarter,financial_year FROM disposition").fetchall(); existing_map={str(r[1] or "").strip().upper():r for r in existing_rows};
                wcs={str(r[0]).strip() for r in conn.execute("SELECT DISTINCT work_center FROM disposition WHERE TRIM(COALESCE(work_center,''))<>''").fetchall()}; grades={str(r[0]).strip() for r in conn.execute("SELECT DISTINCT grade FROM disposition WHERE TRIM(COALESCE(grade,''))<>''").fetchall()}; conn.close()
                valid=[]; errors=[]; duplicates=0; updated=0; updated_details=[]; seen=set(); missing_intensity=0; unknown_wc=0; unknown_grade=0; invalid_dates=0
                for idx,r in enumerate(records,start=2):
                    err=_validate_record(r); d=str(r.get("insp_lot_date","")).strip()
                    if d:
                        try: _dt.datetime.fromisoformat(d[:10])
                        except Exception: err=err or "Invalid date"; invalid_dates+=1
                    else: err=err or "Missing inspection date"; invalid_dates+=1
                    if not str(r.get("defect_intensity","")).strip(): missing_intensity+=1
                    if wcs and str(r.get("work_center","")).strip() and str(r.get("work_center")).strip() not in wcs: unknown_wc+=1
                    if grades and str(r.get("grade","")).strip() and str(r.get("grade")).strip() not in grades: unknown_grade+=1
                    key=str(r.get("batch_no","")).strip().upper()  # BATCH NO is the unique coil key
                    if key in seen: duplicates+=1
                    elif err: errors.append({"row":idx,"error":err})
                    else:
                        seen.add(key)
                        if key in existing_map:
                            oldrow=existing_map[key]; newvals=[r.get(k,"") for k in ["heat_no","work_center","grade","output_weight","main_defect","defect_intensity","quality_decision","insp_lot_date","ud_date","month","week","quarter","financial_year"]]
                            oldvals=[oldrow[0]]+list(oldrow[2:])
                            changed_fields=[]
                            for field, oldv, newv in zip(["heat_no","work_center","grade","output_weight","main_defect","defect_intensity","quality_decision","insp_lot_date","ud_date","month","week","quarter","financial_year"], oldvals, newvals):
                                if str(oldv if oldv is not None else "") != str(newv if newv is not None else ""):
                                    changed_fields.append({"field":field,"old":oldv if oldv is not None else "","new":newv if newv is not None else ""})
                            if changed_fields:
                                updated+=1; valid.append(r)
                                if len(updated_details)<25:
                                    updated_details.append({"batch_no":r.get("batch_no",""),"heat_no":r.get("heat_no",""),"changes":changed_fields})
                            else: duplicates+=1
                        else: valid.append(r)
                token=secrets.token_urlsafe(24)
                with IMPORT_PREVIEW_LOCK:
                    now_preview = time.time()
                    for old_token, old_item in list(IMPORT_PREVIEWS.items()):
                        if now_preview - old_item.get("created", 0) > IMPORT_PREVIEW_TTL:
                            IMPORT_PREVIEWS.pop(old_token, None)
                    if len(IMPORT_PREVIEWS) >= MAX_IMPORT_PREVIEWS:
                        oldest = sorted(IMPORT_PREVIEWS.items(), key=lambda kv: kv[1].get("created", 0))[:max(1, len(IMPORT_PREVIEWS)-MAX_IMPORT_PREVIEWS+1)]
                        for old_token, _ in oldest:
                            IMPORT_PREVIEWS.pop(old_token, None)
                    IMPORT_PREVIEWS[token]={"created":now_preview,"filename":uploaded[0],"records":valid,"summary":{"detected":len(records),"valid":len(valid),"duplicates":duplicates,"updated":updated,"errors":len(errors),"error_rows":errors[:100],"missing_intensity":missing_intensity,"invalid_dates":invalid_dates,"unknown_work_centers":unknown_wc,"unknown_grades":unknown_grade}}
                self._send_json({"ok":True,"preview_id":token,"filename":uploaded[0],**IMPORT_PREVIEWS[token]["summary"],"updated_details":updated_details,"sample":[{k:r.get(k,"") for k in ["insp_lot_date","heat_no","work_center","grade","output_weight","main_defect","defect_intensity","quality_decision"]} for r in valid[:25]]})
            except Exception as e: self._send_json({"error":str(e)},status=400)
            return

        if path == "/api/admin/import_confirm":
            if not _require_role(self, "admin", "qa_engineer", "importer"): return
            try:
                body=_json_body(self); pid=str(body.get("preview_id","")); item=IMPORT_PREVIEWS.get(pid)
                if not item or time.time()-item.get("created",0)>IMPORT_PREVIEW_TTL: IMPORT_PREVIEWS.pop(pid,None); raise ValueError("Import preview expired. Please upload the file again.")
                _require_safety_backup("before_disposition_import")
                result=_insert_records(item["records"]); meta=_admin_meta(self) or {};
                conn=get_conn(); conn.execute("INSERT INTO import_history(filename,detected,valid,duplicates,errors,updated,imported,imported_by) VALUES(?,?,?,?,?,?,?,?)",(item["filename"],item["summary"]["detected"],item["summary"]["valid"],item["summary"]["duplicates"],item["summary"]["errors"],result.get("updated",item["summary"].get("updated",0)),result["inserted"],meta.get("username","Admin"))); conn.commit(); conn.close(); IMPORT_PREVIEWS.pop(pid,None); _activity_event(self,"data_import_confirm",tab="Admin",filters={"filename":item["filename"],"inserted":result["inserted"]}); _audit(self,"data_import_confirm",details={"filename":item["filename"],"inserted":result["inserted"],"updated":result.get("updated",0)})
                _write_backup_file("disposition_import")
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
                _require_safety_backup("before_disposition_import")
                result = _insert_records(records)
                try:
                    meta = _admin_meta(self) or {}
                    conn = get_conn()
                    conn.execute(
                        "INSERT INTO import_history (filename,detected,valid,duplicates,errors,updated,imported,imported_by) VALUES (?,?,?,?,?,?,?,?)",
                        (uploaded[0], len(records), len(records), 0, 0, result.get("updated",0), result.get("inserted",0), meta.get("username",""))
                    )
                    conn.commit()
                    conn.close()
                except Exception:
                    pass
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
                bundle = _parse_fishbone_file(uploaded[0], uploaded[1])
                meta = _admin_meta(self) or {}
                result = _replace_fishbone_master(bundle, uploaded[0], meta.get("username", "Admin"))
                _audit(self, "fishbone_master_import", details={"filename": uploaded[0], **result})
                self._send_json({"ok": True, "filename": uploaded[0], **result})
            except Exception as e:
                self._send_json({"error": str(e)}, status=400)
            return

        if path == "/api/admin/backup/create":
            if not _require_role(self, "admin"): return
            try:
                result = _write_backup_file("manual")
                if not result:
                    raise ValueError("Backup could not be created — check server disk/permissions")
                meta = _admin_meta(self) or {}
                _audit(self, "backup_create", details=result)
                self._send_json({"ok": True, **result})
            except Exception as e:
                self._send_json({"error": str(e)}, status=400)
            return

        if path == "/api/admin/backup/restore":
            if not _require_role(self, "admin"): return
            try:
                ctype = self.headers.get("Content-Type", "")
                data = None
                if "multipart/form-data" in ctype:
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
                        raise ValueError("No backup file was uploaded")
                    raw_bytes = uploaded[1]
                    try:
                        text = gzip.decompress(raw_bytes).decode("utf-8")
                    except Exception:
                        text = raw_bytes.decode("utf-8")  # allow an uncompressed .json too
                    data = json.loads(text)
                else:
                    body = _json_body(self)
                    name = os.path.basename(str(body.get("name", "")))
                    fpath = os.path.join(BACKUP_DIR, name)
                    if not name.startswith("backup_") or not name.endswith(".json.gz") or not os.path.isfile(fpath):
                        raise ValueError("Backup file not found")
                    with gzip.open(fpath, "rt", encoding="utf-8") as f:
                        data = json.load(f)
                valid, reason = _backup_is_valid(data)
                if not valid:
                    raise ValueError("Backup integrity validation failed: " + reason)
                safety = _write_backup_file("before_restore")
                if not safety:
                    raise ValueError("Pre-restore safety backup failed. Restore was blocked to protect live data.")
                counts = _restore_backup_data(data)
                meta = _admin_meta(self) or {}
                _audit(self, "backup_restore", details=counts)
                self._send_json({"ok": True, "restored": counts})
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
                _require_safety_backup("before_fishbone_alias_set")
                norm = _norm_defect_key(disp_defect)
                meta = _admin_meta(self) or {}
                conn = get_conn()
                conn.execute("DELETE FROM fishbone_alias WHERE norm_disposition_defect=?", (norm,))
                conn.execute("INSERT INTO fishbone_alias (disposition_defect,norm_disposition_defect,master_defect,created_by) VALUES (?,?,?,?)",
                             (disp_defect, norm, master_defect, meta.get("username", "Admin")))
                conn.commit(); conn.close()
                FISHBONE_CACHE["aliases"] = None
                _cache_clear()
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
                _require_safety_backup("before_fishbone_alias_delete")
                conn = get_conn()
                conn.execute("DELETE FROM fishbone_alias WHERE id=?", (aid,))
                conn.commit(); conn.close()
                FISHBONE_CACHE["aliases"] = None
                _cache_clear()
                _audit(self, "fishbone_alias_delete", record_id=aid)
                self._send_json({"ok": True})
            except Exception as e:
                self._send_json({"error": str(e)}, status=400)
            return

        if path == "/api/admin/records":
            try:
                body = _json_body(self)
                limit = min(max(int(body.get("limit", 100)), 1), 500)
                query = str(body.get("q", "")).strip()
                requested_ids = body.get("ids") or []
                if requested_ids:
                    if not isinstance(requested_ids, list):
                        raise ValueError("ids must be a list")
                    # Exact-ID export/search path: avoids the old latest-500 limitation
                    # when an admin selects records from a large PostgreSQL dataset.
                    ids=[]
                    for raw_id in requested_ids:
                        try: ids.append(int(raw_id))
                        except Exception: continue
                    ids=list(dict.fromkeys(ids))[:500]
                    if not ids:
                        self._send_json({"rows": [], "total": 0, "query": query})
                        return
                    conn = get_conn()
                    base = "SELECT id,insp_lot_date,heat_no,batch_no,work_center,grade,output_weight,main_defect,defect_intensity,quality_decision,month,week,quarter,financial_year FROM disposition"
                    placeholders=','.join(['?']*len(ids))
                    rows=[dict(r) for r in conn.execute(base + " WHERE id IN ("+placeholders+") ORDER BY id DESC", tuple(ids)).fetchall()]
                    conn.close()
                    self._send_json({"rows": rows, "total": len(rows), "query": query})
                    return
                conn = get_conn()
                base = "SELECT id,insp_lot_date,heat_no,batch_no,work_center,grade,output_weight,main_defect,defect_intensity,quality_decision,month,week,quarter,financial_year FROM disposition"
                if query:
                    like = f"%{query}%"
                    where = " WHERE CAST(id AS TEXT) LIKE ? OR insp_lot_date LIKE ? OR heat_no LIKE ? OR batch_no LIKE ? OR work_center LIKE ? OR grade LIKE ? OR main_defect LIKE ? OR quality_decision LIKE ? OR month LIKE ? OR week LIKE ? OR quarter LIKE ? OR financial_year LIKE ?"
                    params = (like,like,like,like,like,like,like,like,like,like,like,like)
                    rows = [dict(r) for r in conn.execute(base + where + " ORDER BY id DESC LIMIT ?", params + (limit,)).fetchall()]
                    total = conn.execute("SELECT COUNT(*) FROM disposition" + where, params).fetchone()[0]
                else:
                    rows = [dict(r) for r in conn.execute(base + " ORDER BY id DESC LIMIT ?", (limit,)).fetchall()]
                    total = conn.execute("SELECT COUNT(*) FROM disposition").fetchone()[0]
                conn.close()
                self._send_json({"rows": rows, "total": total, "query": query})
            except Exception as e:
                self._send_json({"error": str(e)}, status=400)
            return

        if path == "/api/admin/quality_records":
            if not _is_admin(self):
                _auth_error(self)
                return
            try:
                body = _json_body(self)
                issue = str(body.get("issue", "")).strip()
                limit = min(max(int(body.get("limit", 100)), 1), 500)
                valid_decisions = ["PRIME","FOR NEXT PROCESS","SALVAGE","HOLD FOR DECISION","REJECT","RE-WORK","DIVERT"]
                conn = get_conn()
                select = "SELECT id,insp_lot_date,heat_no,batch_no,work_center,grade,output_weight,main_defect,defect_intensity,quality_decision,month,week,quarter,financial_year FROM disposition"
                clauses=[]; params=[]
                if issue == "missing_heat_no": clauses.append("TRIM(COALESCE(heat_no,''))=''")
                elif issue == "missing_batch_no": clauses.append("TRIM(COALESCE(batch_no,''))=''")
                elif issue == "missing_grade": clauses.append("TRIM(COALESCE(grade,''))=''")
                elif issue == "missing_decision": clauses.append("TRIM(COALESCE(quality_decision,''))=''")
                elif issue == "invalid_weights":
                    clauses.append("output_weight IS NULL OR output_weight <= 0" if not USE_POSTGRES else "output_weight IS NULL OR output_weight::text IN ('NaN','Infinity','-Infinity') OR output_weight <= 0")
                elif issue == "invalid_dates":
                    all_rows=[dict(r) for r in conn.execute(select).fetchall()]
                    bad=[]
                    for r in all_rows:
                        dv=str(r.get("insp_lot_date") or "").strip()
                        try: datetime.strptime(dv[:10], "%Y-%m-%d") if dv else (_ for _ in ()).throw(ValueError())
                        except Exception: bad.append(r)
                    conn.close(); self._send_json({"rows":bad[:limit],"total":len(bad),"issue":issue}); return
                elif issue == "missing_intensity": clauses.append("TRIM(COALESCE(defect_intensity,''))='' OR UPPER(TRIM(defect_intensity))='NONE'")
                elif issue == "invalid_values": clauses.append("TRIM(COALESCE(work_center,''))='' OR TRIM(COALESCE(main_defect,''))='' OR (TRIM(COALESCE(quality_decision,''))<>'' AND UPPER(TRIM(quality_decision)) NOT IN (%s))" % ','.join('?'*len(valid_decisions))); params.extend(valid_decisions)
                elif issue == "duplicate_batch":
                    rows = [dict(r) for r in conn.execute(select + " WHERE TRIM(COALESCE(batch_no,''))<>'' AND UPPER(TRIM(batch_no)) IN (SELECT UPPER(TRIM(batch_no)) FROM disposition WHERE TRIM(COALESCE(batch_no,''))<>'' GROUP BY UPPER(TRIM(batch_no)) HAVING COUNT(*)>1) ORDER BY id DESC LIMIT ?", (limit,)).fetchall()]
                    total = conn.execute("SELECT COUNT(*) FROM disposition WHERE TRIM(COALESCE(batch_no,''))<>'' AND UPPER(TRIM(batch_no)) IN (SELECT UPPER(TRIM(batch_no)) FROM disposition WHERE TRIM(COALESCE(batch_no,''))<>'' GROUP BY UPPER(TRIM(batch_no)) HAVING COUNT(*)>1)").fetchone()[0]
                    conn.close(); self._send_json({"rows":rows,"total":total,"issue":issue}); return
                else:
                    conn.close(); self._send_json({"error":"Unknown quality issue"},status=400); return
                where=' WHERE '+ ' AND '.join(clauses) if clauses else ''
                rows=[dict(r) for r in conn.execute(select+where+" ORDER BY id DESC LIMIT ?", tuple(params)+(limit,)).fetchall()]
                total=conn.execute("SELECT COUNT(*) FROM disposition"+where,tuple(params)).fetchone()[0]
                conn.close(); self._send_json({"rows":rows,"total":total,"issue":issue})
            except Exception as e:
                self._send_json({"error":str(e)},status=400)
            return

        if path == "/api/admin/delete":
            if not _require_role(self, "admin", "qa_engineer", "importer"): return
            try:
                body = _json_body(self)
                record_id = int(body.get("id"))
                _require_safety_backup("before_record_delete")
                conn = get_conn()
                cur = conn.execute("DELETE FROM disposition WHERE id=?", (record_id,))
                conn.commit()
                conn.close()
                _audit(self,"record_delete",record_id=record_id)
                _cache_clear()
                self._send_json({"ok": True, "deleted": cur.rowcount})
            except Exception as e:
                self._send_json({"error": str(e)}, status=400)
            return

        self._send_json({"error": "not found"}, status=404)


# Set to True once schema/seed/index startup work has finished. /healthz and
# /readyz report it so a slow first boot is diagnosable from the outside.
STARTUP_READY = False
STARTUP_ERROR = ""
STARTUP_LOCK = threading.Lock()


def _run_startup_tasks():
    """Schema creation, first-run seeding and index creation.

    Runs on a BACKGROUND thread, never on the startup path. On a cold deploy
    against an external Postgres (Supabase/Neon) this can take minutes — an
    empty-database seed inserts every historical row, and CREATE INDEX on a
    populated table is not instant. Doing it before binding the socket is what
    made the platform's port scan time out and cancel the deploy: the process
    was alive and working, but nothing was ever listening.
    """
    global STARTUP_READY, STARTUP_ERROR
    errors = []
    for label, fn in (("admin schema", _ensure_admin_schema),
                      ("initial seed", _seed_postgres_if_empty),
                      ("query indexes", ensure_fast_indexes)):
        started = time.time()
        try:
            fn()
            print(f"Startup: {label} ready in {time.time() - started:.1f}s", flush=True)
        except Exception as exc:
            errors.append(f"{label}: {exc}")
            print(f"Startup ERROR: {label} failed after "
                  f"{time.time() - started:.1f}s — {exc}", flush=True)
    with STARTUP_LOCK:
        STARTUP_ERROR = "; ".join(errors)
        # Never advertise readiness after a failed startup step. The process
        # may remain alive long enough for diagnosis, but /readyz will stay
        # 503 and Render can restart the unhealthy deployment.
        STARTUP_READY = not errors
    if STARTUP_READY:
        print("Startup: all initialisation complete.", flush=True)
    else:
        print("Startup: initialization FAILED; service is not ready.", flush=True)


def main():
    import sys
    # Render/Railway/Heroku buffer stdout, so without this the startup log is
    # empty and a hung boot looks identical to a silent one.
    try:
        sys.stdout.reconfigure(line_buffering=True)
        sys.stderr.reconfigure(line_buffering=True)
    except Exception:
        pass
    # Cloud hosts (Render, Railway, etc.) provide the port via the PORT
    # environment variable. Fall back to a CLI arg, then default 8000
    # for local use.
    port = int(os.environ.get("PORT", sys.argv[1] if len(sys.argv) > 1 else 8000))

    # Bind FIRST. The host's health check only needs an open port; everything
    # below is allowed to take as long as it needs without risking the deploy.
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"Quality Disposition Dashboard listening on 0.0.0.0:{port}", flush=True)
    if not (ADMIN_USERNAME and ADMIN_PASSWORD):
        print("INFO: ADMIN_USERNAME/ADMIN_PASSWORD are not set; administrator authentication will use the existing users table. Set both environment variables for first-time provisioning.", flush=True)

    threading.Thread(target=_run_startup_tasks, daemon=True, name="startup").start()
    if BACKUP_SCHEDULE_HOURS > 0:
        threading.Thread(target=_scheduled_backup_loop, daemon=True, name="scheduled-backup").start()
        print(f"Scheduled backups enabled: every {BACKUP_SCHEDULE_HOURS:g}h (BACKUP_SCHEDULE_HOURS).", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()