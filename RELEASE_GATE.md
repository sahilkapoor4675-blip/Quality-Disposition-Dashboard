# Release Gate

A build must not be deployed unless every check below passes on an isolated (temporary) database.
Never run these scripts against production.

## Required checks (run from the repository root)

```bash
python -m py_compile server.py reports.py
node --check app.js
node --check sfx.js
python code_health.py
python regression.py --suite regression_smoke
python regression.py --suite regression_test
python regression.py --suite regression_v64_3
python regression.py --suite regression_v64_5
python regression.py --suite regression_v64_6
python regression.py --suite regression_period_comparison
python http_smoke.py
python smoke_test.py
python admin_ux_audit.py
python export_acceptance.py
python export_stress.py
```

`regression.py` is the unified regression runner. The suite names above replace the old
`regression_smoke.py`, `regression_test.py`, `regression_v64_3.py`, `regression_v64_5.py`, and
other deleted standalone test files that were previously referenced here.

## Export completeness rules
- Excel/PDF/PPTX report tables preserve all source rows; no silent top-N truncation.
- Every PPTX chart section keeps its chart image and table, including every continuation slide.
- Chart visuals may be bounded Top-N summaries for readability; the paired tables are complete.

## Production discipline
Keep `DATABASE_URL` pointed at the production PostgreSQL service. Any schema or business-logic change
must be followed by the complete gate. After deploying, verify `/api/admin/service_health` reports
`latest_data_date` and `freshness_age_days`, then hard-refresh the browser (Ctrl+Shift+R) once so the
new CSS/JS is loaded.
