# V27.3 — RCA (Root Cause Analysis) + 6M Icon/Color Coding

## Added
- **RCA import**: the same "Import 6M Fishbone Master" upload in Admin now also reads two more
  sheets from the workbook, both optional:
  - `RCA_RootCause_Library` — Defect List, 6M Category, WHY-1 → WHY-5/Root Cause, Action,
    Preventive Action, Role, Responsibility (one row per defect × 6M category).
  - `Icon Color Coding` — 6M category → recommended color (icon is carried over from whatever
    emoji prefixes the category cell in the RCA sheet, e.g. "👤Man").
- **RCA panel**: a new "Root Cause Analysis (RCA)" table renders under the 6M Fishbone diagram
  on both the Quality Control Room tab and the Dashboard tab, for whichever of the Top 5 Defects
  is selected. Shows the Why-Why chain, root cause, action, preventive action and role/
  responsibility for every 6M category that has RCA data on file for that defect.
- **Dynamic icon/color coding**: the fishbone diagram (card grid, Ishikawa SVG, and the PNG used
  in Excel/PDF exports) now takes its 6M category colors and icons from the imported
  `fishbone_style` table instead of a fixed palette. Falls back to the original look until an
  admin imports a workbook that carries an Icon Color Coding sheet.
- Excel and PDF exports include a new RCA table alongside the existing 6M cause list for the
  current #1 defect.
- Backups/restore now include the RCA library and style config alongside the existing 6M
  Fishbone Master, aliases, disposition data and KPI targets.

## Preserved
- Existing 6M Fishbone Master import behavior for workbooks that only have `Master_Data` —
  RCA and style sheets are optional; nothing breaks if they're absent.
- Existing fishbone matching (manual alias → exact → fuzzy) is unchanged; RCA is attached to
  whatever the match already resolves to.
- Existing disposition data, KPI calculations, and 5-tab navigation.

## Data model
- New tables: `rca_master` (defect × 6M category → why1..why5, action, preventive_action, role,
  responsibility) and `fishbone_style` (6M category → label, icon, color). Both are created
  automatically on server startup for existing databases (no manual migration needed).
