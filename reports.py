#!/usr/bin/env python3
"""
Report generation module: Excel / PDF / PowerPoint export builders and the
chart/fishbone-diagram PNG renderers they embed.

Deliberately self-contained — every function here works only off an
already-assembled `payload` dict (built by `_export_data()` in server.py) or
plain arguments. Nothing in this module opens a database connection or
imports from server.py, so server.py can safely `import reports` without any
risk of a circular import.
"""

import io
import re
from datetime import datetime

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


def _filter_summary(filters):
    return [(k.replace("_", " ").title(), v) for k, v in filters.items() if v and v != "All"]


def _safe_filename(filters, ext):
    # Content-Disposition is an HTTP header: strip control characters and
    # header-sensitive delimiters before the filename reaches _send_bytes().
    safe_parts = []
    for value in filters.values():
        if not value or value == "All":
            continue
        text = str(value)
        text = re.sub(r"[\x00-\x1f\x7f]", "-", text)
        text = text.replace("\\", "-").replace("/", "-").replace('"', "-")
        text = re.sub(r"[^A-Za-z0-9._-]+", "_", text).strip("._- ")
        if text:
            safe_parts.append(text[:80])
    suffix = ("_" + "_".join(safe_parts[:3])) if safe_parts else "_All_Data"
    clean_ext = str(ext or ".xlsx")
    clean_ext = "." + re.sub(r"[^A-Za-z0-9]+", "", clean_ext.lstrip("."))[:8]
    return "Quality_Disposition_Report" + suffix + clean_ext

def _send_bytes(self, data, content_type, filename):
    self.send_response(200)
    self.send_header("Content-Type", content_type)
    self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
    self.send_header("Content-Length", str(len(data)))
    self.send_header("Cache-Control", "no-store")
    self.end_headers()
    try:
        self.wfile.write(data)
    except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
        # A large export (Excel/PDF/PPTX) is exactly the kind of download a
        # flaky connection or a cancelled browser download interrupts
        # mid-stream. The file was already fully generated in memory before
        # this call, so there's no partial state to clean up -- just don't
        # let a normal client-side cancel look like a server crash.
        pass

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
    """Create dashboard-style chart PNGs for Office/PDF exports. Returns bytes or None.

    NOTE ON THE RECURSIONERROR THAT USED TO HAPPEN HERE: every "unexpectedly deep
    processing limit" export failure traced back to this function's "pareto" branch,
    always at the final savefig() call. The real cause was combining ax.twinx() (used
    for the dual Qty/Cumulative-% axis) with fig.savefig(..., bbox_inches="tight").
    bbox_inches="tight" makes Matplotlib walk get_tightbbox() across every artist,
    and when a twinned axis is in the mix that walk revisits the twin pair's shared
    locators/formatters once per x-tick label -- so the recursion depth scales with
    the number of distinct defect labels on the chart. A handful of labels stayed
    under the recursion ceiling; a broad/unfiltered report with a long defect list
    (or many grades/work-centers/months elsewhere) did not. fig.tight_layout() below
    already lays the figure out correctly on its own, so bbox_inches="tight" was
    redundant on top of it -- dropping it removes the trigger entirely rather than
    just delaying it with a higher recursion limit or a smaller payload.
    """
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
    # No bbox_inches="tight" here -- see the note at the top of this function. fig.tight_layout()
    # already sized everything correctly; re-tightening at savefig() time is what recursed.
    out=io.BytesIO(); fig.savefig(out,format="png",facecolor="white"); plt.close(fig); out.seek(0); return out.getvalue()

FISHBONE_BRANCHES = [
    ("man","Man","#118DFF","top"),
    ("machine","Machine","#16A34A","top"),
    ("material","Material","#D97706","top"),
    ("method","Method","#7C3AED","bottom"),
    ("measurement","Measurement","#DB2777","bottom"),
    ("environment","Environment","#0891B2","bottom"),
]
def _png_safe_icon(icon):
    """Return the icon only if matplotlib's default font can draw every character.
    Colour emoji (👤 📦 📋 📏 🌍) are not in DejaVu Sans and were rendered as empty
    "tofu" boxes in the exported fishbone image; those are dropped (the coloured
    branch label already identifies the category)."""
    icon = "".join(ch for ch in str(icon or "") if ch not in "\ufe0f\u200d").strip()
    if not icon:
        return ""
    try:
        from matplotlib import font_manager as _fm
        from matplotlib.ft2font import FT2Font
        cmap = FT2Font(_fm.findfont("DejaVu Sans")).get_charmap()
        return icon if all(ord(ch) in cmap for ch in icon) else ""
    except Exception:
        return ""

def _fishbone_png(item, style=None):
    """Render the same 6M Ishikawa/fishbone diagram shown on the webapp (spine + 6 angled
    bones converging on the defect) as a PNG, for embedding in Excel/PDF/PPT exports.
    Colors/icons follow the imported Icon Color Coding sheet (fishbone_style), passed in by
    the caller (server.py) as payload["fishbone_style"] since loading it live here would
    require a database call this module deliberately has no access to; when a branch has an
    RCA root cause on file, it's captioned under the cause list."""
    if plt is None or not item:
        return None
    causes = item.get("causes") or {}
    rca = item.get("rca") or {}
    style = style or {}
    defect_text = item.get("defect") or "Top Defect"
    fig, ax = plt.subplots(figsize=(12.4,6.8), dpi=150)
    fig.patch.set_facecolor("white")
    ax.set_xlim(-0.8,12.6); ax.set_ylim(-5.0,4.9); ax.axis("off")
    # Icons are shown only when EVERY branch icon can be drawn, so labels stay consistent
    # (never one branch with an icon and five without).
    _icons_ok = all(
        _png_safe_icon((style.get(b[0]) or {}).get("icon")) == "".join(ch for ch in str((style.get(b[0]) or {}).get("icon") or "") if ch not in "\ufe0f\u200d").strip()
        for b in FISHBONE_BRANCHES)
    spine_x2=10.9
    ax.annotate("", xy=(spine_x2,0), xytext=(0.25,0), arrowprops=dict(arrowstyle="-|>",color="#243B53",lw=2.6,mutation_scale=22))
    # Head box (the defect / effect)
    head_w,head_h=1.55,1.25
    ax.add_patch(FancyBboxPatch((spine_x2-0.05,-head_h/2),head_w,head_h,boxstyle="round,pad=0.02,rounding_size=0.12",linewidth=0,facecolor="#16324F"))
    import textwrap
    wrapped="\n".join(textwrap.wrap(str(defect_text),14)[:3])
    ax.text(spine_x2-0.05+head_w/2,0,wrapped,ha="center",va="center",color="white",fontsize=10.5,fontweight="bold")
    anchors=[1.9,4.35,6.8]
    for i,(key,label,_default_color,side) in enumerate(FISHBONE_BRANCHES):
        st=style.get(key,{})
        color=st.get("color") or _default_color
        icon=_png_safe_icon(st.get("icon")) if _icons_ok else ""
        label=st.get("label") or label
        lane=i%3; anchor_x=anchors[lane]; sign=1 if side=="top" else -1
        tip_x=anchor_x-1.55; tip_y=sign*3.85
        ax.plot([anchor_x,tip_x],[0,tip_y],color=color,linewidth=2.2,solid_capstyle="round")
        ax.plot([anchor_x],[0],marker="o",markersize=4,color=color)
        box_w,box_h=1.85,0.5
        by=tip_y-box_h if side=="top" else tip_y
        ax.add_patch(FancyBboxPatch((tip_x-box_w/2,by),box_w,box_h,boxstyle="round,pad=0.02,rounding_size=0.09",linewidth=0,facecolor=color))
        ax.text(tip_x,by+box_h/2,f"{icon} {label}".strip(),ha="center",va="center",color="white",fontsize=9.5,fontweight="bold")
        items=[str(x) for x in (causes.get(key) or []) if str(x).strip()] or ["No cause on file"]
        n=min(len(items),5)
        for j,txt in enumerate(items[:5]):
            t=0.16+j*(0.62/max(1,n-1)) if n>1 else 0.48
            bx=anchor_x+(tip_x-anchor_x)*t; byp=0+(tip_y-0)*t
            perp=0.16*sign
            txt_short="\n".join(textwrap.wrap(txt,20)[:2])
            ax.text(bx+0.08,byp+perp,txt_short,fontsize=6.6,color=("#9aa7b4" if items[0]=="No cause on file" else "#243B53"),ha="left",va="center",style=("italic" if items[0]=="No cause on file" else "normal"))
        rca_list = rca.get(key) if isinstance(rca, dict) else None
        rc = (rca_list[0].get("root_cause") if rca_list else None)
        if rc:
            rc_short="\n".join(textwrap.wrap(f"RCA: {rc}",22)[:2])
            rc_y = by-0.30 if side=="top" else by+box_h+0.30
            ax.text(tip_x,rc_y,rc_short,fontsize=6.2,color=color,ha="center",va="center",fontweight="bold",style="italic")
    fig.tight_layout(pad=0.6)
    # Same fix as _chart_png() above: rely on tight_layout() alone, don't also pass
    # bbox_inches="tight" to savefig() -- that combination is what caused the
    # RecursionError, not this diagram's own artist count.
    out=io.BytesIO(); fig.savefig(out,format="png",facecolor="white"); plt.close(fig); out.seek(0); return out.getvalue()

_CHART_MAX_BARS=25      # bars drawn per bar chart (tables stay complete)
_CHART_MAX_POINTS=60    # trend points drawn per line chart (tables stay complete)

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
    # Chart VISUALS stay readable and fast on high-cardinality data: only the largest bars / the
    # most recent points are drawn (the paired tables always list every row).
    def _top_by_qty(rows,n=_CHART_MAX_BARS):
        rows=list(rows)
        if len(rows)<=n: return rows,""
        return sorted(rows,key=lambda r:float(r.get("output_qty") or 0),reverse=True)[:n],f" (Top {n} of {len(rows)})"
    if wc:
        wc_top,wc_sfx=_top_by_qty(wc)
        charts.append(("Work Center",_chart_png("bar","Output Quantity by Work Center"+wc_sfx,[r["name"] for r in wc_top],[r["output_qty"] for r in wc_top])))
    if gr:
        gr_top,gr_sfx=_top_by_qty(gr)
        charts.append(("Grade",_chart_png("bar","Output Quantity by Grade"+gr_sfx,[r["name"] for r in gr_top],[r["output_qty"] for r in gr_top])))
    for title,key in [("Monthly Trend","monthly"),("Weekly Trend","period"),("Quarterly Trend","quarterly"),("Financial Year Trend","yearly")]:
        rows=payload[key]["rows"]
        if rows:
            sfx=""
            if len(rows)>_CHART_MAX_POINTS:
                sfx=f" (latest {_CHART_MAX_POINTS} of {len(rows)})"; rows=rows[-_CHART_MAX_POINTS:]
            charts.append((title,_chart_png("line",title+sfx,[r["name"] for r in rows],[r["output_qty"] for r in rows])))
    return [(n,b) for n,b in charts if b]

def _xl_embed_charts(ws, charts_dict, names, start_row=3, anchor_col="J", width=500, height=225, gap_rows=13):
    """Place named chart PNGs one below another, starting at anchor_col/start_row, so a
    table (columns A onward) and its matching chart(s) sit on the SAME worksheet/page
    instead of a separate 'all charts' sheet."""
    row=start_row; placed=0
    for name in names:
        img=charts_dict.get(name)
        if not img: continue
        try:
            xli=XLImage(io.BytesIO(img)); xli.width=width; xli.height=height
            ws.add_image(xli,f"{anchor_col}{row}"); row+=gap_rows; placed+=1
        except Exception: pass
    return placed

def _excel_report(payload):
    if Workbook is None:
        raise RuntimeError("Excel export requires openpyxl")
    wb=Workbook(); ws=wb.active; ws.title="Dashboard"
    navy="0F2A4A"; accent="118DFF"; white="FFFFFF"; light="EEF4FF"
    charts_dict=dict(_export_charts(payload))
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

    # ---- Dashboard cover page: KPI grid + a single headline chart, on one page. ----
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
    kpi_rows_used=5+((min(len(klist),16)-1)//4+1)*3
    if "Decision Distribution" in charts_dict:
        try:
            xli=XLImage(io.BytesIO(charts_dict["Decision Distribution"])); xli.width=780; xli.height=340
            ws.add_image(xli,f"A{kpi_rows_used+2}")
        except Exception: pass
    ws.freeze_panes="A5"; ws.sheet_view.showGridLines=False

    ws=wb.create_sheet("KPI Summary")
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

    # ---- Defect Analysis: table + its Pareto / Intensity charts, same sheet. ----
    d=payload["defects"]; ws2=wb.create_sheet("Defect Analysis"); title(ws2,"Defect Analysis",1,5); header(ws2,3,["Rank","Defect","Records","Qty (MT)","% Records"])
    for r in d["register"]:
        ws2.append([r["rank"],r["defect"],r["records"],r["qty"],r["pct_records"]])
    ws2.append(["","Total",d["register_total"]["records"],d["register_total"]["qty"],d["register_total"]["pct_records"]])
    for rr in range(4, ws2.max_row+1):
        ws2.cell(rr,4).number_format="#,##0.000"
        ws2.cell(rr,5).number_format="0.000%"
    autofit(ws2)
    _xl_embed_charts(ws2,charts_dict,["Defect Pareto","Defect Intensity"],anchor_col="H")

    for sheet_name, rows, total, chart_name in [("Work Center",payload["wcg"]["by_work_center"],payload["wcg"]["total_work_center"],"Work Center"),("Grade Analysis",payload["wcg"]["by_grade"],payload["wcg"]["total_grade"],"Grade")]:
        w=wb.create_sheet(sheet_name); title(w,sheet_name,1,7); header(w,3,["Name","Coils","Output MT","Defect Coils","Defect %","Reject Qty MT","Reject % Qty"])
        for r in rows: w.append([r.get("name"),r.get("coils"),r.get("output_qty"),r.get("defect_coils"),r.get("defect_pct"),r.get("reject_qty"),r.get("reject_pct_qty")])
        if total: w.append(["Total",total.get("coils"),total.get("output_qty"),total.get("defect_coils"),total.get("defect_pct"),total.get("reject_qty"),total.get("reject_pct_qty")])
        for rr in range(4, w.max_row+1):
            w.cell(rr,3).number_format="#,##0.000"
            w.cell(rr,5).number_format="0.000%"
            w.cell(rr,6).number_format="#,##0.000"
            w.cell(rr,7).number_format="0.000%"
        autofit(w)
        _xl_embed_charts(w,charts_dict,[chart_name],anchor_col="J")

    for sheet_name, rows, total, labels, chart_name in [("Monthly Trend",payload["monthly"]["rows"],payload["monthly"].get("total"),["Month","Coils","Output MT","Defect Coils","Defect %","Reject Qty MT","Reject % Qty","FPY %"],"Monthly Trend"),("Weekly Trend",payload["period"]["rows"],payload["period"].get("total"),["Week","Coils","Output MT","Defect Coils","Defect %","Reject Qty MT","Reject % Qty","FPY %"],"Weekly Trend"),("Quarterly Trend",payload["quarterly"]["rows"],payload["quarterly"].get("total"),["Quarter","Coils","Output MT","Defect Coils","Defect %","Reject Qty MT","Reject % Qty","FPY %"],"Quarterly Trend"),("Financial Year",payload["yearly"]["rows"],payload["yearly"].get("total"),["Financial Year","Coils","Output MT","Defect Coils","Defect %","Reject Qty MT","Reject % Qty","FPY %"],"Financial Year Trend")]:
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
        _xl_embed_charts(w,charts_dict,[chart_name],anchor_col="J")
    th=payload.get("target_history",{}); w=wb.create_sheet("Target vs Actual History"); title(w,"Target vs Actual History",1,5); header(w,3,["Period","Target","Actual","Attainment","Gap (pp)"])
    for r in th.get("rows",[]): w.append([r.get("period"),r.get("target"),r.get("actual"),r.get("attainment"),r.get("gap_pp")])
    for rr in range(4,w.max_row+1):
        for cc in (2,3,4): w.cell(rr,cc).number_format="0.00%"
        w.cell(rr,5).number_format="0.00"
    autofit(w)

    # ---- 6M Fishbone Analysis: the Ishikawa diagram for the current #1 defect, plus its cause list. ----
    fb=payload.get("fishbone"); fw=wb.create_sheet("6M Fishbone Analysis"); title(fw,"6M Fishbone Analysis",1,3)
    if fb and fb.get("matched"):
        fw["A2"]="Top Defect"; fw["B2"]=fb.get("defect","")
        try:
            png=_fishbone_png(fb, payload.get("fishbone_style"))
            if png:
                xli=XLImage(io.BytesIO(png)); xli.width=900; xli.height=490; fw.add_image(xli,"A4")
        except Exception: pass
        header(fw,26,["Category","Cause"])
        row=27
        for key,label,_c,_s in FISHBONE_BRANCHES:
            for cause in (fb.get("causes") or {}).get(key) or []:
                fw.cell(row,1,label); fw.cell(row,2,cause); row+=1
        autofit(fw)
        rca=fb.get("rca") or {}
        if rca:
            row+=2
            fw.cell(row,1,"Root Cause Analysis (RCA)").font=Font(bold=True,color=navy); row+=1
            header(fw,row,["6M Category","5-Why Chain","Root Cause","Action","Preventive Action","Role","Responsibility"]); row+=1
            for key,label,_c,_s in FISHBONE_BRANCHES:
                for r in (rca.get(key) or []):
                    fw.cell(row,1,label); fw.cell(row,2," → ".join(r.get("why_chain") or [])); fw.cell(row,3,r.get("root_cause",""))
                    fw.cell(row,4,r.get("action","")); fw.cell(row,5,r.get("preventive_action","")); fw.cell(row,6,r.get("role","")); fw.cell(row,7,r.get("responsibility",""))
                    row+=1
            autofit(fw)
    else:
        fw["A2"]="No 6M Fishbone mapping found for the current #1 defect yet. Import/update the 6M Fishbone Master in Admin, or map this defect to a master cause set."
        fw["A2"].font=Font(italic=True,color="6B7C93")
        fw.column_dimensions["A"].width=100

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

    # Neutralize spreadsheet formulas in text cells while preserving numeric cells.
    def _safe_excel_text(value):
        if isinstance(value, str) and value[:1] in ("=", "+", "-", "@"):
            return "'" + value
        return value

    for ws in wb.worksheets:
        for row in ws.iter_rows():
            for cell in row:
                if isinstance(cell.value, str):
                    cell.value = _safe_excel_text(cell.value)

    bio=io.BytesIO()
    wb.save(bio)
    data=bio.getvalue()
    if not data:
        raise RuntimeError("Excel export produced an empty workbook")
    return data

def _pdf_section(story, styles, title_text, chart_imgs, table_rows, table_widths, table_header_bg="#118DFF", chart_w=520, chart_h=230, note=None):
    """One report section: heading, its chart(s) side-by-side, then its data table —
    all flowing onto the same page (reportlab only spills to a new page if the content
    genuinely doesn't fit), so every chart sits together with its own table."""
    story.append(Paragraph(title_text,styles["Heading2"]))
    if note:
        story.append(Paragraph(note,styles["Small"]))
    if chart_imgs:
        cells=[RLImage(io.BytesIO(img),width=chart_w,height=chart_h) for img in chart_imgs if img]
        if cells:
            crow=Table([cells],hAlign="CENTER")
            crow.setStyle(TableStyle([("ALIGN",(0,0),(-1,-1),"CENTER"),("VALIGN",(0,0),(-1,-1),"MIDDLE"),("TOPPADDING",(0,0),(-1,-1),4),("BOTTOMPADDING",(0,0),(-1,-1),8)]))
            story.append(crow)
    if table_rows and len(table_rows)>1:
        tbl=Table(table_rows,repeatRows=1,colWidths=table_widths,hAlign="CENTER",style=TableStyle([
            ("BACKGROUND",(0,0),(-1,0),colors.HexColor(table_header_bg)),("TEXTCOLOR",(0,0),(-1,0),colors.white),
            ("FONTNAME",(0,0),(-1,0),"Helvetica-Bold"),("ALIGN",(0,0),(-1,-1),"CENTER"),
            ("ROWBACKGROUNDS",(0,1),(-1,-1),[colors.white,colors.HexColor("#F6F9FC")]),
            ("GRID",(0,0),(-1,-1),.3,colors.HexColor("#DCE6EF")),("FONTSIZE",(0,0),(-1,-1),7.5),
            ("TOPPADDING",(0,0),(-1,-1),3),("BOTTOMPADDING",(0,0),(-1,-1),3)]))
        story.append(tbl)
    story.append(PageBreak())

def _pdf_report(payload):
    if SimpleDocTemplate is None:
        raise RuntimeError("PDF export requires reportlab")
    bio=io.BytesIO(); doc=SimpleDocTemplate(bio,pagesize=landscape(A4),rightMargin=22,leftMargin=22,topMargin=20,bottomMargin=20)
    styles=getSampleStyleSheet(); styles.add(ParagraphStyle(name="Small",parent=styles["BodyText"],fontSize=7.5,leading=9)); styles.add(ParagraphStyle(name="Title2",parent=styles["Title"],fontSize=20,textColor=colors.HexColor("#0F2A4A"),alignment=TA_LEFT))
    charts_dict=dict(_export_charts(payload))
    story=[Paragraph("QUALITY INTELLIGENCE",styles["Title2"]),Paragraph("Disposition & Defect Analytics — Dashboard Export",styles["Heading2"]),Paragraph("Generated: "+datetime.now().strftime("%d-%b-%Y %H:%M:%S"),styles["Small"]),Spacer(1,5)]
    fs=_filter_summary(payload["filters"]); story.append(Paragraph("Filters: "+("; ".join(f"{k}: {v}" for k,v in fs) if fs else "All"),styles["Small"])); story.append(Spacer(1,8))
    # ---- Cover page: KPI cards + headline Decision Distribution chart. ----
    kl=payload["kpis"].get("kpis",[]); card_rows=[]
    for base in range(0,min(len(kl),16),4):
        card_rows.append([f'{k.get("label","")}\n{_export_display_value(k.get("value",0), k.get("fmt",""))}' for k in kl[base:base+4]])
    if card_rows:
        kt=Table(card_rows,colWidths=[185,185,185,185],rowHeights=[42]*len(card_rows)); kt.hAlign="CENTER"; kt.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),colors.HexColor("#EAF2FB")),("TEXTCOLOR",(0,0),(-1,-1),colors.HexColor("#0F2A4A")),("FONTNAME",(0,0),(-1,-1),"Helvetica-Bold"),("ALIGN",(0,0),(-1,-1),"CENTER"),("VALIGN",(0,0),(-1,-1),"MIDDLE"),("BOX",(0,0),(-1,-1),.5,colors.HexColor("#DCE6EF")),("INNERGRID",(0,0),(-1,-1),.5,colors.HexColor("#DCE6EF")),("FONTSIZE",(0,0),(-1,-1),8)])); story += [kt,Spacer(1,10)]
    if "Decision Distribution" in charts_dict:
        story.append(Paragraph("Quality Decision Distribution",styles["Heading2"]))
        story.append(RLImage(io.BytesIO(charts_dict["Decision Distribution"]),width=560,height=250))
    story.append(PageBreak())

    # ---- Defect Analysis: table + its Pareto / Intensity charts, same page. ----
    # The COMPLETE defect register is printed (release-gate rule: no silent or noted top-N
    # truncation of report tables). Long registers simply continue over more pages, with the
    # header row repeated by _pdf_section().
    d=payload["defects"]; register=d["register"]
    reg_note=None
    rows=[["Rank","Defect","Records","Qty MT","% Records"]]+[[r["rank"],r["defect"],r["records"],f'{r["qty"]:.3f}',f'{r["pct_records"]*100:.2f}%'] for r in register]+[["","Total",d["register_total"]["records"],f'{d["register_total"]["qty"]:.3f}',f'{d["register_total"]["pct_records"]*100:.2f}%']]
    _pdf_section(story,styles,"Defect Analysis",[charts_dict.get("Defect Pareto"),charts_dict.get("Defect Intensity")],rows,[45,300,70,80,80],chart_w=375,chart_h=167,note=reg_note)

    # ---- Work Center / Grade: table + matching bar chart, same page. ----
    wc=payload["wcg"]["by_work_center"]; wtot=payload["wcg"]["total_work_center"]
    wc_rows=[["Name","Coils","Output MT","Defect Coils","Defect %","Reject Qty MT","Reject % Qty"]]+[[r.get("name"),r.get("coils"),f'{r.get("output_qty",0):.3f}',r.get("defect_coils"),f'{r.get("defect_pct",0)*100:.2f}%',f'{r.get("reject_qty",0):.3f}',f'{r.get("reject_pct_qty",0)*100:.2f}%'] for r in wc]
    if wtot: wc_rows.append(["Total",wtot.get("coils"),f'{wtot.get("output_qty",0):.3f}',wtot.get("defect_coils"),f'{wtot.get("defect_pct",0)*100:.2f}%',f'{wtot.get("reject_qty",0):.3f}',f'{wtot.get("reject_pct_qty",0)*100:.2f}%'])
    _pdf_section(story,styles,"Work Center Performance",[charts_dict.get("Work Center")],wc_rows,[130,80,90,90,80,100,90])

    gr=payload["wcg"]["by_grade"]; gtot=payload["wcg"]["total_grade"]
    gr_rows=[["Name","Coils","Output MT","Defect Coils","Defect %","Reject Qty MT","Reject % Qty"]]+[[r.get("name"),r.get("coils"),f'{r.get("output_qty",0):.3f}',r.get("defect_coils"),f'{r.get("defect_pct",0)*100:.2f}%',f'{r.get("reject_qty",0):.3f}',f'{r.get("reject_pct_qty",0)*100:.2f}%'] for r in gr]
    if gtot: gr_rows.append(["Total",gtot.get("coils"),f'{gtot.get("output_qty",0):.3f}',gtot.get("defect_coils"),f'{gtot.get("defect_pct",0)*100:.2f}%',f'{gtot.get("reject_qty",0):.3f}',f'{gtot.get("reject_pct_qty",0)*100:.2f}%'])
    _pdf_section(story,styles,"Grade Performance",[charts_dict.get("Grade")],gr_rows,[150,80,90,90,80,100,90])

    # ---- Trend sheets: table + matching line chart, same page. ----
    for label,key,chart_name in [("Monthly Trend","monthly","Monthly Trend"),("Weekly Trend","period","Weekly Trend"),("Quarterly Trend","quarterly","Quarterly Trend"),("Financial Year Trend","yearly","Financial Year Trend")]:
        trows=payload[key]["rows"]; total=payload[key].get("total")
        rows2=[["Period","Coils","Output MT","Defect %","Reject % Qty","FPY %"]]+[[r.get("name"),r.get("coils"),f'{r.get("output_qty",0):.3f}',f'{r.get("defect_pct",0)*100:.2f}%',f'{r.get("reject_pct_qty",0)*100:.2f}%',f'{r.get("first_pass_yield_pct",0)*100:.2f}%'] for r in trows]
        if total: rows2.append(["Total",total.get("coils"),f'{total.get("output_qty",0):.3f}',f'{total.get("defect_pct",0)*100:.2f}%',f'{total.get("reject_pct_qty",0)*100:.2f}%',f'{total.get("fpy",0)*100:.2f}%'])
        _pdf_section(story,styles,label,[charts_dict.get(chart_name)],rows2,[110,90,100,90,100,90])

    # ---- Target vs Actual History ----
    th=payload.get("target_history",{}); tr=[['Period','Target','Actual','Attainment','Gap pp']]+[[r.get('period'),f"{r.get('target',0)*100:.2f}%",f"{r.get('actual',0)*100:.2f}%",f"{r.get('attainment',0)*100:.1f}%",f"{r.get('gap_pp',0):+.2f}"] for r in th.get('rows',[])]
    _pdf_section(story,styles,"Target vs Actual History",[],tr,[100,90,90,100,80])

    # ---- 6M Fishbone Analysis: diagram + cause list, same page. ----
    fb=payload.get("fishbone")
    if fb and fb.get("matched"):
        fb_png=_fishbone_png(fb, payload.get("fishbone_style"))
        cause_rows=[["Category","Cause"]]
        for key,label,_c,_s in FISHBONE_BRANCHES:
            for cause in (fb.get("causes") or {}).get(key) or []:
                cause_rows.append([label,cause])
        _pdf_section(story,styles,f"6M Fishbone Analysis — {fb.get('defect','')}",[fb_png] if fb_png else [],cause_rows,[130,600],chart_w=740,chart_h=390)
        rca=fb.get("rca") or {}
        if rca:
            rca_rows=[["6M Category","Root Cause (5-Why)","Action","Preventive Action","Responsibility"]]
            for key,label,_c,_s in FISHBONE_BRANCHES:
                for r in (rca.get(key) or []):
                    rca_rows.append([label,r.get("root_cause",""),r.get("action",""),r.get("preventive_action",""),r.get("responsibility","") or r.get("role","")])
            if len(rca_rows)>1:
                _pdf_section(story,styles,f"Root Cause Analysis (RCA) — {fb.get('defect','')}",[],rca_rows,[90,180,180,180,110])
    else:
        story.append(Paragraph("6M Fishbone Analysis",styles["Heading2"]))
        story.append(Paragraph("No 6M Fishbone mapping found for the current #1 defect yet. Import/update the 6M Fishbone Master in Admin, or map this defect to a master cause set.",styles["Small"]))
        story.append(PageBreak())

    # ---- Root cause + improvement opportunities. ----
    rc=payload.get("root_cause",{}); rcrows=rc.get("rows",[])
    if rcrows:
        rr=[["Defect","Grade","Work Center","Heat No","Batch No","Qty MT"]]+[[rc.get("defect",""),x.get("grade",""),x.get("work_center",""),x.get("heat_no",""),x.get("batch_no",""),f'{float(x.get("output_weight") or 0):.3f}'] for x in rcrows]
        _pdf_section(story,styles,"Root Cause Investigation — Top Defect",[],rr,[130,110,120,110,110,70])
    intel=payload.get("intel",{}); opp=[]
    for x in intel.get("early_warnings",[]): opp.append([x.get("title",""),x.get("detail",""),x.get("action","")])
    for x in intel.get("recurring_patterns",[])[:8]: opp.append([f'Recurring: {x.get("defect")}',f'{x.get("grade")} • {x.get("work_center")} • {x.get("period_count")} periods',"Investigate"])
    if opp:
        story.append(Paragraph("Root Cause / Improvement Opportunities",styles["Heading2"]))
        opp_tbl=Table([["Issue","Evidence","Recommended Action"]]+opp,repeatRows=1,colWidths=[180,380,150],hAlign="CENTER",style=TableStyle([("BACKGROUND",(0,0),(-1,0),colors.HexColor("#118DFF")),("TEXTCOLOR",(0,0),(-1,0),colors.white),("FONTNAME",(0,0),(-1,0),"Helvetica-Bold"),("ALIGN",(0,0),(-1,-1),"LEFT"),("ROWBACKGROUNDS",(0,1),(-1,-1),[colors.white,colors.HexColor("#F6F9FC")]),("GRID",(0,0),(-1,-1),.3,colors.HexColor("#DCE6EF")),("FONTSIZE",(0,0),(-1,-1),7)]))
        story.append(opp_tbl)
    if story and isinstance(story[-1], PageBreak): story.pop()
    doc.build(story); return bio.getvalue()


def _pptx_add_transition(slide, kind="fade", speed="med"):
    """Add a native PowerPoint slide transition (plays automatically in Slide Show /
    Present mode) — every export slide gets one so the deck isn't fully static."""
    try:
        from lxml import etree
        from pptx.oxml.ns import qn
        sld=slide._element
        for t in sld.findall(qn("p:transition")): sld.remove(t)
        transition=etree.SubElement(sld,qn("p:transition")); transition.set("spd",speed)
        etree.SubElement(transition,qn(f"p:{kind}"))
        sld.remove(transition)
        cSld=sld.find(qn("p:cSld")); cSld.addnext(transition)
    except Exception:
        pass

def _pptx_report(payload):
    """Build a PowerPoint mirroring the webapp: title slide, KPI grid, then one slide per
    topic with its chart AND its data table together (same PNGs used by the Excel/PDF
    exports), plus the 6M Fishbone diagram — all centered, consistently aligned, and with
    a slide transition so the deck isn't static."""
    if Presentation is None:
        raise RuntimeError("PowerPoint export requires python-pptx")
    NAVY=RGBColor(0x0F,0x2A,0x4A); ACCENT=RGBColor(0x11,0x8D,0xFF); WHITE=RGBColor(0xFF,0xFF,0xFF)
    LIGHT=RGBColor(0xEA,0xF2,0xFB); BORDER=RGBColor(0xDC,0xE6,0xEF); SUBTLE=RGBColor(0xB8,0xD6,0xF7)
    BAND=RGBColor(0xF4,0xF8,0xFC)

    prs=Presentation(); prs.slide_width=Inches(13.333); prs.slide_height=Inches(7.5)
    blank=prs.slide_layouts[6]
    all_slides=[]

    def add_slide():
        s=prs.slides.add_slide(blank); all_slides.append(s); return s

    def band(slide, text, sub=None):
        box=slide.shapes.add_shape(MSO_SHAPE.RECTANGLE,0,0,prs.slide_width,Inches(0.95))
        box.fill.solid(); box.fill.fore_color.rgb=NAVY; box.line.fill.background(); box.shadow.inherit=False
        accent_bar=slide.shapes.add_shape(MSO_SHAPE.RECTANGLE,0,Inches(0.95),prs.slide_width,Pt(3))
        accent_bar.fill.solid(); accent_bar.fill.fore_color.rgb=ACCENT; accent_bar.line.fill.background(); accent_bar.shadow.inherit=False
        tf=box.text_frame; tf.margin_left=Inches(0.4); tf.margin_top=Inches(0.05); tf.word_wrap=True
        p=tf.paragraphs[0]; p.text=text; p.font.size=Pt(22); p.font.bold=True; p.font.color.rgb=WHITE; p.alignment=PP_ALIGN.LEFT
        if sub:
            p2=tf.add_paragraph(); p2.text=sub; p2.font.size=Pt(10.5); p2.font.color.rgb=SUBTLE; p2.alignment=PP_ALIGN.LEFT

    def style_table(table, headers, rows, col_weights=None):
        n=len(headers)
        if col_weights:
            total=sum(col_weights)
            for i,c in enumerate(table.columns): c.width=int(table._graphic_frame.width*col_weights[i]/total)
        for cidx,h in enumerate(headers):
            cell=table.cell(0,cidx); cell.text=str(h); cell.fill.solid(); cell.fill.fore_color.rgb=ACCENT
            cell.vertical_anchor=MSO_ANCHOR.MIDDLE
            for para in cell.text_frame.paragraphs:
                para.alignment=PP_ALIGN.CENTER
                for run in para.runs: run.font.bold=True; run.font.color.rgb=WHITE; run.font.size=Pt(10.5)
        for ridx,r in enumerate(rows,1):
            for cidx,val in enumerate(r):
                cell=table.cell(ridx,cidx); cell.text=str(val); cell.vertical_anchor=MSO_ANCHOR.MIDDLE
                cell.fill.solid(); cell.fill.fore_color.rgb=WHITE if ridx%2==1 else BAND
                for para in cell.text_frame.paragraphs:
                    para.alignment=PP_ALIGN.LEFT if cidx==0 else PP_ALIGN.CENTER
                    for run in para.runs: run.font.size=Pt(9.5); run.font.color.rgb=NAVY

    def add_table_slide(title_text, headers, rows, col_weights=None, max_rows=14, note=None, top=Inches(1.25), height=Inches(5.75)):
        chunks=[rows[i:i+max_rows] for i in range(0,len(rows),max_rows)] or [[]]
        for ci,chunk in enumerate(chunks):
            sub=note or (f"Rows {ci*max_rows+1}-{ci*max_rows+len(chunk)} of {len(rows)}" if len(rows)>max_rows else None)
            s=add_slide(); band(s,title_text,sub)
            left=Inches(0.4); width=prs.slide_width-Inches(0.8)
            gframe=s.shapes.add_table(len(chunk)+1,len(headers),left,top,width,height)
            style_table(gframe.table,headers,chunk,col_weights)
        return chunks

    def add_chart_table_slide(title_text, chart_imgs, headers, rows, col_weights=None, max_rows=9, sub=None):
        """Chart(s) framed at the top, the data table right below. When the table has
        more rows than fit, EVERY continuation slide repeats the same chart(s) above
        the next block of rows, so a chart section never degrades to a bare table."""
        chart_imgs=[im for im in (chart_imgs or []) if im]
        pages=[rows[i:i+max_rows] for i in range(0,len(rows),max_rows)] or [[]]
        for pi,chunk in enumerate(pages):
            if len(rows)>max_rows:
                psub=f"Rows {pi*max_rows+1}-{pi*max_rows+len(chunk)} of {len(rows)}"+(f" — {sub}" if sub else "")
            else:
                psub=sub
            s=add_slide(); band(s,title_text,psub)
            if chart_imgs:
                n=len(chart_imgs); gap=Inches(0.18)
                avail_w=prs.slide_width-Inches(0.8)-(n-1)*gap; pic_w=int(avail_w/n); pic_h=Inches(2.55); top=Inches(1.18)
                x=Inches(0.4)
                for img in chart_imgs:
                    frame=s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,x-Pt(3),top-Pt(3),pic_w+Pt(6),pic_h+Pt(6))
                    frame.fill.solid(); frame.fill.fore_color.rgb=WHITE; frame.line.color.rgb=BORDER; frame.line.width=Pt(0.75); frame.shadow.inherit=False
                    s.shapes.add_picture(io.BytesIO(img),x,top,width=pic_w,height=pic_h)
                    x=int(x+pic_w+gap)
                table_top=Inches(3.95); table_h=Inches(3.15)
            else:
                table_top=Inches(1.25); table_h=Inches(5.7)
            if headers:
                left=Inches(0.4); width=prs.slide_width-Inches(0.8)
                gframe=s.shapes.add_table(len(chunk)+1,len(headers),left,table_top,width,table_h)
                style_table(gframe.table,headers,chunk,col_weights)

    charts_dict=dict(_export_charts(payload))

    # ---- Title slide ----
    s=add_slide()
    bg=s.shapes.add_shape(MSO_SHAPE.RECTANGLE,0,0,prs.slide_width,prs.slide_height)
    bg.fill.solid(); bg.fill.fore_color.rgb=NAVY; bg.line.fill.background(); bg.shadow.inherit=False
    accent_bar=s.shapes.add_shape(MSO_SHAPE.RECTANGLE,0,Inches(7.0),prs.slide_width,Inches(0.06))
    accent_bar.fill.solid(); accent_bar.fill.fore_color.rgb=ACCENT; accent_bar.line.fill.background(); accent_bar.shadow.inherit=False
    tb=s.shapes.add_textbox(Inches(0.8),Inches(2.7),prs.slide_width-Inches(1.6),Inches(2.2)); tf=tb.text_frame; tf.word_wrap=True
    p=tf.paragraphs[0]; p.text="QUALITY INTELLIGENCE"; p.font.size=Pt(42); p.font.bold=True; p.font.color.rgb=WHITE; p.alignment=PP_ALIGN.CENTER
    p2=tf.add_paragraph(); p2.text="Disposition & Defect Analytics — Dashboard Export"; p2.font.size=Pt(18); p2.font.color.rgb=SUBTLE; p2.alignment=PP_ALIGN.CENTER
    fs=_filter_summary(payload["filters"])
    p3=tf.add_paragraph(); p3.text="Generated "+datetime.now().strftime("%d-%b-%Y %H:%M:%S")+"    |    Filters: "+("; ".join(f"{k}: {v}" for k,v in fs) if fs else "All"); p3.font.size=Pt(12); p3.font.color.rgb=RGBColor(0x9F,0xC2,0xEC); p3.alignment=PP_ALIGN.CENTER

    # ---- KPI grid — 4x3, same 12 KPIs and order as the web dashboard cards. ----
    kl=payload["kpis"].get("kpis",[])
    for base in range(0,len(kl),12):
        chunk=kl[base:base+12]
        s=add_slide(); band(s,"Critical KPIs","Executive Summary")
        cols=4; margin_x=Inches(0.4); top=Inches(1.3); gap=Inches(0.18); cell_h=Inches(1.7)
        cell_w=int((prs.slide_width-2*margin_x-(cols-1)*gap)/cols)
        for i,k in enumerate(chunk):
            r=i//cols; c=i%cols
            x=int(margin_x+c*(cell_w+gap)); y=int(top+r*(cell_h+gap))
            box=s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,x,y,cell_w,cell_h)
            box.fill.solid(); box.fill.fore_color.rgb=LIGHT; box.line.color.rgb=BORDER; box.line.width=Pt(0.75); box.shadow.inherit=False
            tf=box.text_frame; tf.word_wrap=True; tf.vertical_anchor=MSO_ANCHOR.MIDDLE
            p=tf.paragraphs[0]; p.text=k.get("label",""); p.font.size=Pt(11); p.font.bold=True; p.font.color.rgb=NAVY; p.alignment=PP_ALIGN.CENTER
            p2=tf.add_paragraph(); p2.text=_export_display_value(k.get("value",0),k.get("fmt","")); p2.font.size=Pt(22); p2.font.bold=True; p2.font.color.rgb=NAVY; p2.alignment=PP_ALIGN.CENTER

    if "Decision Distribution" in charts_dict:
        s=add_slide(); band(s,"Quality Decision Distribution")
        # Chart on the left, its complete data table on the right (every decision
        # row plus the Total), so the slide follows the same chart+table pairing
        # as every other topic slide.
        pic_w=Inches(6.6); pic_h=int(pic_w*5.15/7.5); top=Inches(1.4)
        s.shapes.add_picture(io.BytesIO(charts_dict["Decision Distribution"]),Inches(0.4),top,width=pic_w,height=pic_h)
        _dec_rows=[[r.get("decision",""),r.get("coils",0),f'{r.get("pct_coils",0)*100:.2f}%',f'{r.get("qty",0):.3f}',f'{r.get("pct_qty",0)*100:.2f}%'] for r in (payload["kpis"].get("decision_table") or [])]
        _dt=payload["kpis"].get("decision_total")
        if _dt: _dec_rows.append(["Total",_dt.get("coils",0),f'{_dt.get("pct_coils",0)*100:.2f}%',f'{_dt.get("qty",0):.3f}',f'{_dt.get("pct_qty",0)*100:.2f}%'])
        _dec_h=["Decision","Coils","% Coils","Qty (MT)","% Qty"]
        _tbl_w=prs.slide_width-Inches(0.4)-Inches(7.3)
        _gf=s.shapes.add_table(len(_dec_rows)+1,len(_dec_h),Inches(7.3),Inches(1.5),_tbl_w,Inches(0.42)*(len(_dec_rows)+1))
        style_table(_gf.table,_dec_h,_dec_rows,[2.4,1,1.1,1.3,1.1])

    # ---- Defect Analysis: table + its Pareto / Intensity charts, same slide. ----
    # The COMPLETE defect register is paginated across slides (every continuation slide repeats
    # the Pareto/Intensity charts above the next block of rows). No top-N cap.
    d=payload["defects"]; _pptx_register=d.get("register",[])
    _pptx_reg_sub=None
    add_chart_table_slide("Defect Analysis",[charts_dict.get("Defect Pareto"),charts_dict.get("Defect Intensity")],
        ["Rank","Defect","Records","Qty (MT)","% Records"],
        [[r["rank"],r["defect"],r["records"],f'{r["qty"]:.3f}',f'{r["pct_records"]*100:.2f}%'] for r in _pptx_register],
        col_weights=[0.6,3.0,1.1,1.2,1.2], sub=_pptx_reg_sub)

    # ---- Work Center / Grade: table + matching bar chart, same slide. ----
    wcg_headers=["Name","Coils","Output MT","Defect Coils","Defect %","Reject Qty MT","Reject % Qty"]
    wcg_weights=[2.2,1,1.3,1.3,1,1.4,1.3]
    wc=payload["wcg"]["by_work_center"]; gr=payload["wcg"]["by_grade"]
    add_chart_table_slide("Work Center Performance",[charts_dict.get("Work Center")],wcg_headers,
        [[r.get("name"),r.get("coils"),f'{r.get("output_qty",0):.3f}',r.get("defect_coils"),f'{r.get("defect_pct",0)*100:.2f}%',f'{r.get("reject_qty",0):.3f}',f'{r.get("reject_pct_qty",0)*100:.2f}%'] for r in wc],
        col_weights=wcg_weights)
    add_chart_table_slide("Grade Performance",[charts_dict.get("Grade")],wcg_headers,
        [[r.get("name"),r.get("coils"),f'{r.get("output_qty",0):.3f}',r.get("defect_coils"),f'{r.get("defect_pct",0)*100:.2f}%',f'{r.get("reject_qty",0):.3f}',f'{r.get("reject_pct_qty",0)*100:.2f}%'] for r in gr],
        col_weights=wcg_weights)

    # ---- Trend slides: table + matching line chart, same slide (Monthly/Weekly/Quarterly/FY). ----
    trend_headers=["Period","Coils","Output MT","Defect %","Reject % Qty","FPY %"]; trend_weights=[1.6,1,1.3,1,1.2,1]
    for label,key,chart_name in [("Monthly Trend","monthly","Monthly Trend"),("Weekly Trend","period","Weekly Trend"),("Quarterly Trend","quarterly","Quarterly Trend"),("Financial Year Trend","yearly","Financial Year Trend")]:
        trows=payload[key]["rows"]
        add_chart_table_slide(label,[charts_dict.get(chart_name)],trend_headers,
            [[r.get("name"),r.get("coils"),f'{r.get("output_qty",0):.3f}',f'{r.get("defect_pct",0)*100:.2f}%',f'{r.get("reject_pct_qty",0)*100:.2f}%',f'{r.get("first_pass_yield_pct",0)*100:.2f}%'] for r in trows],
            col_weights=trend_weights)

    # ---- 6M Fishbone Analysis slide — the Ishikawa diagram for the current #1 defect. ----
    fb=payload.get("fishbone")
    if fb and fb.get("matched"):
        s=add_slide(); band(s,"6M Fishbone Analysis",f"Top defect: {fb.get('defect','')}")
        png=_fishbone_png(fb, payload.get("fishbone_style"))
        if png:
            pic_w=Inches(12.5); pic_h=Inches(5.9); left=int((prs.slide_width-pic_w)/2); top=Inches(1.35)
            frame=s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,left-Pt(3),top-Pt(3),pic_w+Pt(6),pic_h+Pt(6))
            frame.fill.solid(); frame.fill.fore_color.rgb=WHITE; frame.line.color.rgb=BORDER; frame.line.width=Pt(0.75); frame.shadow.inherit=False
            s.shapes.add_picture(io.BytesIO(png),left,top,width=pic_w,height=pic_h)
    else:
        s=add_slide(); band(s,"6M Fishbone Analysis")
        tb=s.shapes.add_textbox(Inches(0.6),Inches(2.8),prs.slide_width-Inches(1.2),Inches(1.5)); tf=tb.text_frame; tf.word_wrap=True
        p=tf.paragraphs[0]; p.text="No 6M Fishbone mapping found for the current #1 defect yet."; p.font.size=Pt(16); p.font.color.rgb=NAVY; p.alignment=PP_ALIGN.CENTER
        p2=tf.add_paragraph(); p2.text="Import/update the 6M Fishbone Master in Admin, or map this defect to a master cause set."; p2.font.size=Pt(12); p2.font.color.rgb=RGBColor(0x6B,0x7C,0x93); p2.alignment=PP_ALIGN.CENTER

    # ---- Target vs Actual History ----
    th=payload.get("target_history",{})
    add_table_slide("Target vs Actual History",["Period","Target","Actual","Attainment","Gap (pp)"],
        [[r.get('period'),f"{r.get('target',0)*100:.2f}%",f"{r.get('actual',0)*100:.2f}%",f"{r.get('attainment',0)*100:.1f}%",f"{r.get('gap_pp',0):+.2f}"] for r in th.get('rows',[])],
        col_weights=[1.4,1,1,1.2,1])

    # ---- Root cause / improvement opportunities — bullet slide. ----
    intel=payload.get("intel",{}); bullets=[]
    for x in intel.get("early_warnings",[]) or []: bullets.append(f'\u26a0 {x.get("title","")}: {x.get("detail","")}')
    for x in (intel.get("recurring_patterns",[]) or [])[:8]:
        bullets.append(f'\u21bb Recurring: {x.get("defect")} — {x.get("grade")} / {x.get("work_center")} ({x.get("period_count")} periods)')
    if bullets:
        s=add_slide(); band(s,"Root Cause & Improvement Opportunities")
        tb=s.shapes.add_textbox(Inches(0.6),Inches(1.35),prs.slide_width-Inches(1.2),Inches(5.8)); tf=tb.text_frame; tf.word_wrap=True
        for i,b in enumerate(bullets[:14]):
            p=tf.paragraphs[0] if i==0 else tf.add_paragraph()
            p.text=b; p.font.size=Pt(14); p.font.color.rgb=NAVY; p.alignment=PP_ALIGN.LEFT; p.space_after=Pt(8)

    # A gentle fade transition on every slide so presenting the deck isn't fully static.
    for slide in all_slides:
        _pptx_add_transition(slide,"fade","med")

    bio=io.BytesIO(); prs.save(bio); return bio.getvalue()



