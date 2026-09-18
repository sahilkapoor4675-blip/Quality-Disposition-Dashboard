# V58 Release Gate

V58 is a stability/release-candidate baseline. Future changes should not be promoted unless the regression gate passes on an isolated database.

## Required checks

```bash
python -m py_compile server.py reports.py
node --check app.js
python tests/regression_smoke.py
python tests/http_smoke.py
```

The regression suite covers data validation, idempotent/concurrent disposition import, KPI/analysis calculations, cache limits, activity retention, backup integrity/tamper detection, restore, and CSV safety.

The HTTP smoke suite exercises health/readiness plus the registered public API, export endpoints, login, and admin read endpoints against a temporary SQLite database. It never uses production credentials or a production database.

## Production discipline

Keep `DATABASE_URL` pointed at the production PostgreSQL service. Do not run the test scripts against production. Any schema or business-logic change must be followed by the complete gate before release.


### Export stress gate
```bash
python tests/export_stress.py
```
This must pass before any release. It specifically guards against high-cardinality Excel/PDF/PPTX export regressions.


## Export completeness gate
- Excel/PDF/PPTX report tables must preserve all source rows; no silent top-N table truncation.
- PPTX chart sections must keep the matching chart image and table on every continuation slide.
- Chart visuals may remain bounded Top-N summaries for readability, but paired tables are complete.
- `tests/export_acceptance.py` validates row completeness and chart+table pairing.
