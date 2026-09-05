#!/usr/bin/env python3
"""
Quality Disposition Control Dashboard
Pure Python built-in HTTP server + SQLite. No Flask. No external CDN.
Run:  python3 server.py [port]
Then open http://localhost:8000/  (default port 8000)
"""

import json
import math
import os
import sqlite3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "quality.db")

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


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


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
            clauses.append("(defect_intensity IS NULL OR defect_intensity = '')")
        else:
            clauses.append(f"{key} = ?")
            params.append(val)
    where = " AND ".join(clauses)
    return (f"WHERE {where}" if where else "", params)


def compute_kpis(filters):
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

    # Intensity Tagging % and Without Intensity %
    intensity_filter = filters.get("defect_intensity", "All")
    if intensity_filter == "NONE":
        intensity_tagging_pct = 0.0
    else:
        it_where = where_sql + (" AND " if where_sql else "WHERE ") + \
            "main_defect <> '' AND main_defect <> 'NO DEFECT' AND defect_intensity <> ''"
        cur.execute(f"SELECT COUNT(*) FROM disposition {it_where}", params)
        with_intensity = cur.fetchone()[0]
        intensity_tagging_pct = (with_intensity / defect_coils) if defect_coils else 0.0

    without_intensity_pct = (1 - intensity_tagging_pct) if intensity_filter != "NONE" else 0.0

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
    # WITHOUT INTENSITY row = defect coils with blank intensity
    wi_where = where_sql + (" AND " if where_sql else "WHERE ") + \
        "main_defect <> '' AND main_defect <> 'NO DEFECT' AND defect_intensity = ''"
    cur.execute(f"SELECT COUNT(*), COALESCE(SUM(output_weight),0) FROM disposition {wi_where}", params)
    cnt, qty = cur.fetchone()
    intensity_table.append({"intensity": "WITHOUT INTENSITY", "coils": cnt, "qty": qty})

    it_total_coils = sum(r["coils"] for r in intensity_table)
    it_total_qty = sum(r["qty"] for r in intensity_table)
    for r in intensity_table:
        r["pct_coils"] = (r["coils"] / it_total_coils) if it_total_coils else 0.0
        r["pct_qty"] = (r["qty"] / it_total_qty) if it_total_qty else 0.0

    conn.close()
    return {
        "kpis": kpis,
        "decision_table": decision_table,
        "top_defects": top_defects,
        "intensity_table": intensity_table,
        "totals": {"total_coils": total_coils, "output_qty": output_qty},
    }


def get_filter_options():
    conn = get_conn()
    cur = conn.cursor()
    options = {}
    for key in FILTER_KEYS:
        cur.execute(f"SELECT DISTINCT {key} FROM disposition WHERE {key} <> '' ORDER BY 1")
        vals = [r[0] for r in cur.fetchall()]
        if key == "defect_intensity":
            vals = vals + ["NONE"]
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
    return {"by_work_center": wc_rows, "by_grade": gr_rows}


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

    register = []
    for defect in MAIN_DEFECTS_FULL_LIST:
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
    return {"rows": rows}


def compute_period_trend(filters):
    """Trend across weeks (ignores the Week filter itself, applies the
    other 7)."""
    conn = get_conn()
    cur = conn.cursor()
    where_sql, params = build_where(filters, exclude={"week"})

    cur.execute("SELECT DISTINCT week FROM disposition WHERE week <> ''")
    weeks = sorted([r[0] for r in cur.fetchall()], key=_week_sort_key)

    rows = [_group_metrics(cur, where_sql, params, "week", w) for w in weeks]
    conn.close()
    return {"rows": rows}


HTML_PAGE = None  # loaded lazily from index_template


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # keep console quiet

    def _send_json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
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
                self._send_json(compute_period_trend(filters))
            except Exception as e:
                self._send_json({"error": str(e)}, status=500)
        elif path == "/api/health":
            self._send_json({"status": "ok"})
        else:
            self._send_json({"error": "not found"}, status=404)


def main():
    import sys
    # Cloud hosts (Render, Railway, etc.) provide the port via the PORT
    # environment variable. Fall back to a CLI arg, then default 8000
    # for local use.
    port = int(os.environ.get("PORT", sys.argv[1] if len(sys.argv) > 1 else 8000))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"Quality Disposition Dashboard running on port {port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
