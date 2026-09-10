# V27.4 — Production Reliability & Performance

## What changed
- Added composite database indexes for the dashboard's most common multi-filter/grouping combinations.
- Applied the composite indexes consistently to SQLite and PostgreSQL paths.
- Added GitHub Actions CI to automatically run compile, code-health, smoke, and regression checks on pushes/PRs to `main`/`master`.
- Preserved the existing dataset, filters, KPI calculations, QCR calculations, UI behavior, and import/export logic.

## Data safety
The bundled `quality.db` remains unchanged at the row/data level. Index creation only changes database access structures.


## Export Optimization Update
- Added dedicated Export Center tab with filtered Excel, PDF and PowerPoint actions.
- Added PowerPoint (16:9) management deck export with KPI scorecard, charts, trends, QCR intelligence and root-cause slides.
- Enhanced Excel export with complete filtered row-level data plus dashboard/QCR analysis.
- Enhanced PDF export with complete trend, work-center, grade and QCR intelligence summary tables.
