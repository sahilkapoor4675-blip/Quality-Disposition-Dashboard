# V27.4 Notes

V27.4 is a reliability/performance phase. It does **not** redesign the dashboard or change business calculations.

### Preserved contracts
- 4,936 bundled disposition records
- Existing filter keys and behavior
- Existing KPI calculations
- Existing QCR calculations and logic
- Existing tabs, exports, import flow, and role model

### CI
GitHub Actions runs automatically for pushes and pull requests targeting `main` or `master` and executes:
1. Python compile check
2. Code-health audit
3. Smoke test
4. Read-only regression test
