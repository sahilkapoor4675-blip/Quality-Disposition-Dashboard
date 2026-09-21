# Release Gate

A build must not be deployed unless every check below passes on an isolated (temporary) database.
Never run these scripts against production.

## Required checks (run from the repository root)

```bash
python -m py_compile server.py reports.py
node --check app.js
python code_health.py
python regression_smoke.py      # data rules, imports, KPI maths, backup/restore, security
python http_smoke.py            # health/readiness + every public, export and admin-read route
python smoke_test.py            # bundled dataset unchanged, core tabs/API respond
python regression_test.py       # core endpoints + filter contract
python regression_v64_3.py      # single response, malformed filters, drill totals, per-FY quarters, data-quality wiring
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
must be followed by the complete gate. After deploying, hard-refresh the browser (Ctrl+Shift+R) once so
the new CSS/JS is loaded.
