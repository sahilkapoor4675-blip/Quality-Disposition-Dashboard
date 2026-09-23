"""Regression checks for quarter and financial-year period-over-period KPI comparison.

Uses an isolated temporary SQLite database and never touches production data.
"""
import os
import sys
import tempfile
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BASE_ROOT = Path('/mnt/data/repo_extract/Quality-Disposition-Dashboard-main')
# Import the exact patched server from this patch directory; its unchanged sibling
# dependency (reports.py) is resolved from the source checkout.
sys.path[:0] = [str(ROOT), str(BASE_ROOT)]

with tempfile.TemporaryDirectory(prefix='qdash_period_compare_') as td:
    os.environ.update(
        DB_PATH=str(Path(td) / 'quality.db'),
        APP_VERSION='test-period-compare',
        ADMIN_USERNAME='admin',
        ADMIN_PASSWORD='Strong-Admin-1234!',
    )
    os.environ.pop('DATABASE_URL', None)
    os.environ.pop('RENDER', None)

    import server

    server._ensure_admin_schema()
    server.ensure_fast_indexes()
    conn = server.get_conn()
    conn.execute('DELETE FROM disposition')
    conn.commit()
    conn.close()

    def rec(batch, d, decision, w):
        m, wk, q, fy = server._derive_period_fields(d)
        return {
            'heat_no': 'H' + batch,
            'batch_no': batch,
            'work_center': 'WC1',
            'grade': 'A',
            'output_weight': float(w),
            'main_defect': 'NO DEFECT' if decision == 'PRIME' else 'STICKING',
            'defect_intensity': '' if decision == 'PRIME' else 'LIGHT',
            'quality_decision': decision,
            'insp_lot_date': d.isoformat(),
            'ud_date': '',
            'month': m,
            'week': wk,
            'quarter': q,
            'financial_year': fy,
        }

    # FY 2025-26 Q4 (Jan-Mar 2026): 100 MT, 80 prime / 20 reject.
    # FY 2026-27 Q1 (Apr-Jun 2026): 120 MT, 90 prime / 30 reject.
    # FY 2026-27 Q2 (Jul-Sep 2026): 150 MT, 120 prime / 30 reject.
    server._insert_records([
        rec('Q4A', date(2026, 2, 10), 'PRIME', 80),
        rec('Q4B', date(2026, 2, 11), 'REJECT', 20),
        rec('Q1A', date(2026, 5, 10), 'PRIME', 90),
        rec('Q1B', date(2026, 5, 11), 'REJECT', 30),
        rec('Q2A', date(2026, 8, 10), 'PRIME', 120),
        rec('Q2B', date(2026, 8, 11), 'REJECT', 30),
    ])

    base = {
        'month': 'All', 'week': 'All', 'quarter': 'All', 'financial_year': 'All',
        'work_center': 'All', 'grade': 'All', 'quality_decision': 'All', 'defect_intensity': 'All',
    }
    errors = []

    # Quarter-only: latest Q2 resolves to FY 2026-27 and compares with Q1 in that FY.
    q2 = dict(base, quarter='Q2')
    d = server.compute_kpis(q2)
    if d['period'].get('current') != 'Q2 (FY 2026-27)':
        errors.append(f"Q2 current label: {d['period']}")
    if d['period'].get('previous') != 'Q1 (FY 2026-27)':
        errors.append(f"Q2 previous label: {d['period']}")
    fpy = next(k for k in d['kpis'] if k['label'] == 'First Pass Yield % (Prime%)')
    if abs(float(fpy.get('prev') or 0) - 0.75) > 1e-12:
        errors.append(f"Q2 previous FPY expected 0.75, got {fpy.get('prev')}")

    # Quarter-only Q1 rolls across the FY boundary to Q4 of the previous FY.
    q1 = dict(base, quarter='Q1')
    d = server.compute_kpis(q1)
    if d['period'].get('current') != 'Q1 (FY 2026-27)':
        errors.append(f"Q1 current label: {d['period']}")
    if d['period'].get('previous') != 'Q4 (FY 2025-26)':
        errors.append(f"Q1 previous label: {d['period']}")
    fpy = next(k for k in d['kpis'] if k['label'] == 'First Pass Yield % (Prime%)')
    if abs(float(fpy.get('prev') or 0) - 0.80) > 1e-12:
        errors.append(f"Q1 previous FPY expected 0.80, got {fpy.get('prev')}")

    # Financial Year: FY 2026-27 compares against FY 2025-26.
    fy = dict(base, financial_year='FY 2026-27')
    d = server.compute_kpis(fy)
    if d['period'].get('previous') != 'FY 2025-26':
        errors.append(f"FY previous label: {d['period']}")
    fpy = next(k for k in d['kpis'] if k['label'] == 'First Pass Yield % (Prime%)')
    # 210 prime / 270 total for FY26-27; 80 / 100 for FY25-26.
    if abs(float(fpy.get('value') or 0) - (210/270)) > 1e-12:
        errors.append(f"FY current FPY expected 0.70, got {fpy.get('value')}")
    if abs(float(fpy.get('prev') or 0) - 0.80) > 1e-12:
        errors.append(f"FY previous FPY expected 0.80, got {fpy.get('prev')}")

    # Explicit Quarter + FY remains backward compatible.
    explicit = dict(base, quarter='Q2', financial_year='FY 2026-27')
    p = server.compute_prev_filters(explicit)
    if p != dict(base, quarter='Q1', financial_year='FY 2026-27'):
        errors.append(f"Explicit Q2+FY previous filters wrong: {p}")

    # Invalid quarter labels must remain non-comparable rather than invent Q0/Q5 periods.
    invalid = dict(base, quarter='Q5', financial_year='FY 2026-27')
    if server.compute_prev_filters(invalid) is not None:
        errors.append('Invalid Q5 quarter should have no previous-period comparison')

    if errors:
        print('PERIOD COMPARISON REGRESSION FAIL')
        for e in errors:
            print(' -', e)
        raise SystemExit(1)
    print('PERIOD COMPARISON REGRESSION PASS — Quarter (including FY-boundary Q1→Q4) and Financial Year KPI comparisons are active.')
