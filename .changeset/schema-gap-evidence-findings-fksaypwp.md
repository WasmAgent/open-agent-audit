---
"@openagentaudit/schema": minor
"@openagentaudit/core": minor
"@openagentaudit/adapters": minor
"@openagentaudit/passport": patch
---

feat: expose schema coverage gaps in dashboard and worker

- Add evidence chain visibility to event details (signature status, DSSE badge, chain integrity via prev_hash, signer key hint)
- Fix writeRunToD1 to persist all Finding fields (description, event_id, confidence, false_positive_likelihood, first_seen/last_seen, occurrence_count, suppressed)
- Add FindingsPanel component: fetches GET /api/v1/runs/:id/findings, severity/confidence badges, MITRE/NIST/OWASP framework pills, drill-down to triggering event
- Add policy.rule_id to event details
- Add recording_mode to audit summary card
- Add finding_count and risk_score (ARS) columns to Runs list
- Upgrade all dependencies to latest (biome 2.x, zod 4.x, React 19, @noble 3.x)
- Remove duplicate RawEvent/AepMeta type declarations; delete dead pages/HomePage.tsx
