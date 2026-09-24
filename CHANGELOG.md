## V64.9 — Insight strip moved to Quality Control Room, KPI cards show percentage-point delta (2026-09-25)

### Changed
- **Insight strip relocated:** the "💡 Reject changed from X% to Y% (…)" one-liner introduced in V64.8 was showing on the Dashboard tab; it's now shown only on the Quality Control Room tab, placed right under the QCR header (above the Quality Health strip), where the rest of the "why did it change" analysis already lives. Same >5pp significance gate as before — still renders nothing when there's no real driver.
- **KPI cards now show the percentage-point delta alongside the existing percent change, for every percentage-valued KPI** (First Pass Yield %, Defect Rate, Reject % Qty, Hold for Decision % Qty, Salvage % Qty, Rework % Qty). Previously these cards only showed the *relative* change (e.g. Reject% moving 0.35%→0.44% displayed as a confusing "+25.7%"); now it reads "+25.7% (+0.09 pp)" — the pp figure is what actually matters operationally. Quantity/count KPIs (Total Coils, Output Quantity, Reject Qty (MT), etc.) are unaffected and continue to show only the relative % change, since a "percentage point" isn't a meaningful concept for a raw quantity.
- Sign and color coding on the new pp figure follow the same rules already in place for the rest of the card: the sign (+/−) reflects the raw numeric direction (value went up or down), and the color (green/red) reflects whether that direction is *good* for that specific KPI — a Reject% decrease shows green even though the number itself is negative, exactly as it already did for the existing percent figure. No frontend logic needed to change here; it was already direction-aware, the new pp number simply inherits it.

## V64.8 — KPI card depth + glass control layer + chart entrance + insight strip (2026-09-24)

Full pass on all three suggestion buckets from the "next level UI" ask — everything under Glass (A), 3D (B), and the new-direction bucket (C), not just a subset. No layout, data, or API changes.

### A — Glass
- **Consistent glass elevation-token system:** new shared tokens (`--glass-bg-1/2`, `--glass-blur-1/2`, `--glass-border`, light + dark variants) replace one-off hardcoded translucency values. Applied to the sticky filter bar, filter dropdown menus, the Save/Manage Presets popover, and a modal's own title strip (drill-down header, export dialog header) — deliberately *not* applied to table/chart bodies or dense modal content, where translucency would hurt legibility rather than help it. Fixes a real inconsistency along the way: dark-mode filters were solid/opaque while light-mode filters were already glass; both are glass now.
- **Status-tinted glow on hover:** KPI cards already had a status-colored ambient shadow at rest (green/amber/red/blue), but hovering reset every card to the same flat navy shadow, losing that signal at the exact moment you're looking closer. Hover now keeps the card's own status color and deepens the glow instead of flattening it — light and dark themes both.
- **Glass sheen sweep:** a soft one-time diagonal light streak crosses a KPI card on hover, reusing the existing `::after` flash layer.

### B — 3D
- **3D mouse-tilt on KPI cards:** cards tilt a few degrees toward the cursor (`rotateX`/`rotateY`, capped at 5°) via `--tiltX`/`--tiltY` custom properties updated on `mousemove`. Skipped automatically on touch devices (`pointer: fine` check) and when `prefers-reduced-motion` is set.
- **Count-up on first paint:** KPI values already animated a count-up when a filter/refresh changed them; they now also count up from 0 on the very first render of a page load, not just on subsequent changes.
- **Chart bars grow in on load:** bars now animate up from the baseline once per chart load/refresh (`scaleY` from the bottom), layered on top of the existing whole-panel fade-in. The refresh completion window that clears the animation class was extended from 350ms to 700ms so a 480ms bar-grow isn't cut off mid-animation.

### C — New direction
- **OLED-style dark mode:** deepened the dark theme's background/navy tokens from `#0B1220` toward a truer near-black `#070B14`, giving cards more contrast against the canvas — closer to how an actual 24/7 control-room monitor looks. Card, border, and text tokens are unchanged, so contrast ratios elsewhere are unaffected.
- **Telemetry-grid header, dark mode only:** a very low-opacity grid line texture behind the header's navy gradient, and a soft glow on the active tab — a plant-control-room cue instead of a generic flat header. Static (no motion), so no performance or accessibility cost.
- **"Why did this change" insight strip:** a new one-line banner above the KPI grid, populated from the same driver-analysis the QCR tab's existing (collapsed) "Why did it change?" accordion already computes server-side (`why_changed.statement`). Shown **only** when a real, significant driver was found (>5pp defect-mix shift — the same bar the backend already uses to decide whether a shift is worth flagging as a problem); otherwise the strip renders nothing and takes zero space, unlike a persistent always-on status row.

### Notes
- All of the above are additive CSS/JS changes to existing elements; nothing was restructured, renamed, or removed.
- `prefers-reduced-motion: reduce` disables the tilt, first-paint count-up, hover sheen sweep, and chart bar-grow; the status-glow hover, glass tokens, and OLED palette still apply since they're not motion.
- Sparklines remain removed per earlier feedback — not reintroduced here.

### Notes
- All of the above are additive CSS/JS changes to existing elements (`.kpi-card`, `header`, `.tab-btn.active`); nothing was restructured, renamed, or removed.
- `prefers-reduced-motion: reduce` disables the tilt, the first-paint count-up, and the hover sheen sweep; the status-glow hover and OLED palette still apply since they're not motion.
- Sparklines remain removed per earlier feedback — not reintroduced here.

## V64.7 — Follow-up: Data Status Strip removed, Manage Presets popover z-index fix (2026-09-23)

### Removed
- **Data Status Strip:** the compact `Data through: … • Last refreshed: … • Active filters: N • Comparing to: …` row added below the filter summary bar earlier in V64.7 has been removed per feedback. Its HTML block and dedicated CSS (`.data-status-strip`, `.dss-*`, light/dark theme rules) were deleted; the print-mode selector list was cleaned up to drop the now-nonexistent class. The JS that fed it (`statusDataThrough`/`statusLastRefreshed`/`statusActiveFilters`/`statusComparingTo` element updates) was already null-safe, so no other behavior changed.

### Fixed
- **Manage Presets popover hidden behind sticky controls:** the "Save Preset"/"Manage Presets" popover (`.view-popover`) had `z-index: 60`, well below the sticky filters/tabs bar (`z-index: 1000`–`9999`) that sits directly beneath it, so the sticky bar could render on top of and hide part of the popover. Raised the popover's `z-index` to `10050` so it always displays above the sticky controls while still staying below modal dialogs (Export, Command Palette, Compare, Drilldown).

### Notes
- No version bump — this stays **V64.7** since no version-drift or data/schema change is involved, only a UI element removal and a stacking-order fix.

## V64.7 — Data Status Strip, Import Column Mapping, named Saved Filter Presets (2026-09-23)

### Added
- **Data Status Strip:** a compact, always-visible row under the filter summary bar — `Data through: … • Last refreshed: … • Active filters: N • Comparing to: …` — so it's always obvious how current the numbers on screen are and what's narrowing them. Documented as a suggestion since V64.6's audit; now implemented. Reuses the existing freshness (`/api/data_freshness`), last-refreshed and active-filter-count signals rather than adding new polling.
- **Import column mapping:** the Monthly Data Import Wizard now reads the uploaded file's header row up front (new `/api/admin/import_headers` endpoint) and auto-matches it against the known fields. When a plant's export uses renamed headers and a required column (Heat No, Batch No, Insp Lot Date, Quality Decision) can't be auto-matched, a "Map your columns" step opens so the user points each field at the right column before Validate & Preview runs — instead of the import failing outright with a generic "column not found" error. Well-formed files that already auto-match are unaffected; the panel stays out of the way and is always available via "🧭 Map your columns" for a manual review.
- **Named, dropdown-managed filter presets:** "Save View"/"Manage Views" (which already stored the full filter combination, not just layout) now use an inline popover instead of browser `prompt()`/`alert()` dialogs — type a name and save, or open "Manage Presets" to load or delete any saved preset from a proper list. Same `qdash_saved_views` localStorage store, no migration needed.

### Changed
- Relabeled the filter-summary-bar buttons "Save View" → "Save Preset" and "Manage Views" → "Manage Presets" to match the above.

### Notes
- No database schema or seed data changed. `VERSION.txt` and the `server.py` fallback constant bumped together to keep runtime version reporting in sync (per the V64.6 fix for version drift).

## V64.6 — Deep webapp audit + live data/filter refresh hardening (2026-09-23)

### Fixed
- **Runtime version drift:** `VERSION.txt` and the server fallback are now aligned to `V64.6`, matching the dashboard/admin metadata and current release documentation.
- **Live filter freshness:** added a lightweight `/api/data_revision` probe driven by the existing committed `disposition_revision`. The open dashboard now checks it every 30 seconds while visible (and immediately when returning to the tab); when data changes, filter options refresh in place without rebuilding the whole toolbar, the global-search index is invalidated, and the active dashboard refreshes automatically.
- **Stale filter selections:** if an import/edit removes a currently selected filter value, the selection safely falls back to `All`, the URL state is updated, and the dashboard reloads against the new valid state.
- **Public connection-status leakage:** unauthenticated `/api/connection_status` failures now return a generic message instead of raw database/driver exception text. The detailed exception remains server-side under the response request id.
- **Brittle V64.6 regression:** the UI regression no longer expects one hard-coded `app.js` cache-buster value; the server now derives asset versions from file modification time, so the test validates the actual versioned asset contract instead.

### Verified
- Python syntax / compile checks: PASS
- Inline JavaScript syntax checks (`index.html`, `admin.html`): PASS
- V64.3 regression: PASS
- V64.5 targeted regression: PASS
- Unified `regression.py` (all 6 embedded suites): PASS
- Quarter/FY period comparison regression: PASS
- Deep regression + legacy regression + app smoke: PASS
- HTTP smoke, Admin UX, export acceptance: see audit release-gate results

### Notes
- Regression coverage is consolidated in the repository root `regression.py`; the six deleted legacy `regression_*.py` files are no longer required.
- The new live refresh only reacts to mutations that go through the app's existing disposition write paths, which already advance `disposition_revision` after commit. Direct external database writes that bypass the application will not change this runtime revision.
- No production seed/database files were modified.

## V64.6 — Export button converted to modal dialog (2026-09-23)

### Fixed
- **Export/controls overlap:** the header Export action no longer opens an anchored dropdown that can sit over the sticky filters area. Export now opens a centered modal dialog using the same backdrop/dialog interaction pattern as the Command Palette.

### Changed
- The header **⬇ Export** button is now an explicit dialog trigger (`aria-haspopup="dialog"`) and opens `#exportDialogModal`.
- The dialog provides four export choices: **Excel report**, **PDF report**, **PowerPoint report**, and **Raw data (CSV)**. These continue to call the existing `exportDashboard()` flow, so export generation and active-filter handling are unchanged.
- Added keyboard/accessibility behavior: initial focus moves into the dialog, `Tab` focus is contained within the dialog controls, `Esc` closes it, clicking the backdrop closes it, and focus is restored to the Export trigger after closing.
- The dialog is responsive and styled for both light and dark themes, with viewport-safe sizing on narrow screens.

### Unchanged
- No application-version bump: this remains **V64.6**.
- No export endpoint, report-generation, database, or filter/data logic was changed by this UI patch.
- The Command Palette remains the home for navigation, preferences, and other commands; export choices are intentionally kept in the dedicated Export dialog.

### Verification
- Checked the Export dialog in light and dark themes at desktop and narrow/mobile widths.
- Confirmed the dialog opens/closes cleanly, does not overlap the sticky filter controls, and restores focus to the Export button after dismissal.

## V64.6 — Follow-up: dark-mode color fix + Ctrl+E migration hint + orphaned-CSS lint (2026-09-23)

### Fixed
- **Quality Health "Why?" breakdown lost its red/green color-coding in dark mode.** `.qcr-health-reasons span` was swept into a large shared selector group used for QCR's "nested light card" pattern (root-cause paths, alert/repeat/contributor items, etc.), which set `color:var(--text)` — a neutral light color that, at higher specificity, silently overrode the `.negative`/`.positive` red/green from the light-theme rules. Removed it from that shared group and gave it its own dark-mode colors (`#F5A3A3` / `#8FE3B5`, matching the existing `kpi-target-item` dark convention) so the breakdown stays color-coded in both themes.

### Added
- **Ctrl+E migration hint.** Since last patch's removal of the `Ctrl+E` export shortcut (superseded by the header's "⬇ Export" button), pressing it now does nothing silently — anyone with old muscle memory would just be confused. It now shows a one-time toast ("Ctrl+E no longer exports — use the ⬇ Export button in the header instead"), remembered via `localStorage` so it doesn't repeat.
- **`code_health.py` now reports orphaned CSS classes** — selectors with no matching reference anywhere in `index.html`, `admin.html`, or `app.js`. This is exactly the class of bug behind the Quality Health "Why?" fix two patches back (dead `.qcr-health-score`/`.qcr-health-reasons` rules from a removed card silently colliding with a later feature that reused one of the class names) — report-only (warns, doesn't fail the build), same convention as the existing duplicate-selector check. Currently reports 68 pre-existing orphans repo-wide; none were touched in this patch, this only adds visibility going forward.
- Bumped `app.css` (`?v=69.4 → ?v=69.5`) and `app.js` (`?v=64.6.11 → ?v=64.6.12`) cache-busters.

### Unchanged
- No application-version bump: this remains **V64.6**.
- The 68 pre-existing orphaned classes the new lint check surfaces were not cleaned up in this patch — flagged for a future pass, not fixed here, to keep this change scoped to what was asked.

## V64.6 — Export duplication cleanup + Quality Health "Why?" readability fix (2026-09-23)

### Fixed
- **Duplicate export entry points removed.** The header's "⬇ Export" button/dropdown (added in the previous patch) was left running alongside two older, now-redundant paths to the exact same `exportDashboard()` calls: the Command Palette's four "Export Quality Report — …" entries and the global `Ctrl+E` keyboard shortcut. Both are now removed — the header button/dropdown is the one and only way to export. Updated the `?` keyboard-shortcuts toast, the Command Palette button's tooltip, and stale in-code comments (which still said "there are no export buttons" and "Ctrl+E") to match.
- **Quality Health "Why?" breakdown was rendering oversized, wrong-colored, and clipped.** Each reason row (e.g. "‑18.6 pts Defect Rate") sits inside `.qcr-exec-item` (the executive-strip card), and `.qcr-exec-item b`/`span` — rules meant for that card's big "51/100"-style KPI numbers — were unintentionally leaking into the popup: the bold label rendered at 20px in the heading color with `nowrap` + ellipsis truncation instead of the intended small red/green 13px text, which is why longer labels (e.g. "First Pass Yield") were getting cut off mid-word. Root cause was a **leftover, orphaned CSS block** (`.qcr-health`, `.qcr-health-score`, `.qcr-health-label`, `.qcr-confidence-note`, plus a second, conflicting `.qcr-health-reasons`/`span`/`b` definition) from an older standalone "Quality Health Score" card that no longer exists in the markup — the class names were reused for the current popup without removing the old rules, so both silently applied at once. Removed the dead block entirely and rewrote the popup's `span`/`b` styling with explicit, sufficiently specific overrides (font, color, `white-space:normal`) so rows always render small, bold, and in the correct red (negative) / green (positive) color, and wrap normally instead of truncating.
- **Popup could overflow/get cut off on narrow screens.** The "Why?" popup previously had a fixed `min-width:220px` while living inside a ~1/5-width (or, on mobile, half-width) executive-strip card — wider than its own container on small screens. Changed to `width:max-content;max-width:min(240px,80vw)` so it always sizes to its content and never exceeds the viewport.
- Bumped `app.css` (`?v=69.3 → ?v=69.4`) and `app.js` (`?v=64.6.10 → ?v=64.6.11`) cache-busters.

### Unchanged
- No application-version bump: this remains **V64.6**.
- No data logic or API changes; `exportDashboard()` and the export endpoints are untouched — only the redundant trigger paths were removed.

## V64.6 — Visible Export button + Compare Mode tablet view + Live Now pulse (2026-09-23)

### Investigated, no change made
- **`quality.db` in the repo:** checked before touching `.gitignore`. This is intentionally committed — it's the app's one-time bundled seed database (`_BUNDLED_SEED_DB` in `server.py`), copied once into the real persistent `DB_PATH` (outside the repo) on first run only; the existing `.gitignore` already has an explicit comment guarding it from being accidentally excluded. The `users` table in it is empty (no shipped credentials); `disposition` holds ~4,936 rows of seed/demo data. Gitignoring it would break first-run seeding, so left as-is.

### Added
- **Visible "⬇ Export" button in the header**, next to Commands — opens a small dropdown (Excel / PDF / PowerPoint / raw CSV), each calling the same `exportDashboard()` used by the Command Palette and `Ctrl+E`. Previously exports had no visible entry point at all; a first-time user had no way to discover the feature just by looking at the page.
- **Compare Mode now has a tablet-width fallback.** Below 900px there's no room for two full dashboards side-by-side, but between 551–900px there's enough height for them stacked top/bottom instead — each pane is still the same fully-interactive dashboard iframe, just arranged vertically. Only hidden outright below 550px, where there isn't reasonably enough room stacked either.
- **"Live Now" (Admin → Dashboard Activity) pulses briefly when its value actually changes** — a quick scale/color flash on the number itself, not a full re-render — so the independent 18s poll (added in the previous patch) is visible at a glance instead of requiring someone to stare at a static-looking number.

### Unchanged
- No application-version bump: this remains **V64.6**.
- No data logic or API changes; `exportDashboard()`, `/api/activity/live` and the export endpoints are all reused as-is, not modified.

## V64.6 — Live Now independent refresh + Last Updated as relative time (2026-09-23)

### Verified, no change needed
- **Dark mode vs. print/export:** confirmed the browser's native Print / "Print to PDF" (`Ctrl+P`) is the only path that runs `@media print`, and that block already forces the light palette even when the dashboard is in dark mode (`html[data-theme="dark"]` is overridden inside the `@media print` rule in `app.css`). The app's own **Export → PDF** (and Excel/PPT) feature is generated entirely server-side (`reports.py`, via matplotlib/reportlab/openpyxl) with a fixed navy/white branded style — it was never driven by the on-screen theme, so it was never at risk here either way. A manual OS/browser screenshot doesn't trigger any print media query, so it naturally captures whatever theme is on screen at the time, which is expected screenshot behavior rather than a bug.

### Changed
- **Admin → Dashboard Activity → "Live Now" now refreshes independently, every 18s**, instead of waiting on the shared 60s full-panel refresh. It's a second, lightweight `setInterval` that only calls `/api/activity/live` (the same tiny endpoint the dashboard's own heartbeat feeds) and updates just the `aLiveNow` stat — it does not touch the heavier `/api/activity` summary+tables query that the rest of the Activity panel (and the other 60s-polled panels) still use, so this doesn't add meaningful load. Runs only while the tab is visible and the Activity panel has actually been opened at least once.
- **Header "Last Updated" is now relative time** ("Just now", "12 min ago", "2 hr ago", falling back to the absolute date/time past 24h) instead of a second static date+time sitting next to the digital clock — the two blocks now read as distinct signals ("what time is it" vs. "how fresh is this data") rather than duplicating each other. The exact date/time is still available as a hover tooltip. It also now updates on every real data refresh (initial load and every filter change), not just once at page load as before, and ticks forward every 30s while the tab is visible.

### Unchanged
- No application-version bump: this remains **V64.6**.
- No HTML structure beyond the header's default placeholder text, no data logic, and no other CSS/JS was touched.

## V64.6 — Header clock cleanup + card elevation consistency (2026-09-23)

### Fixed
- **Header clock widget:** removed the redundant "Current Time" text label above the digital clock (the icon + live time already communicate this). Replaced the generic `▦` glyph with an inline calendar/clock SVG icon and re-colored its badge to the header's blue brand palette (`#2388C9 → #16324F`) instead of the previous off-palette purple-blue gradient. Position is unchanged: the clock stays directly above the Commands button in both themes.
- **Card/panel radius inconsistency:** `.kpi-card`, `.panel`, `.insights-panel`, `.qcr-hero` and `.filters` previously resolved to three different border-radius values at runtime (10px / 11px / 12px) because of overlapping legacy rules from earlier passes. All surface-level cards and panels now read from a single `--radius-card` token (12px), so corners are visually consistent across the dashboard. `.filter-menu` uses a distinct, intentionally smaller `--radius-menu` (10px) since it's a floating menu, not a card; `.drill-dialog` uses `--radius-modal` (16px) as the modal tier.
- **Card/panel shadow inconsistency:** replaced ~15 ad-hoc `box-shadow` values (different blur/spread/opacity combinations with no shared logic) with a small elevation scale: `--shadow-card`, `--shadow-card-hover`, `--shadow-sticky`, `--shadow-menu`, `--shadow-modal`.
- **Dark-mode shadow bug:** `.panel`, `.filters`, `.insights-panel` and `.filter-menu` had no dark-mode shadow override, so they rendered with a light, blue-tinted shadow (`rgba(15,42,74,…)`) on a near-black background in dark mode — barely visible and the wrong hue. Because the new shadow tokens are CSS custom properties re-declared inside `html[data-theme="dark"]`, every surface that uses them now automatically gets a correct dark shadow (`rgba(0,0,0,…)`) with no per-element override needed.
- **Dark-mode muted-text contrast:** raised `--muted` in dark mode from `#9AABC2` to `#A9B8CE` (contrast vs. the dark card background improves from ≈6.6:1 to ≈8.5:1, comfortably clearing WCAG AA for normal text and AAA for large text). This is the color used by the header kicker/sub-lines, KPI labels, table sub-text and other secondary copy throughout the app.
- Bumped the `app.css` cache-buster (`?v=68.9 → ?v=69.0`) so browsers pick up the updated stylesheet instead of a cached copy.

### Unchanged
- No application-version bump: this remains **V64.6**.
- No HTML structure, JS behavior, data logic, or non-card CSS (buttons, tabs, badges, dots, etc.) was touched.

## V64.6 — KPI stagger, toast cap, font fallback hardening (2026-09-23)

### Added
- **KPI card refresh stagger:** when the KPI grid re-renders, cards now animate in with a small ripple (0ms, 65ms, 130ms… up to 7 cards) instead of every card flashing/counting up at the exact same instant. Implemented via a `--kpi-stagger` CSS custom property set per-card in `renderKpis()`, referenced by the pulse/up/down/value/flash animations in `app.css` so the child `.value` text and the `::after` flash overlay stay in sync with the card's own entrance. Respects `prefers-reduced-motion` (stagger and animation both skipped).
- **Toast notification cap + scroll safety:** `.toast-host` now has `max-height:calc(100vh - 36px)` with `overflow-y:auto` (thin scrollbar) so a long burst of toasts scrolls within the viewport instead of silently overflowing past the bottom edge. `showToast()` also caps visible toasts at 4 — if a new one arrives while 4+ are already showing, the oldest is dismissed immediately instead of letting the stack grow unbounded (e.g. during a bulk export or a batch of failed rows).
- **Script-font fallback:** `.quality-intelligence-title` and the intro screen's headline used `'Allura', cursive` as their font stack. The bare `cursive` generic renders wildly differently across OS/browser combinations (confirmed while testing this patch: with the Google Fonts request blocked, the header title rendered in an unrelated serif face, not a script face). Fallback is now `'Allura','Brush Script MT',Georgia,'Times New Roman',serif` — a deliberate, predictable degradation instead of a generic keyword.
- Added `system-ui` into the three shared typography tokens (`--font-body`, `--font-display`, `--font-metric`) as a smoother, closer-to-native intermediate fallback before the hard-coded `Segoe UI`/`Arial` stack.
- Bumped `app.css` (`?v=69.0 → ?v=69.1`) and `app.js` (`?v=64.6.7 → ?v=64.6.8`) cache-busters.

### Checked, no change needed
- **Filter dropdown search:** already implemented (`.filter-search` input inside `.filter-menu`, filters the option list on every keystroke). No changes made here.
- **Google Fonts loading:** `display=swap` was already present on the Google Fonts request and a `preconnect` to `fonts.gstatic.com` (with `crossorigin`) was already in place — both are covered.

### Unchanged
- No application-version bump: this remains **V64.6**.
- No data logic, API calls, or non-listed CSS/JS was touched.

## V64.6 — Header alignment fix + Live Users moved to Admin (2026-09-23)

### Fixed
- **Header vertical misalignment:** `.executive-meta` (the "Last Updated" block + the clock/status/Commands cluster) used `align-items:center`. That was fine before the digital clock existed, when both sides were a single row of similar height — but once the clock stacked on top of the status row, the taller right-hand stack pushed "Last Updated" to float in the vertical middle instead of lining up with anything, which is what looked "upar-niche" / uneven. Changed to `align-items:flex-end` so "Last Updated" now bottom-aligns with the Live Data / Commands row exactly as it did before the clock was added, with the clock sitting cleanly above just that row. Verified at 1600px, 1300px (wrapped), 800px, and 650px in both themes.

### Changed
- **"NOW ACTIVE" moved out of the header, into Admin → Activity.** The header no longer shows the live active-user pill. The same real-time count (from `/api/activity/live`, the same endpoint the dashboard's own heartbeat feeds) now appears as a **"🟢 Live Now"** stat at the top of the Admin panel's existing **Dashboard Activity** section, alongside the other activity stats (Unique IPs, Active IPs Today, etc.) rather than as a separate one-off pill. The heartbeat itself (`sendLiveHeartbeat` / `startLiveUserTracking`) still runs from the main dashboard unchanged — only where the number is *displayed* changed, not how it's collected.
- Bumped `app.css` cache-buster (`?v=69.1 → ?v=69.2`).

### Unchanged
- No application-version bump: this remains **V64.6**.
- "LIVE DATA" pill and the Commands button stay in the header exactly as before.

### V64.6 — Current Time card (selected #3 design)
- Moved the current-time widget to the header top-right, directly above the Commands action.
- Added calendar-style date + live seconds clock in 12-hour AM/PM format.
- Added responsive light/dark styling for the selected card design.
## V64.6 — 12-hour clock + live header clock + time-display audit (2026-09-22)

### Fixed
- **12-hour time format across the UI:** visible date/time values in the Admin console now use `hh:mm AM/PM` (with seconds where the source timestamp is an operational event). Raw 24-hour server timestamp strings are no longer shown directly to users.
- **Server timestamp interpretation:** Admin display formatting now treats timezone-less database timestamps as UTC before converting them to the browser's local time, preventing the previous browser-local misinterpretation of SQLite/PostgreSQL server timestamps. Relative activity labels retain their friendly `just now / min ago / hr ago` form while their exact tooltip uses the same 12-hour format.
- **Live digital clock:** added a seconds-updating current-time clock to the right side of the main dashboard header. It updates once per second while the tab is visible and catches up immediately when the tab becomes visible again.
- **Admin shortcut bug:** the `R` keyboard shortcut now invokes the canonical loaded-panel refresh path instead of a legacy/non-existent refresh binding.
- **Admin version metadata:** static Admin HTML metadata is aligned to the runtime V64.6 version.

### Unchanged
- No application-version bump: this remains **V64.6**.
- Date-only fields remain date-only; only fields that carry a time are converted to 12-hour AM/PM display.
- Sorting, presentation mode, drill-down behavior, chart precision and analytics calculations are unchanged.

### Re-audit checkpoints
1. Main header clock shows `hh:mm:ss AM/PM` and advances every second.
2. Last Updated shows `DD Mon YYYY • hh:mm AM/PM`.
3. Admin Activity, Audit, Import History, Fishbone History, KPI History, Backups and operational timestamps no longer display 24-hour clock strings.
4. Admin server timestamps without an explicit timezone are parsed according to their source semantics (database timestamps as UTC; local compact backup/connection timestamps as local) before browser-local display conversion.
5. Admin `R` shortcut refreshes loaded panels and preserves the Records view state.
6. Runtime version stays V64.6 and asset cache-busters advance without a version bump.

### Verification
- `python3 regression.py` — PASS (all 6 embedded suites).
- Inline JavaScript syntax + clock/time-contract checks — PASS.
- `code_health.py`, `regression.py`, `smoke_test.py`, `http_smoke.py`, `admin_ux_audit.py`, `export_acceptance.py` — PASS.
- `export_stress.py` — PASS (Excel 3.40s, PDF 2.90s, PPTX 18.46s on the repository stress fixture).



## V64.6 — Full webapp re-audit + primary navigation patch (2026-09-22)

### Fixed
- **Primary dashboard tabs:** all main `.tabs > .tab-btn` controls now use the same blue-gradient visual family as table headers, with dedicated light/dark variants. QCR contribution sub-tabs remain unaffected by this rule.
- **Admin manual refresh regression:** a legacy `refreshBtn.onclick` assignment was overriding the V64.6 centralized lazy/loaded-panel refresh handler. The legacy all-panel request burst is removed.
- **Admin live refresh tracking:** Home, Data Quality, Records and Database Status are explicitly tracked from initial paint so the 60-second live refresh loop actually refreshes the intended overview panels.
- **Admin Records refresh UX:** manual loaded-panel refresh now preserves the current search query, date range, record-id filter and page offset instead of resetting the Records view.

### Full-audit result
- Re-ran Python/JavaScript syntax, code-health, deep regression, V64.3, V64.5, V64.6 UI regression, Admin UX, smoke, HTTP (47 routes), export acceptance and export stress. All checks passed.
- Export stress completed successfully: Excel 3.75s, PDF 3.04s, PPTX 17.42s on the repository stress fixture.
- No database seed files or application data were modified by this patch.

### UI suggestions (not implemented in this patch)
- Add a compact “data status” strip showing active filter count + data-through date + last refresh time.
- Add a user-selectable chart density/label mode for crowded analysis cards without changing the underlying values.
- Add a persistent “Reset view” affordance that resets filters, sorting and saved-view state together.
- Add table row density presets (Comfortable / Compact) with remembered preference.

### Re-audit checkpoints
1. Main tabs remain blue-gradient in light and dark themes; QCR sub-tabs remain separately styled.
2. Admin Refresh Loaded does not call the legacy all-panel list; it refreshes only already-loaded panels and preserves Records state.
3. The 60-second Admin loop refreshes Home/Data Quality/Records/Database Status after login and any subsequently opened live panel.
4. Sensitive Admin endpoints continue to enforce their documented server-side roles independent of UI visibility.


## V64.6 — Main Navigation & Admin Refresh Audit Patch (2026-09-22)

- Primary dashboard tabs now use the same family of blue-gradient treatment as table headers in both light and dark themes; QCR sub-tabs remain separately scoped.
- Fixed a manual Admin refresh override that was rebinding `refreshBtn` to the legacy all-panels request burst, bypassing the V64.6 lazy/loaded-panel refresh architecture.
- Initial live Admin panels are now explicitly tracked by the loaded-panel refresh loop, so the intended 60-second refresh actually covers Home, Data Quality, Records, and Database Status.
- Admin manual refresh preserves the current Records search/date/record-id/page state instead of unexpectedly resetting the Records view.
- Added V64.6 regression contracts for primary-tab gradient styling, cache-busting, refresh wiring, and loaded-panel freshness behavior.

# V64.6 — Dashboard card-heading polish follow-up

## Follow-up changes
- **Dashboard card headings:** applied the approved subtle navy/blue gradient treatment to card headings only in Dashboard, Work Center & Grade, Defect List, and Period Trend. The existing heading text/content is unchanged. A thin blue accent line, restrained shadow, and theme-aware gradients were added without changing the surrounding card layout.
- **Light + dark theme coverage:** the heading treatment has dedicated light/dark variants so text contrast, border, accent line and depth remain readable in both themes.
- **6M Fishbone → RCA table header:** explicitly locked to the same blue-gradient header palette used by dashboard tables in both themes, including matching border/text treatment.
- **Chart precision remains scoped:** only the Dashboard Decision Mix donut chart shows Qty (MT) and % values to exactly 3 decimal places. No other chart precision was changed.

## No version bump
- This is a visual follow-up on **V64.6**. `VERSION.txt` and runtime version metadata remain on V64.6; only the static CSS cache-buster is advanced so deployed browsers load the new styling.

## Re-audit checkpoints
1. Dashboard card headings keep the exact existing text and receive the subtle light-theme blue gradient + thin accent line + soft shadow.
2. Switch to dark theme and confirm the same heading treatment remains readable without changing card layout.
3. Work Center & Grade, Defect List and Period Trend use the same heading treatment; other QCR/Admin headings remain unaffected.
4. QCR → 6M Fishbone → RCA table header matches the dashboard table blue gradient in light and dark themes.
5. Decision Mix donut alone uses 3 decimal places for Qty/%; Pareto, Work Center, Grade, Intensity, Monthly and Period Trend charts keep their prior precision.

## Verification
- `python3 regression.py`
- V64.5 release-gate checks + HTML/JS syntax + Admin UX + HTTP + export acceptance/stress should be re-run before deployment.

---


## V64.6 — Follow-up precision/package correction

### Fixed
- **Decision Mix donut precision is now actually shipped:** the donut Qty (MT) values and percentage values use exactly 3 fractional digits in the center total, slice labels, and hover tooltips. `app.js` is explicitly included in this patch and its asset cache-buster is advanced so browsers cannot reuse the older V64.6 JS bundle.
- **Other charts remain unchanged:** Work Center, Grade, Defect/Pareto, Intensity and Period Trend chart formatters retain their existing V64.5 precision contracts.

### Deployment safety
- JS cache-buster advanced from `64.6` to `64.6.1`; CSS cache-buster advanced from `68.5` to `68.6`. Runtime/application version remains **V64.6**.

### UI polish
- **Numeric alignment:** dashboard, drill-down and RCA table numeric cells use tabular numerals for cleaner column alignment without changing values or rounding.
- Existing low-risk UI affordances are preserved: visible sort-state indicators, sticky filters, chart hover cues, and keyboard focus indicators.

### Re-audit checkpoints
1. Decision Mix donut: Qty and % labels/tooltips show 3 digits after the decimal point.
2. Non-donut charts: no formatter changes beyond the existing V64.5 contracts.
3. Table numeric columns align visually; displayed values remain unchanged.
4. Runtime/version remains **V64.6**; this is a follow-up patch, not a version bump.


# V64.5 — Admin audit fixes: freshness, performance, concurrency and security

## Fixed
- **Admin freshness was measuring the wrong thing.** `/api/admin/service_health` previously used `MAX(import_history.created_at, activity_log.created_at)`, so a steady stream of anonymous viewer heartbeats could keep an old dataset looking “fresh”. Freshness is now calculated from the latest non-empty `disposition.insp_lot_date`. The response exposes `latest_data_date`, `freshness_age_days`, `data_revision` and `data_changed_at`; `latest_activity` remains informational only.
- **Freshness UI could contradict the status.** The service-health chip previously displayed `latest_import || latest_activity` while the status used the maximum of both. The chip now displays the same source-date value used by the freshness calculation and explicitly labels it “Data through”. Unknown/no-data state is a warning rather than healthy.
- **Admin initial-load request fan-out was excessive.** Multiple historical `showAdmin()` wrappers delayed and fired secondary loader groups independently. These are now replaced by one central IntersectionObserver-based loader. Overview, Data Quality, Latest Records and Database status remain immediate; deeper sections load when first viewed.
- **Duplicate 60-second Admin polling was removed.** Activity/database/backups, production safety, ops monitoring, performance/recovery/command-center and V38 safety each had their own timers. V64.5 uses one central visible-page poll for already-open live monitoring sections.
- **Backup list parsing caused repeated CPU/IO work.** `/api/admin/backup/list` used to gzip-decompress, JSON-parse and integrity-check every retained backup on each call. It now caches derived metadata against a filename/size/mtime signature and invalidates the cache when backups are created or pruned.
- **Viewer heartbeat write frequency was too high.** Public heartbeat moved from every 20 seconds to every 30 seconds and only runs while the tab is visible. `/api/activity/live` now caches the active-user count briefly and uses a 90-second window. Heavy exports also default to a concurrency of 1 via `EXPORT_CONCURRENCY` unless explicitly overridden.
- **Admin Data Quality used multiple table scans.** The endpoint is now a conditional-aggregate query with one duplicate-group result query; duplicate correction remains a distinct-record metric.
- **Admin quality-record invalid-date investigation loaded the entire table into Python.** Invalid-date filtering now occurs in SQL. Duplicate-batch investigation uses a CTE rather than repeating the grouping expression in the returned rows query.
- **Admin Records repeatedly counted the full table.** The unfiltered `grand_total` is now briefly cached and invalidated by disposition writes.
- **Import Preview → Confirm could become stale.** An `app_state` revision now records the last disposition mutation. Preview stores the revision and Confirm rejects the operation if the dataset changed between the two steps.
- **Disabled users could retain existing sessions.** A shared `_revoke_user_sessions()` helper now invalidates all in-memory sessions for the affected user. Viewer session authentication also checks the session’s active flag.
- **Several sensitive GET endpoints relied on the broad `_is_admin()` role group.** Users, security session status, backup list/verify/download, and audit analytics/export now require the `admin` role server-side.
- **Admin Security fetched the same session-status endpoint twice.** The session table is now rendered directly from the primary security-status response.

## Runtime metadata
- Added idempotent `app_state(key,value)` schema entries for `disposition_revision` and `disposition_changed_at`. This table is runtime metadata and is intentionally excluded from backup snapshots.
- Inserts/updates, deletes, bulk deletes and backup restores advance the disposition revision inside the same transaction as the data mutation.

## Documentation / re-audit support
- `README.md` now documents the V64.5 behavior, Admin performance architecture, freshness semantics, security boundaries and exact re-audit checkpoints.
- `regression_v64_5.py` was added as a targeted regression check; it uses a temporary SQLite copy and never changes the repository seed database.
- The final V64.5 verification also re-ran legacy regression coverage, HTTP/Admin UX smoke checks, export acceptance, and the export stress fixture; all passed.
- `VERSION.txt` and the runtime version fallback were bumped to `V64.5`.

## Verification
- Python compile check: PASS
- Admin/index inline JavaScript syntax checks: PASS
- `regression_test.py`: PASS
- `smoke_test.py`: PASS
- `http_smoke.py`: PASS (47 routes/endpoints)
- `admin_ux_audit.py`: PASS (21 Admin sections)
- `export_acceptance.py`: PASS
- `regression_v64_5.py`: PASS

## Security research note
- Current dependency research did not justify an unsafe mass upgrade. The app does not accept arbitrary PPTX uploads; it generates PPTX files. A current upstream python-pptx security issue remains an upstream watch item, so this release documents it rather than claiming it is fixed in application code.

---

# Quality Disposition Dashboard — Changelog

Consolidated release/fix history for the current V64.5 release. Everything lives in
this one file now instead of separate `CHANGELOG_V*.md` files, to keep the repo
from accumulating a changelog file per release.

## V64.4

Release focus: admin console load time, and re-fixing/strengthening the chart and
theme polish that V64.3 claimed but had regressed or was too subtle to notice.

### Files changed
`server.py`, `app.js`, `app.css`, `admin.html`, `VERSION.txt`, `CHANGELOG.md`, `README.md`.

### Fixed
- **Admin console was slow to load / stayed slow.** `/api/admin/data_integrity`
  ran 8 separate `COUNT(*)` queries, each a full scan of `disposition` — and the
  admin UI called it *twice* on every login (`perf()`'s sibling `command()`
  re-fetched `db_performance` for no reason, and both fetched `data_integrity`)
  plus again every 60 seconds via the command-center poller for as long as the
  admin tab stayed open. It's now a single query using conditional aggregation,
  the duplicate `db_performance` fetch in `command()` is gone (it reuses
  `perf()`'s result), and the endpoint has a short response cache so rapid
  repeat calls don't re-scan the table. Also added a missing
  `activity_log(event_type, created_at)` index — the home/security/error-monitor
  panels all filter on `event_type` and had no index backing it.
- **Bar/donut hover feedback was missing**, despite V64.3's changelog listing it
  as done. No CSS for it ever existed — `.chart-bar`/`.chart-slice` classes are
  now applied to every bar and pie/donut shape, with a hover scale-up + opacity
  change (drilldown-on-click is unchanged).
- **Donut center "TOTAL" glow was present but too faint to read as a glow**
  (opacity capped at .16). Raised to .32 so the effect V64.3 described is
  actually visible.
- **KPI card corner accent was a flat status color**, not the gradient V64.3's
  changelog claimed. Each status (good/bad/amber/neutral) now uses a real
  top-to-bottom gradient.
- **Legend dots' gradient was a same-color opacity fade** (full color to 80%
  opacity), invisible at an 11px dot. Replaced with a visible light-to-dark
  sweep of the same chart color.
- **Dark mode table header and totals row didn't match.** `thead th` had a
  dark-mode override to flat navy, but `tfoot`/`tr.grand-total-row` had no dark
  override at all and kept the light theme's flat blue — so the header went
  dark while the totals row stayed blue, right next to each other in the same
  table. Both now share one blue gradient (also applied to the light-theme
  header/totals, matching the gradient treatment used elsewhere in the UI).

## V64.3

Release focus: full-application bug audit (server, dashboard, admin, exports, import/backup).

### Files changed
`server.py`, `app.js`, `app.css`, `admin.html`, `index.html` (version meta only), `periods.py`, `VERSION.txt`, `README.md`, `CHANGELOG.md`, `RELEASE_GATE.md`, `DELETE_THESE_FILES.txt`, plus new `regression_v64_3.py`. `quality.db` and `reports.py` are unchanged.

### Fixed
- **Double HTTP response:** `do_GET` used `if path == "/api/activity"` where an `elif` was required, so every normal route (`/`, `/api/kpis`, exports, ...) also wrote a second `404 not found` response after the real one.
- **HTTP 500 on malformed filters:** `compute_prev_filters` raised on labels such as `month=garbage`, `week=garbage`, `financial_year=junk`, `month=ALL`. It now returns "no comparison"; all routes share `_filters_from_qs()` which trims and treats any-case `all` as `All`.
- **Admin Data Quality Monitor:** UI read `missing_heat`, `invalid_weights`, `invalid_decisions` while the API returns `missing_heat_no`, `missing_weight`, `missing_decision`, `invalid_values`; those tiles always showed 0. "records require correction" was never populated.
- **False data-quality issues:** Defect Intensity is required only when a real defect is recorded; 2,838 `NO DEFECT` coils no longer count as issues (score 39.4% -> 96.9% on the bundled data; real gaps: 152 coils). Applies to the score, integrity check, issue drill-down and import preview. `invalid_values` is now counted once per record.
- **Drill-down:** one shared `_drilldown_where()` builds the filter for both totals and rows (`defect_category` totals previously disagreed with rows for `NO DEFECT`); invalid `page`/`page_size` fall back to defaults instead of HTTP 500.
- **Quarterly trend:** grouped by (financial year, quarter) so Q1 of two different years is never merged.
- **QCR executive strip:** trend arrow compared non-existent fields (`fpy`, `fpy_pct`) and always said "Stable"; it now uses `first_pass_yield_pct`. KPIs with no target or neutral direction are no longer counted as target breaches.
- **KPI targets:** reject NaN/infinite values and inverted bands.
- **CSV import:** Windows-1252 files (Excel "CSV (Comma delimited)") are decoded instead of failing.
- **Admin:** Database panel now loads at login; three 60-second pollers referenced a non-existent `#loginPanel`/`admin-authenticated` class and kept calling admin APIs while logged out; Security session list now includes `qa_manager`; viewer login clears failed-attempt counter on success.
- **Housekeeping:** `VERSION.txt` (was V64.0) now matches; `import uuid` no longer precedes the shebang; `periods.py` synced with `server.py` (it lacked the quarter/FY guard); saving a view no longer throws if browser storage is blocked.

### Also fixed (second pass)
- **Restoring a backup crashed** whenever it contained fishbone-import history: the `INSERT` listed 9 columns but supplied only 8 values (`imported_by` was silently dropped), so `_restore_backup_data` raised `Incorrect number of bindings supplied` and the whole restore rolled back.
- **Tab switching kept the old scroll position.** Scrolled down on one tab, then switching tabs (click, keyboard 1-5, or browser Back) reopened the new tab at the same scroll offset instead of the top. `activateTab()` now resets scroll to the top on every switch (Back/Forward still restore their own position, as expected).
- **KPI cards had a dead 76px gap** on the right: `.kpi-bottom` reserved a column for the sparkline, which is `display:none`. Removed the reserved column.
- **Admin danger buttons (Logout/Delete) were unreadable** on light theme: dark-red text on a crimson background. Text is now white.
- **`sfx.js` could fail to load** when browser storage is blocked (private browsing, locked-down profiles), silencing all UI sound feedback; `localStorage` calls are now wrapped in `try/catch`.
- Deleting a saved view no longer throws if browser storage is blocked.

### Fixed: Defect Intensity Breakdown chart had no hover/drill-down
The "Defect Intensity Breakdown — Coils & Quantity (MT)" chart (Dashboard
tab) was the only chart never wired for click-to-drill-down: its bars had
no `data-drill-category`/`data-drill-kind`, `wireChartDrilldown()` was never
called for it, and the click handler's `kind` switch had no `'intensity'`
branch at all — clicking a bar did nothing, and the server had no matching
drill-down filter to call even if it had. Its bars already used `data-tip`
so the hover tooltip worked; the missing piece was the click path. Fixed:
- `server.py`: new `intensity_category` drill-down metric in `_drilldown_where` — filters by `defect_intensity`, with `"WITHOUT INTENSITY"` mapped to a blank/NULL column value (matching how the chart's own totals are bucketed) rather than a literal string match.
- `app.js`: the chart's bars now carry `data-drill-category`/`data-drill-kind="intensity"`; `wireChartDrilldown('intensityChart','intensity')` is called; the click handler gained an `'intensity'` branch.
- `regression_v64_3.py`: new check asserting the drill-down count for `LIGHT` and `WITHOUT INTENSITY` matches the chart's own row counts.

### UI: styled custom tooltips (replacing the browser's native `<title>`)
Every chart shape (donut slices, bar/grouped-bar bars, Pareto bars and its
cumulative-% dots, line-chart dots) and every truncated axis/category label
carried a plain SVG `<title>` before this, which shows the OS's own unstyled
tooltip box after a browser-controlled delay. These are now a single shared
floating `<div class="chart-tooltip">`, styled to match the app's own card
design (background, border, shadow, theme-aware), positioned from the
pointer with `pointerover`/`pointermove`/`pointerout` delegated on
`document` — so a chart redraw (resize, filter change, tab switch) never
needs to re-wire a listener. Content moved from an SVG `<title>` child to a
plain-text `data-tip` attribute on the shape itself; `data-drill-category` /
`data-drill-kind` (the click-to-drill-down attributes) are untouched, so
hovering and clicking the same shape both still work as before.

### UI: subtle chart depth + refreshed fishbone diagram
- Donut, bar (horizontal/grouped), and Pareto charts now use a soft top-to-bottom gradient fill plus a low-opacity drop shadow instead of flat color chips — a restrained "lifted" look instead of flat paint, without a full 3D/bevel treatment (which distorts how donut/bar proportions read — a well-known data-viz readability problem).
- The 6M Fishbone diagram gets the same gradient/shadow treatment on its branch pills and defect head box, plus a faint fish-silhouette watermark behind the spine — purely decorative, sits behind the live data, adapts to light/dark theme, never affects layout or text.
- **Fixed while building this:** every chart's gradient/shadow used the *same* SVG element ids (e.g. `grad-118DFF`) keyed only by color. With several charts on one page, ids collide — the browser resolves `url(#id)` to whichever chart defined it *last* in the DOM, so the moment any one chart's container re-rendered (e.g. on a browser resize), other charts referencing that id could silently go transparent with no console error. Every chart instance now gets its own randomly-tagged id namespace, so charts can never collide. Verified with rects/fills enumerated across all 5 tabs before and after forced resize churn.

### UI: chart depth extended to KPI cards, tables, legends, badges, pills and buttons
CSS/JS-only follow-up to the chart depth work above (`app.css`, `app.js`); no backend, schema, or markup changes.
- **KPI cards:** the colored corner accent bar (`.kpi-card::before`, good/bad/amber/neutral) is now the same top-to-bottom gradient used on chart fills instead of a flat color.
- **Legend dots:** every chart's legend swatch (pie, bar, combo, Pareto) now echoes its bar/slice's own gradient via a shared `legendDotBg()` helper in `app.js`, instead of a flat color chip.
- **Donut center:** a very soft radial glow now sits behind the "TOTAL" / grand-total text inside the donut hole, echoing the same low-opacity depth used on the slices.
- **Table headers:** the base `th`, `tfoot`/Grand Total row, sortable-header hover state, the RCA table header, and the "What Changed?" compare-table header all use the same gradient treatment as the chart fills (previously flat).
- **Status pills/badges:** KPI trend badges (`.trend.good/.bad/.equal/.info`), the KPI status pill, and the Quality Control Room status pills (`.qcr-status`) now use a same-hue two-tone gradient instead of a single flat pastel — a shade-deepening gradient rather than an opacity fade, since fading a pale pastel toward transparent would wash the chip out against the card.
- **Toast notifications:** the colored left accent bar is now a gradient strip (a `::before`, the same technique as the KPI accent bar) instead of a flat `border-left-color`, which a plain CSS border can't render as a gradient.
- **Hover feedback on charts:** every drillable bar/slice (anything with `data-drill-category`) now gives a small opacity + scale hover response, respecting `prefers-reduced-motion`; the existing SVG drop-shadow filter is left untouched so it isn't silently replaced by a CSS `filter` on hover.
- **Live status/user-count pills:** the header's live indicator pill and the "N live users" pill now carry a very soft matching glow (`box-shadow`), and their dots gained a blurred glow (previously a hard-edged ring only), consistent in both light and dark theme.
- **Secondary buttons:** Export, Reset filters, Investigate/mini-investigate, and the drill-down panel's header/export buttons now lift slightly (`translateY(-1px)` + soft shadow) on hover, matching the lift the tab buttons already had; several of these previously had no hover feedback at all.
- **Empty states:** the "no data" icon now carries a soft drop-shadow glow instead of sitting flat.
- **Fixed while building this:** the Grand Total row / `tfoot` had no dark-theme override at all, so in dark mode it kept the light theme's flat blue background while the column header above it correctly switched to dark — the two are meant to match (they share the identical background in light theme). Dark mode now gives the Grand Total row/`tfoot` the same dark background as the header.

### Verification
Full `RELEASE_GATE.md` suite plus `regression_v64_3.py` (fails on pre-fix code, passes now). The bundled database is unchanged.

## V64.2

Release focus: Admin Control Center usability and navigation safety.

### Files changed in this Admin UX patch
- `admin.html` — runtime Admin navigation/scroll-sync implementation and structural section alignment.
- `admin_ux_audit.py` — non-destructive contract test for sidebar/content ordering, accessibility state, and scroll-sync hooks.
- `README.md` — current-build documentation updated with the V64.2 Admin UX scope and safety notes.
- `CHANGELOG.md` — this release note and the preserved historical release history.

### Data-preservation verification
- No application data file is included in this patch ZIP.
- No backend/data-layer file is included in this patch ZIP.
- The existing V64.1 audited baseline was used for hybrid regression testing.
- Bundled database SHA-256 remained `91003fed5e377967c78d4a61bf0266e3529dad7bc11b5b5f9aec1b7f0071020c`.

### Admin Control Center UX

### V64.2 follow-up fixes
- **Sidebar labels cut/truncated:** increased desktop sidebar width and fixed the legacy `.sidebar-link span` CSS selector that was unintentionally applying 28px icon sizing to the text span. Labels now use the available width and can wrap safely.
- **Removed the Admin top/global search bar:** removed its markup and dead keyboard/search handlers from the Admin console. Latest Records remains the dedicated record-search surface.
- **Tab-switch scroll-position bug:** replaced `scrollIntoView()` navigation with deterministic `window.scrollTo()` positioning so every sidebar tab opens at the fresh top of its own section. Mobile reserves the sticky sidebar height before positioning the target.
- **Shortcut cleanup:** removed the obsolete Ctrl/⌘+K search hint from Admin navigation because the Admin global search no longer exists; refresh/help shortcuts remain.
- **Mobile navigation overlap risk:** removed sticky positioning from the now-searchless Admin command bar so the sticky horizontal sidebar remains the only top navigation layer on small screens.
- **Current-section label clipping:** allowed the sidebar progress label to wrap instead of truncating with ellipsis.

### Follow-up verification
- Existing V64.1/V64.2 backend and database behavior remains outside this patch.
- Patch-level source contracts cover sidebar readability, absence of the Admin top search, and deterministic tab-jump behavior.
- The patch was prepared against the V64.1 audited baseline and contains only Admin UX/documentation/test files.

- Rebuilt the Admin sidebar as grouped, canonical navigation with 21 one-to-one section links.
- Added scroll-spy behavior: the active sidebar tab automatically follows the section currently in the viewport.
- Clicking a sidebar item smooth-scrolls to the matching section, updates `aria-current`, and keeps the active item visible in the sidebar.
- Added a current-section position indicator (`01 / 21`, etc.) to reduce orientation loss while scrolling.
- Added the previously un-navigated Import History panel to the sidebar.
- Reordered the Admin content sections to exactly match sidebar navigation order.
- Moved Overview production-health blocks inside Overview and KPI target history inside KPI Targets so navigation boundaries match the visible content.
- Added a non-destructive `admin_ux_audit.py` contract test for sidebar/content ordering, accessibility attributes, and scroll-sync hooks.
- No disposition-data schema, import, delete, restore, KPI-calculation, or backup behavior was changed by this UX release.

## V64.1

### Deep Audit & Maintenance

- Fixed admin record deep-links so Quality issues and Global Search open an exact `record_id` instead of using fuzzy text search.
- Fixed admin record-search errors so they render in the Records panel instead of the Login status area.
- Added strict `YYYY-MM-DD` validation, date-range ordering checks, and a bounded record-search query length.
- Added an inspection-date index for faster date-range diagnostics and guaranteed connection cleanup on exact-record lookup failures.
- Added served-app version injection so HTML asset/meta markers stay aligned with `VERSION.txt`.
- Added an isolated `deep_audit.py` release-gate covering version headers/meta, auth/CSRF, record ID lookup, date filters, and data-count integrity.
- Hardened XML parsing guidance with `defusedxml`; updated ReportLab and psycopg2-binary dependency floors to current security-maintenance lines.

## V27.1

# V27.1 — Stability & Security Maintenance Release

## Preserved exactly
- Existing `quality.db` data (4,936 disposition records)
- Existing filter keys and filter calculations
- Existing KPI calculations and 16 KPI cards
- Existing five dashboard tabs and their read-only data flows
- Existing QCR rendering and drill-down behavior

## Fixed / hardened
- Removed the hard-coded administrator password from `server.py`.
- Startup no longer deletes/resets the entire `users` table.
- `ADMIN_USERNAME` / `ADMIN_PASSWORD` are now environment-backed for new provisioning.
- Existing users, roles and passwords are preserved on startup.
- Fixed README credential documentation to match the V27.1 security model.
- Bumped frontend asset versions to `27.1` to prevent stale browser cache after deployment.
- Added a non-destructive smoke-test suite covering health, filters, 16 KPIs, QCR, core analysis endpoints and data-count integrity.

## Intentionally deferred
- Large backend/frontend module split (deferred to a separate refactor so current data/filter behavior remains untouched).
- Major CSS rewrite/design changes.
- New analytics/AI features.
- Database migration or schema redesign.

---

## V27.2

# V27.2 — Engineering Hardening

## Preserved
- Existing 4,936 disposition records.
- Existing KPI calculations and filter behavior.
- Existing 5-tab navigation and QCR payload logic.
- Existing import/export/admin workflows.

## Added
- Non-destructive HTTP regression suite covering core API endpoints and a real filter request.
- Data fingerprint check before/after regression tests to detect accidental mutation.
- Lightweight code-health gate for syntax, credential-pattern detection and CSS duplicate reporting.
- `X-Request-ID` response header for easier production troubleshooting.
- Security baseline documentation.

## Intentionally not changed
- Database schema/data model.
- KPI formulas.
- Filter/query semantics.
- QCR calculation logic.
- CSS cascade. Duplicate CSS selectors are reported for the next controlled cleanup rather than aggressively rewritten.

---

## V27.3

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

---

## V27.4

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

---

## V40

# V40 Final Clean Update

- Restored admin header to a clean white background with subtle border/shadow.
- Removed page-level horizontal overflow; responsive admin sections now fit the viewport.
- Preserved internal scrolling only for genuinely wide data tables.
- Switched the intro to the light visual only and removed the dark intro asset.
- Kept the existing intro CTA gate/background animation behavior.
- No application data or database records were changed.

---

## CHANGELOG_V46

# V46 — Intro fixes

## 1. Intro no longer goes blank after the video

Root cause was in the media asset, not the page code. The source clip
`quality_nonferrous_intro_light.mp4` was 10.0s long and its last ~1.0s washed the
whole composition out to white and then faded to black. The old script froze the
player on its "last visible frame", but that frame *was* the black one — so the
screen went dark the moment playback finished.

Fixes:

- The clip is re-encoded and trimmed to **8.70s**, dropping the wash-out/fade-to-black
  entirely (audio gets a 0.6s fade-out so the cut isn't abrupt). The final frame is now
  the fully composed end state: logo, QUALITY / TRACEABILITY / CONTINUOUS IMPROVEMENT,
  NON-FERROUS, the tagline, Cupronickel Division, QUALITY INTELLIGENCE, the QCR / RCA /
  DATA cards and the ENTER DASHBOARD button.
- New asset `quality_nonferrous_intro_endcard.png` — a pixel-exact copy of that final
  frame — is layered over the `<video>` and fades in the instant playback stops. Freezing
  no longer depends on the browser retaining a decoded frame, which is what made the
  behaviour inconsistent across browsers. It is also wired up as the `poster`, so there is
  no black flash on load and the composition still shows if autoplay is blocked outright.
- `.intro-stage` now creates its own stacking context (`z-index:1; isolation:isolate`) so
  the ambient glow, the two sweep lines and the drifting particles animate **above** the
  frozen end-card instead of being covered by it. Background motion continues; the video
  plays once and stops.
- Freeze is now driven by `timeupdate` (duration − 0.08s), with `ended`, `pause`, `error`
  and a duration-based timeout as fallbacks, so the end-card appears even if the clip
  stalls. The video never loops or restarts.

## 2. "Cupronickel Division" sat on top of the divider line

This was baked into the video frames, which is why earlier CSS-side attempts had no
effect. The orange rule was running straight through the text like a strike-through.

- The affected band is repaired at the frame level: the region is cleaned, the division
  name is re-rendered at its original size, colour and centre, and the orange rule is
  moved **below** it as a proper underline (y 352–355, x 490–790).
- The repair is composited into the video from 1.53s (matching when the rule originally
  appeared) through to the end, so it is correct during playback as well as on the
  frozen end-card.

## 3. Intro hint legibility

`CLICK ENTER DASHBOARD TO CONTINUE` was near-white. That was readable only because the
intro used to end on black; against the light composition it was invisible. It is now
dark slate, shifting to brand orange with a soft pulse once the video has stopped.

## Files touched

- `quality_nonferrous_intro_light.mp4` (re-encoded, 8.70s)
- `quality_nonferrous_intro_endcard.png` (new)
- `index.html` (intro styles, end-card markup, freeze logic)
- `server.py` (end-card added to the static asset allow-list)

---

# V46.1 — Deploy fix: port scan timeout

The build succeeded but the deploy was cancelled with
`Port scan timeout reached, no open ports detected`. The process was alive the whole
time — it just never got as far as binding a socket.

`main()` ran `_ensure_admin_schema()`, `_seed_postgres_if_empty()` and
`ensure_fast_indexes()` **before** constructing the server. Against an external Postgres
on a cold database that is not quick work: the seed inserts every historical row and
`CREATE INDEX` on a populated table takes real time. The host gave up waiting for a
listening port and cancelled the deploy long before any of it finished.

Changes:

- `main()` now binds and starts serving first. All schema/seed/index work moved into
  `_run_startup_tasks()`, which runs on a background thread. The port opens in about a
  second regardless of how slow the database is. Verified locally: healthy response at
  +2s on SQLite, and with a deliberately unreachable `DATABASE_URL` the port still opens
  immediately and the failure is logged instead of blocking the boot.
- Each startup task is individually wrapped, timed and logged, so a failure in one no
  longer stops the other two and the log shows exactly which step is slow.
- New `/healthz` (and `/readyz`) endpoint — first route checked, touches no database, no
  auth, no disk. Returns `{ok, ready, startup_error, backend}`. Wired up as Render's
  `healthCheckPath`.
- Startup logging is line-buffered and `PYTHONUNBUFFERED=1` is set in `render.yaml`.
  Previously stdout was buffered, which is why the failed deploy log showed no output
  from the app at all and a slow boot looked identical to a silent one.
- `render.yaml` gains an explicit `buildCommand`.

Note: the build log shows cp314 wheels, so the host is using Python 3.14 and ignoring
`runtime.txt` (which asks for 3.11.9). Everything installed and parses fine on 3.14, so
this is informational — but if you want the pinned version, set it in the service's
environment settings rather than `runtime.txt`.

---

## P0_FIXES

# P0 Fixes — Data-Preserving Release

This release closes the identified P0 reliability/data-safety issues without modifying any live database or bundled data.

## Fixed
- PostgreSQL uses a thread-safe `ThreadedConnectionPool` with locked lazy initialization.
- `/readyz` is now the deployment readiness gate; startup stays unready if schema/seed/index initialization fails. `/healthz` remains a process-liveness endpoint.
- Render health check points to `/readyz`.
- Imported period fields are checked against `INSP LOT DATE`; existing rows are not rewritten.
- Non-finite output weights (`NaN`, `Infinity`, `-Infinity`) are rejected.
- Backup restore is atomic and fail-closed: any restore component failure rolls back the complete restore instead of reporting success with partial data.
- KPI target restore is true snapshot replacement for that table (targets absent from the backup are removed inside the same transaction; failure rolls everything back).

## Data-safety note
No production database, user data, or existing backup was opened, rewritten, migrated, or deleted while producing this release. Validation was performed only against isolated temporary test databases/mocks.

---

## P0_REPAIR_V55

# P0 Repair — Backup Regression Fix

Release repair applied to the V54 P2 hardened build.

## Fixed
- Repaired the backup snapshot envelope mismatch that caused backup creation to fail with `KeyError: counts`.
- Backup snapshots now consistently include `backup_version`, `created_at`, `reason`, `database_backend`, `counts`, and all restore-required data sections.
- Timestamp/date values are converted to JSON-safe ISO strings during snapshot serialization.
- Backup list validation and restore compatibility were re-tested.

## Validation
- `server.py` Python syntax: PASS
- `reports.py` Python syntax: PASS
- `app.js` Node syntax: PASS
- Empty-schema SQLite backup creation: PASS
- Populated SQLite backup + restore smoke test: PASS
- No production PostgreSQL connection or live data was touched.

---

## P1_FIXES

# P1 Bug-Fix Release

This release is built on the P0-fixed package and keeps existing production data untouched.

## Data/KPI correctness
- Canonical validation now treats `INSP LOT DATE` as the source of truth for Month/Week/Quarter/Financial Year.
- Defect Intensity `NONE` is normalized for new records; filters treat blank and legacy literal `NONE` consistently.
- Trend period discovery respects active filters, preventing no-data periods from becoming false 0% observations.
- Quarter period-over-period comparison is disabled when FY is `All`, avoiding ambiguous cross-year comparisons.
- Historical KPI targets are resolved by effective date rather than always using the current target; report exports use the same historical targets.
- QCR forecast risk uses the configurable KPI target/warning/direction settings.
- Data-integrity checks now detect finite/non-positive weights, missing batch numbers, and legacy `NONE` intensity consistently.
- A normalized unique index protects non-empty BATCH NO values where no legacy duplicates exist; legacy duplicates are never deleted automatically.

## Backup/recovery
- Backup snapshots include KPI target history and import history.
- DB-native date/time values are serialized safely as ISO strings in backups.
- Restore remains atomic and fail-closed.
- Restore includes imported history sections and true snapshot replacement for KPI targets.
- Mutating admin workflows require a pre-change safety backup before writing live data.

## Security/export safety
- Main dashboard/QCR database-derived HTML/SVG values are escaped before insertion.
- CSV exports escape spreadsheet formula prefixes for text values.
- XLSX report text values are protected from formula injection.
- Viewer login uses the shared login-failure rate limiter.
- Client IP forwarding headers are only trusted when `TRUST_PROXY_HEADERS` is enabled.

## Audit/workflow consistency
- Single-record add, direct import, delete, KPI-target changes, Fishbone import, and Fishbone-alias changes now write activity/audit signals consistently and invalidate response caches where required.
- Direct import now records an `import_history` row.
- Delete returns `404` when the target record does not exist instead of reporting a successful zero-row deletion.

## Validation performed
- Python syntax check: PASS
- JavaScript syntax check: PASS
- Isolated P1 regression suite: PASS
- Atomic restore rollback test: PASS
- Normalized BATCH NO uniqueness test: PASS
- Backup JSON serialization test: PASS
- Spreadsheet formula-safety helper test: PASS
- Fresh local startup `/healthz`: PASS
- Fresh local startup `/readyz`: PASS

No production database or user data was modified while building or validating this release.

---

## P1_FIXES_V53

# V53.0 — P1 fixes

- Fixed PostgreSQL invalid-weight integrity SQL.
- Repaired Excel workbook save/return path and rejected empty workbooks.
- Hardened export filenames against CR/LF/header injection.
- Added spreadsheet-formula neutralization helper for CSV export paths.
- Hardened admin inline JavaScript arguments with JS-string escaping.
- HTML-escaped administrative inspection dates.
- Hardened fishbone inline handler arguments.
- Destructive fishbone/disposition imports now fail closed if the safety backup fails.
- Direct disposition imports now create import-history entries after successful mutation.
- Corrected malformed fishbone SVG label markup.
- No production database was accessed or modified.

---

## P1_FIXES_V56

# P1 Fixes — V56.0

## Fixed
1. Admin CSV export now uses the same spreadsheet-formula safety function as public CSV exports.
2. Activity-log retention is now actually invoked, with a five-minute cleanup interval and a 10,000-row bound.
3. The activity rate limiter was moved off the global POST path and is now scoped to `/api/activity/event` and `/api/activity/heartbeat`. Admin imports, KPI updates, backups and password actions are no longer accidentally throttled by activity traffic.
4. Disposition imports are serialized with a process lock; PostgreSQL also uses a transaction-scoped advisory lock and SQLite uses `BEGIN IMMEDIATE`, preventing concurrent imports from racing on new BATCH NO values.
5. Existing legacy duplicate BATCH NO groups are preserved; V56 does not delete or merge them.
6. `supabase_schema.sql` now reflects runtime columns/tables including `batch_no`, `ud_date`, `must_reset_password`, activity IP/visitor fields, audit trail, KPI history and Fishbone/RCA/style tables.
7. Release identity is unified at V56.0 (`APP_VERSION`, `VERSION.txt`, frontend asset query strings).
8. README now documents Render + external PostgreSQL as the canonical production path and removes stale `build_db.py` / bundled `quality.db` deployment instructions.

## Data-safety statement
No live/production PostgreSQL connection is used during build or tests. No existing application rows are deleted as part of these P1 fixes.

---

## P2_FIXES

# P2 Hardening — V52.0

Data-preserving maintenance release.

- Unified application release version to V52.0.
- Added thread-safe response/session/login state handling and bounded in-memory maps.
- Added cache invalidation on all known state-changing dashboard/admin paths.
- Made local backup writes atomic (temp file + fsync + os.replace).
- Added backup manifest metadata and backup-file integrity visibility.
- Added app-version response headers.
- Aligned static asset cache-busting with the release version.
- Bounded import preview memory and expired previews proactively.
- No production database was modified by this release build.

---

## P2_FIXES_V54

# V54.0 — P2 hardening

- Consistent backup snapshot helper using a single read transaction.
- Backup filename collision hardening.
- Activity-log retention cap and public activity endpoint rate limiting.
- Persistent server-error event recording for the admin error monitor.
- Render deployment now fails closed if DATABASE_URL is absent instead of silently using SQLite.
- Restore paths clear response cache.
- Added normalized BATCH NO lookup index for import performance.
- Fishbone full refresh clears obsolete style rows.
- Existing production data is preserved; no live database was accessed.

---

## P2_FIXES_V57

# V57.0 — P2 hardening

- Bounded the in-process response cache by both entry count and serialized payload bytes.
- Added an embedded SHA-256 integrity checksum to every new backup; V57 verifies it during listing, explicit verification, and restore. Pre-V57 backups remain structurally restoreable without a checksum.
- Serialized backup writers and retained atomic temp-file + fsync + replace behavior.
- Tightened activity-rate map cleanup to remove the oldest keys first.
- Added a large configurable audit-trail retention ceiling (`AUDIT_RETENTION_MAX`, default 100,000) so long-lived deployments do not grow audit storage without bound.
- Reject unsupported HTTP `Transfer-Encoding` bodies before body parsing; the app expects a bounded `Content-Length`.
- Kept existing P0 backup/restore rollback and P1 import-concurrency protections intact.
- Release/versioned static asset identity moved to V57.0.

These changes are data-preserving and were tested only against isolated local copies.

---

## V58_STABILITY

# V58 Stability Baseline

V58 does not introduce a new business-data model. It establishes a stable release baseline around the V57 P0/P1/P2 repairs and packages the regression checks used to prevent those fixes from regressing again.

Validated in isolated test databases:

- disposition insert/update/idempotency and concurrent import serialization
- KPI and analysis calculation smoke tests
- response-cache entry/byte ceilings
- activity-log retention ceiling
- backup creation, checksum verification, tamper detection, and restore
- input validation and CSV formula-injection protection
- health/readiness and 45 registered HTTP/admin read routes
- release/version consistency and shipped-artifact hygiene

The tests are intentionally isolated from production PostgreSQL.

---

## V59_FINAL

# V59.0 Final Stability Hardening

- Fixed admin inline JavaScript argument handling for usernames and defect names.
- Fixed quality-drill record button handler generation.
- Added HTML-attribute-safe JavaScript escaping helper.
- Preserved V58 P0/P1/P2 data-safety, backup, import-concurrency, and release-gate behavior.

---

## V60_FINAL_STABILITY_HARDENED

# V60.0 Final Stability Hardened

V60 is the post-V59 deep-audit release. It keeps the V59 regression and HTTP release gates and closes the remaining production-safety findings.

## Deep-audit fixes

- Render `ADMIN_USERNAME` / `ADMIN_PASSWORD` are provisioning-only. Once a matching database user exists, authentication uses the stored database password only.
- Import confirmation now takes a pre-change safety backup, matching direct import behavior.
- Record deletion now takes a pre-change safety backup.
- Fishbone alias create/update/delete now take pre-change safety backups.
- Backups now snapshot the full persistent application state: users, activity log, audit trail, fishbone import history, and existing quality/configuration tables.
- Backup validation checks section types/counts and validates the V4 full-state scope.
- Session dictionary reads/writes used by authentication/admin flows are synchronized with `SESSION_LOCK`.
- Proxy forwarding headers are untrusted by default; Render explicitly enables trusted proxy headers through `TRUST_PROXY_HEADERS=true`.
- Report filenames strip control characters, quotes, separators, and unsafe characters before entering `Content-Disposition`.

## Verification

- Deep regression suite: PASS
- 45-route HTTP smoke suite: PASS
- Admin inline JavaScript syntax checks: PASS
- App JS syntax check: PASS
- Python AST checks: PASS
- Backup integrity, tamper detection, full-state restore: PASS
- Concurrent import: PASS
- Environment-password authentication transition: PASS
- Report filename header-safety test: PASS

Production PostgreSQL was not modified during this audit.

---

## V61_EXPORT_HARDENING

# V61.0 Export Hardening

## Fixed export failure

Excel, PDF and PowerPoint reports previously rendered charts for every Work Center and Grade returned by the database. On high-cardinality data this could exhaust rendering resources and surface the generic “unexpectedly deep processing limit” error, while Raw Data CSV continued to work.

V61 bounds only rendered report elements: chart category count, trend points, PDF/PPTX tables, Excel presentation tables, and 6M/RCA presentation rows. The underlying database rows and Raw Data CSV export remain complete.

Heavy report exports default to one-at-a-time on small hosts. The global Python recursion limit is no longer raised to mask report-generation problems.

## Verification

- Excel export stress: 8,000 Work Centers + 8,000 Grades — PASS
- PDF export stress: 8,000 Work Centers + 8,000 Grades — PASS
- PowerPoint export stress: 8,000 Work Centers + 8,000 Grades — PASS
- Existing regression suite — PASS
- HTTP smoke suite — PASS

---

## V62_EXPORT_COMPLETE

# V62 Export Completeness

- Excel: complete underlying tables; visual charts remain bounded for readability/performance.
- PDF: complete tables paginate; matching chart appears with the start of each section.
- PowerPoint: complete tables paginate, and the matching chart(s) are repeated on every continuation slide, so every table chunk stays paired with its chart.
- No source rows are silently dropped from report tables.
- Raw CSV remains complete and unchanged.

---

## V62.1

# V62.1 — Header / Filter Toolbar Reorganization

## What changed
- **Reset All** moved out of the header and into the Dashboard Filters panel
  (`#filters`), next to the "Dashboard Filters" title and the active-filter
  count badge — it's a filter action, so it now lives with the filters.
- **Export buttons** (Quality Report • Excel / PDF / PPT, Raw Data • CSV) stay
  in the header, now right-aligned in the header toolbar row instead of being
  mixed in with the title/badge/reset button.

## Files touched
- `app.js` — `loadFilters()` now renders export buttons into
  `#headerFilterToolbar` and the title/badge/Reset All into `#filters`,
  instead of putting everything into the header. Element IDs and event
  listeners are unchanged.
- `app.css` — `.header-toolbar-row .filter-toolbar` switched from
  `justify-content:space-between` to `flex-end` (only the export actions live
  there now, so they should sit on the right).

## Preserved
- All export/reset functionality and behavior — only the markup location and
  alignment changed, not the IDs, handlers, or filter/export logic.

---

## V62.2

# V62.2 — Export RecursionError Fix + Header Branding Scale-Up

## Root cause of the recurring export failure
Every "This report hit an unexpectedly deep processing limit…" export failure
traced back to `_chart_png()`'s Pareto chart (the dual-axis defect chart used
in Excel/PDF/PPT exports). It combines `ax.twinx()` (for the Qty / Cumulative %
dual axis) with `fig.savefig(..., bbox_inches="tight")`. On matplotlib 3.8.x,
that combination can recurse deep enough — the recursion depth scales with the
number of distinct defect labels on the chart — to blow past Python's stack
limit with a genuine `RecursionError`, which is why a narrower filter (fewer
defect labels) "worked around" it and a broad/unfiltered report didn't.

## Fixed
- `reports.py` — dropped `bbox_inches="tight"` from both chart PNG savefig()
  calls (`_chart_png()` and `_fishbone_png()`). `fig.tight_layout()` already
  lays the figure out correctly; re-tightening at savefig() time was the
  actual recursion trigger, not merely something that needed a higher
  recursion limit or a smaller payload.
- `requirements.txt` — bumped `matplotlib` from `~=3.8.0` to `~=3.10.0` (a
  deliberate minor-version bump, not just a patch bump) as defense-in-depth.
  Stress-tested the exact Pareto-chart code path at up to 3,000 chart labels
  and 400 repeated chart renders in one process on 3.10.x with no recursion
  or slowdown.
- Existing recursion-safety scaffolding in `server.py` (raised recursion
  limit, larger thread stack, one-time capped-payload retry, and the
  diagnostic error response) is left in place as a general safety net for any
  other unrelated deep-recursion edge case — it's just no longer needed for
  this particular failure.

## Header branding scale-up
- `app.css` — the earlier header-height reduction shrank the logo and title
  text along with the header's own padding, which left the branding looking
  small/lost inside the header. Scaled the logo (58px, 42px on mobile) and
  every title/subtitle line back up together so the branding fills the
  header's footprint again, without the header itself growing tall.

## Preserved
- All export formats, filters, KPI/QCR calculations and chart appearance are
  otherwise unchanged — only the two `savefig()` calls and the matplotlib
  version changed on the backend; only sizing changed in the header.

---

## V62.3

# V62.3 — Dashboard Fishbone Cause Text Size

## What changed
- `app.js` — `buildFishboneSvg()` (the true Ishikawa diagram on the Dashboard
  tab): cause-label font size raised from 12.5px to 14px (fallback minimum
  8.5px → 9.5px to match), and the vertical spacing between causes along
  each of the 6 bones (`ROW_GAP`) increased from 48 to 56 so the now-larger,
  still auto-wrapping text has enough room and doesn't overlap a neighboring
  cause. The diagram's existing auto-wrap/auto-shrink logic (`fbFitBox`) is
  untouched — a long cause still wraps onto up to 3 lines, and only shrinks
  toward the (now slightly higher) minimum font size on the rare cause that
  still won't fit, so nothing gets visually cut off.

## Preserved
- QCR tab's card-grid fishbone layout (a separate function) is unchanged —
  this was a Dashboard-tab-only request.
- Cause data, matching logic, RCA table, and every other diagram element
  (spine, head box, branch color/icon boxes) are unchanged.

---

## V62.4

# V62.4 — Site-Wide Sound Effects

## What changed
- Added `sfx.js`: a small, self-contained sound-effect engine. Every sound is
  synthesized on the fly with the Web Audio API (short tones through a
  gentle low-pass filter) — there are no audio files to host or download,
  so it loads instantly and works offline.
- One delegated click/change listener (in `sfx.js` itself) covers the whole
  app instead of wiring every button by hand, since both the dashboard and
  admin panel build most of their buttons dynamically. Different UI
  conditions get audibly different sounds:
  - `click` — a generic secondary button/link
  - `confirm` — a primary/submit button (Save, Login, the export buttons)
  - `select` — picking a filter option, a fishbone-defect chip, a native
    `<select>` value, or a checkbox/radio
  - `open` / `close` — opening a filter dropdown or a file picker
  - `tab` — switching dashboard tabs or admin sidebar sections
  - `toggle` — the dark-mode and sound-mute buttons
  - `success` — an admin action's `setMsg(..., 'ok')` result
  - `error` — an admin action's `setMsg(..., 'err')` result
  - `warning` — Reset All, Delete, Logout and other destructive actions
  - `notify` — the app's existing `alert()` calls (wrapped, not rewritten)
- Added a small 🔊/🔈 mute button next to the existing dark-mode toggle in
  both `index.html` and `admin.html`. The on/off preference is remembered in
  `localStorage`, independent of the dark-mode preference.
- `server.py` — added `/sfx.js` to the same versioned-static-asset route
  `/app.js` already uses (this server has no generic static-file handler;
  every servable path is explicit), so the new file is actually reachable.
- `admin.html` — its shared `setMsg(id, text, kind)` helper (used by every
  admin panel for its inline success/error messages) now also plays the
  matching sound, so real success/failure outcomes are covered, not just
  the click that triggered them.

## Preserved
- No existing click handler, export, filter, or admin workflow logic was
  touched — the listener only *observes* clicks/changes to play a sound; it
  never calls `preventDefault()` or otherwise intercepts the interaction.
- Sound is on by default but fully mutable per browser/device; muting is
  remembered across visits.

---

## V62.5

# V62.5 — Dark Mode: Charts, 6M Fishbone, and Admin Panels

## Root causes found
- **Charts (Dashboard/QCR/all analysis tabs) stayed on a white card in dark
  mode.** Every chart-building function in `app.js` draws its own inline SVG
  (pie, bar, horizontal bar, grouped bar, line, combo/Pareto) with axis text,
  gridlines and baselines as hardcoded hex colors tuned for a white
  background. A previous pass deliberately left the chart card forced white
  in dark mode as a workaround, since re-theming the card alone would have
  made that baked-in dark navy text invisible.
- **QCR tab's 6M Fishbone was "pura white" in dark mode.** Its container
  (`#qcrFishboneDiagram`) was being force-set to `background:#fff !important`
  by that same old workaround, and several of its own elements (cause list
  text, "no cause on file" text, the spine caption, the note banner's text/
  border) had no dark-mode color at all.
- **Some Admin tabs stayed white in dark mode.** Admin has two separate CSS
  variable families: `--card`/`--text`/`--border` (redefined for dark mode
  already) and a second one — `--admin-surface`, `--admin-surface-2`,
  `--admin-heading`, `--admin-line`, `--admin-accent` — used by the Command
  Center, Recovery Center, activity timeline, health-score/notification
  cards, and the KPI import-diff preview. That second family was **never
  redefined for dark mode**, so every panel built from it stayed on its
  light default regardless of theme, while panels using the first family
  correctly went dark — hence only *some* tabs looking broken.

## Fixed
- `app.css` — added a `--chart-*` variable set (axis text, gridlines,
  baseline, marker halo) and an `--fb-*` set (Ishikawa spine/head/cause
  text) to `:root`, with dark-mode-legible values redefined under
  `html[data-theme="dark"]`. Light-mode values are identical to the old
  hardcoded hex, so light mode is pixel-for-pixel unchanged.
- `app.js` — every chart function (`makePieChart`, `makeBarChart`,
  `makeHBarChart`, `makeHGroupedBarChart`, `makeGroupedBarChart`,
  `makeLineChart`, `makeComboChart`, the axis-title helpers) and
  `buildFishboneSvg` (the Dashboard tab's true Ishikawa diagram) now read
  those variables instead of hardcoded hex for every "chrome" element —
  never the data bar/slice/line colors, which already read fine on both
  themes.
- `app.css` — removed the forced-white override on `.chart-scroll`,
  `#dashFishboneDiagram` and `#qcrFishboneDiagram`; they now go properly
  dark like every other card. Added the missing dark colors for
  `.qcr-fb-ul li`, `.qcr-fb-empty`, `.qcr-fb-spine` (+ its border and pill),
  `.qcr-fb-note`, `.qcr-fishbone-chip`, `.qcr-rca-chain` and `.legend`.
- `admin.html` — redefined `--admin-surface`, `--admin-surface-2`,
  `--admin-heading`, `--admin-line`, `--admin-accent` inside the existing
  dark-mode block, fixing the Command Center, Recovery Center, activity
  timeline, health-score/notification cards and import-diff preview in one
  change. Also added explicit dark colors for the handful of elements that
  don't use either variable family at all: `.admin-sidebar`, `.sidebar-link`
  (default/hover/active), `kbd`, `.shortcut-key`, `.activity-icon`,
  `.notify-count`, `.v29-alert.warn`/`.bad` borders, and `.diff-changes
  span`. The Command Center health ring's progress-track color is set via
  inline JS (can't be reached by CSS), so it now picks a dark-safe track
  color when `data-theme="dark"` is active.

## Preserved
- Light mode is visually unchanged everywhere — every new dark value is
  additive, gated behind `html[data-theme="dark"]`.
- No chart data, KPI/QCR calculation, or admin workflow logic was touched;
  only which color each existing SVG/HTML element draws with in dark mode.

---

## V62.6

# V62.6 — Light Mode Is Always the Default

## What changed
- `index.html` and `admin.html` — the pre-paint theme bootstrap no longer
  falls back to the OS's `prefers-color-scheme: dark` when there's no saved
  preference. A first-time visitor now always lands on light mode, even on
  a device set to dark mode at the OS level. Dark mode only activates once
  someone explicitly clicks the 🌙 toggle — from then on their choice is
  remembered in `localStorage` (`qdash_theme`) exactly as before.

## Preserved
- The toggle button, its icon/label sync, and the saved-preference
  persistence are all unchanged — this only removes the *system* fallback
  used when nothing has been saved yet.

---

## V62.7

# V62.7 — Intro Screen: Text/Sound Sync Fix

## Root cause
The intro's text reveal and its procedurally-generated sound cues were
driven by two different clocks that could drift apart:
- **Visuals** (`show()`, revealing each letter/line/card) run off plain
  `setTimeout` delays — not perfectly precise; the browser can be a little
  busy right at page load (fonts, other scripts still loading).
- **Audio** was scheduled all at once, up front, as one absolute Web Audio
  timeline (`audioBase + when/1000` for every cue) computed before any of
  the `setTimeout`s had even started firing.

Two separate problems came from this:
1. If a `setTimeout` fired a few ms late (page busy), that visual reveal
   drifted out of step with its already-fixed audio cue.
2. More significantly: a fresh page load has had **no user gesture yet**,
   so the browser's autoplay policy starts the `AudioContext` in a
   `"suspended"` state. `AudioContext.currentTime` does not advance while
   suspended, so every cue scheduled during that window landed at
   essentially the same frozen instant — and only actually played once the
   context resumed (typically when the person finally clicks something,
   often the "Enter Dashboard" button at the very end). By then the text
   had long since finished appearing, and the sound would land late.

## Fixed (`index.html`, intro script)
- Every tone/whoosh/chime is now scheduled with a freshly-read `now()`
  (`ctx.currentTime`, read at the exact moment its `setTimeout` callback
  actually runs) instead of a precomputed future point on a single timeline
  set up in advance. A delayed visual and its sound are now the same
  event, so they can no longer drift apart from each other.
- `tone()` and `whoosh()` now check `ctx.state === 'running'` before
  scheduling anything. If the context is still suspended (no gesture yet),
  that one cue is silently skipped instead of sitting queued to fire late —
  so a not-yet-interacted-with intro plays its visuals with no delayed/
  out-of-sync sound catching up afterwards, rather than a mistimed one.

## Preserved
- The intro's visual timing, letter-by-letter reveal, and overall pacing are
  completely unchanged — only how (and whether) each accompanying sound
  cue gets scheduled.

---

## V62.8

# V62.8 — Intro "QUALITY INTELLIGENCE" Now Matches the Header Font

## What changed
- `index.html` — the intro screen's "QUALITY INTELLIGENCE" headline used a
  bold sans-serif font (`'Sora'`), different from the header's own
  "QUALITY INTELLIGENCE" title, which is set in the script font `'Allura'`
  (see `.quality-intelligence-title` in `app.css`). Switched the intro's
  headline to the same `'Allura'` cursive font, sized up (script fonts read
  smaller at the same point size than a bold sans) and given the header's
  same soft two-tone text-shadow (a thin dark offset plus a light highlight)
  instead of the old harder drop-shadow, so it reads as the same brand
  wordmark in both places. `Allura` was already being loaded (it's in the
  page's Google Fonts link, used by the header), so nothing new to load.
- Colors were already identical between the two (red "QUALITY" / blue
  "INTELLIGENCE") — only the font, size, weight and shadow style changed.

## Preserved
- The letter-by-letter reveal animation and its timing/sound cues are
  untouched — each letter is still its own `<span>`, just rendered in the
  new font.

---

## V62.9

# V62.9 — The Real Reason Dark Mode Looked Broken: Stale Cached CSS/JS

## Root cause
`/app.css` and `/app.js` are served with `Cache-Control: public,
max-age=31536000, immutable` — a full year, never revalidated — which is
exactly what makes the dashboard load instantly on repeat visits. The
cache-busting for that is the `?v=61.0` query string linked from
`index.html`. Every dark-mode fix since V62.5 (charts, the QCR 6M
fishbone/RCA table, admin panels) was made correctly in `app.css`/`app.js`
on disk — but **`?v=61.0` was never bumped**, so any browser that had
already loaded this dashboard before kept using its year-old cached copy of
`app.css`/`app.js` forever, completely unaware the file on the server had
changed. That's exactly why it looked "kahin dark, kahin white" — the HTML
itself is never cached (`Cache-Control: no-store`) so it always reflected
the latest markup, but the CSS/JS actually painting the colors was stuck on
a much older version underneath it.

## Fixed
- `index.html` — bumped `/app.css` and `/app.js` to `?v=63.0`, forcing every
  browser to fetch the current files at least this once.
- `server.py` — added `_asset_version()`/`_inject_asset_versions()`: when
  serving `index.html` or `admin.html`, the server now rewrites every
  `/app.css`, `/app.js` and `/sfx.js` reference to carry that file's actual
  on-disk last-modified time as its `?v=`, regardless of whatever version
  string is hardcoded in the HTML source. This is the permanent fix —
  correctness no longer depends on remembering to bump a number by hand
  every time one of these three files changes; it's now automatic on every
  deploy.

## Preserved
- The one-year immutable caching itself (what makes repeat visits fast) is
  unchanged — only how the cache gets busted when the file actually changes.

---

## V63.0

# V63.0 — UI Improvements: Breadcrumbs, Compare-to-Previous, Toasts, Export Spinner, Contrast Fixes

## Drill-down breadcrumb ("You are here")
- `index.html`/`app.js` — the drill-down modal (defect → records → Heat
  detail) now keeps a real stack (`drillStack`) instead of one flat state
  that got overwritten every time you went one level deeper. A breadcrumb
  bar appears once there are 2+ levels (e.g. "Defect: Casting Mark ›
  Heat H12345"), each earlier crumb is clickable to jump straight back to
  it, and it stays hidden entirely at a single level so it never clutters
  the common case. `openDrilldown()` still starts a fresh trail (for a new
  chart click); the new `pushDrilldown()` is used for the "go one level
  deeper" case (the Heat No. link inside the records table).

## Chart "compare to previous period"
- `app.js`/`index.html` — added a "Compare to previous period" checkbox
  above the Monthly Quality Trend chart. When on, each of the three metric
  lines gets a second, dashed/lighter line built from the same data already
  on hand (each point shifted back one month), so the gap between the solid
  and dashed line at any given month reads directly as "how much did this
  move since last month" — no extra API call needed. `makeLineChart()` now
  supports a per-series `dashed:true` flag (dash pattern, lighter opacity,
  no dot/value clutter) for this and any future overlay series.

## Friendly empty states
- `app.js`/`app.css` — every chart's "No data to display" and the
  drill-down's "no records" state now render through one shared
  `emptyStateMarkup()` helper: a soft dashed-circle icon plus a title and a
  short, actionable sub-line ("Try widening the date range or clearing a
  filter") instead of a single bare sentence.

## Export button progress + toast notifications
- `app.js` — the four export buttons (Excel/PDF/PPT/CSV) now use
  `fetch()` + a blob download instead of a bare `location.href` redirect.
  This does two things at once: the button shows a spinner and "Generating…"
  the whole time the file is being built, and — because the request now has
  a real success/failure result — a toast notification confirms it
  ("Export ready — filename.xlsx has finished downloading") or explains
  what went wrong, instead of a silent click with no feedback either way.
- Added a small, reusable `showToast(kind, title, message)` (`app.js`) and
  its styling (`app.css`): a top-right stack of auto-dismissing cards for
  success/error/info, independent of sfx.js's sound cues — so someone with
  sound muted still gets a clear visual confirmation.

## Admin: relative "X min ago" timestamps
- `admin.html` — the Dashboard Activity timeline and the per-IP "Last Seen"
  column showed a frozen, literal date/time string. Added `timeAgo()` plus
  a `data-ts`-driven `setInterval` (every 30s) that keeps every timestamp
  reading "just now" → "2 min ago" → "1 hr ago" → "3d ago" as time passes,
  with no page reload and no extra API calls — it's purely re-formatting a
  timestamp the page already has.
- (Checked, already in place: sidebar links and Command Center cards both
  already call `scrollIntoView({behavior:'smooth',block:'start'})` on
  switch — no change needed there.)

## Accessibility: WCAG AA contrast pass
- Ran every dark-mode text/background color pair introduced across the
  recent dark-mode work through the WCAG contrast formula — all pass AA
  (4.5:1) for normal text, several comfortably (7:1+).
- Found and fixed a **pre-existing, theme-independent** gap: `--muted`
  (`app.css`, light mode) was `#6b7c93` on white — 4.26:1, just under the
  4.5:1 AA minimum for normal text — used everywhere from chart axis labels
  to the new toast/empty-state sub-text. Darkened it to `#5b6c82` (5.37:1).
  Found and fixed the same issue in `admin.html`'s separate `--muted`
  (`#718096` → `#5c6b7d`, 4.02:1 → 5.45:1). Both are CSS variables, so this
  one change corrects contrast everywhere they're used, in both files.

## Preserved
- All existing chart/table/export/admin data and calculations are
  untouched — this batch is presentation and feedback only.

---

## V63.1

# V63.1 — Desktop Power-User Features, Batch 1: URL State, Keyboard Shortcuts, Table Sort

## URL reflects tab + filters
- `app.js` — the active tab and every non-"All" filter now show up in the
  address bar (e.g. `?tab=wcgrade&work_center=WC-12`). Filter changes use
  `history.replaceState` (no extra back-button stop per click); switching
  tabs uses `history.pushState` (each tab is its own back/forward stop).
  A `popstate` listener restores whichever tab+filters that history entry
  represents, and `init()` now reads the URL on first load — so a
  bookmarked or pasted link opens straight into that exact view instead of
  always starting blank. "Save current view" now goes through the same
  `syncFilterUiFromState()` used for this, instead of its own copy of that
  DOM-sync logic.

## Keyboard shortcuts
- `app.js`/`index.html` — `/` focuses the global search box, `1`–`5` switch
  tabs, `Ctrl+E` (`Cmd+E` on Mac) triggers the Excel export, and `?` shows a
  toast listing them. All are disabled while typing in any input/textarea/
  select/contenteditable, so normal typing is never hijacked. A small `/`
  key-cap hint sits inside the search box (hidden on narrow/mobile widths —
  these are desktop-only shortcuts).

## Click-to-sort tables
- `app.js`/`app.css` — every data table (Decision, Defect, Work Center,
  Grade, Monthly/Weekly/Quarterly/Yearly Trend, Defect Register, Defect
  Intensity — 10 in total) now sorts by clicking a column header, with an
  ↑/↓ arrow indicator and keyboard support (Enter/Space on a focused
  header). The Grand Total row always stays pinned at the bottom regardless
  of sort. The chosen sort is remembered per table and re-applied
  automatically after a filter change refreshes that table's rows, instead
  of silently reverting to server order.

## Preserved
- No calculation, filter, or export logic changed — this batch only adds
  navigation/interaction affordances on top of existing data flows.

---

## V63.2

# V63.2 — Desktop Power-User Features, Batch 2

## Wide/ultra-wide layout
- `app.css` — above ~1700px width the container/header widen and the KPI
  grid adds a 5th column; above ~2100px a 6th. Below that, layout is
  unchanged (the existing 1480px cap already used normal desktop widths
  well) — this only kicks in once there's real spare width to use.

## Resizable/draggable drill-down modal
- `index.html`/`app.js`/`app.css` — the drill-down dialog can now be
  dragged by its header (like a real window) and resized from a
  bottom-right handle, with sensible min-width/min-height. Resets back to
  its default centered size the next time it's opened.

## Print support (Ctrl+P)
- `app.css` — a `@media print` stylesheet hides the header, tabs, filters,
  search box, toasts, buttons and toggles, forces light colors even in
  dark mode, and adds page-break hints so a chart/table/card isn't sliced
  across two pages — for handing someone a report straight from the
  browser's own print/Save-as-PDF.

## Admin: drag-and-drop file upload
- `admin.html` — the monthly-data and 6M-fishbone-master upload boxes now
  accept a file dragged straight from File Explorer/Finder, in addition to
  the existing click-to-browse. Drops fill the same `<input type="file">`,
  so every existing validation/preview flow needs no changes at all.

## Admin: bulk delete + Shift+click range-select
- `server.py` — added `/api/admin/bulk_delete`: one safety backup and one
  transaction for the whole batch, instead of what a naive loop over the
  single-record delete endpoint would do (one full database backup file
  per record — slow and wasteful for a multi-select).
- `admin.html` — added a "🗑 Delete Selected" button next to the existing
  "Export Selected" (which was already there), plus Shift+click a row
  checkbox to select every row between it and the last one clicked.

## Side-by-side compare mode
- `index.html`/`app.js`/`app.css` — a new "⊞ Compare Periods" button opens
  a small picker (a filter dimension — Month by default — plus a value for
  each side), then shows two independent, fully live copies of the
  dashboard side-by-side in iframes, one per value, everything else (tab,
  other filters) held the same on both. This reuses the URL-state feature
  from the previous batch (`?tab=...&month=...`) rather than duplicating
  any rendering logic — each side is the real interactive dashboard, not a
  simplified summary. Desktop-only (hidden below ~1100px — there's no
  useful way to show two dashboards side-by-side on a narrow screen).

## Preserved
- All six of the above are additive UI/interaction features; no existing
  calculation, filter, export, or admin data-mutation logic changed.

---

## V63.3

# V63.3 — Bug Fixes: Compare Periods, Chart Compare Labels, Bulk-Delete Feedback

## Compare Periods wasn't working — root cause
`server.py` sends `X-Frame-Options: DENY` and `frame-ancestors 'none'` on
every response — a real, intentional clickjacking protection. The Compare
Periods feature (added last batch) shows two copies of this same page
side-by-side in `<iframe>`s. Those two headers block a page from being
framed **at all, including by itself** — so clicking "Show Comparison"
opened the panes, but the browser refused to render anything inside them:
both sides came up silently blank.

### Fixed
- `server.py` — relaxed `X-Frame-Options` from `DENY` to `SAMEORIGIN`, and
  `frame-ancestors` from `'none'` to `'self'`. This still blocks the actual
  threat these headers exist for — another site embedding this app to trick
  someone into clicking something — while allowing the app to embed itself,
  which is exactly what Compare Periods needs. Nothing else about the CSP
  changed.
- `app.css` — also lowered the width at which Compare Periods hides itself
  from 1100px to 900px, since 1100px could hide the button on a perfectly
  usable laptop-width browser window.

## Chart "compare to previous period" — missing data labels
`app.js`'s `makeLineChart()` deliberately left the dashed comparison line
with no value labels or dots at all, to reduce clutter — but that made the
comparison line hard to actually read exact values from. Restored labels
and dots for the dashed series too, sized down and set half-opacity and
positioned *below* each point (the primary series' labels sit above), so
both lines are fully labeled without their labels colliding or the dashed
line visually competing with the primary one.

## Admin: bulk-delete confirmation went to the wrong place
`admin.html` — "Delete Selected" was writing its "Deleted N records."
confirmation into `#loginMsg` (the login form's message box) by a
copy-paste slip — invisible unless you happened to be looking at the login
panel, which isn't even shown once you're logged in. Now shown as a plain
confirmation dialog, matching how its own error path already worked.

## Preserved
- Both fixes are narrowly scoped: the CSP/frame-header change only affects
  same-origin framing permissions, and the chart change only affects the
  dashed/comparison series' rendering — no other security posture, data, or
  calculation changed.

---

## V63.4

# V63.4 — Command Palette, Skeleton Loaders, Density Toggle, Personalization

## Command palette (Ctrl+K / Cmd+K)
- `index.html`/`app.js`/`app.css` — a Spotlight/VS-Code-style palette:
  type to fuzzy-filter, ↑/↓ to move, Enter to run, Esc to close. Commands
  cover navigation (go to any tab, with its 1–5 shortcut shown), all four
  exports, Compare Periods, Reset All Filters, focus search, toggle dark
  mode / compact density / sound, open Admin, set the current tab as the
  default landing tab, and pick an accent color — so it doubles as a
  discoverable index of every shortcut/toggle in the app, not just a
  launcher. A small "⌘K" button in the header opens it too, for anyone who
  wouldn't otherwise discover the keyboard shortcut.

## Skeleton loaders
- `app.js`/`app.css` — switching tabs (or the very first load) now shows a
  shimmering placeholder shaped like the chart/table that's coming,
  instead of an empty container until data arrives. Only fills containers
  that are genuinely empty — a filter-triggered refresh of an
  already-loaded tab keeps its existing dim/fade treatment rather than
  flashing back to a skeleton.

## Density toggle (Comfortable / Compact)
- `index.html`/`app.js`/`app.css` — a "☰" header button tightens every
  table's row padding/font-size so more rows fit without scrolling.
  Remembered per-browser like the theme.

## Personalization
- **Default landing tab** — "Set … as my Default Landing Tab" in the
  command palette. A fresh visit (no tab in a shared/bookmarked URL) now
  opens on that tab instead of always "Dashboard".
- **Accent color** — six presets in the command palette re-tint buttons/
  badges/highlights app-wide via the existing `--accent` CSS variable;
  remembered per-browser.

## Preserved
- All of the above are additive UI/preference features — no calculation,
  filter, or export logic changed.

---

---

## V63.5

# V63.5 — Full Audit: Dark-Mode CSS, Compare Periods, Admin Users, Exports, Hardening

## Fixed
- **Dark mode variables never applied.** A comment in `app.css` contained `--chart-*/--fb-*`;
  the `*/` closed the comment early and the leftover text turned the `html[data-theme="dark"]`
  variable block into an invalid rule that browsers silently dropped. Result: dark-mode text
  (e.g. "Selection: All Data") was near-invisible, a white strip showed behind the tabs, and chart
  colours used the light values. Comment reworded; the block now applies.
- `app.css`: removed a stray leftover fragment of an old `@import` that swallowed the following rule.
- `admin.html`: removed a nested `<style id="admin-v32-production">` tag that invalidated the
  `.admin-prod-grid` rule (production-health layout).
- **Admin "Users" panel never loaded.** The page calls `GET /api/admin/users`; only a POST route
  existed, so it 404'd. Added the GET route (admin-only).
- **Compare Periods panes replayed the full intro splash** and each needed its own "Enter Dashboard"
  click. The intro is now skipped inside an iframe.
- **Filter dropdowns** only closed on the first outside click (`{once:true}` on the listener).
- **PPTX export:** the Quality Decision Distribution slide now has its data table, and every
  continuation slide (Defect / Work Center / Grade / trends) repeats its chart (RELEASE_GATE).
- `makeBarChart` (unused) had a missing `>` in its label markup.

## Hardened
- `server.py`: HEAD support for `/healthz`, `/readyz`, `/`, `/admin` (uptime monitors got 501).
- `server.py`: PostgreSQL pooled connection `close()` is idempotent and a `__del__` returns a
  connection that a failed request never closed (prevents pool exhaustion).
- `server.py`: static-asset 404 branches now `return` (no double response).
- `APP_VERSION` default now comes from `VERSION.txt` (was a stale hard-coded V60.0).
- Release-gate scripts work from the repo root or a `tests/` folder; `RELEASE_GATE.md` updated.
- Dark mode: plant-name line contrast.

## Verified
regression_smoke, http_smoke, smoke_test, regression_test, export_acceptance, export_stress all pass;
112 filter combinations checked for errors/NaN; all 5 tabs, drill-down, search, saved views, compare,
command palette, admin add/import/delete/bulk-delete/backup/restore/6M import checked in a real browser.

## Added after the first V63.5 audit pass (same release)
- **PostgreSQL-only bugs (found by running the whole app against a real PostgreSQL 16):**
  `GET /api/activity` (admin Activity panel) returned HTTP 500 for two reasons: the cursor wrapper passed an
  empty parameter tuple so psycopg2 tried to interpret the `%` in `LIKE 'export_%'`, and an unaliased
  `day` column alias is a syntax error in PostgreSQL. Both fixed; SQLite behaviour unchanged.
- Proved the pooled-connection leak on real PostgreSQL: with the old code 12 failing requests exhausted the
  pool ("connection pool exhausted"); with the fix the pool keeps serving.
- QCR intelligence now ranks ties deterministically (work center / grade / defect / contributor), so
  SQLite and PostgreSQL show the same "biggest problem" and the health-score reasons no longer include a
  0.0-point line caused by float noise.
- Fishbone image used in Excel/PDF/PPTX exports: emoji icons rendered as empty boxes and the left-most
  branch labels were clipped; icons are now shown only when drawable and the canvas is widened.
- Phones: the drill-down dialog was wider than the screen (Close button cut off) and its table wrapped one
  character per line; it now fits the screen and scrolls sideways.
- HTTP 5xx JSON responses no longer expose raw exception text (reference id only; details in the log).
- Housekeeping: rewrote `README.md` and `RELEASE_GATE.md` for the current version only, refreshed
  `GITHUB_UPLOAD.md`, removed old-version notes (`README_V27.4_NOTES.md`, `CODE_HEALTH_REPORT_V27.2.txt`,
  `V40_FILE_MANIFEST.txt`, `THEME_NOTES.md`) and unused legacy copies (`index_original.html`,
  `index.html.js`, `admin.html.js`, `01-…05-*.js`, `01-…04-*.css`, `quality_nonferrous_intro_dark.mp4`).
  Test scripts no longer print old version labels.

## Second audit pass (same release)
- **Security – stored XSS fixed.** Work Center / Grade names containing HTML were injected unescaped into
  the Quality Control Room "contributor" buttons (`Investigate <name>` / `Review <name>`). Any imported
  or hand-entered name could run script for every dashboard visitor. Now escaped. A broad injection scan
  (5 record fields, fishbone/RCA cells, user names, file names, saved views) across the dashboard, all tabs,
  drill-downs, search, QCR widgets and the admin console found no other sink.
- **Intermittent "hung" requests fixed.** The HTTP server used Python's default listen backlog of 5. A
  page load fires ~8 parallel calls, so a few simultaneous visitors overflowed the accept queue and the
  kernel delayed connections by TCP retries (up to a minute). Backlog is now 256; a 123-request burst
  (incl. Excel/PDF/PPTX exports) that previously took 6-61 s (32 timeouts in some runs) now always
  completes in ~8 s with zero failures.
- **Admin console structure.** An unclosed `</div>` after the Import Wizard nested every later panel inside
  it, so hiding that panel for restricted roles hid everything: QA Manager / QA Engineer / Auditor saw
  only 3 / 3 / 2 panels instead of 15 / 17 / 13. Also removed content that sat after `</html>` and escaped
  `&` in the index.html font URL. Both pages now validate with 0 HTML parse errors.
- **Loading states.** Tabs no longer show shimmering skeletons forever when an API call fails: the loaders
  now surface HTTP/JSON errors (they used to return silently) and the tab shows a message with a Retry
  button; leftover placeholders are cleaned up even when a loader returns without rendering.
- **Ctrl/⌘+K** no longer opens the command palette while typing in a field (the toolbar ⌘K button still
  does); pressing it again with the palette open closes it instead of wiping the query.
- **Exports.** PDF and PPTX no longer cap the defect register (300 / 150 rows): every row is printed.
  Chart visuals on high-cardinality data are bounded (Top 25 bars, latest 60 points) while paired tables
  stay complete; stress export times drop (Excel 17→4 s, PDF 16→3 s, PPTX 32→19 s) and peak memory 404→298 MB.
  `export_stress.py` now asserts completeness of the Excel, PDF and PPTX tables.
- Removed 9 unreferenced functions (`server.py`: `_safe_header_filename`, `norm_sinv`, `_coil_count_sql`,
  `_grand_total_row`, `_can`, `_record_signature`, `_backup_snapshot_data`; `app.js`: `makeBarChart`,
  `layoutQcrCards`).

## Preserved
No KPI formula, filter semantic, schema or stored data changed.

---

## V63.6

# V63.6 — Zoom-aware charts, cleaner header, command-palette button fix

## Fixed
- **Charts (and their fonts) ignored browser zoom.** Every chart was drawn on a fixed SVG canvas
  that was stretched to the container's width, so chart text tracked the *container* instead of the
  zoom level: pressing Ctrl +/- resized all page text (8px → 32px across 50%–200% zoom) while chart text
  stayed ~20px. The canvas width is now derived from the container's real CSS width
  (`chartUnits()` in `app.js`), so one SVG unit is always the same number of CSS pixels and chart
  text scales with zoom exactly like every other piece of text, in every browser. Charts remember how
  to redraw and re-render (debounced `ResizeObserver`) when zoom / window size / a hidden tab changes
  their width. Look at 100% zoom is unchanged (`CHART_PX_PER_UNIT = 1.9`; tune in `app.js`).
  - Pie chart: donut + leader lines shrink when narrow so outside labels always fit; centre total
    scales to stay inside the hole.
  - Fishbone diagram: lanes tighten when narrow; below its natural width the card scrolls sideways
    instead of shrinking the text.
  - Rotated first x-axis label of line charts was clipped at the left edge (`.chart-svg{overflow:visible}`).
- **Command palette (⌘K) button was invisible on the light header** (white-on-white). It now has real
  light and dark styles matching the Admin button.

## Changed
- Dark-mode, sound (mute/unmute) and compact-table-rows buttons were removed from the header; they
  are available from the command palette (Ctrl+K / ⌘K or the ⌘K button). Their logic is now plain
  functions (`toggleTheme`, `toggleDensity`, `toggleSound`) instead of hidden-button clicks; palette
  search also matches "volume", "sound", "theme", "density".
- The palette now opens on phones (it was hidden ≤700px) since it is the only place for those toggles.
- "Compare Periods" is only offered in the palette when its button is visible (desktop).
- Asset cache-buster bumped to `68.1`.

---

## V63.7

# V63.7 — Clean aligned header, palette-only actions, verification fixes

## Changed
- **Header is now one clean row.** Admin and the four report buttons (Excel / PDF / PPT / Raw CSV) were removed from
  the header — they live in the command palette (Ctrl+K / the **Commands** button), exactly like dark mode,
  sound and compact rows already did. The empty second toolbar row is gone.
- **Header width now matches the page.** Root cause: `header{max-width:1480px}` (declared last) overrode the
  1740 / 2000px breakpoints that widen `.container`, and even at 1480px the header's box stuck out 24px past the
  cards below (they sit inside the container padding). `--page-max` / `--page-pad` are now shared by `.container`
  and the header, so the edges line up at every viewport width.
- Logo and title block are vertically centred and left-aligned as one unit (logo 64px, hairline divider);
  status + palette button are right-aligned at a common 36px height. Tighter tiers at ≤1500px / ≤1300px / phones.
- The palette button now reads "⌘ Commands" with the shortcut hint (Ctrl K, or ⌘K on Apple devices).
- `exportDashboard(format)` is now a top-level function (no button needed): progress toast while generating,
  success/error toast, guard against double-starts. Used by the palette and Ctrl+E.
- Cache-buster `68.2`.

## Fixed
- Fishbone diagram lost text (“…”) on tightened lanes: narrow layouts now allow up to 5 wrapped lines so no cause is
  ever truncated (the original "show every cause" rule).
- Dark mode: the "NOW ACTIVE" pill was a bright white block on the dark header.
- Phones: branding no longer overflows; "Last updated" / status / palette button fit on one line ≥360px.

## Verified (Chromium; Firefox is not available in the build sandbox)
- Header edges == content edges at 1280 / 1519 / 1700 / 1900 / 2267 / 3038px, light + dark, plus phones.
- Charts: no redraw loop after resize, hidden-tab charts redraw with the right width when shown, chart click →
  drill-down works after a resize redraw, Compare Periods panes render, no page errors on any tab (light/dark),
  no horizontal page overflow on a 390px phone across all 5 tabs.
- Palette: all four exports download (and Ctrl+E), error toast on a failing export, Admin navigation.
- Fishbone verified with real 6M master data through `/api/fishbone`.
- Release gate: node --check, py_compile, code_health, regression_smoke, http_smoke, smoke_test, regression_test,
  export_acceptance, export_stress — all PASS.

---

## V63.8

# V63.8 — Table hover contrast fix, monthly trend simplification

## Fixed
- **Dark mode: hovering any dashboard table row made its text disappear.** `tbody tr:hover` had a
  light-mode-only background (`#EEF7FC`) with no dark-theme override, so in dark mode the row's
  background stayed light while the text stayed light-colored — white-on-white. Added
  `html[data-theme="dark"] tbody tr:hover{background:#1B2740}` to match the existing dark hover
  palette used elsewhere.

## Removed
- **"Compare to previous period" toggle on the Monthly Quality Trend chart.** It added a second
  dashed line per metric showing the prior month's value at the current month's x-position — but the
  chart is already a month-by-month line chart, so the previous month's value was already visible as
  the preceding point on the same line. The toggle added no calculation the chart didn't already
  convey, so it, its checkbox markup, and its `.compare-toggle*` CSS were removed.
- Cache-buster bumped to `68.3`.

---

## V63.9

# V63.9 — Admin health-cards overlap fix

## Fixed
- **Admin > Control Center: the Production Health / Data Integrity / Deployment Health / Error
  Monitor cards overlapped each other instead of stacking as full-width rows.** `.admin-content-grid`
  is a 2-column grid where only children with the `full` class span the whole width
  (`.admin-content-grid>.full{grid-column:1/-1}`); the two `.admin-prod-grid` wrapper `<div>`s (each
  holding a pair of health cards) were missing that class, so CSS grid auto-placed them side by side
  as two half-width cells in the same row instead of two full-width rows underneath the KPI panel.
  Squeezed into half-width, the cards' own contents overflowed their grid cell and visually painted
  over the neighbouring card. Added `full` to both wrapper `<div class="admin-prod-grid">` elements
  in `admin.html`. No CSS/JS changed, so no cache-buster bump needed.

---

## V64.0

# V64.0 — Records diagnostic search (text + date range) with export/delete

## Added
- **Admin > Latest Records: text + inspection-date-range search**, so a specific import (or any
  other slice of data) can be isolated and inspected on its own instead of only ever seeing the
  newest 100 rows. New inputs: a free-text box (matches ID, Heat No, Batch No, Work Center, Grade,
  Main Defect, Decision, Month, Week, Quarter, FY — same fields the old global-search-only query
  matched) plus a From/To inspection-date range, combinable with AND. A "N matching record(s)"
  counter shows the filtered count without disturbing the header's live "Total Records" figure
  (see Fixed, below). Search results feed straight into the **already-existing** Export Selected /
  Delete Selected / bulk-delete tools in that panel — find the exact records, then act on them.
- `/api/admin/records` now accepts optional `date_from` / `date_to` (inclusive, `YYYY-MM-DD`,
  compared against `insp_lot_date`) alongside the existing free-text `q`.

## Fixed
- **Searching records used to overwrite the "Total Records" stat with the filtered count** until
  the next full refresh, since `loadRecords()` always wrote the API response's `total` (which
  becomes the filtered match count as soon as a query is present) into that header figure. The
  endpoint now also returns `grand_total` (the true, always-unfiltered live count), and the
  frontend uses that for the header stat while showing the filtered `total` only in the new
  in-panel match counter.

## Why this helps
- Directly supports diagnosing "import summary says 445 but the dashboard shows 449": filter
  Latest Records to the imported file's date range, compare the matching-record count and the sum
  of Weight (MT) shown there against the import summary, and any extra records are now visible
  and selectable to delete (with the existing single/bulk delete flow, itself backed by a safety
  backup + audit trail already in place before this release).


## V64.6 — Sorting reset fix

### Fixed
- **All sortable tables now support the full 3-click cycle:** ascending → descending → reset to the table's current natural/server order.
- Fixed `Work Center`, `Grade`, `Monthly`, `Weekly`, `Quarterly`, and `Yearly` tables not restoring their natural order on the third click because their freshly rendered row order was not being captured before the remembered sort was reapplied.
- Added an explicit sort-cycle tooltip/accessibility label so the third-click reset behavior is discoverable without changing the table data or column values.

### Verification
- V64.6 targeted regression now asserts that metric tables capture natural order before reapplying remembered sorting.
- Version remains **V64.6**; this is a corrective patch, not a new release version.

## V64.6 — Presentation drill-down z-order & decision icon patch

- Fixed drill-down opened from Analytics Presentation Mode appearing behind the presentation overlay. The real drill modal is temporarily re-parented to `body` while Presentation Mode is active, then restored to its original DOM position on close.
- Fixed `Esc` behavior so an open drill-down closes first without closing Presentation Mode.
- Fixed Presentation Mode toolbar titles so the expand `⛶` control is not included in the copied heading text.
- Quality Decision Mix now uses a decision-oriented `⚖️` icon instead of a chart-type pie icon.
- Runtime/application version remains **V64.6**; only the frontend JS cache-buster advances to ensure the fix is loaded.
