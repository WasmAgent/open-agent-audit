---
"@openagentaudit/core": minor
---

feat: Milestone 1 validateEvents + Milestone 6 alert infrastructure

- validateEvents: parse unknown input into typed CanonicalEvent[] with errors (#200)
- alert rules with per-rule suppression_window_ms for benign drift (#204)
- scheduled audit runner with hourly/daily/weekly cadence gating (#194)
- org-wide risk rollup endpoint GET /api/v1/dashboard/org-risk-rollup (#214)
- AlertGatekeeper integration in maybeDispatchAlerts for rate limiting/dedup (#215)
