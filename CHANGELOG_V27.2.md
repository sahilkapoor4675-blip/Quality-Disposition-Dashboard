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
