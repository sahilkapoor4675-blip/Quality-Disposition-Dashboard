# Quality Disposition Control Dashboard

Plant quality-intelligence dashboard for the Cupronickel (Non-Ferrous) division. Pure Python
(`http.server`) backend, PostgreSQL in production, SQLite for local/offline use. No Flask and no
frontend CDN or build step.

The current version is the single line in `VERSION.txt` (also sent in the `X-App-Version` response
header). `CHANGELOG.md` is the version history (V65 onward; older entries are in
`docs/CHANGELOG_ARCHIVE.md`); this README always describes the current build only.

## What it does
- **Dashboard** – live filters (Month, Week, Quarter, Financial Year, Work Center, Grade, Quality
  Decision, Defect Intensity), KPI cards with period-over-period change, drill-down to underlying coils.
- **Quality Control Room (QCR)** – health score, early warnings, problem finder, why-changed analysis.
- **Work Center & Grade**, **Defects List** (with 6M Fishbone / RCA reference) and **Period Trend** tabs.
- **Chemistry SPC** tab – one heat = one point, ordered by heat number. While this tab is open, the **top filter bar** switches from the disposition filters to the chemistry filters: Month, Week, Quarter, Fin. Year (from the chemistry file's Date column, same labels and April–March financial year as the main dashboard), Grade, Parameter, Heat Qty (last N heats) and Heat No., in the same layout, size and dropdown style as the dashboard filters (Parameter sits where Work Center is, Heat Qty where Quality Decision is, Heat No. where Defect Intensity is); the period lists cascade like the dashboard. Element pictures, centre line and Aim lines are always drawn. Other tabs keep the normal dashboard filters. Under the top bar, one KPI-style card per main element (Cu + the grade's alloying elements, e.g. Cu / Zn / Ni for Ni-Brass): symbol chip, name, status pill, big **Cpk** and **Ppk**, the element picture, then **Cp | Pp** and **Std. Dev. | Std. Dev.** tiles in the dashboard KPI tile font (left column = within σ from the moving range, right column = overall σ), measured against the Standard limits. The cards stretch to the full row width, and the **LOW / MID / HIGH** capability bands (same on every card) are written once in a note strip above them. Then the I-MR control charts and histogram, each showing the **Standard LSL/USL, Aim LSL/USL and the mean**, the Cp/Cpk/Pp/Ppk/σ table of every parameter, the out-of-spec heat list, and every heat joined to its coils' defect/reject data on `heat_no`. There are no Western Electric rules and no KPI cards. Own selectors; the disposition filters do not apply. **Shareable link:** while this tab is open the address bar carries the selection (`?tab=chem&chem_spec=…&chem_param=…&chem_month=…&chem_week=…&chem_quarter=…&chem_fy=…&chem_n=…`), so a Chemistry view can be sent as a link; a link's selection wins over the one remembered in the browser. **Compare Periods** (two live copies of this tab for two Months / Weeks / Quarters / Fin. Years / Grades / Parameters) and **Saved Views** (Save Preset / Manage Presets in the Selection bar, stored separately from the dashboard presets) work here too. CSV downloads: Cpk table, heat-wise data of the charted parameter, and the out-of-spec heat list — available inside the tab and also from the header **Export** dialog, which lists them first (above the disposition reports) while this tab is open. Data comes from **Admin → Cast Chemistry** (validated import) and **Admin → Spec Limits** (Standard.xlsx import — sheet "Standard" and sheet "AIM" — or manual edit).
  **Chemistry SPC maintenance (no version bump):** period filters are calculated from the stored `cast_date` read from the chemistry file; main-element cards mirror the dashboard KPI typography, period-over-period Cpk trend, directional animation and pointer tilt; statistical UCL/LCL lines are intentionally not plotted (Aim LSL/USL are the visible operating bounds); Chemistry drill-down keeps its header/breadcrumb fixed while its content scrolls; Chemistry API responses, capability summaries and the revision-keyed source snapshot are cached; stale in-flight selector requests are cancelled to make filter switching faster. **2026-10-02 (ninth pass):** every drill-down table (main drill-down incl. the Heat history, and the Chemistry heat drill-down) has an Excel-style filter in each column header (funnel button: value list with counts, search, Select All, OK / Clear filter / Cancel; several columns combine and each list only offers values left by the other filters); the header text is bold, centred and middle-aligned; icons were added to the Chemistry SPC tab wherever one was missing (table headers, Cp / Pp / Std. Dev. tiles, Cpk / Ppk labels, Prev, capability-band strip, status cells, notes). See "Drill-down header filters" below. **2026-10-02 (eighth pass):** with Grade = All each grade name is a larger heading on a light-blue band; with Parameter = All only the element heading (Cu%, Zn%, Ni%) is blue, the chart box itself keeps the normal card background; the Chemistry panel titles use the same card-heading style as the other tabs; one font system on the whole tab (DM Sans headings, Space Grotesk card text/numbers, Inter 14px tables/notes/buttons, Manrope 14px legends, nothing under 12px). **2026-10-01 (seventh pass):** out-of-Aim values shown as out of spec; Aim LSL/USL in the heat drill-down; element boxes with hover (their blue background was removed again on 2026-10-02). **2026-10-01 (sixth pass):** LOW/MID/HIGH shown once above the cards; cards fill the row and use the dashboard tile font; Std/Aim LSL/USL lines are always drawn; the Mean line is the middle of the Aim band; upper-limit-only elements (Pb etc.) draw LSL and Aim LSL at 0; Parameter = All charts get gaps and more height; presentation mode fits at 100% zoom (see "Chemistry SPC — chart limits & mean"). **2026-10-01 (fourth pass):** the Chemistry *Selection* bar sits under the header search like the other tabs; Grade and Parameter count as active filters when they differ from the default view; element-card trend is KPI-style (`Prev ▲/▼ +y% (+Δ)`) and, with only Heat Qty (last N) set, compares the last N heats with the N before; Compare Periods starts on a dimension with 2+ values; the date column is also found by its content when no header says "Date".
- **Compare Periods** – two dashboards side by side; saved views; global search; command palette (Ctrl/⌘+K) with categorised commands and field-name hints;
  light/dark theme; works on phones and tablets.
- **Exports** – Excel (styled: JSL logo, icons, KPI / severity colours), PDF, PowerPoint (chart + table on every slide) and raw CSV. Every drill-down and Chemistry table also exports to a styled Excel file (`reports._table_xlsx`) or plain CSV.
- **Admin console** (`/admin`) – grouped, scroll-synced control center for monitoring, data operations,
  latest records, 6M Fishbone, backups/recovery, security and audit; sidebar order always matches section order. Results appear as toasts, and long jobs (import, backup/restore, downloads) show a progress bar.
- **Presentation Mode** – drill-downs stay above the presentation overlay and return cleanly to the dashboard when closed (`Esc` closes the drill-down first, preserving Presentation Mode); toolbar titles exclude the fullscreen control glyph.
- **Header clock** – a compact calendar-style clock at the top-right of the header, above Commands: local date plus a live seconds clock in 12-hour AM/PM format, in both light and dark themes.

## Run locally
```bash
pip install -r requirements.txt
python3 server.py            # http://localhost:8000/  (admin console: /admin)
```
Without `DATABASE_URL` the app uses a persistent SQLite file outside the app folder (set `DB_PATH` to choose
the location). The bundled `quality.db` seeds it on the first run only; later restarts and code replacements
never reseed it.

## Production (Render + PostgreSQL)
`render.yaml` and [docs/DEPLOY.md](docs/DEPLOY.md) describe the free Render + Supabase setup. On Render the app
fails closed if `DATABASE_URL` is missing; it never silently falls back to SQLite.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (required in production) |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Creates the first admin only if that username does not exist yet |
| `DB_LIMIT_MB` | Database size guard (default 500) |
| `DB_PATH` | SQLite file location (local use) |
| `PORT` | Listen port (default 8000) |
| `PGSSLMODE`, `PG_POOL_MIN`, `PG_POOL_MAX` | PostgreSQL SSL mode and pool size |
| `BACKUP_SCHEDULE_HOURS`, `BACKUP_KEEP` | Automatic backup interval and retention |
| `EXPORT_CONCURRENCY`, `EXPORT_WAIT_TIMEOUT_S` | Heavy report export throttling on small hosts (`EXPORT_CONCURRENCY` defaults to `1`) |
| `TRUST_PROXY_HEADERS` | Honour `X-Forwarded-*` behind Render's proxy |
| `APP_VERSION` | Optional override; by default read from `VERSION.txt` |

Set these in the Render dashboard, never in Git.

Health probes: `GET`/`HEAD /healthz` and `/readyz` (no database access; `render.yaml` uses `/readyz`).

## Data rules
- A normalised, non-empty `BATCH NO` identifies one coil. Existing legacy duplicates are never deleted
  automatically.
- Imports (`.xlsx/.xlsm/.csv/.tsv`) are validated and previewed before writing; each data-changing import
  creates a safety backup. Imports are transaction-locked so concurrent uploads cannot create the same batch.
- CSV exports neutralise spreadsheet-formula characters.
- **Import normalisation (tenth pass).** Dates are read day-first from real dates, Excel serials and the text
  formats plants export (`12.04.2026`, `2026-04-12 00:00:00`, `2026-04-12T08:30`, `12 Apr 2026`, `2026/04/12`;
  a month-first value such as `04/13/2026` is used only when it cannot be read day-first). `BATCH NO` /
  `HEAT NO` stored as floats (`2000000001.0`) read as `2000000001`; `HEAT NO` has spaces removed and is
  upper-cased (this is also how the Chemistry join matches). `WORK CENTER` and `GRADE` have repeated spaces
  collapsed and, when they differ from a value already in the database only by case/spacing, take the stored
  spelling, so a typo-level difference never becomes a second filter entry.
- **Quarter without a financial year.** `Q1..Q4` repeat every FY; with Quarter picked and FY on *All*, every
  KPI, table and the comparison use the latest FY that has that quarter (same as the period label).
- The *Defect Intensity* list offers `NONE` only when blank-intensity coils exist under the other filters.

## Backups
JSON-GZIP snapshots with integrity checksums, created after every import, on demand (Admin → Backups) and on
a schedule. Restore verifies the checksum first and rolls back on failure. The built-in backup is a recovery
aid, not a substitute for provider-level backups: copy backups off the server periodically.

Disaster recovery (recovery points, off-site copies, restore, provider switch): [docs/DISASTER_RECOVERY.md](docs/DISASTER_RECOVERY.md). Off-site bucket / encryption / alert setup: [docs/DEPLOY.md](docs/DEPLOY.md).

## Security
- Admin APIs require an authenticated session plus CSRF validation; sensitive Users, Security, Backup and audit-export endpoints are Super Admin (`admin` role) only; login attempts are rate-limited.
- Public activity endpoints are rate-limited separately; request bodies, sessions and import previews are
  size-bounded.
- `script-src` has no `'unsafe-inline'`: every inline `<script>` is stamped with a random per-request
  nonce, and interactive admin rows use `data-action` attributes + `addEventListener` delegation rather
  than `onclick="..."`, so an injected `<script>` tag can't execute even if it reaches the page.
- Server errors (HTTP 5xx) return only a reference id to the browser; the real message is in the server log.
- See [docs/SECURITY.md](docs/SECURITY.md) for the full baseline.

## Admin console navigation
- Sidebar navigation is grouped into a canonical 23-section sequence; sidebar and content use the same order.
- While scrolling, the active sidebar tab follows the section in view; clicking a tab jumps to the top of that section.
- Overview production-health content and KPI target history live inside their logical parent sections; Import History is in the navigation, followed by Cast Chemistry and Spec Limits (Chemistry SPC data).
- There is no global search bar in Admin; use **Latest Records** (search + date filters + export/delete).

## Repository layout

The repository root holds **only what the running app needs** (the server serves these files by name
from the root, so they must stay there). Tests and documentation live in their own folders.

| Path | Role |
|---|---|
| `server.py` | HTTP server, API, database layer, imports, backups, admin |
| `reports.py` | Excel / PDF / PowerPoint / CSV report builders |
| `chem_spc.py` | Chemistry import validation, spec matching and SPC maths (pure functions; tested by `tests/test_chem_spc.py`) |
| `alerts.py`, `logging_setup.py`, `session_store.py` | Backup-failure alerts, rotating logs, session/login store |
| `dr_storage.py`, `dr_recovery.py`, `dr_pg_backup.py` | Off-site storage, snapshot verify/restore CLI, PostgreSQL dump runner (used by the GitHub Action) |
| `index.html`, `sfx.js` | Dashboard UI |
| `src/js/`, `src/css/` | `app.js` / `app.css` source, split into small numbered files — see "Frontend source layout" below |
| `admin.html` | Admin console (single file) |
| `sw.js`, `site.webmanifest`, `favicon*`, `jsl-*.png`, `intro-photo-*.webp` | PWA shell and images |
| `quality.db` | First-run SQLite seed (4,936 disposition records) |
| `supabase_schema.sql` | Reference PostgreSQL schema (startup migrations stay authoritative) |
| `requirements.txt`, `runtime.txt`, `render.yaml`, `Procfile`, `.env.example`, `VERSION.txt` | Deployment config |
| `.github/workflows/` | `dr-backup.yml` (12-hourly PostgreSQL dump), `dependency-audit.yml` (weekly `pip-audit`) |
| `tests/` | Release gate: `run_gate.py` runs `static_checks.py`, `regression.py`, `test_units.py`, `test_smoke.py`, `test_chem_spc.py`, `test_import_normalization.py`, `test_data_lifecycle.py`, `test_exports.py`, `test_browser.py` |
| `tools/self_host_fonts.sh` | One-time script to self-host Google Fonts locally (see "Fonts" below) — not needed for the app to run |
| `docs/` | `DEPLOY.md`, `DISASTER_RECOVERY.md`, `SECURITY.md`, `CHANGELOG_ARCHIVE.md` |

## Frontend source layout

`app.js` and `app.css` are not files in the repo — they're built by `server.py` at request time by concatenating:

- `src/js/01-…` through `src/js/22-…` (filename order = script load order), and
- `src/css/01-…` through `src/css/15-…` (filename order = cascade order — later files can override earlier ones, same as before the split).

Every piece is cut on a safe boundary (a top-level JS statement, or a top-level CSS rule/comment), so each file is independently valid and the join is byte-for-byte identical to the old single `app.js`/`app.css`. The browser still only ever requests one `/app.js` and one `/app.css`; nothing about page load or the CSS cascade changed.

**When you fix a bug, upload only the one `src/js/NN-*.js` or `src/css/NN-*.css` file that changed** — not the whole bundle. The filename tells you what's inside (e.g. `15-chart-builders.js`, `06-qcr.css`). If you ever need the full single-file `app.js`/`app.css` (e.g. to hand to a tool that expects one file), request it against a running instance — `GET /app.js` / `GET /app.css` returns the built bundle.

## Fonts
By default the dashboard loads Google Fonts (DM Sans, Sora, Outfit, Allura) non-blocking from
`fonts.googleapis.com` — if that's slow or blocked on your network, the page still renders immediately
with fallback fonts. To remove that dependency entirely, run `bash tools/self_host_fonts.sh` on any
machine with internet access, then follow the printed instructions to switch `index.html` over to the
local copy it downloads into `fonts/`.

## Release gate
Before deploying, run one command from the repository root (isolated temporary databases only — never
point it at production):

```bash
python tests/run_gate.py          # everything, ~2 min (py_compile, node --check, static checks, 6 regression suites, unit tests, smoke, data lifecycle, exports + stress, browser)
python tests/run_gate.py --fast   # same, minus the slow export stress test
```

Every check must pass. The browser check (`test_browser.py`) drives a real headless Chromium and needs
`pip install playwright && playwright install chromium`; it's optional — without it, the gate prints
`[SKIP] browser (Chromium UI regression)` and still runs everything else. Export rules: Excel/PDF/PPTX
tables keep all source rows (no silent top-N truncation) and every PPTX chart section keeps its chart
image and table. After deploying, check that `/api/admin/service_health` reports `latest_data_date` and
`freshness_age_days`, then hard-refresh the browser (Ctrl+Shift+R) once so the new CSS/JS loads.

## Troubleshooting
- **Old look / dark mode wrong after a deploy** – hard-refresh once (Ctrl+Shift+R); CSS and JS are cached
  by version.
- **Uptime monitor shows the service down** – point it at `/healthz` (GET or HEAD).
- **Admin says login required after a restore** – expected: restore replaces the user/session tables; log in again.

## UI notes
### Header Design
The dashboard uses the approved **Design 4 — Industrial Copper** header: static copper-base coil/plant artwork on a steel-inspired surface, JSL orange/graphite diagonal accents, and the existing Quality Intelligence typography preserved as-is. The compact right-side toolbar remains bottom-aligned with the date/time card above it. The same composition adapts for the dark theme.

### UI note — Intro screen
The cursor-following Field Name Hover Tag is intentionally disabled on the introduction/splash screen and remains active across the dashboard/admin fields.

### Cursor-following Field Name Hover Tag
The field-name hover tag is enabled across the main dashboard and Admin UI, including dynamically rendered controls. The Intro/Splash screen is intentionally excluded.

### Header live-status behavior
- The **LIVE DATA** indicator includes a subtle pulsing status dot in the main dashboard header.
- The pulse is CSS-based and remains unobtrusive while indicating the live state.
- Existing Dashboard/Admin cursor-following field hints remain enabled; the Intro/Splash screen is excluded.

### Drill-down header filters (2026-10-02)
- **Where:** `src/js/21-drill-header-filters.js` (+ `src/css/17-drill-header-filters.css`). Used by the main drill-down (`#drillModal`: KPI cards, chart bars, QCR investigations, global search, Heat No. history) and by the Chemistry heat drill-down (`#chemDrillModal`, both its tables).
- **Use:** click the funnel in a column header -> tick the values to keep -> OK. A blue funnel and a "Filtered" strip (with *Clear all filters*) show what is active. Esc closes the menu first, then the drill-down.
- **All records, not just the page:** the server sends 250 rows per page. The first time a filter menu is opened the remaining pages are loaded (500 rows per request, `/api/drilldown`), so a filter covers the whole drill-down; while a filter is active the page buttons are hidden and the count reads `N of M records`. Clearing the filters returns to the normal paginated view.
- **Export:** *Export Selected Records* = styled Excel, the **CSV** button next to it = plain CSV. Both contain every record and every stored column (14: the 9 on screen + UD Date, Month, Week, Quarter, Financial Year). With a column filter active only the filtered rows are exported (the browser sends them to `POST /api/export/table`); without a filter the server builds the file (`GET /api/drilldown/export?fmt=xlsx|csv`, no row cap).
- **New drill-down tables:** call `QDHF.decorateStatic(table)` after the table is in the DOM (tables whose rows are all in the page); the paginated main table is rendered by `QDHF.renderDrill()` from `renderDrillPage()`.

### Chemistry SPC — Heat Qty window and dates
- With **Heat Qty (Last N)** the banner shows the heat range and the min / max cast date of the current window and of the previous N heats it is compared with; the Heat Qty dropdown shows each option's date span; notes cover fewer heats than N, heats without a cast date and overlapping dates. The same text heads the Chemistry CSVs and the print / Save-as-PDF view. Built in `chem_spc.window_of()`; returned as `window` by `/api/chem/spc`.
- Dates are shown **dd-mm-yyyy** in tables, tooltips, drill-downs, CSV exports and Admin tables (stored internally as ISO).

### Chemistry SPC — drill-down, MR note and card layout (2026-10-02)
- **Histogram bars are clickable**: a bar opens the list of heats in that value range inside the Chemistry heat dialog (`openChemBin`); a row opens the usual heat drill-down. *Export Selected Records* exports the bin list (column filters honoured). Bins with 0 heats are not clickable. Hover = highlight + other bars dim (same focus effect as the dashboard charts); keyboard: Tab to a bar, Enter / Space.
- **MR chart** has a "How to read this" note: an orange dot is a moving range above 3.267 x MR-bar, i.e. a sudden jump versus the previous heat. It is a stability signal, not an out-of-spec result.
- **Element cards**: the Prev line and the trend chip always stack (Prev on top, chip below). **Heat drill-down Status** wraps (`OUT OF SPEC` / `ABOVE USL`) so no horizontal scroll is needed.
- **Capability table**: header icon above label on every column; the table has no CSV buttons. The Cpk table, Heat data and Out-of-spec heats exports are in the header **Export** dialog only; the dialog's *File type* picker chooses Excel (default, styled) or CSV.

### Chemistry SPC — data rules
- **Cast dates:** Month / Week / Quarter / Fin. Year come from the stored `cast_date` (the file's Date column, read on import; if no header says "Date", a column where most cells are real dates is used). Heats imported without a date have empty period lists — the tab says so; re-import the chemistry file (heats update in place, no duplicates) to fill them. Heat Qty (last N) and its trend work without dates.
- **Chemistry vs Disposition panel:** read-only comparison of reject % / defect % on coils of in-spec vs out-of-spec heats, joined on `heat_no`; an empty card means no such heat exists in the selection or none has inspection data yet.
- **Key:** the workbook's `Coil No.` is the `heat_no` of the disposition table; one heat = one SPC point. Columns are matched by header name, so sheets with a different column order, extra columns (Hardness, Conductivity, HF No.) or a Date column (it is ignored) import fine.
- **Import checks (admin):** blank/odd heat numbers, duplicate heats in the file (identical = skipped, conflicting = all copies rejected), text (a trailing % sign is accepted) or out-of-range % (below 0 / above 100), `Total%` far from the sum of the elements, alloy that does not fit the heat prefix, denomination that does not fit the sheet (not checked for sheet names of 30+ characters, which Excel may have truncated), analyst-name typos, and values more than one spec width outside the limits. Errors skip the row; warnings import it. Nothing is written until **Confirm**; a recovery point is taken first.
- **Re-import:** the same heat updates in place (numbers are overwritten, changes are listed); identical rows are counted as unchanged; heats not in the file are never deleted. A blank analyst/sheet in the new file keeps the stored value.
- **Spec matching:** sheet name → alloy code → denomination (for alloys with several specs, e.g. Ni-Brass 5 Rs vs 10/20 Rs). A sheet named exactly like a grade only decides while it does not contradict the heat's own Alloy column: if the grade's alloy code and the heat's Alloy differ, the sheet name is ignored, the Alloy column decides, and if it cannot the heat stays unassigned (the import shows a `sheet_alloy` warning) — so a wrongly named sheet can never put a heat on the wrong limits. Specs are matched when charts are drawn, so editing a spec applies instantly. Heats with no matching spec are charted without LSL/USL.
- **Maths:** I-chart limits = mean ± 3·MR̄/1.128, MR-chart UCL = 3.267·MR̄, Cp/Cpk use the within-σ (MR̄/d2), Pp/Ppk the overall standard deviation. Lower limits of 0 (impurity-type) are treated as "no lower limit" in these calculations (the charts still draw them at 0, see below). `Total%` gets an out-of-spec count only (it is a sum, so Cp/Cpk are not meaningful).


### Chemistry SPC — chart limits & mean
- **Always drawn:** Std LSL, Std USL, Aim LSL and Aim USL appear on the I chart and the histogram whenever they are stored; the scale widens to include them, however tight the data is. Statistical UCL/LCL are still not plotted.
- **Mean line = centre of the Aim band** `(Aim LSL + Aim USL) / 2`, not the data mean or moving-range mean. Without any Aim limit it falls back to the data mean. The Cpk table's "Mean" column and the MR chart's MR̄ line are unchanged.
- **Upper-limit-only parameters** (impurities, e.g. Pb "0 - 0.04"): the server ignores a 0 LSL for Cp/Cpk and out-of-spec counts, but the charts draw Std LSL and Aim LSL at **0**, so the mean falls between 0 and the Aim USL.
- **Out of spec on the charts:** a point outside the Standard limits **or outside the Aim band** (while Aim is shown) is drawn red; histogram bins entirely outside those limits turn red. Cp/Cpk, the Cpk table's out-of-spec count, the out-of-spec heat list and CSVs still use the Standard limits only.
- **Display conventions (Chemistry SPC).** Index names are written Cp / Cpk / Pp / Ppk (never CPK / PPK) on the cards and in the capability table headers. **Std. Dev. is always shown to 3 decimals** (cards and table; the CSV export keeps the full value). Cp, Cpk, Pp and Ppk values in the capability table are bold. The Prev line and the ▲/▼ change chip wrap inside the card instead of being clipped at 100 % zoom. Every histogram bar with at least one heat carries its count at any chart width (smaller, then vertical, on narrow bars), not only in presentation mode.
- **Heat drill-down:** shows Std LSL/USL and Aim LSL/USL per parameter; Status reads `OUT OF SPEC · ABOVE AIM USL` etc. when a value is outside the Aim band.
- **Parameter = All:** each element sits in its own blue-themed box (also in presentation mode) with the dashboard hover lift/glow.
- **Presentation mode:** with Parameter = All every element chart gets the full presentation stage and the stage scrolls to the next element; charts are redrawn to the stage's shape, so nothing is clipped at 100% browser zoom.

### Chemistry SPC thorough bug + performance maintenance (2026-09-30)
The Chemistry SPC tab has been through a full application-level regression pass. Chemistry now participates in the shared tab routing/default-tab contract; valid parameters with no matching values remain selected instead of silently switching; Reset All returns to a deterministic default grade/parameter; null Cpk/Ppk states remain non-numeric during animation; and the duplicate card keyboard refresh path has been removed.

For large heat selections, the API still returns the full statistical series and no chemistry data is discarded. The browser renders the complete series as a single SVG path and bounds individual marker nodes, while a nearest-point hover layer continues to expose the exact heat/value and chart-to-heat drill-down for every source point. This reduces layout/paint work during large Chemistry SPC loads without changing the stored data or SPC calculations. The Chemistry response/source/disposition/overview caches remain bounded and revision-aware.

This maintenance pass does **not** change the application version.

### Chemistry SPC dashboard parity maintenance (2026-09-30)
Chemistry SPC reuses the dashboard's existing interaction primitives wherever the UI concept is shared: KPI cards use the dashboard status/hover/tilt/trend/sparkline treatment; charts use the shared `.chart-scroll`, `.chart-svg`, `.chart-bar` and global tooltip contracts; filters use the dashboard dropdown markup and cascading behaviour; and Chemistry drill-down keeps the shared frozen header/breadcrumb model. Chemistry-specific code remains limited to cast-chemistry filtering, SPC math and chemistry-specific chart/panel content. This maintenance pass does not bump the application version.
- **Trend chip on the Chemistry element cards**: `▼ -10.32% (-0.27)` = relative change of the index, then the absolute difference of the index itself (Cpk 2.31 vs 2.57 → -0.27). Cpk / Ppk are unit-less, so the bracket is not percentage points. Whole chip is bold; hover shows this explanation.
- **Heat count beside the grade name** uses the grade-name font (`.chem-gh-n`); the heat / cast range (Heat Qty only) is `.chem-gh-win`.

## Assistant & Help (free, offline)
- **Where:** header **✨ Assistant** button (or `Ctrl+/`), Command palette → *Assistant & Help*, `?` for Help topics. Code: `src/js/23-assistant.js` (+ `src/css/18-assistant.css`); public API `window.QDAssist` (`open`, `help`, `ask`, `helpMode`, `toggleLang`).
- **No cost, no key:** answers are built in the browser from `/api/qcr` (the same data the Control Room uses) with the current filters, plus a built-in knowledge base (`KB` array, 34 topics, English + Hinglish). No external AI service is called.
- **Ask:** keyword / intent routing (summary, KPI value, top defects, worst grade / work center, trend, why-changed, alerts, next steps, forecast) plus actions (open tab, Export, theme, apply / reset filters, open heat). Add a new topic by adding one row to `KB`; add a new question type in `answer()`.
- **Help mode:** header **❓** (or palette / panel) — click any KPI card, chart panel, table column, tab, filter or header button and a pop-up card explains it (`explainElement`, `showPop`, `CHART_HELP`, `COL_HELP`); `Esc` closes the pop-up, then the mode. **Guided tour:** `TOUR` array (selector + EN / Hinglish / Hindi text). New charts are picked up automatically if their panel has a heading — add a row to `CHART_HELP` for a custom description and live number.
- **Languages:** English, Hinglish and Hindi (Devanagari) — `t(en, hinglish, hindi)` in the code, `DEVA` + `norm()` map Devanagari words to the Roman keywords the router knows. Stored in `qd_assist_lang`. KB rows are `[id, group, keywords, titleEn, titleHi, English, Hinglish, Hindi]` — add all three texts when adding a topic. Read-aloud and voice input use the browser's speech APIs and only appear where supported. All speech goes through one `Voice` controller and one `Mic` controller in `23-assistant.js` (one voice at a time; same 🔊 again = stop; stopped by closing the pop-up / panel, Esc, tab or language change, a new question, tab hidden or page left; 🎤 is an on/off toggle released on close) — never call `speechSynthesis.speak()` or `new SpeechRecognition()` directly.
- The header buttons (`.qa-split`: Assistant + ❓) live in `.qa-clock-row` next to the clock card on purpose: the header has no spare width, and adding it to `.header-actions` made the title wrap.
