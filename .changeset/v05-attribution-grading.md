---
"@openagentaudit/adapters": minor
"@openagentaudit/schema": minor
"@openagentaudit/core": minor
---

aep/v0.5 attribution grading end to end (canonical wasmagent-protocol 0.1.9/0.1.10): the schema mirrors the three grading axes (authority_origin, identity_source, attribution_backing) plus run_attribution_backing_floor / run_attribution_backing_observed and authorization_evidence_count; the adapter accepts aep/v0.5 records, extracts grading into canonical events via `getAttribution`, and mirrors authorization_evidence_count; scoring adds the attribution-integrity bonus/penalty (rewards verifiable backing and honest floor reporting, penalises `unknown`).
