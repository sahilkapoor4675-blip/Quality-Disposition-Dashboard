# Release Gate

A build must not be deployed unless every check below passes on an isolated (temporary) database.
Never run these scripts against production.

## Required checks (run from the repository root)

```bash
python -m py_compile server.py reports.py dr_pg_backup.py
node --check app.js
node --check sw.js
python code_health.py
python regression.py            # runs all 6 embedded suites (deep/smoke, HTTP contract, V64.3, V64.5, V64.6 UI, period comparison)
python test_disaster_recovery.py
python http_smoke.py            # health/readiness + every public, export and admin-read route
python smoke_test.py            # bundled dataset unchanged, core tabs/API respond
python admin_ux_audit.py        # admin navigation contract
python export_acceptance.py     # Excel/PDF/PPTX completeness + chart/table pairing
python export_stress.py         # high-cardinality export stress
```

## Export completeness rules
- Excel/PDF/PPTX report tables preserve all source rows; no silent top-N truncation.
- Every PPTX chart section keeps its chart image and table, including every continuation slide.
- Chart visuals may be bounded Top-N summaries for readability; the paired tables are complete.

## Production discipline
Keep `DATABASE_URL` pointed at the production PostgreSQL service. Any schema or business-logic change
must be followed by the complete gate. After deploying, verify `/api/admin/service_health` reports `latest_data_date` and `freshness_age_days`, then hard-refresh the browser (Ctrl+Shift+R) once so
the new CSS/JS is loaded.
