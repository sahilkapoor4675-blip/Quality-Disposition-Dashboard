## Intro screen: no more blank screen while waiting for the first click — no version bump (2026-10-03, sixteenth pass)

**Why it happened (not a crash)**
- Browsers keep audio locked until the first click / key press. The intro deliberately holds its whole sequence (logo, tagline, NON-FERROUS, title, cards)
  until audio can really play, so the sound stays in sync with the animation. While it waited, the middle of the screen was empty and only a small prompt
  sat at the bottom edge (for up to 8 s) — it looked like a broken page.

**Fixed**
- The JSL logo is shown immediately while the gate waits (`src/js/01-intro-splash.js`); the headline sequence still starts on the click, so sound sync is unchanged.
- The "Click anywhere or press any key to start with sound" prompt is now centred where the title will appear, slightly larger, with a soft pulse
  (disabled under `prefers-reduced-motion`) and a compact version for phones (`src/css/15-intro-screen.css`).
- If nobody clicks, the intro now starts silently after **5 s** instead of 8 s (`GATE_FALLBACK_MS`). A click later still switches the remaining sound cues on.

## Full audit pass — no version bump (2026-10-03, fifteenth pass)

**Audit performed (nothing else needed fixing)**
- Release gate (`python tests/run_gate.py --fast`): all 12 checks PASS (py_compile, node --check on 25 JS pieces + bundle, static checks, regression,
  unit, import normalisation, 47-route smoke, data lifecycle, exports, real-Chromium UI regression).
- Extra static analysis: pyflakes on every Python file (only unused-import / unused-variable cosmetics) and ESLint `no-undef` / unreachable-code /
  duplicate-key rules on the bundled `app.js` (no real findings; every `SFX` use is guarded by `window.SFX`).
- Hostile-input fuzz of ~3,300 requests across every public data endpoint (SQL-injection strings, 3,000-char values, NUL bytes, emoji, overflowing and
  negative numbers, path-traversal strings): server stayed up, no SQL error, no traceback, nothing slow — except the one bug below.

**Fixed**
- **`/api/drilldown` returned HTTP 500 for an absurd `page` value** (e.g. `?page=99999999999999999999`): `(page-1)*page_size` overflowed the 64-bit SQL
  `OFFSET` (`OverflowError: Python int too large to convert to SQLite INTEGER`). `page` is now capped at 1,000,000 (an empty page is returned, with the
  real `total_pages`). Normal pagination is unchanged. The same unbounded-offset pattern in `POST /api/admin/records` (`offset`) is capped too.

**Tests**
- `tests/test_smoke.py`: new regression check for `page=99999999999999999999 / 1000000 / -5 / abc` on `/api/drilldown`.

## Chemistry SPC + export fixes — no version bump (2026-10-03, fourteenth pass)

**Fixed**
- **Heat count font.** `358 heats` beside the grade name is now the same font family, size and weight as the grade name (it was a small 14 px label).
  The heat range / cast-date span shown when *Heat Qty (last N)* is chosen stays small.
- **Element cards: trend chip is bold end to end** — arrow, `+` / `-` sign, `%` and the bracketed `(−0.27)`. The chip has a hover tooltip that says what
  the numbers are: `%` = relative change, the bracket = absolute difference of the Cpk / Ppk index itself (e.g. 1.86 − 1.78). Cpk / Ppk have no unit, so
  the bracket is **not** percentage points (pp).
- **Histogram bars now react like the dashboard charts.** The drill-down existed but could not be reached: the Aim band / limit lines / normal curve are
  drawn after the bars and covered them, so the pointer never touched a bar. Non-bar shapes now ignore the pointer. Hover = bar highlight (outline, lift,
  shadow), the other bars dim, tooltip says *click to drill down*; click or Enter/Space opens the heats of that bar. Empty bars stay inert.
- **Drill-down export was incomplete.**
  - Main drill-down (*Export Selected Records*): the file had the 9 on-screen columns and the server export stopped at 50,000 rows. It now has **every stored
    column** (adds UD Date, Month, Week, Quarter, Financial Year) and **every record**. With column filters active it exports exactly the filtered rows
    (all pages are loaded first, not only the page on screen).
  - Chemistry heat drill-down: Aim LSL / Aim USL and the Aim-based status were missing; column filters were ignored. Both fixed (Excel and CSV).
  - Chemistry histogram-bin list: column filters are honoured.
- **Main Excel report: columns cut off.** The auto-fit skipped every column after the first on sheets with a merged title row, so long names (defects, grades)
  were truncated. Column widths are now computed per column.

**Changed / Added**
- **Styled Excel for every "export what you see" button** (new `reports._table_xlsx`, `POST /api/export/table`): JSL logo, navy title band, sub-title, meta block
  (exported time, selection, window, filters, record count), icons in every header, status / decision / Cpk-band colours, zebra rows, total row, auto-filter,
  frozen header, landscape fit-to-width print setup. Text cells are formula-safe. Used by the main drill-down, the Chemistry Cpk table, Heat data,
  Out-of-spec heats, the histogram-bin list and the heat drill-down (heat sheet has a *Chemistry* block and a *Coils* block).
- **Export dialog → Chemistry: file-type picker** (Excel styled / CSV plain). Excel is the default. The drill-down header has a new **CSV** button next to
  *Export Selected Records* (`GET /api/drilldown/export?fmt=xlsx|csv`).
- **Main Excel report (header Export → Excel)** now carries the dashboard look: JSL logo on every sheet, icons on sheet titles and headers, KPI tiles in each
  card's accent colour with the trend line (▲/▼, %, "vs prev") like the web cards, severity colours (high / medium / low / info), zebra rows, bold total row,
  auto-filter + frozen header, repeat-header and landscape one-page-wide printing (the workbook prints on 14 pages instead of 40).

**Tests**
- `tests/test_chem_spc.py`: heat-count font, bold trend, histogram hover / pointer-events, Excel exports present, CSV Aim columns, file-type picker.
- `tests/test_exports.py`: `table_export_acceptance` (1,200 rows kept, logo, decision colours, formula injection neutralised).
- Verified in Chromium: hover + click + keyboard on histogram bars, filtered and unfiltered drill-down exports (rows / columns / values), Chemistry exports.
- Release gate: PASS.

## Chemistry SPC UI fixes — no version bump (2026-10-02, thirteenth pass)

**Fixed**
- **Element cards: trend chip position.** The `% change (± value)` chip sat beside the Prev value on some cards and below it on others
  (it only wrapped when it did not fit). The Prev line and the chip now always stack the same way (Prev on top, chip below) on every card,
  for Cpk and Ppk alike.
- **Heat drill-down: Status column ran past the table edge** (horizontal scroll needed for `OUT OF SPEC · ABOVE USL`). The status now wraps to two
  lines (`🚩 OUT OF SPEC` / `ABOVE USL`) in a fixed-width column. Same format in the new histogram bin list.
- **Capability table header:** icon and label were misaligned from column to column. Every header is now icon on top, label below, centred.

**Added**
- **Histogram drill-down.** Clicking a histogram bar opens the heats that fall inside that value range (heat, cast date, value, status, coils,
  reject %); click a heat for its full chemistry + coil disposition. *Export Selected Records* downloads the bin's list. Empty bars are not clickable;
  the tooltip says "click to see heats".
- **Moving Range chart: "How to read this" note** under the chart. It explains that a dot above the limit (3.267 x MR-bar, value shown) is a sudden jump
  from the previous heat, lists likely causes (charge / raw-material change, furnace practice, sampling or analysis error), states that it is a process
  stability signal and not an out-of-spec result, and shows how many jumps the current selection has. Tooltip wording is now
  `above UCL: big jump vs previous heat`.

**Removed**
- **"Cpk table (CSV)" / "Heat data (CSV)" buttons from the Capability table.** Both downloads remain in the header **Export** dialog.

**Tests**: `tests/test_chem_spc.py` now checks that the CSV exports live only in the header Export dialog. `test_chem_spc.py` and `static_checks.py` pass.

**Files**: `src/js/21-chem-spc.js`, `src/css/16-chem-spc.css`, `tests/test_chem_spc.py`, `README.md`, `CHANGELOG.md`.

## Chemistry SPC: heat / date window for "Heat Qty (Last N)" + dd-mm-yyyy dates — no version bump (2026-10-02, twelfth pass)

**Added**
- **Banner shows the window, not just "Last 50 heats".** Two lines: `Current: Last 50 heats · NBS6101 → NBS6150 · Cast 12-Jun-26 to 03-Jul-26 (22 days)` and
  `Compared to: previous 50 heats · NBS6051 → NBS6100 · Cast 20-May-26 to 11-Jun-26`. Month / Week / Quarter / FY selections that are
  combined with Heat Qty read `Last 50 heats of Jun-2026 · ...`.
- **Min / max cast date, not first / last heat.** Heats run in heat-number order, not date order, so the span is the earliest and latest cast
  date inside the window. When the date spans of the two windows really intersect the banner adds `dates overlap with previous window`
  (a single shared boundary day does not count).
- **Heat Qty dropdown options carry their span**: `Last 50 · 12-Jun → 03-Jul` (follows Grade and Month / Week / Quarter / FY). Fewer
  heats than the option: `Last 200 · only 150 · ...`. `All` stays plain.
- **Edge-case notes**: `Last 100 requested, only 71 heats available (Mar-26 → Sep-26)`, `3 heats have no cast date`,
  `Previous window has only X of N heats`, and for Grade = All `K grades have fewer than N heats`.
- **Grade = All**: banner says `Last N heats per grade`; each grade heading shows its own heat range and cast span when Heat Qty is set.
- **Where it is written**: the banner, a header block at the top of all three Chemistry CSVs (selection, current / compared window, notes,
  export date), and a print header (Ctrl+P / Save as PDF) on the Chemistry tab. The server-built PPTX / PDF / Excel reports cover the
  disposition data only and are unchanged.
- API: `/api/chem/spc` now returns `window` (`requested`, `available`, `current`, `previous`, `overlap`, `qty_spans`, `available_span`).

**Changed**
- **dd-mm-yyyy everywhere** (was yyyy-mm-dd): Chemistry heat drill-down (subtitle, coil table, its CSV), chart tooltips, Chemistry CSVs,
  disposition CSV exports (full CSV and drill-down export), Admin record tables / import previews and chemistry import warnings.

**Files**: `chem_spc.py`, `server.py`, `admin.html`, `index.html`, `src/js/21-chem-spc.js`, `src/css/16-chem-spc.css`.

## Chemistry SPC display polish — no version bump (2026-10-02, eleventh pass)

**Changed**
- **Cp / Cpk / Pp / Ppk wording.** The element cards and every Chemistry table header showed *CPK* / *PPK* in capitals
  (CSS `text-transform: uppercase`); they now read **Cpk** / **Ppk** (Cp, Pp likewise), cards and tables alike.
- **Std. Dev. to 3 decimals** on the element cards and in the capability table (it used 3–5 decimals depending on size).
  The Cpk table CSV still exports the full-precision value.
- **Cp, Cpk, Pp and Ppk are bold** in the capability table (colour bands unchanged).

**Fixed**
- **Trend chip cut on the element cards** at 100 % browser zoom (the `% change` and the `(± value)` in brackets were hidden
  by `overflow: hidden` / no-wrap). The Prev line and the chip now wrap onto a second line inside the card, and the bracketed
  value is always shown. Checked at 1280 / 1366 / 1536 / 1920 px with a wider font and a worst-case `-100.00% (-1.25)`.
- **Histogram data labels missing outside presentation mode.** A count was drawn only when the bar was at least 22 units
  wide, which narrow charts (more bins, limits widening the axis, smaller screens) never reached; presentation mode is wider,
  so it showed them. Every non-empty bar is now labelled (size 10 → 9 → 8.5, vertical text on very narrow bars, card-coloured
  halo). The y-axis also has more headroom so the tallest bar's count no longer sits under the Std / Aim / Mean line labels.
  Reproduced before the fix: 0 of 21 labels at 800 px; after: 21 of 21 at 520, 800 and 1440 px.

## Audit pass: import parsing, normalisation, filter consistency, Chemistry SPC checks — no version bump (2026-10-02, tenth pass)

**Audit method.** Full re-check of the release gate, then an independent re-computation: 61 random filter
combinations (KPIs, drill-down row counts, Work Center / Grade rows, monthly / weekly / quarterly totals,
Defect register, decision and intensity tables, every offered filter option) compared against plain SQL on
`quality.db`; Chemistry SPC (Cp, Cpk, Pp, Ppk, within / overall σ, out-of-spec count, Month / Week / Quarter / FY
filters, Heat Qty, previous-period Cpk, disposition join per heat) compared against a separate implementation on a
1,075-heat dataset; XSS payloads in grade / defect / work centre / analyst / sheet names; console and page errors on
every tab. All of those numbers matched. The items below are what the audit found.

**Fixed**
- **Disposition CSV dates.** `12.04.2026` (SAP), `2026-04-12 00:00:00`, `2026-04-12T08:30:00`, `12 Apr 2026`,
  `2026/04/12`, `12.04.26` and Excel serial numbers were rejected with "INSP LOT DATE is required", failing the
  whole row. They are now read (day-first; month-first only when it cannot be day-first). The Chemistry importer
  already accepted these; both importers now agree.
- **Duplicate coils from float IDs.** A batch stored as `2000000001.0` was inserted as a second coil next to
  `2000000001`. Whole-number floats now read as integers.
- **Work Center / Grade / Heat No. spelling.** `cnd_slt`, `NI-Brass   (Ni - 05)` or `NBS 6348` created extra filter
  entries and broke the Chemistry heat join. Heat No. is whitespace-stripped and upper-cased; Work Center and Grade
  are space-collapsed and snapped to the spelling already stored when only case / spacing differs.
- **`NONE` in the Defect Intensity list** was always offered, so choosing it under some filters returned 0 rows. It is
  now offered only when blank-intensity coils exist under the other active filters.
- **Filter-option race.** Slower, older option responses could overwrite the dropdown lists (and reset a value picked
  meanwhile) after quick successive changes. Only the newest request now updates the lists.
- **Quarter with FY = All** (latent until a second financial year exists, i.e. April 2027): numbers combined every FY's
  Q1 while the label and previous-period comparison named the latest FY. Both now use the latest FY with that quarter.
- `/api/drilldown` no longer returns the raw exception text on failure (logged server-side instead).
- **Chemistry SPC:** a shared link with `chem_n` outside the preset list (e.g. 25) silently fell back to *All*; any
  whole number up to 5000 is kept and shown in the Heat Qty list. A heat repeated on two sheets with identical values
  was reported as "different values"; the message now says it is on different sheets (grade ambiguous).

**Added**
- `tests/test_import_normalization.py` (in `run_gate.py`): date formats, ID / spelling normalisation, `NONE` option,
  quarter-to-FY resolution and the duplicate-heat messages.

**Observations, not changed (source data / design choices)**
- 152 defect coils have a blank intensity and 7 *NO DEFECT* coils carry an intensity; the *WITHOUT INTENSITY* row of the
  intensity table includes NO DEFECT coils; `WAVINESS` and `POOR SHAPE/WAVINESS` are separate defects; grade names mix
  `NI-Silver(Ni10,…)` and `Ni-Silver (Ni-20%,…)` styles. Cleaning these needs a grade / defect alias master.

## Drill-downs: Excel-style header filters, bold centred headers; Chemistry SPC icons — no version bump (2026-10-02, ninth pass)

**Added**
- **Column filters in every drill-down header.** Each column header of the main drill-down (KPI card / chart bar / QCR investigation / search / Heat No. history) and of both tables in the Chemistry heat drill-down has a funnel button that opens an Excel-like menu: search box, *(Select All)*, a check list of the column's values with record counts, **OK / Clear filter / Cancel**. Filters on several columns combine, and each list only shows values that are still possible under the other columns' filters. An active column gets a blue funnel and a tinted header; a *Filtered* strip above the table lists the active filters with **Clear all filters**.
- **Filters cover every record, not only the page on screen.** The drill-down is paginated (250 rows per page); opening a filter menu loads the remaining pages once (500 rows per request), then the table is filtered across all of them. While filtered, the count reads `959 of 4,936 records`, totals in the footer are recomputed, and paging is hidden; clearing filters returns to the normal pages.
- **Export Selected Records exports only the filtered rows** while a filter is active (CSV with the 9 on-screen columns, Excel-friendly UTF-8); with no filter the server export is unchanged.
- **Chemistry SPC icons where there were none:** capability-table headers (🧪 Parameter, 🔢 Heats, 📍 Mean, 🔻 Std LSL, 🔺 Std USL, 🎯 Aim LSL/USL, 🎯 Cp, 📈 Cpk, 📐 Pp, 📊 Ppk, 📉 Std. Dev., 🚩 Out of spec), the *Impurities & other parameters* row (🧫), the *Capability bands* strip (🎯), the element-card labels (📈 Cpk, 📊 Ppk, 🕘 Prev) and tiles (🎯 Cp, 📐 Pp, 📉 Std. Dev.), the out-of-spec heat list headers and search box, the heat drill-down table headers, its status cells (✅ OK / 🚩 OUT OF SPEC) and the *Disposition of this heat's coils* heading (🏭), and ℹ️ in front of the explanatory notes.

**Changed**
- **Drill-down table headers are bold (800), centred horizontally and middle-aligned vertically**, and long labels wrap at spaces instead of inside words (Date / Weight (MT) used to break letter by letter). The main drill-down column widths were adjusted slightly so the label and funnel fit.
- Chemistry capability table: the *Parameter* header no longer wraps inside the word.

**Fixed (test only)**: `tests/test_browser.py` asserted a `.sparkline` inside the Chemistry element cards, which the cards stopped having earlier; it now checks the status pill instead (the full gate was failing on this one line before). New browser checks: 9 funnel buttons, header style, a Work Center filter narrowing across all pages, *Clear all filters*.

**Notes**: no API, table or calculation change; `VERSION.txt` untouched. Dashboard tables outside drill-downs (Decision / Defect / Weekly tables, Chemistry capability and out-of-spec lists) are unchanged: the dashboard tables keep their existing click-to-sort headers. Files: `src/js/21-drill-header-filters.js` (new), `src/js/10-drilldown-dialogs-loadkpis.js`, `src/js/21-chem-spc.js`, `src/css/17-drill-header-filters.css` (new), `src/css/16-chem-spc.css`, `sw.js` (shell cache `qdash-shell-v15`), `tests/test_browser.py`, `README.md`, `CHANGELOG.md`.

**Validation**: full release gate passes (py_compile, node --check on 25 JS files + bundle, static checks, regression x6, unit, smoke, data lifecycle, exports, Chromium browser suite). In headless Chromium: Total Coils drill-down -> 9 funnels, header `800 / center / middle`, Work Center = CND_PIC gave 959 of 4,936 records (all CND_PIC, rows beyond page 1 included), Grade list narrowed by that filter, Esc closed only the menu, Clear all filters restored page 1 of 250; Heat history and the Chemistry heat drill-down (15 funnels on 2 tables) checked; no page errors or console errors.

## Chemistry SPC: bigger grade headings on blue, heading-only blue on element charts, one font system on every tab — no version bump (2026-10-02, eighth pass)

**Changed**
- **Grade = All:** every grade title (e.g. `Cu-Ni 80-20`, `Test Brass`) is now a larger heading (22px, DM Sans) on a light-blue band with a blue left accent (dark-mode variant included), so the grades are easy to tell apart. The heat count beside it is 14px.
- **Parameter = All (Cu% / Zn% / Ni% charts):** the blue background of the whole chart box is removed. The box now has the normal card background and border; only the element heading (`Cu%`, `Zn%`, `Ni%`) sits on the light-blue band. The lift / sheen hover on the box was removed together with the blue. Presentation mode keeps the same heading band.
- **Fonts and sizes are now consistent across tabs.** The Chemistry panel titles (Individuals / Moving Range / Histogram / Capability / Out-of-Spec) had no shared rule and were 18px; they now use the same card-heading style as the Dashboard, Work Center & Grade, Defects and Period Trend tabs (DM Sans 16px / 800, light-blue header strip with accent bar, dark-mode too). Inside the Chemistry tab the mixed fonts and sizes (Bahnschrift, Manrope, Space Grotesk and Inter at 9.5 - 13px) were unified: element-card labels, big Cpk/Ppk values (30px), sub-labels, status pill, Prev / trend and element names use Space Grotesk like the dashboard KPI cards; capability-band note, notes, footers, buttons and the period banner use Inter 14px like the dashboard tables / banners; chart legends use Manrope 14px like the dashboard legends; chart axis text uses Manrope. Nothing on the tab is below 12px any more (the table section separators are 12.5px).

**Notes**: no API, data, table or calculation change; `VERSION.txt` untouched. The light teal shading *inside* a chart between Aim LSL and Aim USL is part of the chart (it marks the operating band) and is unchanged. Service-worker shell cache bumped to `qdash-shell-v14` so browsers fetch the new CSS. Files: `src/css/05-typography-layout-drilldown.css`, `src/css/16-chem-spc.css`, `sw.js`, `README.md`, `CHANGELOG.md`.

**Validation**: full gate run (`py_compile`, `node --check`, static checks, regression x6, unit, smoke, data lifecycle, exports) passes. Headless Chromium (1440 px) read back computed fonts of every tab before/after and screenshots of Grade = All and Parameter = All; no page errors. Known and unrelated to this change: `tests/test_browser.py` line 224 still asserts a `.sparkline` inside the Chemistry element cards, but the cards no longer have one (it fails identically on the zip as uploaded); every other browser check passes.

## Chemistry SPC: out-of-Aim = out of spec, Aim limits in the heat drill-down, blue element boxes with hover — no version bump (2026-10-01, seventh pass)

**Changed**
- **A value outside the Aim band is shown as out of spec** (red marker) on the I chart, and the histogram bins that lie completely outside the Aim band turn red. The tooltip says why, e.g. `OUT OF SPEC (above Aim USL)` / `(below Std LSL)` (`chemOutWhy`). This follows the "Aim LSL / USL" chart toggle: with Aim hidden only the Standard limits count. The legend reads "Out of spec (outside Aim / Std limits)".
- **Heat drill-down** now has **Std LSL, Std USL, Aim LSL and Aim USL** columns (upper-limit-only elements show 0 as the lower bound, like the charts). The Status column reads `OUT OF SPEC · ABOVE AIM USL` / `BELOW AIM LSL` besides the existing Standard checks; those rows get a light red background. `/api/chem/heat` returns `aim_lsl`, `aim_usl` and `aim_side` per parameter.
- **Parameter = All:** every element box uses the dashboard's blue theme (light-blue gradient, blue border and heading, dark-mode variant) in normal **and presentation mode**, and has the KPI-card hover (lift, blue glow, one light sheen sweep). Drill-down parameter rows also highlight on hover.

**Notes**: Cp/Cpk/Pp/Ppk, the Cpk table's "Out of spec" count, the out-of-spec heat list and CSV exports still count **Standard** limit violations only; the Aim rule is a chart / drill-down view. Files: `server.py`, `src/js/21-chem-spc.js`, `src/css/16-chem-spc.css`, `README.md`, `CHANGELOG.md`.

**Validation**: `test_chem_spc.py` and `static_checks.py` pass; in headless Chromium a point between Aim USL and Std USL, a point below Std LSL and Pb above its Aim USL were forced and shown red with the right tooltip / drill-down status; blue box + hover checked in normal and presentation mode; no page errors.

## Chemistry SPC: one LOW/MID/HIGH note, full-width cards with dashboard fonts, limits always drawn, Aim-centred mean, presentation-mode fit — no version bump (2026-10-01, sixth pass)

**Changed**
- **LOW / MID / HIGH** are identical on every element card, so they are no longer repeated inside each card. They are written once in a note strip above the cards (*Capability bands (Cpk / Ppk): LOW 0.67 · MID 1.00 · HIGH 1.33 · Higher is better*), still read from the admin KPI target row **Chemistry Capability (Cp/Cpk/Pp/Ppk)**.
- **Element cards fill the full row width** like the dashboard KPI grid: with 1-4 cards the grid uses exactly that many columns instead of leaving blank space on the right (`.chem-el-grid-wrap[data-n]`). 5-6 column layouts on very wide screens and the 2 / 1 column mobile layouts are unchanged.
- **Cp / Pp / Std. Dev. tiles** use the dashboard KPI tile typography (Space Grotesk, 14.5px, bold values) instead of the 9.5px / 12px they had; tiles got a little more padding.
- **Std LSL, Std USL, Aim LSL and Aim USL are always drawn** on the I chart and the histogram. The scale widens to include every limit however small the data spread; the old "Std/Aim limit is far below this scale" note and the silently dropped line are gone (`chemDomain`, histogram x-range).
- **The "Mean" line is the middle of the Aim band** ((Aim LSL + Aim USL) / 2), never the data mean / moving-range mean (`chemMeanLine`). Only when a grade has no Aim limit at all does it fall back to the data mean. The MR chart keeps its own MR-bar line; the Cpk table's "Mean" column is still the data mean.
- **Upper-limit-only elements (impurities such as Pb, limit 0 - 0.04):** Std LSL and Aim LSL are drawn at **0** and the mean sits between 0 and the Aim USL (e.g. Aim USL 0.010 -> mean 0.005). The server still treats a 0 LSL as "no lower limit" for Cp/Cpk and out-of-spec counts; only the drawing adds the 0 line (`chemDispLimits`). Where both lines coincide the Aim (solid) line is drawn first and the Std (dashed) line on top so both stay visible.
- **Parameter = All:** each element chart sits in its own box with a 30px gap, a larger element heading and 30% more chart height.

**Fixed**
- **Presentation mode at 100% browser zoom, Parameter = All.** The stacked per-element charts were squeezed into one clipped panel (only the top of the first chart was visible). Each element now gets the full presentation stage and the stage scrolls to the next element; the chart is redrawn to the stage's shape so legend, limit labels and x-axis are never cut off. Applies to the I chart, MR chart and histogram. The histogram no longer reserves the empty right margin meant for limit labels.

**Notes**: no API, table or column change; `VERSION.txt` untouched. Files: `src/js/21-chem-spc.js`, `src/css/16-chem-spc.css`, `tests/test_chem_spc.py` (the card check now looks for the band note instead of per-card LOW/MID/HIGH), `README.md`, `CHANGELOG.md`.

**Validation**: `test_chem_spc.py` and `static_checks.py` pass; every parameter of both seeded grades was opened in headless Chromium (1536 px wide, 100% zoom) and its Std / Aim / Mean labels read back from the SVG; presentation mode checked for the I chart, MR chart and histogram, with Parameter = All and a single element; no page errors.

## Chemistry SPC: ordered periods, KPI-style cards with admin LOW/MID/HIGH, All defaults, no Compare box — no version bump (2026-10-01, fifth pass)

- **Month / Week / Quarter / FY** lists are now in date order (oldest first, like the dashboard). **Week** shows the full range (`06-Apr-2026 to 12-Apr-2026`). Older periods (e.g. FY 2025-26) were missing because the lists came only from the selected grade; Grade = All now lists the periods of every grade (`/api/chem/meta` -> `all_periods`).
- **Element cards** are built like the dashboard KPI cards: LOW / MID / HIGH tiles + "Higher is better", status ON TARGET / WATCH / ACTION from the same rule as KPI cards. The bands are a KPI target row, **Chemistry Capability (Cp/Cpk/Pp/Ppk)** (default 0.67 / 1.00 / 1.33), editable in Admin -> KPI Targets. The explanatory text under the cards is removed.
- **I, MR and Histogram headings** all name the element (e.g. "Individuals (I) Chart - Cu%").
- **"Does Chemistry Affect Quality?"** panel removed.
- **Filters start on All** (Grade, Parameter, periods, Heat Qty), also after Reset All; nothing is restored from the browser any more (a shared link or preset still sets them). Grade = All shows the element cards per grade (control charts need a grade); Parameter = All draws one I / MR / Histogram per main element. API: `spec`/`param` = `__all__` or empty.
- Files: `chem_spc.py`, `server.py`, `index.html`, `admin.html`, `sw.js` (shell cache v13), `src/js/21-chem-spc.js`, `src/css/16-chem-spc.css`, `tests/test_chem_spc.py`, `tests/test_browser.py`.

## Chemistry SPC: dates, Selection bar, trend, Compare, Active filters — no version bump (2026-10-01, fourth pass)

- **Month / Week / Quarter / FY lists empty.** Root cause: heats stored without a `cast_date` (imported before the Date column was read). The importer now also finds a date column by its content when no header says "Date". The dropdowns and a note on the tab say plainly "No cast dates stored — re-import the chemistry file"; re-importing updates the existing heats (no duplicates).
- **Selection bar** for the Chemistry tab now sits under the header search, above the filters, like the other tabs.
- **Trend on element cards** is KPI-style: `Prev: x  ▲/▼ +y% (+Δ)`. With only Heat Qty (last N) set, the last N heats are compared with the N before them (works without dates). API: `overview[].cpk_change_pct`, `period_comparison.mode`.
- **Compare Periods** starts on a dimension that has 2+ values, marks the others "(not enough data)", and clears the other period filters in both panes.
- **Chemistry vs Disposition** panel: purpose line, honest empty-state messages, no hover-lift (it is read-only).
- **Active filters:** Grade and Parameter count (and highlight) when they differ from the default view; the status counter is updated too.
- Files: `chem_spc.py`, `server.py`, `index.html`, `sw.js` (shell cache v12), `src/js/10, 21-chem-spc`, `src/css/16-chem-spc`, tests.

## Chemistry SPC: shareable link, Compare Periods, Saved Views, shared Export dialog, safer spec matching — no version bump (2026-10-01, third pass)

**Added**
- **Chemistry selection is now in the URL.** While the Chemistry SPC tab is open the address bar carries `chem_spec`, `chem_param`, `chem_n` (Heat Qty), `chem_month`, `chem_week`, `chem_quarter`, `chem_fy` next to `tab=chem`, exactly like the dashboard filters, so the link can be shared. A link's selection wins over the one remembered in the browser (`qdash_chem_sel_v1` stays as the fallback); a link is a complete selection, so anything it does not carry means "All". Browser Back/Forward restore the Chemistry selection too, and invalid or outdated values in a link are cleaned up by the existing grade/period sanitising.
- **Compare Periods on the Chemistry tab.** The Chemistry filter bar has its own *Compare Periods* button (the command palette entry follows the tab). It compares Month, Week, Quarter, Financial Year, Grade or Parameter side by side as two live copies of the tab. When a period is compared, the other period filters are cleared in both panes (otherwise a Month outside the chosen Quarter would blank the pane). Framed copies no longer overwrite the selection the main window remembers.
- **Saved Views on the Chemistry tab.** The Selection bar has Saved Views / Save Preset / Manage Presets, stored under `qdash_chem_saved_views` (separate from the dashboard presets, because the filters differ). A preset stores grade, parameter, Heat Qty and the four period filters; loading one whose grade no longer exists keeps the current grade and says so.
- **Header Export dialog lists the Chemistry downloads.** While the Chemistry tab is open the same dialog shows a *Chemistry SPC* group first — Cpk table, Heat data, Out-of-spec heats (CSV, built from the current Chemistry selection, same files as the buttons inside the tab) — and the four disposition reports below it under their own heading. Other tabs see the dialog exactly as before. No new export button or feature was created. (Excel / PDF / PowerPoint for Chemistry do not exist; that would be a separate report feature.)

**Fixed**
- **Wrong limits when a sheet is named exactly like a grade.** `resolve_spec()` used to give such a sheet's heats that grade even when the heat's Alloy column said something else, so Cpk could be computed on the wrong limits. Now the exact sheet-name match is trusted only if it does not contradict the Alloy column (grade alloy code vs heat Alloy, both filled in and different). On a contradiction the sheet name is ignored and the Alloy column decides; if it cannot (unknown alloy, or ambiguous), the heat stays unassigned instead of being guessed. The Cast Chemistry import shows a `sheet_alloy` warning for each such heat. Sheet == grade with a matching or blank Alloy, a grade without an alloy code, and "sheet beats denomination" are unchanged. Specs are matched at read time, so already-imported heats are corrected without re-import.
- **Manage Presets closed itself after deleting a preset** (the click on the re-rendered 🗑 button was treated as a click outside); it now stays open so several presets can be removed in a row. Applies to both preset lists.

**Notes**: no table/column change, no API change, `VERSION.txt` untouched. Files: `chem_spc.py`, `index.html`, `sw.js` (shell cache v11), `src/js/04, 09, 10, 20, 21-chem-spc, 22`, `src/css/10, 11`, `tests/test_chem_spc.py`, `tests/test_browser.py`, `README.md`, `CHANGELOG.md`. The "Known / by design" note in the entry below (no URL state, no Compare Periods / Saved Views on the Chemistry tab, sheet-before-Alloy matching) is superseded by this entry.

**Validation**: full release gate passes (py_compile, JS syntax of all 23 pieces + bundle, static checks, regression, unit, smoke, data lifecycle, exports incl. stress, real-browser run). New checks: sheet-vs-Alloy matrix + import warning (`test_chem_spc.py`); shared link opens the same selection in a fresh browser profile, preset save/load/delete and isolation from dashboard presets, Chemistry Compare Periods panes show the two chosen months and do not touch the remembered selection, Export dialog shows the Chemistry group only on this tab and downloads `chemistry_cpk_*.csv`, dashboard Compare/Export unchanged (`test_browser.py`).

## Chemistry SPC parity audit — no version bump (2026-10-01, second pass)

Checked the Chemistry SPC tab against the other tabs (theme, filter behaviour, shared features). Light/dark tokens, filter bar markup/size/fonts, cards, tables, mobile layout and the Month/Week/Quarter/FY cascade already matched the dashboard; a brute-force check of 1,263 period combinations found none that the dropdowns offer yet show zero heats, and none hidden that actually has data. What did not match was the shared chrome around the tab:

**Fixed**
- **Command palette** had no "Go to Chemistry SPC"; on the Chemistry tab "Set … as my Default Landing Tab" showed the raw key `chem`; and **"Reset All Filters" reset the hidden dashboard filters** instead of the Chemistry filters on screen. It now lists the tab, uses its name, and resets the Chemistry filters while that tab is open.
- **Keyboard shortcut `6`** opens Chemistry SPC (1–5 unchanged); the shortcuts toast says 1-6.
- **Header search** (Grade / Work Center result) changed only the hidden dashboard filters while the Chemistry tab was open, so nothing visible happened. It now takes you to the Dashboard tab with that filter applied.
- **Export dialog** said "the current dashboard filters are applied" while the Chemistry tab was open. It now states that the reports cover the disposition data with the dashboard filters, and that the Chemistry CSVs are inside the tab. Other tabs keep the original wording.
- **`tests/test_browser.py`** now seeds two grades across Mar/May/Jun 2026 (FY 2025-26 and 2026-27) and asserts: Quarter→Month/FY cascade, active-filter badge, previous-period banner, dropdown search / one-open-at-a-time / click-outside, grade switch keeps the parameter, Reset All, palette entry + Reset, key `6`, header search → Dashboard, export-dialog wording, browser Back/Forward. The harness also stops its server if seeding fails (a leaked server made the next run hit a stale instance).

**Known / by design (unchanged)**: Chemistry filters are remembered in the browser (`qdash_chem_sel_v1`) rather than in the URL; there is no Compare Periods or Saved Views for this tab; a sheet named exactly like a grade is matched to that grade before the heat's Alloy column.

## Audit fixes — no version bump (2026-10-01)

**Fixed**
- **Chemistry SPC — Week dropdown order.** The Week list was sorted as text on the `DD-Mon-YY` label, so weeks came out as 30-Mar, 29-Jun, 27-Apr, 18-May ... instead of newest-first. `period_options()` now sorts on the ISO Monday date. Labels, filter values and API shape are unchanged; regression added to `tests/test_chem_spc.py`.
- **Off-site backup encryption never ran from GitHub Actions.** `docs/DEPLOY.md` (Step 2B) says adding the `DR_ENCRYPTION_KEY` secret encrypts scheduled dumps, but `.github/workflows/dr-backup.yml` neither passed that secret to `dr_pg_backup.py` nor installed `cryptography`, so dumps were always uploaded unencrypted. The workflow now does both (an unset secret is an empty string and still means "encryption off").
- **`tests/test_browser.py` could not pass.** (1) After a full page reload the intro splash replays by design, but the test clicked the Chemistry tab straight away (blocked by the intro overlay); it now acknowledges the intro again. (2) The bundled `quality.db` has no chemistry rows, so every Chemistry UI assertion hit the correct "No chemistry data" state; the test now seeds a small Standard.xlsx + chemistry workbook through the real admin import API. (3) The tooltip check hovered a `<circle>` that the transparent `.chem-hover-layer` intentionally covers; it now drives a real mouse move over the layer for both the I and MR charts.

**Validation**: full release gate (including browser + export stress) passes.


## Chemistry SPC maintenance — no version bump (2026-09-30)

**Changed**
- **Period filters:** Month, Week, Quarter and Financial Year continue to be derived from the chemistry file's stored `cast_date` using the same April–March labels and period priority as the main dashboard. Added a comparable previous-period calculation so main-element Cpk cards can show `Prev`, directional change and the matching arrow.
- **Element cards:** typography now mirrors the dashboard KPI card typography (including the dashboard value font), and cards reuse the dashboard's directional `kpi-up` / `kpi-down` motion plus the same pointer-safe tilt interaction.
- **Control charts:** statistical UCL/LCL lines are no longer drawn. Server-side IMR/UCL calculations remain available for diagnostics and moving-range OOC detection; visible operating bounds are the Aim LSL/USL lines, with Standard LSL/USL still available as specification references.
- **Drill-down:** Chemistry heat drill-down now keeps its header and breadcrumb fixed while the chemistry/disposition content scrolls, matching the shared dashboard drill-down behaviour.
- **Performance:** added short-lived API response caching, a chemistry-revision-keyed in-memory source snapshot, cached multi-parameter capability results, and cancellation of stale in-flight selector requests to reduce repeated work and visible loading lag.

**Data safety**
- No database schema, chemistry table columns, recovery format, or imported data files were changed. Chemistry writes still invalidate the relevant caches. `VERSION.txt` was left unchanged.

**Validation**
- `tests/test_chem_spc.py`: PASS.
- `tests/test_exports.py`: PASS (14 export checks).
- `tests/regression.py`: PASS (six regression suites).
- Python/JavaScript syntax checks: PASS.
- `tests/static_checks.py`: still reports the repository's pre-existing sidebar-order assertion mismatch (unchanged by this Chemistry patch).
- Browser UI check could not launch because the environment has no installed Playwright Chromium executable.

## V66.2 — Chemistry SPC follow-up: top filter bar, Aim lines, element-coloured cards, app-style tables and drill-down (2026-09-30)

**Changed**
- **Chemistry filters moved to the top filter bar.** Opening the Chemistry SPC tab replaces the disposition filters (and the "Selection / Saved Views" strip) at the top with the chemistry filters — Month, Week, Quarter, Fin. Year, Grade, Parameter, Heat Qty, Heat No. — plus the Insert switches (Icon, Centre Line, Aim Chemistry). Every other tab keeps the normal dashboard filters exactly as before. Nothing is drawn as a filter/insert box inside the tab any more. (`src/js/21-chem-spc.js` follows the tab panel's own visibility, so no other JS piece had to change; CSS hides the disposition filters only while `html.chem-mode` is set.)
- **Element cards:** the Cp / Pp / Cpk / Ppk labels and the Std. Dev. labels and values are black (they were red / teal). The values keep the rating colours (green ≥ 1.33, amber 1.00–1.33, red < 1.00). The big symbol takes the colour of the element's picture (Cu copper, Sn silver-grey, P red-orange, …) and each card gets a soft background glow in the same colours; dark theme uses the lighter logo colour and white labels.
- **Tables** of the Chemistry tab (capability table, out-of-spec heats) now use the app's own `.table-scroll > table` markup, so the header row looks like every other table in the app; the chemistry-only header/cell overrides were removed.
- **Heat drill-down** now uses the same markup and classes as the main "Underlying Records" drill-down (`drill-modal`, `drill-head`, breadcrumb, `drill-meta`, `drill-table`, export button). "Export Selected Records" downloads the heat's chemistry and coils as CSV.

**Fixed**
- **Aim lines were not always drawn.** The I chart dropped an Aim limit silently when it was far from the data, and the histogram's x-axis only knew the Standard limits, so an Aim line outside that range vanished. Aim limits now widen the scale like the Standard limits (or show a "far below / above / left / right of the data" note), are solid teal with a light Aim band, and the histogram range is widened for them. When no Aim limit exists at all the tab now says so ("No Aim limits are stored for this grade …") instead of just drawing nothing.
- **Standard.xlsx AIM sheet:** an AIM grade name that differs from the Standard name only by extra text (e.g. "Brass (5rs.) AIM") is matched to the single Standard grade it contains and reported as info; unrelated names are still ignored and listed. Test added.

**Notes**: no table/column change; service-worker shell cache bumped to v10 so installed apps pick up the change. Files: `src/js/21-chem-spc.js`, `src/css/16-chem-spc.css`, `index.html`, `chem_spc.py`, `sw.js`, `tests/test_chem_spc.py`.

## V66.2 — Chemistry SPC: dates, Standard + AIM limits, element cards, no Western Electric (2026-09-30)

**Added**
- **Date column of the chemistry file is mapped** (`chem_heats.cast_date`, ISO). Day-first `02.04.2026` / `04.04.26`, Excel dates and serial numbers are read. A number typed as `2505.2025` is read as 25-May-2025 and flagged; an unreadable date (e.g. `27.05.206`) or a future date only gives a warning — the heat is still imported (without a date for the unreadable case). A re-import updates a corrected date and never erases a stored one with a blank. The Admin preview shows Heats with a date / Without a date / Date span and a Date column in the sample.
- **Filter / Insert boxes** on the Chemistry SPC tab: Month, Week, Quarter, Fin. Year (labels identical to the main dashboard: `Apr-2026`, `Wk of 30-Mar-26`, `Q1` = Apr–Jun, `FY 2026-27`), Grade, Parameter, Heat Qty, Heat No.; Insert: Icon, Centre Line, Aim Chemistry. API: `/api/chem/spc` accepts `month`, `week`, `quarter`, `fy`; `/api/chem/meta` lists the periods available per grade. Charts still run in heat-number order — dates only filter.
- **Standard.xlsx has two sheets, both are read**: the sheet named "Standard" (Standard limits) and the sheet whose name contains "AIM" (Aim limits), merged per grade description. AIM rows without a Standard row, Standard rows without an AIM row, and AIM limits wider than the Standard limits are reported in the preview. A Standard-only file never erases stored AIM limits. Admin → Spec Limits shows and edits both sets. **No table/column change**: AIM limits are stored inside `chem_specs.limits_json` under the reserved key `_aim`, so existing backups and recovery points restore unchanged.
- **Element cards**: one big card per main element with symbol, atomic number, name, a drawn picture (inline SVG, works offline) and Cp | Pp, Cpk | Ppk, Std. Dev. | Std. Dev. (within σ / overall σ). Std. deviations are also in the capability table and CSV.
- I chart and histogram draw **Standard LSL/USL, Aim LSL/USL and the mean** (each can be hidden through the Insert box).

**Removed**
- Western Electric rules 1-4 (calculation, point colouring, legend, table column, CSV column, out-of-control comparison card).
- The KPI cards (Heats plotted, Mean, Cpk, Ppk, Out-of-control points, Out-of-spec heats) and the old "Main elements — Cpk" strip (replaced by the element cards).

**Notes**: Cp/Cpk/Pp/Ppk are calculated against the Standard limits. `app.js`/`app.css` query strings → 66.2, service-worker shell cache → v9.

## V66.1 — Chemistry SPC tab: loader registered, tab bar on one row (2026-09-30)

**Fixed**
- **Chemistry SPC showed "Couldn't load this view. TAB_LOADERS[tabName] is not a function" and no data.** The tab's loader was never registered in the tab map. `21-chem-spc.js` now registers `TAB_LOADERS.chem = loadChemSpc` itself (retrying after the bundle has run if the map is defined later), so it no longer depends on another `src/js` piece.
- **The 6th tab wrapped onto a second row.** The tab bar is now one row: equal-width tabs on screens >= 1000 px, sideways scrolling (no wrapping) below that. Service-worker shell cache bumped to v8.

## V66.1 — Chemistry SPC polish: dark theme, label overlap, CSV exports (2026-09-30)

**Fixed**
- **Dark theme:** the histogram's normal-fit curve was a fixed dark navy (`#0f2a4a`) and nearly invisible on the dark card; it now follows the theme text colour. The "Excellent" Cpk colour (`#0B7A3B`) had too little contrast on dark; dark mode now uses the theme green (text and card edge).
- **Histogram labels overlapping:** when the mean was close to USL (or LSL) the "Mean" label was drawn over the "USL" label. It now moves to the free side of its line, or one row lower when both limits are close. The "LSL/USL far off the scale" notes moved down a row so they cannot touch the Mean label.
- **README** still described a chemistry date-range selector and future/unreadable-date import checks that were removed earlier; corrected.

**Added**
- **CSV downloads in the Chemistry SPC tab** (client-side, from the data already on screen; no server or database change): *Cpk table* (every parameter of the grade: main-element flag, heats, mean, limits, Cp, Cpk, Cpk rating, Pp, Ppk, out-of-control and out-of-spec counts) and *Heat data* (one row per heat of the charted parameter in heat-number order: value, out-of-spec flags, Western Electric rules, analyst, coils, reject %, top defect). Formula-looking text is neutralised as in the existing out-of-spec CSV.
- Note: the Excel / PDF / PowerPoint / CSV reports of the main dashboard still contain disposition data only (heat number is already a column there); chemistry is not part of them.

**Unchanged**: no table/column change, so off-site backups, recovery points and restores behave as before (chemistry tables are picked up automatically). Service-worker shell cache bumped to v7.

## V66.1 — Chemistry SPC: thorough bug + performance maintenance (no version bump, 2026-09-30)

- Completed a full application-parity regression pass for Chemistry SPC against the dashboard tab/filter/KPI/chart interaction contracts.
- Fixed Chemistry tab routing/default-tab validation so `chem` participates in the shared tab-key contract.
- Fixed a selector-state bug where a valid parameter with no values for the current grade/period was silently replaced by another parameter; the user selection now remains intact and renders an explicit empty state.
- Fixed Chemistry Reset All semantics: clears period/last-N/search state and restores deterministic grade/parameter defaults.
- Fixed null Cpk/Ppk animation so unavailable capability values remain `—` instead of animating through numeric zero.
- Removed duplicate Chemistry KPI keyboard activation path that could trigger two refreshes for one Enter/Space action.
- Added dense-chart rendering protection: full Chemistry series remains in the SVG path/API data, while point marker nodes are bounded; exact nearest heat/value hover and chart-to-heat drilldown remain available for every underlying point. This reduces browser layout/paint cost without reducing stored data.
- Chemistry API/source/disposition/overview caches remain bounded and invalidated at the existing mutation/revision boundaries; stale in-flight Chemistry requests are cancelled.
- No database/schema/data-file changes. `quality.db` was verified byte-for-byte identical to the original uploaded database; the bundled disposition count remains 4,936.
- `VERSION.txt` remains `APP_VERSION=V66.1`; no application version bump.
- Validation: Chemistry SPC test PASS, unified regression 6/6 PASS, unit suite 14/14 PASS, Python compile + JavaScript syntax checks PASS, static code-health/admin checks PASS.

## V66.1 — Chemistry SPC: heat-number order only, main-element Cpk, 3-decimal precision (2026-09-30)

**Changed**
- **Period filtering uses cast date; chart order remains heat-number based.** The chemistry file's Date/Cast Date/Date of Analysis/etc. column is normalized into `cast_date` and drives Month / Week / Quarter / Financial Year filters. Charts remain ordered by **heat number only** (letters prefix, then numeric sequence; NBS999 comes before NBS1000), and "Last N heats" means the N highest heat numbers after period filtering. The I-chart axis stays heat-number based; point hover may show the stored cast date as context. Legacy `date_from` / `date_to` request parameters remain ignored for compatibility. The `cast_date` field is preserved so existing databases and recovery points keep their schema.
- **Main elements first.** New "★ Main elements — Cpk" strip at the top of the tab: one card per main element (Cu, plus every element the grade's spec gives a real minimum, e.g. Ni in Cu-Ni, Zn in brass), showing Cpk, rating, mean, limits, Cp, Ppk, number of heats, and an "off-centre" flag when Cp is far above Cpk. Click a card to chart that element. In the parameter table the main elements come first (★), impurities follow. If a spec names no alloying element, any element averaging ≥ 1 % counts as main.
- **Copper-base Cpk rating** (KPI cards, strip and table): ≥ 1.67 excellent, ≥ 1.33 capable, 1.00–1.33 marginal, < 1.00 not capable; shown as words as well as colour. Fewer than 30 heats is marked "indicative".
- **3-decimal precision.** Chemistry values are kept and shown to at least 3 decimals. Total% was compared to its limits after rounding to 2 decimals; it is now compared at 3 (elements were already compared exactly).

**Verified**: full release gate passes (chemistry SPC tests extended: date normalization/period filtering, heat-number ordering incl. numeric sequence, last-N by heat number, main-element detection, Cpk bands, 3-decimal storage and Total% comparison, overview order over HTTP). Service-worker shell cache bumped to v6.

## V66.1 — Chemistry SPC (2026-09-30)

**Added**
- **Dashboard tab "Chemistry SPC"** (`src/js/21-chem-spc.js`, `src/css/16-chem-spc.css`): grade/parameter/date-range/last-N selectors; Individuals and Moving-Range charts (limits from MR̄/d2), histogram with LSL/USL and normal fit, Cp/Cpk/Pp/Ppk for every parameter of the grade, Western Electric rules 1-4, out-of-spec heat list (searchable, CSV export), and a click-through heat dialog. Chemistry is joined to disposition on `heat_no`: each point's tooltip shows that heat's coils, reject % and top defect, the out-of-spec list shows the defects seen on the heat's coils, and a comparison card contrasts reject/defect rates for in-spec, out-of-spec and out-of-control heats.
- **Admin → Cast Chemistry**: file upload (.xlsx/.csv/.tsv, all sheets), preview with duplicate / typo / range / future-date / total-mismatch / alloy-prefix / denomination / analyst-name checks, per-row issue list, diff of heats that would change, then Confirm (recovery point before, import-history row inside the same transaction).
- **Admin → Spec Limits**: import Standard.xlsx (new/changed/unchanged preview, never deletes) or add/edit/delete a grade's LSL/USL by hand.
- New tables `chem_heats`, `chem_specs`, `chem_import_history` (created at startup; included automatically in backups/restore); new `chem_spc.py` module; endpoints `/api/chem/meta|spc|heat` (public, read-only) and `/api/admin/chem_*` (role-checked, CSRF-protected).
- **Re-import behaviour:** the same `heat_no` is updated in place (numbers are overwritten, changes are listed in the preview); new heats are added; heats missing from the file are never touched or deleted. A blank date / analyst / sheet in the new file never erases the stored value. Moving a heat to another sheet counts as an update (it decides which spec applies). Excel serial-number dates are accepted.
- **Older recovery points still restore:** V5 backups taken before the chemistry tables existed can be restored into this version; the chemistry tables are left untouched (any other unknown table still blocks the restore, as before).
- Expression index `idx_disp_heat_norm` on `UPPER(TRIM(heat_no))` keeps the chemistry↔disposition join fast; service-worker shell cache bumped to v5 so installed PWAs pick up the new tab.
- `tests/test_chem_spc.py` (SPC maths vs hand calculation, every import rule, spec matching, full HTTP flow, backup round-trip) added to the release gate.

**Fixed (Chemistry SPC review pass)**
- **Re-import lost the stored spec:** a re-import from a file without Sheet/Alloy/Denomination columns filled those blanks from the stored heat only *after* spec matching, so the preview showed a false "no matching spec" warning and did not count the heat as out-of-spec. The stored values are now merged first.
- **False denomination warnings on long sheet names:** Excel cuts sheet names at 31 characters, so "NI-Brass (Ni - 05) (10rs. & 20rs.)" arrives as "...(10rs. & 20r" and every 20 Rs heat was flagged as being on a 10 Rs sheet. The check is skipped for names that long (real mismatches on short names are still reported).
- **`75.2 %` typed as text** rejected the whole heat as "not a number"; a trailing % sign is now accepted.
- **"No spec assigned" group claimed its heats were "in spec"** in the Chemistry-vs-Disposition card (and "No out-of-spec heats ✔" in the list) although no limits exist. Both now say that no limits are defined.
- **Selector errors were silent:** a failed request after changing grade/parameter/dates/last-N left the old charts on screen with only an unhandled promise rejection in the console. A visible error banner is shown and cleared on the next successful load.
- **Stale/edited saved selection** (browser storage) with an unknown parameter or malformed date is reset to safe values instead of sending the API a 400.
- `tests/test_chem_spc.py` gained regression checks for each of the above.

## V66.1 — app.js / app.css split into src/js, src/css (2026-09-29)

**Changed (layout only — every page still loads exactly one `/app.js` and one `/app.css`; runtime, version and behaviour untouched)**
- `app.js` (3,821 lines) and `app.css` (2,497 lines) — the two files you kept having to re-upload in full for a one-line fix — are now cut into 22 files under `src/js/` and 15 under `src/css/`. Each cut sits on a top-level statement boundary in the JS and a top-level rule/comment boundary in the CSS, so every piece is independently valid and the concatenation is byte-for-byte identical to the old single files (verified with a script that rebuilds the original and diffs it — zero difference).
- `server.py` now builds `/app.js` and `/app.css` on the fly by concatenating `src/js/*.js` / `src/css/*.css` in filename order (numbered prefixes fix that order), cached in memory and rebuilt automatically if a piece's timestamp changes. `X-App-Version` / `?v=` cache-busting is unaffected: it now uses the newest piece's mtime.
- From here on, when a fix only touches one part of the dashboard, you upload just that one `src/js/NN-*.js` or `src/css/NN-*.css` file on GitHub — never the whole bundle.
- `dr_pg_backup.py`'s off-site backup manifest and the `/api/admin/disaster_recovery/status` file-hash list now hash every `src/js/*.js` / `src/css/*.css` piece individually (in addition to the files they already covered), so a disaster-recovery restore still verifies the exact frontend byte-for-byte.
- Test suite updated for the split: `tests/run_gate.py`'s `node --check` step now checks all 22 JS pieces plus the rebuilt bundle; `tests/regression.py`'s embedded suites, `tests/static_checks.py` (code-health / orphaned-class scan) and `tests/test_smoke.py` now read the bundle by joining `src/*/*.*` instead of a single file, and the smoke test additionally asserts the served `/app.js` and `/app.css` are complete (not truncated by a bad concatenation).
- Service worker shell cache bumped to v4 (installed PWAs re-fetch the new-but-identical `app.js`/`app.css`).

**Verified**: full gate before and after the split — same checks, same results (`node --check` now on 22+1 files instead of 1, 6 regression suites, 47 HTTP routes, data-lifecycle + browser + export checks all pass unchanged).

## V66.1 — Bug-fix pass: blocking fonts, admin nav highlight, empty selection (2026-09-28)

**Fixed**
- **Page blank/laggy when Google Fonts is slow or blocked.** `index.html` loaded the Google Fonts stylesheet as a render-blocking `<link>`; on a restricted plant network the dashboard stayed blank (measured: no first paint after 12 s). It now loads non-blocking (`media="print"` + `onload`, with `<noscript>` fallback). First paint with fonts hanging: never -> ~0.7 s. Fonts still apply once they arrive.
- **Admin sidebar highlighted the wrong section.** Clicking "Import History" highlighted "Latest Records" and "Audit Trail" highlighted "Audit Analytics" (139 px panels are shorter than the scroll-spy anchor). The clicked section is now pinned until the user scrolls by hand (wheel/touch/keys).
- **Empty selection looked like real data.** Filters that match no coils (e.g. Month=Jun + Quarter=Q2) showed green/red 0.000% KPIs and a "-100%" trend. The dashboard now shows a "No records match the selected filters" banner, neutral "NO DATA" cards and no trend line.
- **Command palette tab names** now match the real tabs (Defects List, Period Trend, Quality Control Room).
- **Cascading filters (#4).** Picking Quarter=Q2 now narrows the Month dropdown (and vice-versa for every other filter) to only values that actually co-occur, so it's no longer possible to build a zero-overlap combination from the dropdowns themselves. Applies after any filter click, Reset All, a saved view, and on load from a shared/bookmarked URL.
- **CSP hardening (#2): script-src no longer allows 'unsafe-inline'.** Every inline `<script>` in index.html/admin.html is now stamped with a random per-request nonce that must match the one in the CSP header; the 7 remaining `onclick="..."` attributes (users table, fishbone alias, records delete, backup restore, quality-drilldown jump) were converted to `data-action` attributes + delegated `addEventListener`, since attribute-based handlers aren't covered by a nonce. An injected `<script>` (e.g. via a hypothetical future XSS bug) can no longer execute even if it makes it into the page. style-src intentionally keeps 'unsafe-inline' (documented in server.py) since the UI has ~50 inline `style="..."` attributes and, unlike script, an inline style value can't execute code in a modern browser.
- **Self-hosting kit for Google Fonts (#3).** `tools/self_host_fonts.sh` downloads the exact fonts this app uses and writes a local `fonts/fonts-local.css`; server.py now serves `/fonts-local.css` and `/fonts/*.woff2` (404 until the script has been run). index.html has a marked, ready-to-uncomment swap. Not run automatically here: it needs outbound internet access to Google Fonts, which the environment that produced this patch didn't have.
- **Test gaps closed (#5).** `tests/test_data_lifecycle.py` (new, wired into the release gate) round-trips import preview→confirm (including rejecting a re-used preview_id) and backup create→mutate→restore against a real server + isolated database. Documented, not closed: the PostgreSQL-backed path (`dr_pg_backup.py` / `DB_URL`) still has no automated test, since that needs a live Postgres instance and the `psycopg2` driver, neither available in this sandbox.
- **Browser regression tests in the release gate (#6).** `tests/test_browser.py` (new) drives a real headless Chromium against a real server process and checks actual DOM/runtime behaviour: dashboard load, all 5 tabs, the cascading-filter fix, the empty-selection banner, every admin sidebar link highlighting itself correctly, and zero CSP violations / console errors / uncaught JS errors anywhere in the run. `run_gate.py` adds this check only when Playwright + Chromium are installed (`pip install playwright && playwright install chromium`) and prints a visible `[SKIP]` line otherwise, rather than silently never running it. Verified to actually catch regressions: manually reintroduced each of the three bugs above one at a time and confirmed this test fails on every one of them before re-fixing.
- **Intro sound was random (sometimes missing, sometimes late/early).** Browsers keep an AudioContext suspended until a click/key press; the intro played its visuals anyway and silently skipped every cue while suspended, so sound only appeared if the browser happened to allow autoplay or the user interacted mid-way (then it lagged the animation). The intro now starts only when audio can actually play: immediately if the browser allows it, otherwise on the first click/key press (a small "Click anywhere or press any key to start with sound" prompt is shown). With no interaction it starts silently after 8 s so the dashboard is never blocked. Modifier keys (Shift/Ctrl/Alt/Esc) don't count as a gesture. The intro also now respects the dashboard's sound-off preference (`jsl_qi_sfx_enabled`) and creates no AudioContext when muted.
- Service worker shell cache bumped to v3 so installed PWAs pick up the new HTML/JS.

## V66.1 — Repository restructure, no runtime change (2026-09-28)

**Changed (layout only — `server.py`, `app.js`, `app.css`, `admin.html`, `index.html` untouched, version stays V66.1)**
- Repo root now holds only runtime files. The 9 test/audit scripts became 5 files in `tests/` (`test_units.py` = alerts + disaster-recovery, `test_smoke.py` = server + HTTP smoke, `test_exports.py` = acceptance + `--stress`, `static_checks.py` = code health + admin UX audit, `regression.py`), plus `tests/run_gate.py`, which runs the whole release gate with one command and prints a PASS/FAIL table.
- 6 Markdown files merged into 3 under `docs/`: `DEPLOY.md` (Supabase/Render setup + platform continuity), `DISASTER_RECOVERY.md` (runbook + recovery-point notes + architecture), `SECURITY.md`. `RELEASE_GATE.md` folded into the README; `CHANGELOG_ARCHIVE.md` moved to `docs/`.
- README rewritten for the current build only (old "What changed in V65/V66" sections already live in `CHANGELOG.md`).
- `dependency-audit.yml` moved back to `.github/workflows/` (at the repo root GitHub never ran it).
- Removed `.dockerignore` (there is no Dockerfile in the repo); docs no longer claim a Dockerfile exists — `Procfile` is the portable start command.

**Verified**: full gate before and after the move — same checks, same results (14 unit tests = 9 + 5, 47 HTTP routes, 6 regression suites, export acceptance + stress).

## V66.1 — Header time, admin toasts + progress, palette categories (2026-09-28)

- Header "Last Updated" now shows hours and minutes ("2 hr 15 min ago").
- Admin panel: dashboard-style toast notifications for every result message (replaces `alert()`), plus progress toasts (% + ETA) for import validate/confirm, 6M Fishbone import, backup create/restore/verify/download, CSV and audit exports, bulk delete and "Refresh Loaded Admin Data". File uploads report real upload progress.
- Presentation-mode button pinned to the far right of each analytics panel title (was overlapping the title text).
- Command palette (header "Commands"): commands grouped into categories; hovering shows the field-name hint tag.
- Service worker shell cache bumped to v2 so installed PWAs pick up the new app.js/app.css.

## V66.1 — Backup failure alerts, asset extraction, changelog split (2026-09-28)

**Added**
- Backup failure alerts by webhook (Slack/Teams/Discord/generic JSON) and/or email (`alerts.py`, stdlib only). Fires when a local backup cannot be created or the off-site copy fails/keeps failing; one reminder per `ALERT_COOLDOWN_MINUTES` while it persists, one "RECOVERED" message when it clears. State is persisted in `app_state`, so restarts neither re-spam nor lose the recovery notice. Secrets are redacted from message text; sends run on a daemon thread with timeouts, so a dead webhook cannot slow or break a backup. `/api/admin/disaster_recovery/status` now includes `alerting` (booleans only, no secrets). `python3 alerts.py --test` sends a test message. New `test_alerts.py` (9 tests) added to the release gate.
- `dr-backup.yml`: posts to the `ALERT_WEBHOOK_URL` repository secret if the scheduled PostgreSQL dump job fails.
- `.dockerignore`: keeps `.git`, tests, audits, docs and secrets out of the image (`quality.db` seed is kept).

**Changed**
- `index.html` no longer carries inline CSS/JS (91 KB -> 57 KB, the part that is re-downloaded on every load because HTML is `no-store`): the three `<style>` blocks now sit at the end of `app.css` in their original order, and the intro-screen script and service-worker registration are in `app.js`. Only the tiny theme-before-paint snippet stays inline on purpose (avoids a flash of the wrong theme). Note: the intro's letters now build once `app.js` has loaded (it is `defer`red) instead of during HTML parsing.
- `CHANGELOG.md` trimmed to V65+ (207 KB -> 70 KB); V64.9 and older moved verbatim to `CHANGELOG_ARCHIVE.md`.

**Verified**: `py_compile`, `node --check`, `code_health.py`, `regression.py` (6 suites), `test_disaster_recovery.py`, `test_alerts.py`, `http_smoke.py`, `smoke_test.py`, `export_acceptance.py`, `admin_ux_audit.py`, plus a headless-Chromium load (intro -> dashboard, no JS errors). `code_health.py` now reports 2 orphaned CSS classes (`intro-scan-run`, `intro-scan-stamped`): dead rules that were previously hidden inside the inline `<style>`.

## V66.1 — Full audit pass (2026-09-28)

**Fixed**
- `index.html` was 1.4 MB because the two intro-screen photos were embedded as base64 inside the CSS, so every page load re-downloaded them. Extracted to `intro-photo-left.webp` / `intro-photo-right.webp` (~35 KB + ~25 KB, transparency preserved), served with a 7-day cache and precached by the service worker. `index.html` is now ~90 KB (-94%).
- Service worker (`sw.js`): no longer caches `/api/export/*` report downloads (multi-MB files that would fill browser storage); only JSON responses under 2 MB are cached and the API cache is capped at 80 entries.
- `cryptography` pin raised from `~=43.0.0` (10 known CVEs, would fail the repo's own `pip-audit --strict` gate) to `~=50.0.0`; `pip-audit` now reports no known vulnerabilities.
- `dependency-audit.yml` was sitting in the repo root, so GitHub never ran it. Moved to `.github/workflows/dependency-audit.yml`.
- `regression.py` (V64.6 UI suite) asserted a CSS selector (`.dashboard-table td:not(:first-child)`) that was removed as dead code earlier; it now checks the live `.drill-table` rule. Full unified regression passes (6 suites).
- `RELEASE_GATE.md` listed scripts that no longer exist (`regression_smoke.py`, `regression_test.py`, `regression_v64_3.py`, `regression_v64_5.py`); replaced with the real command list.
- Removed an unused `import sys` from `dr_recovery.py`.
- Added `DR_ENCRYPTION_KEY` to `.env.example` and `render.yaml`.

**Size**
- Logo/favicon PNGs re-encoded (256-colour palette, visually identical side-by-side): `jsl-watermark.png` 123→16 KB, `jsl-header-logo.png` 122→16 KB, `favicon-512.png` 161→91 KB, `favicon-192/180.png` ~halved.

**Verified**: `py_compile`, `node --check`, `code_health.py`, `regression.py` (6 suites), `test_disaster_recovery.py`, `http_smoke.py` (47 routes), `smoke_test.py`, `admin_ux_audit.py`, `export_acceptance.py`, `export_stress.py`, ESLint (no real undefined-variable/duplicate-key/unreachable-code findings), `pip-audit` — all pass.

## V66.1 — Scroll & animation smoothness pass (2026-09-27)

- Export progress bar (Excel/PDF/PPT/CSV downloads) now runs off `requestAnimationFrame` instead of two independent `setInterval` timers (80ms/200ms). Same pacing/math, but every update now lands right before a repaint instead of on its own clock, removing the occasional visible micro-stutter under load.
- Added site-wide `scroll-behavior:smooth` (auto-disabled under `prefers-reduced-motion`).
- Added `-webkit-overflow-scrolling:touch` to every internally-scrolling container (drill-down body, table scroll areas, tab strip, QCR RCA table, fishbone diagram, filter dropdown lists, toast stack) for smooth momentum scrolling on iOS.
- Narrowed one remaining `transition: all` (fishbone chip buttons) to only the properties that actually change on hover/active, avoiding an unnecessary full-property transition watch.

## V66.1 — Offline support, CSS cleanup, off-site backup encryption (2026-09-27)

- Added a service worker (`sw.js`) for the public dashboard: app-shell assets and last-loaded dashboard API responses are cached, so the page still loads (with an "offline" banner) if the network drops. Scoped to the public dashboard only — `admin.html` does not register it, so no admin/audit data is ever cached to disk.
- Removed all 24 orphaned CSS classes flagged by `code_health.py`'s lint check (previously deferred to "a future pass"); `orphaned CSS classes: 0` now.
- Added optional client-side encryption for off-site backups: when `DR_ENCRYPTION_KEY` is set, `dr_pg_backup.py` encrypts the dump (Fernet/AES128-CBC+HMAC) before upload, so the Backblaze bucket only ever holds ciphertext. Backward compatible — with no key set, uploads are unchanged. Adds a `decrypt` subcommand for restores.

## V66.1 — DR / Security Hardening (2026-09-27)

- Added complete provider-independent disaster recovery architecture and emergency runbook.
- Added independent PostgreSQL custom-format backup/verify/restore helper (`dr_pg_backup.py`).
- Added optional S3 Object Lock retention for sensitive off-site recovery copies.
- Fixed PostgreSQL sequence resynchronisation after application-level snapshot restore.
- Fixed import/disposition history transaction split so import history can commit atomically with imported rows.
- Made audit-trail persistence failures observable in logs rather than silently swallowed.
- Hardened local recovery artifacts with restrictive filesystem permissions where supported.
- Added DR audit report and explicit production activation gates.

# V66.1 — Disaster Recovery hardening

- Added `DISASTER_RECOVERY_ARCHITECTURE.md` with the complete provider-independent DR model, backup layers, RPO/RTO, security controls, migration procedure and validation gates.
- Added `DR_RUNBOOK.md` for emergency host/database recovery and restore drills.
- Added `dr_pg_backup.py` for independent PostgreSQL custom-format dump, verify and restore operations; credentials are passed through libpq environment variables rather than printed/embedded in commands.
- Fixed PostgreSQL BIGSERIAL/identity sequence resynchronisation after application-level recovery-point restore so the next insert cannot collide with a restored primary key.
- Initial startup now creates a current-state recovery point when the durable revision is ahead of the last backup.
- Local recovery directories/files receive restrictive permissions where supported; backup timestamps use UTC.
- Recovery manifests now fall back to `git rev-parse HEAD` when deployment-provided commit metadata is unavailable.
- Recovery artifacts are explicitly excluded from Git.

# V66.0 — Disaster Recovery + full persistence hardening

## Changed
- **Full-state recovery points:** upgraded the application snapshot format from V4 to **V5**. The backup now discovers every persistent database table at runtime, captures its schema/column manifest, current data revision and application file hashes, while explicitly excluding runtime session/login-throttle state. This prevents future tables/configuration from being silently omitted from backups.
- **Live-data continuity:** recovery points are generated from the live database state, so the original 4,936 seed rows are just the starting point; later inserts, updates, deletes, KPI changes, Fishbone/RCA/configuration changes, user changes and audit/import history are captured at the current revision.
- **Mutation coverage:** added pre-change safety snapshots and post-change recovery points to direct record writes, imports, deletes/bulk deletes, KPI targets, user creation/toggle/password changes/reset, Fishbone imports and alias changes.
- **Recovery freshness:** added durable `data_revision` / `data_changed_at` tracking and a scheduler that detects any change newer than the latest recovery point.
- **Off-site replication:** added optional S3-compatible encrypted-at-rest/off-site replication with upload verification. Local-only mode remains functional; when remote DR is configured, safety mutations can require a verified remote copy.
- **Restore integrity:** V5 restores verify checksum, table set, schema fingerprint and exact column order before replacing persistent state transactionally. Runtime sessions/login throttles are cleared after restore and must be recreated.
- **Recovery observability:** Admin Backup/Recovery UI now shows live revision, last-backed-up revision, off-site status and stale/current state instead of treating the newest local file as automatically “protected.”
- **Portability:** added `dr_recovery.py` for explicit backup verification/restore and added deployment/DR environment templates.
- **Input validation fix:** `user_toggle.active` now requires a real JSON boolean; strings such as `"false"` are rejected instead of being truthy-coerced.

## Verified
- `python3 -m py_compile server.py dr_storage.py dr_recovery.py test_disaster_recovery.py`
- `node --check app.js`
- Existing regression/smoke/export/admin suites re-run after V66 changes.
- New V66 DR tests cover V5 snapshots, round-trip restore and strict boolean validation.

---

## V65.0 — Follow-up: performance-linked UX — rAF-throttled chart resize redraws, fixed KPI-tilt jitter (no version bump — same version)

### Changed
- **Chart resize redraws now go through requestAnimationFrame, with reads and writes batched separately.** The `ResizeObserver` that redraws charts when their container's width changes (browser zoom, window resize, sidebar reflow, a hidden tab becoming visible) previously ran every queued chart's redraw *synchronously inside a `setTimeout` callback* — an arbitrary point relative to the browser's render pipeline, and each redraw individually called `chartAvailWidth()` (a layout read) right before mutating the DOM, so N charts resizing together meant N interleaved read→write→read→write cycles (layout thrashing). Now: the 120ms settle timer still exists (so a drag-resize doesn't redraw on every intermediate frame), but the actual batch is deferred one more step onto `requestAnimationFrame`, every queued chart's width is measured *up front* in one read pass, and only the charts that changed width are redrawn in a second write pass. Each redrawn chart also gets a brief `chart-refreshing → chart-ready` fade (the same transition already used for filter-triggered refreshes) instead of an instant content pop, so a resize reads as a smooth dip-and-return instead of a flicker.
- **Fixed a real jitter bug in the KPI card hover-tilt effect.** `attachKpiTilt()`'s `mousemove` handler was calling `getBoundingClientRect()` (a forced layout read) on *every single mousemove event* — which can fire 60–120+ times/second — then writing two CSS custom properties synchronously, with no throttling at all. The card's bounding rect is now measured once on `mouseenter` and reused for the whole hover gesture; each `mousemove` only records the latest pointer position and schedules at most one `requestAnimationFrame` callback to apply it, so a burst of events between two frames collapses into a single style write instead of one per event.

### Unchanged
- No application-version bump: this remains **V65.0**.
- No API, schema, or data changes — this pass only touches `app.js` (the resize-redraw `ResizeObserver` callback and `attachKpiTilt`). `app.css` is untouched — the fade transition reuses the existing `.chart-refreshing`/`.chart-ready` classes and their `prefers-reduced-motion` guard from the previous passes, so nothing new needed adding there.
- The KPI count-up animations (`animateKpiValue`/`animateNumericSpan`) were already frame-synced via `requestAnimationFrame` with `performance.now()` timing — checked, not touched.
- Fast data loading on the network/backend side (SQLite WAL mode, streaming exports, request cancellation on rapid filter changes via the existing `AbortController` in `triggerFilterRefresh`) was already addressed in earlier passes — checked, not duplicated here.
- Only `app.js` was touched for this pass.

### Verified
- `node --check app.js` — clean.
- Manually traced the new resize-redraw path: read phase (`chartAvailWidth` for every queued target) fully completes before the write phase (`_qdRedraw`) begins for any target, confirming no interleaved layout thrashing.
- Confirmed the reused `.chart-refreshing`/`.chart-ready` classes already respect `prefers-reduced-motion: reduce` (existing CSS), so the new fade is disabled for anyone with that preference, same as the filter-refresh transition.

## V65.0 — Follow-up: professionalism pass — spacing scale, typography hierarchy, top-of-page loading bar (no version bump — same version)

### Changed
- **Consistent spacing scale.** Added an explicit `--sp-1` … `--sp-8` (4/8/12/16/20/24/28/32px) token scale to `:root`. Retrofitted the layout-level paddings/gaps/margins that had drifted into one-off values — `.container` (24px/28px/30px → 24/28/28), `.kpi-grid`/`.kpi-card` (13px/14px/16px/18px → 12/16), `.filters` (14px/16px/17px → 16px, gap 12/13px → 12px), `.panel`/`.panel-body`/`.panel h3` (16px/18px → 16px throughout), `.qcr-hero` (18px/20px → 16/20), and the export dialog's head/options/option/foot (10/14/16/18/20/22/24px → 12/16/20/24) — onto the shared scale. Small form-control paddings tuned to a specific line-height (buttons, selects, filter chips) were left alone; this targeted the card/panel/section-level spacing that actually reads as inconsistent.
- **Typography hierarchy strengthened.** Added `--fw-heading`/`--fw-value`/`--fw-label`/`--fw-meta` and matching `--ls-*` letter-spacing tokens. Fixed a real inversion in the KPI cards: the small uppercase **label** was set heavier (`font-weight:800`) than the big **value** underneath it (`700`) — backwards from the hierarchy the design was going for. Labels now recede (`650`, wider `.6px` tracking, unchanged size/caps) while values lead (`800`, tighter `-.6px` tracking), so the number is what draws the eye first. Panel/QCR-hero headings now consistently use the same `--fw-heading` (800) tier.
- **Top-of-page loading bar.** Added a thin (3px), YouTube-style progress strip (`.page-progress-bar`) that fills in from the left whenever dashboard data is loading — filter changes, tab switches, the initial page load — and sweeps to 100% + fades out once every in-flight request settles. Implemented as a `fetch()` wrapper in `app.js` (right above the toast code) that auto-tracks any `/api/…` call, so every current loader (`loadKpis`, `loadFilters`, `fetchQcrCore`, drilldown, fishbone, root-cause, `qcr_target_history`, `kpi_targets`) and any future one is covered without per-function wiring. Background polling (activity heartbeat/live-user ping, the silent data-revision check) and the export flow are excluded — exports already drive their own detailed progress toast with live % and ETA, and heartbeat polling shouldn't visibly flicker the bar.
- **Toast notifications — reviewed, not rebuilt.** The top-right, slide-in, auto-dismissing toast system (`showToast`, `.toast-host`) already matched the ask; only its padding was snapped onto the new spacing scale (13px/14px → 12px/16px). No behavioural changes.

### Unchanged
- No application-version bump: this remains **V65.0**.
- No API, schema, or data changes — this pass only touches `app.css` (spacing tokens + retrofits, typography tokens + retrofits, new `.page-progress-bar` styles) and `app.js` (the new fetch-wrapper progress-bar module). `admin.html` and `index.html` don't define their own copies of these components (`admin.html` is fully self-contained and doesn't load `app.css`/`app.js`), so nothing there needed touching.
- Only `app.css` and `app.js` were touched for this pass.

### Verified
- `node --check app.js` — clean.
- CSS brace balance checked programmatically after all edits (1445/1445).
- Confirmed via grep that `admin.html`/`index.html` contain no inline duplicates of `.kpi-card`, `.toast-host`, or the new `.page-progress-bar` that would need a matching edit.
- Manually traced the fetch-wrapper's exclude list against every `fetch(...)` call site in `app.js` to confirm heartbeat/live/activity/data_revision/export calls are excluded and every real data loader is not.

## V65.0 — Follow-up: visual polish — consistent shadow elevation, shimmering text-only loaders, friendlier empty/error/success states, dark-mode copper contrast audit (no version bump — same version)

### Changed
- **Shadow elevation system.** Documented and extended the existing `--shadow-*` token scale (`card < card-hover < sticky < overlay < menu < modal`), adding a new `--shadow-overlay` tier for floating, self-dismissing surfaces like toasts. Retrofitted the toast, `.view-popover` (light + dark), and the whole QCR card family (`.qcr-card`, `.qcr-exec-item`, `.qcr-quality-status`, `.qcr-problem-card`, `.qcr-fb-branch`, resting + hover states) from bespoke near-duplicate `box-shadow` values onto these shared tokens, so every "card-like" surface now genuinely renders the same shadow instead of a dozen slightly-different one-off blurs/opacities.
- **Skeleton loaders — shimmer for the text-only spots.** Added `loadingStateMarkup(caption)`, which renders a few shimmering skeleton lines (reusing the existing `.skeleton-line` shimmer already used by the chart/table skeletons) plus a caption, and swapped it into every place that previously just showed static "Loading…" text: the drill-modal's record list, and the QCR tab's "Loading 6M fishbone analysis…" (×2) and "Loading root-cause path…" states. The one small inline counter that's too tight for skeleton lines (the drill-modal's record-count badge) instead got a lightweight `.loading-pulse-text` opacity pulse.
- **Empty/error/success states — one consistent, friendlier look.** Extended `emptyStateMarkup(title, sub, kind)` with a `kind` ('empty' | 'error' | 'success'), each with its own icon and colour: the existing neutral dotted-circle icon for "nothing to show", a new triangle-exclamation icon in `--red` for failures, and a new check-in-circle icon in `--green` for explicitly good "nothing wrong found" results. Converted all ~20 of the QCR tab's and drill-modal's plain-text `qcr-empty`/`drill-empty` messages to use it with the appropriate kind — including the "6M fishbone mapping not found" message (kept its `<b>` defect name via a new `rawTitle` option) and the "quality analysis could not run" / "no material quality problem detected" pair, which were previously indistinguishable plain text despite being opposite outcomes (temporary failure vs. genuinely good news).
- **Dark-mode accent-colour contrast — audited against WCAG AA.** Manually computed relative-luminance contrast ratios for the dark-mode `--accent` (#4DA3FF) and `--amber` (#FBBF24, the app's closest "copper/warm" accent) against the dark card background (#141B2C): **6.53:1** and **10.28:1** respectively — both comfortably clear WCAG AA's 4.5:1 for normal text (the dark-mode palette was already well-tuned here). The genuine "washed out" issue turned out to be the *decorative* header copper-coil artwork, not a text/contrast problem: in dark mode it was rendered at `opacity:.48` with `mix-blend-mode:screen`, which reads as faint against the dark header gradient. Bumped it to `opacity:.66` with `filter:saturate(1.45) brightness(1.2)` so the copper coils stay visible and rich instead of fading into the background.

### Unchanged
- No application-version bump: this remains **V65.0**.
- No API, schema, or data changes — this pass only touches `app.js` (`emptyStateMarkup`/`loadingStateMarkup` and their ~20 call sites) and `app.css` (elevation tokens, empty/error/success/loading styles, header copper-coil dark-mode filter). All previous passes (export progress bar, rounded toasts, spring KPI count-up, tab fade-in, button ripple, staggered chart grow-in) are untouched.
- Only `app.js` and `app.css` were touched for this pass.

### Verified
- `node --check app.js` — clean.
- CSS brace/parenthesis balance checked programmatically after all edits (1439/1439 braces, 1201/1201 parens).
- Grepped for the old `qcr-error-detail` class after converting its one call site — no longer referenced anywhere, so nothing was left orphaned.
- Manually walked the WCAG contrast math (sRGB → linear → relative luminance → (L1+0.05)/(L2+0.05)) for the two dark-mode colours above rather than asserting compliance without checking.

## V65.0 — Follow-up: micro-interactions — spring KPI count-up, tab fade-in, button ripple, staggered chart grow-in (no version bump — same version)

### Changed
- **KPI count-up now uses a spring easing curve instead of a flat ease-out.** `animateKpiValue()` (headline value) and `animateNumericSpan()` (Prev/%/pp trend spans underneath) both switched from `1-(1-t)³` to a shared `easeSpringOut()` — a classic easeOutBack curve — so the number overshoots the target slightly and settles back instead of just decelerating smoothly into it. Duration nudged 620ms → 680ms to give the overshoot room to read.
- **Switching tabs now fades + slides the new panel in** (130ms, opacity 0→1 + `translateY(8px)→0`) instead of the content just snapping into view. No JS timing code needed — the animation is defined on `.tab-panel:not(.hidden)` and CSS animations don't run on a `display:none` element, so toggling the existing `.hidden` class off replays it automatically every time.
- **Every real `<button>` in the app (plus the drill-modal's anchor-styled export link) now lifts on hover and ripples on click.** Hover adds a `scale(1.02)` + a stronger drop shadow; `.tab-btn` keeps its existing (now-enhanced) `translateY(-2px) scale(1.02)` hover instead of the generic rule. Click spawns a small expanding-circle ripple from the exact click point via one delegated `document` click listener in `app.js` — covers Export, Reset All, Compare mode, filter triggers, dialog Cancel/Save buttons, the command-palette trigger, drill-modal Close/Export, etc. without needing a listener wired up per button.
- **Chart bars and donut/pie slices now grow in with a small per-item stagger** instead of every shape animating in lockstep. Each generated `<rect class="chart-bar">` / `<path class="chart-slice">` now carries a `style="--i:N"` (its index, capped at 10) that feeds a `calc()` animation-delay, so a chart reads as a left-to-right / slice-by-slice ripple on load instead of one flat pop. Covers the horizontal bar chart, horizontal & vertical grouped bar charts, the combo (bar+line) chart, and the donut/pie chart.
- All of the above respects `prefers-reduced-motion: reduce` (tab fade, button hover-lift, ripple, and slice stagger all turn off; the pre-existing bar-stagger reduced-motion guard already in place still applies).

### Unchanged
- No application-version bump: this remains **V65.0**.
- No API, schema, or data changes — this pass only touches `app.js` (spring easing, ripple listener, `--i` index on chart markup) and `app.css` (tab fade-in, button hover/ripple styling, staggered bar/slice animation-delay). The two-phase export progress bar and its rounded-toast styling from the previous two passes are untouched.
- Only `app.js` and `app.css` were touched for this pass.

### Verified
- `node --check app.js` — clean.
- CSS brace/parenthesis balance checked programmatically after the addition (1427/1427 braces, 1189/1189 parens) — no stray/unclosed rules.
- Manually traced the ripple listener against buttons without a distinguishing class (bare `<button>` tags like `#drillCloseBtn`, `#exportDialogCloseBtn`) to confirm the delegated `button,.drill-export` selector still catches them.
- Confirmed the pre-existing `.chart-ready .chart-bar` reduced-motion override (already in app.css) still wins for that selector; added the matching guard for the new `.chart-ready .chart-slice` stagger.

## V65.0 — Follow-up: export progress bar polish — fast counting %, live ETA, rounder toast (no version bump — same version)

### Changed
- **The percentage now visibly counts up quickly, one step at a time**, instead of jumping straight to whatever number the current phase computed. A fast ticker (every 80ms) eases the displayed number toward a moving "target" percent — always advancing by at least 1% per tick, faster when the gap to the target is bigger — so it reads as continuous, lively motion rather than occasional jumps.
- **A real-time "~Ns left" estimate now sits next to the percentage.** It's derived every tick from elapsed time vs. percent-so-far (`estimatedTotal = elapsed ÷ (percent/100)`), so it keeps re-estimating itself as the real download phase kicks in and naturally self-corrects instead of showing a single fixed guess. Shows "Calculating…" for the first couple of percent (too little signal yet), "Almost done…" under a second, `~Ns left` under a minute, and `~Nm Ns left` beyond that; flips to "Done" at 100%.
- **The export toast — and toast notifications generally — now use a rounder, softer shape.** Corner radius increased (10px → 16px), the dismiss "✕" button is now a circular hover target instead of a bare glyph in the corner, and the toast clips its content to the rounded shape so nothing (including the accent-color left edge) reads as square.
- **The progress bar itself is now a full pill shape with a soft moving shimmer highlight** (disabled under `prefers-reduced-motion: reduce`), so it doesn't look like a flat, static rectangle while a report is generating.
- The percentage and ETA now sit on their own line under the bar (`percent` left, `ETA` right) instead of squeezed beside the track, so both stay easy to read as the numbers change quickly.

### Unchanged
- No application-version bump: this remains **V65.0**.
- No API, schema, or data changes — this pass only touches `app.js` (the ticking/ETA logic in `showToast`/`exportDashboard`) and `app.css` (toast + progress-bar styling). The two-phase progress model (simulated 0→90% while the server assembles the report, real bytes 90→99% once headers arrive, 100% on handoff to the browser) from the previous pass is unchanged.
- Only `app.js` and `app.css` were touched for this pass.

### Verified
- `node --check app.js` — clean.
- Manually traced the ticker/ETA math across the full range (early "Calculating…" state, mid-flight re-estimation, sub-minute and multi-minute formatting, and the 100%/"Done" handoff) and confirmed the shimmer respects `prefers-reduced-motion`.

## V65.0 — Follow-up: live progress bar on the export toast (no version bump — same version)

### Changed
- **The "Generating … report" toast (top-right, shown while an Excel/PDF/PPT/CSV export runs) now shows a live progress bar and percentage**, instead of just a static "this can take up to a minute" message with no feedback until it finishes or fails.
  - `showToast()` in `app.js` gained an opt-in `opts.progress` mode: it renders a thin track + fill bar and a `NN%` label inside the toast body, and attaches a `.setProgress(pct)` method to the same dismiss-function the caller already gets back — every other existing `showToast(...)` call site is untouched, since the new markup and method only appear when a caller explicitly asks for it.
  - `exportDashboard()` drives that bar in two phases:
    1. **0→90%** while the server is assembling the report — there's no real signal yet at this stage (the export endpoints build the whole file in memory before sending a single byte), so the bar eases forward on a smooth curve instead of sitting frozen.
    2. **90→99%** once the response headers arrive: real bytes received are tracked against the response's `Content-Length` (when the server sends one) via a streamed `ReadableStream` read, so the last stretch reflects the actual download rather than a guess. If the browser can't stream the body or the server didn't send a `Content-Length` (e.g. the streamed CSV path), it falls back to holding at 96% until the file is fully in hand.
    3. **100%** is set the moment the file is handed to the browser to save, immediately before the existing "Export ready" success toast and the download itself.
- Failure and "already generating" behavior is unchanged: an error still dismisses the progress toast and shows the existing red "Export failed" toast; a repeat click while busy still shows the existing "is already being generated" info toast.

### Unchanged
- No application-version bump: this remains **V65.0**.
- No API, schema, or data changes. Purely a frontend (`app.js` + `app.css`) UX addition — the request/response flow, filenames, and file contents produced by `/api/export/*` are identical to before.
- Only `app.js` and `app.css` were touched for this pass.

### Verified
- `node --check app.js` — clean.
- Manually traced both progress paths (streamed body with `Content-Length`, and the no-`Content-Length`/no-stream fallback) and the existing success/error/duplicate-click toast behavior — all unchanged apart from the added bar.

## V65.0 — Follow-up: 3-decimal precision for KPI pp-change and QCR Critical KPIs (no version bump — same version)

### Changed
- **KPI card percentage-point (pp) change now shows 3 decimals instead of 2** — e.g. `+0.087 pp` instead of `+0.09 pp` — in both the static render and the count-up animation (`renderKpis()`'s delta markup and its `animateNumericSpan` formatter in `app.js`).
- **Quality Control Room → Critical KPIs grid values now show 3 decimals** (`qcrFmtKpi()`), matching the 3-decimal precision the main Dashboard's KPI headline values already use (`fmtValue()`). Applies to all six Critical KPI cards (First Pass Yield %, Defect Rate, Reject % Qty, Hold for Decision % Qty, Salvage % Qty, Rework % Qty).
- **The "Gap … pp" line inside each Critical KPI card** (distance from its configured target) now also shows 3 decimals, for consistency with the pp precision change above.

### Unchanged
- No application-version bump: this remains **V65.0**.
- Other pp/percentage displays elsewhere in the Quality Control Room — the "Why Changed" FPY/Reject pp figures, the Target History table's Gap column, and Compare Mode's period-over-period delta — were **not** touched in this pass and still show 2 decimals; only the KPI cards' pp change and the Critical KPIs grid (value + its own Gap line) were requested.
- No data, API, schema, or layout changes — display formatting only.

### Verified
- `node --check app.js` and `eslint --no-unused-vars` — clean.
- Full regression pass: all 6 `regression.py` suites, `smoke_test.py`, `http_smoke.py` (47 endpoints), `admin_ux_audit.py`, `code_health.py` — all pass.

## V65.0 — Follow-up: dead-code cleanup in server.py, reports.py, app.js (no version bump — same version)

### Removed
- **Unused imports in `server.py`.** `get_logger` (from `logging_setup`), and a full set of openpyxl/matplotlib/reportlab/pptx symbols (`Image as XLImage`, `Font`, `PatternFill`, `Alignment`, `Border`, `Side`, `FancyBboxPatch`, `colors`, `A4`, `landscape`, `getSampleStyleSheet`, `ParagraphStyle`, `TA_CENTER`, `TA_LEFT`, `Paragraph`, `Spacer`, `Table`, `TableStyle`, `PageBreak`, `Image as RLImage`, `Inches`, `Pt`, `RGBColor`, `PP_ALIGN`, `MSO_ANCHOR`, `MSO_SHAPE`) were imported but never referenced — the actual report-building code that needs these already lives in `reports.py`, which imports them itself. `server.py` only ever calls the already-imported `_excel_report` / `_pdf_report` / `_pptx_report` wrappers.
- **Unused import in `reports.py`.** `TA_CENTER` (from `reportlab.lib.enums`) — `TA_LEFT` is used, `TA_CENTER` never was.
- **Dead local variables (`server.py`):** an unused `ppm_defective` computation in `compute_kpis()` (never included in the 12-item KPI list), an unused `total_coils` aggregate inside `dimension_rows()`'s risk scoring (only `total_qty` is actually used), and an unused exception-binding (`except Exception as e`) in the public `/api/connection_status` handler, where the exception was already intentionally never surfaced to the caller.
- **Dead local variable (`reports.py`):** an unused `light` color constant in `_excel_report()`, and an unused `n=len(headers)` in `style_table()`'s PPTX helper.
- **Dead local variables (`app.js`):** an unused loop index in the filter-dropdown's `renderOptions()`; three unused strings (`directionText`, `targetText`, `prevText`) computed in the KPI card renderer but never inserted into the card markup (`kpiTargetMarkup()` already renders the equivalent target info); an unused `catch(e)` binding in `loadRootCause()`'s fallback; and an unused `loadToken` local in `loadControlRoom()` (the `++window.qcrLoadToken` increment itself is kept — only the unused local binding was removed).
- **Two redundant f-string prefixes in `server.py`** on two `SELECT DISTINCT` queries that had no `{}` interpolation.
- One float() parse of the (currently unused) `critical` threshold in `_kpi_target_status()` was kept, not removed — it silently validates that `critical` is present and numeric before returning a status; deleting it would have changed behavior (a missing/invalid `critical` config would then be silently un-validated).

### Verified
- Fresh `pyflakes` pass on `server.py` and `reports.py`: 0 warnings (previously 31 combined).
- Fresh `eslint --no-unused-vars` pass on `app.js`: 0 warnings for genuinely-dead locals (2 remaining warnings are unused *parameters* of a shared rendering function, `qcrRenderTrendPrediction(rows, d, w)`, left as-is rather than changing a function signature for a cosmetic-only pass).
- `python -m py_compile` on every changed `.py` file, `node --check app.js` — both clean.
- Full regression pass: all 6 `regression.py` suites, `smoke_test.py`, `http_smoke.py` (47 endpoints), `export_acceptance.py`, `export_stress.py` (Excel/PDF/PPTX), `code_health.py`, `admin_ux_audit.py` — all pass, identical results to the pre-cleanup baseline (same 4936-record count, same 47 endpoints, same export byte sizes to within a few bytes of normal run-to-run timestamp variance).
- No API, database, schema, data, or visual/behavioral change — this is a pure dead-code removal pass. Line counts: `server.py` 6164→6152, `reports.py` 912→911, `app.js` 3205→3202.
- The 24 orphaned CSS classes and 161 duplicate-selector groups `code_health.py` reports in `app.css` were **not** touched in this pass — they were already reviewed in an earlier audit and are compound/shared selectors where a dead class rides along with a live one; removing them needs a careful per-rule check, not a bulk pass, to avoid breaking live styling.

## V65.0 — Follow-up: export chart reliability

### Fixed
- **Decision Distribution export now supports all seven disposition categories.** The pie-chart color palette is cycled to match every nonzero slice, preventing the Excel/PDF/PowerPoint export path from failing when all decision types contain quantity.
- **Export charts are isolated per chart.** A failure in one chart is logged and skipped so the remaining charts and export tables can still be generated.

### Verified
- Seven-slice Decision Distribution PNG generation succeeds.
- A synthetic single-chart failure is isolated without dropping the remaining charts.
- Python compile check passes for `reports.py`.

## V65.0 — Follow-up: intensity drilldown consistency, session-lock DB access, Fishbone import cleanup, Postgres seed cursor cleanup

### Fixed
- **"WITHOUT INTENSITY" now includes legacy `NONE` values** in both the intensity chart aggregation and drilldown filtering, keeping chart totals and drilldown rows consistent with the existing filter behavior.
- **Admin session expiry cleanup no longer performs the database delete while holding `SESSION_LOCK`.** The session is removed under the lock first, then the shared-session delete runs after the lock is released.
- **Fishbone style refresh no longer contains a dead update branch.** The function already performs a full style-table reset before inserting imported styles, so the unreachable existing-category lookup and update path were removed.
- **PostgreSQL seed import now closes its cursor explicitly** after `executemany()` before committing the transaction.

### Verified
- Python compile check passes for `server.py`.
- Targeted checks confirm the intensity `NONE` handling, lock-release before session deletion, Fishbone import path, and explicit Postgres seed cursor close.
- Existing frontend changes and documentation remain intact.
- No schema migration or intentional data transformation was introduced by this patch.

## V65.0 — Follow-up: QCR target breach accuracy, cache bounds, target precision

### Fixed
- **QCR Target Breaches now exclude neutral KPIs.** `qcrRenderExecutive()` counts only `amber` and `bad` statuses, so KPIs without a configured target are not reported as breaches.
- **Bounded the QCR core response cache.** `qcrCoreCache` now removes entries older than 60 seconds when the cache grows beyond 15 entries and evicts the oldest remaining entry when the limit is still exceeded.
- **Corrected `num3` target formatting.** `fmtTarget()` now renders `num3` values with three decimal places.
- **Removed an unused QCR executive variable.**

### Verified
- `node --check app.js` — clean.
- Targeted checks confirm the QCR breach filter, cache cleanup, `num3` precision, and unused-variable cleanup are present.
- Existing v2 animated header implementation and earlier frontend fixes remain intact.
- No API, database, schema, or data changes are involved.


## V65.0 — Follow-up: animated header accent lines

### Added
- **Animated header accent lines.** The top and bottom header strips now use 200%-width gradient layers that move with `transform: translate3d()` in opposite directions at 8s and 12s cycles.
- **Theme-aware accent animation.** Dark mode uses brighter blue, cyan, copper, and steel tones for clear motion on the graphite header.
- **Reduced-motion and print safety.** Both animations stop under `prefers-reduced-motion: reduce` and print.

### Verified
- Replaced the previous background-position implementation with the v2 transform-based implementation at the end of `app.css`.
- Confirmed the new header keyframes and selectors occur once and the stylesheet remains syntactically valid.
- Existing JavaScript, API, database, data, layout logic, and prior frontend fixes remain unchanged.


## V65.0 — Follow-up: frontend sorting, QCR KPI animation, drilldown null-safety, filter refresh pulse

### Fixed
- **Table sorting now handles signed numbers and unit-suffixed values correctly.** `_parseSortCell()` now removes thousands separators and percent signs, accepts a leading `+` sign, strips common trailing units (`pp`, `pts`, `MT`, `coils`), and validates the remaining value as one numeric token. This prevents change/trend cells such as `+1.23%` or `−0.50%`, and values such as `12.5 MT`, from falling back to string comparison and producing the wrong order.
- **Quality Control Room KPI count-up animation was restored.** `animateKpiValue()` is shared by the Dashboard and QCR, but the two areas maintain separate cancellation tokens (`kpiAnimationToken` and `qcrAnimationToken`). The animation guard now accepts either active token, so a QCR animation is no longer cancelled immediately because the Dashboard token differs.
- **Drilldown rendering is now null-safe.** `renderDrillPage()` now guards the optional title, subtitle, count, scope, and export elements before reading or writing them. The error path uses the already-captured count element as well, so a partial/future refactor of the drilldown markup cannot turn a missing optional element into a full render crash.
- **Filter refresh pulse now retriggers on every filter change.** `triggerFilterRefresh()` removes the existing `filter-pulse` class, forces a reflow, and then adds it again. This makes the CSS animation replay for each filter change instead of only the first time the class is added.

### Added
- **`.filter-pulse` CSS animation.** Added a short expanding blue ring around the sticky filter bar as a visual signal that a filter change has triggered a refresh. The animation is disabled under `prefers-reduced-motion: reduce`.

### Verified
- `node --check` on the updated `app.js` — clean.
- Targeted validation of `_parseSortCell()` for signed numeric values, percentages, and the supported unit suffixes — correct numeric parsing.
- Confirmed the requested functions/classes are present exactly once in the updated source and that no unrelated sections were intentionally modified.
- No database, API, schema, or data changes are involved in this frontend-only patch.


## V65.0 — Follow-up: first-visit Quality Control Room (QCR) tab load delay fixed (no version bump — same version)

### Fixed
- **The Quality Control Room tab was slow only the *first* time it was opened in a session** — every visit after that felt instant. Root cause: `fetchQcrCore()` already caches its `/api/qcr` response for 30s, and `prefetchQcrCore()` exists specifically to warm that cache in the background, but it was only ever called from `triggerFilterRefresh()` — i.e. after the user changed a filter while sitting on the Dashboard tab. On a fresh page load (the normal case — land on Dashboard, then click "Quality Control Room"), nothing warmed the cache first, so that first click always paid the full `/api/qcr` round trip (KPIs, defect register, work-center/grade breakdowns, monthly trend, and problem-finder/RCA intelligence, all computed fresh) before anything rendered.
- `init()` now calls `prefetchQcrCore()` in the background right after the landing tab finishes rendering (Dashboard or any other non-QCR start tab), the same call `triggerFilterRefresh()` already made after a filter change. By the time the user actually clicks into the Quality Control Room tab, its data is normally already sitting in cache, so `loadControlRoom()` resolves immediately instead of waiting on the network. Skipped when the Quality Control Room tab is itself the saved/URL-restored landing tab, since it is already fetching its own data at that point and a second parallel request would be wasted. Fire-and-forget, matching the existing `prefetchQcrCore()` contract — no new UI state, no change to what the tab shows, no change to `/api/qcr` itself.

### Verified
- `node --check app.js` — clean.
- Manually traced both `init()` paths (Dashboard as landing tab, and a non-QCR tab restored from a saved default/shared URL) to confirm the new prefetch fires exactly once, after the landing tab's own load, and is skipped when Quality Control Room is the landing tab itself.
- No change to `/api/qcr`, `fetchQcrCore()`'s caching/retry logic, or `loadControlRoom()`'s rendering — this only adds one additional (existing) prefetch call site.

## V65.0 — Follow-up: SQLite WAL mode (concurrency/lag fix), sticky-filter scroll-jank fix (no version bump — same version)

### Changed
- **SQLite now runs in WAL (write-ahead log) mode instead of the default rollback-journal mode.** The old default only allows *either* one writer *or* readers on the database file at a time; any concurrent write (an import, a backup, an admin edit, or even the activity-log ping every page view triggers) blocked every reader until it finished, and — as the `busy_timeout=3000` fallback shows — a slow enough overlap could still surface as an outright "database is locked" 500. Benchmarked the difference with a stand-in workload shaped like this app's real one (several readers doing a sustained, chunked table scan — the same access pattern the streamed CSV export uses — while a writer commits a batch of inserts): the writer's batch took **4.67s under the old default vs. 0.45s under WAL** — roughly a 10x reduction in writer stall time under concurrent read load. This is a one-time, per-database-file mode change persisted in the file header (SQLite writes small `-wal`/`-shm` sidecar files alongside the main `.db` file); it changes nothing about the schema or any row of data, and is trivially reversible. Paired with the standard, still-durable `synchronous=NORMAL` setting recommended for WAL. Wrapped in try/except so the rare filesystem that can't support WAL (some network mounts) just keeps the previous behavior instead of failing every request. Verified the existing backup/restore mechanism is unaffected — it already works by querying rows through the normal DB connection (not by copying the raw file), which reads WAL-mode data correctly with no changes needed.
- **The "Database" admin panel's disk-usage figure now includes the new `-wal`/`-shm` sidecar files** that WAL mode adds alongside the main SQLite file. This number feeds the `DB_LIMIT_MB` quota percentage shown there, so it needs to reflect everything actually on disk, not just the main file, to avoid quietly under-reporting usage against that quota.
- **Sticky filter bar: reduced scroll-jank from its glass-blur effect.** The dashboard's filter bar sits `position:sticky` at the top of the page and uses `backdrop-filter: blur(...)` for its glass look — while it stays pinned and the page scrolls underneath it, the browser has to resample and re-blur that background on every scroll frame, which is a well-known source of visible scroll stutter for exactly this "sticky + glass" pattern. Added `will-change:backdrop-filter`, which hints the browser to keep a dedicated compositing surface ready for the effect instead of recalculating it cold each frame — a standard, non-visual fix (nothing about how the bar looks changes). Also added an explicit `@media(prefers-reduced-motion:reduce)` rule that drops the live blur entirely in favor of the existing solid card background for anyone who has asked their OS for reduced motion — zero per-frame blur cost for those users, and glass/parallax-style effects are exactly what that setting is meant to opt people out of. No other transitions/animations needed changes: the existing keyframe animations already respect `prefers-reduced-motion` (checked directly — `.kpi-card`, chart bars/slices, the presentation view, the header pulse, and skeleton loaders all already had reduced-motion rules in place), scroll/resize listeners were already debounced or `requestAnimationFrame`-throttled (the cursor-following field-name tag, chart refit-on-resize), and the network path was already gzip-compressed with immutable long-lived caching on the static bundle.

### Verified
- Full regression pass: all 6 `regression.py` suites (including `backup_integrity`, `restore`, `restore_rollback`, `full_state_backup` — specifically to confirm WAL mode doesn't affect backup correctness), `smoke_test.py`, `http_smoke.py` (47 endpoints), `admin_ux_audit.py`, `code_health.py` — all pass, no visual or behavioral change to anything except the two fixes above.
- Standalone benchmark (see above) demonstrating the WAL concurrency improvement under a workload shaped like this app's real read/write mix.

### Added
- **Structured, rotating application logging (`logging_setup.py`).** Every `print()` call in `server.py` (35 of them — startup messages, backup results, export failures, recursion diagnostics) now goes through Python's `logging` module instead. Console output is unchanged; each line is *also* written as one JSON object per line to a rotating file (`<persistent dir>/logs/app.log`, 5&nbsp;MB × 5 backups) so operational history survives a redeploy/restart instead of only living in whatever the platform's own log buffer happens to retain. New admin endpoint `GET /api/admin/system_log?lines=N` tails this file (JSON entries, newest last) for in-app inspection. This is explicitly per-process — the response says so — since file-based rotation can't merge logs across multiple instances; that's a platform-level concern (Papertrail/Datadog/etc.), not something an in-app file can solve.
- **Admin inspection for the two in-memory rate limiters.** New `GET /api/admin/rate_limit_status` (admin-only) surfaces `ACTIVITY_RATE` (general per-IP request throttle) and `LOGIN_ATTEMPTS` (brute-force login lockout): tracked-IP counts, the top offenders, and which IPs are currently locked out. Wired into the admin **Security** panel (new "Tracked IPs (activity/login)" stats + a login-attempts table) alongside the existing session list.
- **Cross-instance session + login-attempt sync on Postgres (`session_store.py`).** Previously `SESSIONS` and `LOGIN_ATTEMPTS` were pure in-memory dicts — correct for a single process, but silently wrong the moment a deployment runs more than one instance behind a load balancer: a login on instance A was invisible to instance B, and a brute-force lockout only counted attempts the *one* instance it hit happened to see. Two new tables (`sessions`, `login_attempts`) are created **only when `DATABASE_URL`/Postgres is configured** — SQLite is a single local file, so a SQLite deployment is single-instance by construction and its behavior is completely untouched by this change. On Postgres: session creation/renewal/logout/revoke now write through to the shared table (renewal is throttled to once/minute per session, not every request, to avoid turning a cheap in-memory check into a DB round-trip on every API call); a session lookup that misses the local cache falls back to the shared table before giving up (the case where a request lands on a different instance than the one that issued the cookie); login-attempt counting checks/increments the shared table in addition to the local dict, so a brute-force attempt spread across instances is still caught. `/api/admin/rate_limit_status` includes the shared login-attempts table's contents as `login_attempts_shared` when Postgres is active.
- **`.github/workflows/dependency-audit.yml`** — runs `pip-audit -r requirements.txt --strict` on every change to `requirements.txt`, on every PR, and weekly on its own (catches a CVE disclosed after the last commit, not just ones a diff would trigger on). `requirements.txt` is pinned with `~=`, so a routine `pip install` on deploy can pull in a newer patch release with no human review; this is the check on that. No `package.json` exists in this project, so there is nothing for `npm audit` to scan — noted directly in the workflow file so it isn't mistaken for an oversight later. Ran `pip-audit` locally against the current pins: **no known vulnerabilities found.**

### Changed
- **`/api/export/csv` now streams instead of buffering the whole file in memory.** The old path did `cur.fetchall()` (the entire filtered result set as Python tuples), built one big `StringIO` of CSV text, then one more `.encode()`'d copy of the whole thing, before sending a single response — three full in-memory copies of however many rows matched the filter. This project is explicitly designed to hold multi-million-row imports ("6M Fishbone Master"), so an unfiltered export could spike memory noticeably and block the request thread until the whole file was serialized. The export now pulls rows in batches of 2,000 via `fetchmany()` and streams small CSV batches straight to the response as they're produced (`reports._stream_csv`), so memory stays bounded regardless of row count and the client starts receiving bytes immediately. Output (headers, column order, UTF-8 BOM, filename) is byte-for-byte the same shape as before; verified against a 13,900-row export. The Excel/PDF/PPTX exports were checked too — they're already built from pre-aggregated summary tables (KPIs, Pareto, monthly/weekly trends), not raw disposition rows, so they were never subject to this and didn't need the same treatment.
- **`code_health.py`'s orphaned-CSS detector now understands dynamically-built class names.** It previously flagged classes like `status-good` and `qcr-badge-risk-high` as unused because `app.js` builds them at runtime (`` `status-${status}` ``, `` `qcr-badge-risk-${risk.toLowerCase()}` ``) rather than writing the literal string anywhere — false positives that would have made a "delete what's orphaned" pass actively break live styling (risk badges, status pills, toasts) had anyone acted on the old report. The detector now recognizes both `` `prefix-${var}` `` and `'prefix-' + var` construction patterns and excludes any CSS class starting with a live prefix. After that fix, traced each remaining candidate by hand against `app.js`/`server.py` (not just grep) — e.g. confirmed the `early_warnings` API field and its `medium`/`high` severity values are computed server-side but never read by the frontend, so `.qcr-severity-pill.medium` really is dead, not just unreferenced-looking.
- **Removed 110 confirmed-dead CSS rule blocks from `app.css`** (~11&nbsp;KB) — an entire legacy "Quality Intelligence" styling section (`.qcr-row`, `.qcr-breach*`, `.qcr-risk-*`, `.qcr-why-*`, `.qcr-opportunity*`, `.qcr-repeat*`, and more) whose own comments already called it "legacy two-column row (kept for any older render paths)"; the current QCR intelligence UI uses a different, still-live class set (`qcr-ranked-row`, `qcr-problem-row`, `qcr-severity-pill`, `qcr-exec-item`, etc.). Also dropped one dead comma-branch (`.qcr-severity-pill.medium`) from a rule shared with a still-used selector. Only removed rules where **every** class in the selector was confirmed dead — anywhere a dead class rode along in a shared/compound selector with a live one, it was left alone rather than risk a surgical edit to a rule that also styles something real. Orphaned-class count: 68 → 24 (the remainder are exactly those left-alone shared-selector leftovers, cosmetic only).

### Fixed
- **A "database is locked" cascade the streaming CSV change would otherwise have introduced.** Its first draft opened the export's SELECT cursor, then logged the export via `_activity_event()` — a *second*, concurrent SQLite connection doing an INSERT — while the SELECT's cursor was still open and unconsumed (streaming holds it open for the life of the response instead of fetching everything up front). SQLite's SELECT-in-progress readers hold a lock that blocks a concurrent writer; the writer hit the 3-second `busy_timeout`, failed, and — because `_activity_event`'s error handler was a bare `except Exception: pass` that never closed the connection it had opened — leaked that connection with an uncommitted transaction still open, which then blocked *every subsequent write for the rest of the process*, surfacing as sporadic 500s on completely unrelated endpoints (`/api/kpis`, `/api/period_trend`, ...). Caught by the full regression suite before shipping. Fixed two ways: (1) the export now logs the activity *before* opening its SELECT, so the two never overlap; (2) `_activity_event()`'s exception handler now always closes whatever connection it opened, so a future transient failure here can no longer leak a lock for the rest of the process's life — a real pre-existing robustness gap, not just a workaround for the new code path.
- **`code_health.py`'s `_JsonFormatter`** in the new logging module no longer duplicates a redundant `asctime` field alongside `ts` in each JSON log line (cosmetic).

### Verified
- Full regression pass: all 6 `regression.py` suites, `smoke_test.py`, `export_acceptance.py`, `export_stress.py`, `http_smoke.py` (47 endpoints), `admin_ux_audit.py`, and `code_health.py` — all pass.
- Added a standalone unit check for the new `session_store.py` SQL (upsert/fetch/delete, login lockout + clear, snapshot) against a stand-in database, since a live Postgres instance isn't available in this environment; the Postgres-only `payload::jsonb->>'user_id'` bulk-revoke path is confirmed to fail safe (swallowed, no crash) against a non-Postgres backend rather than exercised against real Postgres.
- Manually smoke-tested the new admin endpoints (`/api/admin/rate_limit_status`, `/api/admin/system_log`) and the streamed CSV export (13,936-row file, correct row count and content) end-to-end against a running instance.
- Fresh `python -m py_compile` of every `.py` file and `node --check app.js`.
- No data, API response shape, or visual/behavioral change for existing functionality — every addition above is either new (opt-in admin endpoints, new files) or gated so it's a no-op on the existing SQLite/single-instance configuration (Postgres session/login sync).

## V65.0 — Follow-up: admin logout session race fixed (no version bump — same version)
- **Fixed:** `/api/logout` (the admin logout endpoint) removed a session from the shared, in-memory `SESSIONS` dict with a bare `SESSIONS.pop(token, None)` — the one mutation site in `server.py` that did **not** take `SESSION_LOCK` first. Every other place that touches `SESSIONS` (login, viewer logout, `revoke_session`, `change_password`, `user_toggle`, and the periodic `_cleanup_sessions` sweep) takes the lock before reading or writing it, because `ThreadingHTTPServer` runs each request on its own thread and several of those call sites iterate `list(SESSIONS.items())` while holding it. An admin logging out at the same moment one of those locked iterations was running could race and intermittently raise `RuntimeError: dictionary changed size during iteration` inside whichever unrelated request happened to be mid-iteration — a sporadic 500 under concurrent admin traffic that would not reproduce reliably and gave no useful log signal beyond the reference id. The pop is now wrapped in `SESSION_LOCK` like every other session mutation; no change to the logout response, cookies, or any other behavior.
- **Verified:** full regression pass (`smoke_test.py`, `regression.py`'s 6 suites — including its `security_hardening` and session-handling checks, `http_smoke.py` — 47 endpoints, `admin_ux_audit.py`) plus a fresh `python -m py_compile` and `node --check app.js`. No other defects found in this pass; no data, API, or visual changes beyond the fix above.


## V65.0 — Full audit pass: duplicate HTML id fixed (no version bump — same version)
- **Admin console — duplicate `id="admin-field-hints"` fixed.** The field-name hover tag's `<style>` block and its `<script>` block in `admin.html` both used the same `id`, which is invalid HTML (ids must be unique per page) and made the project's own `admin_ux_audit.py` contract check fail. Neither id was referenced anywhere else in the codebase, so this was safe to rename without touching behavior: the style block is now `admin-field-hints-style` and the script block is `admin-field-hints-script`.
- **Full regression pass:** ran every existing release-gate script (`smoke_test.py`, `regression.py`'s 6 suites, `http_smoke.py` — 47 endpoints, `code_health.py`, `admin_ux_audit.py`, `export_acceptance.py`, `export_stress.py`) plus a fresh Python syntax compile of every `.py` file and a Node syntax check of every inline `<script>` block in `index.html` and `admin.html`. All pass; the duplicate id above was the only defect found. No data, API, or visual changes.

### Intro screen — clean side imagery (v8), no baked-in text
- Replaced the old copper/coil illustrated intro background with real plant photography: a faded industrial-plant image on the left edge and a copper-coil warehouse image on the right edge of the splash screen, each anchored to the screen edge and fading to transparent toward the centre.
- The photos sit behind the intro text (`z-index:0`, under the existing `intro-stage` at `z-index:1`) and are masked by their own edge-to-centre fade, so they never visually collide with the "NON-FERROUS / QUALITY INTELLIGENCE" headline, the cards, or the "Enter Dashboard" button at any width.
- On screens ≤800px wide the side images narrow to 22vw and dim to 80% opacity so they stay out of the way of the centred text on phones/tablets.
- No text is baked into the images themselves — all copy remains the existing live DOM/CSS headline elements, so it keeps behaving correctly with reduced-motion, replay, and the letter-by-letter reveal.
- Everything else about the intro (timeline, sound design, letter animation, iframe/Compare-Periods guard) is unchanged.

### Live Data indicator pulse fix
- Restored the header **LIVE DATA** status dot pulse after the Design 4 header styling had disabled its animation.
- The pulse now uses the existing `livePulse` keyframes with a controlled 1.8s cadence and will-change hint for smooth rendering.
- Intro hover-tag exclusion and full Dashboard/Admin field-hint coverage remain unchanged.
## V65.1 — Field Hint Coverage Fix
- Restored cursor-following **Field Name Hover Tag** coverage across the full main Dashboard UI and Admin UI.
- Kept the Intro/Splash screen explicitly excluded from field-name hints.
- Added generic fallback coverage for dynamically added controls, form fields, navigation, cards, tables, and action buttons so newly rendered UI does not silently lose the hint.


## Unreleased — Intro Hover Tag Fix
- Disabled the cursor-following Field Name Hover Tag on the `#introScreen` / splash screen so the introduction remains presentation-only.

## 2026-09-25 — Design 4 Industrial Copper Header
- Implemented the approved static **Design 4** header treatment on the main dashboard.
- Kept the existing **QUALITY INTELLIGENCE** script typography unchanged.
- Switched the header artwork to a fixed industrial treatment with copper-base coil imagery, subtle steel texture, and JSL orange/graphite diagonal accents.
- Preserved the compact header alignment: branding on the left; Last Updated/Live Data/Export/Commands along the bottom-right; date/time above the command toolbar.
- Disabled decorative header motion so the Design 4 treatment remains static and professional.
- Added matching dark-theme styling using graphite/navy steel tones while retaining the copper/industrial reference.

## V65.0 — Follow-up: header clock stacked above Commands again, intro "Enter Dashboard" delay removed (no version bump — same version) (2026-09-25)

### Fixed
- **Header — clock stacked above Commands again, no gap under the logo.** A recent "one row" experiment had put the clock and the Live Data / Export / Commands pills side by side on one line, with the "Last Updated" chip floating awkwardly in the middle of that taller cluster and a gap opening up under the JSL logo/title block. Reverted `.header-right-stack` to the earlier column layout — clock on top, "Last Updated" + Live Data + Export + Commands as one row directly under it — and changed `.header-top-row` to bottom-align its two halves, so the logo/title block now sits flush with that row instead of floating centered with empty space beneath it. This is the same arrangement the header used a couple of releases back; the dedicated `max-width:760px` rule that used to force this layout only on phones was removed since it's now the default at every width.
- **Intro screen — "Enter Dashboard" no longer stuck behind an invisible ~2.7s pause.** The intro's timeline still budgeted time for the old Copper Mill quality-scan/PASS-badge beat (sweep sound, stamp thud, chime) even though that skin was removed earlier in V65.0 and the scan panel has been `display:none` ever since (`data-skin` is hardcoded to `classic`). The button was waiting on — and the page was playing sound effects for — an animation nobody could see. Removed that dead stretch from the timeline; the button now appears right after the intro cards finish, cutting the load-to-ready time by roughly 2 seconds with no visual change to anything that was actually on screen.

### Checkpoints
- Header: the digital clock sits directly above the Live Data / Export / Commands row, and the JSL logo + title block bottom-aligns with that row with no visible gap underneath, at desktop, tablet and phone widths, in both themes.
- Loading the dashboard: "Enter Dashboard" unlocks noticeably sooner than before (no long pause after the intro cards finish, no scan-sweep/stamp sound).

## V65.0 — Follow-up: intro screen progress fill + logo scale-in, header accent strip (no version bump — same version) (2026-09-25)

### Added
- **Intro screen — logo scale-in:** the logo's entrance now pairs a subtle scale-up (.9 → 1) with the existing fade/translate, instead of a flat fade only.
- **Intro screen — progress fill bar:** a thin blue→orange gradient bar appears right under the logo and fills smoothly across the whole reveal sequence, finishing exactly as "Enter Dashboard" unlocks, then fades out. Gives the loading pause a clear "getting the dashboard ready" read. Skipped entirely under `prefers-reduced-motion: reduce`, consistent with the rest of the intro's decorative motion.
- **Header — clean gradient accent strip:** a thin (3px) brand-gradient line (blue → orange) across the header's top edge, with a subtle glass-style inner top highlight on the header itself. Separate light/dark gradient tones. This is the enterprise-dashboard-style replacement for the old illustrated header scene — a small brand cue instead of decorative artwork, matching the plain Classic header direction from the earlier V65.0 follow-up.

### Notes
- CSS/JS only; no data, API or layout changes. No application-version bump: this remains **V65.0**.

### Checkpoints
- Loading the dashboard: the logo scales up slightly while fading in; a thin gradient progress bar fills under it and disappears right as the "Enter Dashboard" button lights up.
- With `prefers-reduced-motion: reduce` set, the progress bar never appears (no layout shift either) — the rest of the intro already updates instantly per the existing reduced-motion handling.
- Header shows a thin blue→orange line across its top edge in both light and dark theme.

## V65.0 — Follow-up: "Copper Mill" theme removed, header/intro back to plain Classic (no version bump — same version) (2026-09-25)

### Removed
- **"Copper Mill" theme removed entirely, along with its Ctrl+K toggle.** The animated factory-bay header (copper coils, flowing blue/copper ribbon waves, 3D swinging logo with a moving glint) and the redesigned intro screen (coil renderings, "Cu 29" watermark, quality/gauge icons, the scan-line + "QC SCAN PASSED" badge sequence, and its extended procedural sound) introduced earlier in V65.0 are gone. The plain **Classic** header and intro — the look that shipped before this theme — is now the only option; there is nothing to switch, so the "Theme: Switch to Copper Mill / Classic" command was removed from the command palette (Ctrl+K).
- `data-skin` is hardcoded to `classic` in `index.html`; the old `localStorage`-backed `qdash_skin` copper/classic toggle is gone from both `index.html` and `app.js`. The now-unused Copper Mill CSS (`.intro-copper` layer, `.header-fx`, scan-panel styles, etc.) is left in `index.html`/`app.css` but is inert and never shown.

### Notes
- No data, API, or layout changes. No application-version bump: this remains **V65.0**, since the Copper Mill theme being removed here shipped and was reverted within the same V65.0 release.

### Checkpoints
- Loading the dashboard (fresh browser, no prior `localStorage`) shows the plain Classic header and intro — no coil artwork, no scan-line/badge sequence, no swinging 3D logo.
- Ctrl+K command palette has no "Theme" / "Copper Mill" / "Classic" entry.
- A browser with an old `qdash_skin=copper` value saved from earlier in V65.0 still renders Classic (the attribute is no longer read from `localStorage` at all).

## V65.0 — Presentation mode fits the screen, field-name hover tag, animated header, icons (2026-09-24)

### Fixed
- **Presentation mode no longer overlaps chart and table at 100% zoom.** The panel is now exactly the size of the stage; legend, chart and table share it. The chart is redrawn with an aspect ratio that matches the free space (and re-fitted on window resize), the table gets at most 38% of the height and scrolls inside itself, the duplicated inner title/expand button is hidden, and the 6M Fishbone is fitted the same way.
- **Chart hover tooltip had no CSS at all**; it is now styled (dark pill, shown only on hover). Single-series charts also name the measure (e.g. "Qty (MT)").

### Added
- **Field-name hover tag:** a small tag follows the cursor and names the field: KPI parts (value, previous, change, status, targets), table columns and cells (column + row), filters and their options, legends, icon-only buttons. Turn it off/on from Ctrl+K.
- **"Copper Mill" theme (default) — header rebuilt to follow the reference video:** pale factory-bay scene with copper coils on the right, blue steel and copper ribbon waves flowing behind the text, a 3D logo (layered depth shadows, slow swing, a glint that sweeps across the logo shape only). "Last Updated" is a solid glass chip so the animation can never hide it. Separate light/dark treatments. GPU transforms only; off for reduced-motion and print; scene hides on narrow screens. Switch to the plain **Classic** header/intro from Ctrl+K (remembered).
- **Intro screen bug fixed:** the "QUALITY INTELLIGENCE" headline could break mid-word ("INTEL" / "LIGENCE") on narrow screens. Each word is now one unbreakable unit, so a line break can only ever fall between words.
- **Intro screen redesigned around the dashboard's own subject matter (copper coils + quality inspection), no live figures:** the background carries two coil renderings (a large rotating pair behind the logo, a coil "stack" lower-left), a faint "Cu 29" mark, and two watermark icons (a quality checkmark, an inspection gauge) — all decorative, never touching the text. Partway through the sequence a small panel shows an animated quality-inspection beat: a scan line sweeps across a coil cross-section, then a "QC SCAN PASSED" badge stamps in — illustrating what the dashboard does, without displaying any of its actual numbers. Sound design was extended to match: a very quiet ambient pad swells in for a cinematic feel (silent until the browser allows audio), a filtered sweep plays under the scan line, and a soft stamp thud + confirm chime land on the badge. All of it fades out when the dashboard is entered, is skipped for reduced-motion, and none of it appears in the Classic skin.
- **Icon set:** shared SVG sprite in index.html plus `qdIc()` helper in app.js. Icons added to Dashboard Filters, Compare Periods, Reset All, Selection, Saved Views, Save/Manage Presets, Export button and dialog, Commands, Search, Last Updated, drill-down, Compare view, Control Room summary strip and zone headings, presentation mode.

---

_Older entries (V64.9 and earlier) live in [CHANGELOG_ARCHIVE.md](CHANGELOG_ARCHIVE.md)._


## Chemistry SPC parity audit — no version bump (2026-09-30)

- Reconciled Chemistry SPC with the dashboard's shared KPI/chart interaction contracts: KPI typography inheritance, status/trend styling, 5° pointer tilt, sparkline treatment, refresh shimmer/pulse, chart-ready entry animation, point/bar hover behaviour, and global chart tooltips.
- Added a Chemistry selection summary and period-comparison banner so active Grade/Parameter/period/heat selection remains visible while scrolling.
- Moved the Individuals-chart legend above its SVG plot and added a consistent MR legend.
- Added the shared `chart-bar` semantics and value labels to non-empty Chemistry histogram bins.
- Kept statistical UCL/LCL out of the visible I/MR plot bounds; MR UCL remains a diagnostic flag only. Updated chart copy so it no longer claims visible control-limit lines.
- Added reduced-motion and keyboard interaction safeguards for Chemistry element cards and chart points/bars.
- Fixed the static Admin navigation contract to include the existing Chemistry Import and Chemistry Spec sections.
- Removed obsolete unused Chemistry card/layout CSS from the previous implementation.
- No database/schema/data-file changes. `quality.db` remains byte-for-byte unchanged. `VERSION.txt` remains `V66.1`.
