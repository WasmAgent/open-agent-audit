---
"@openagentaudit/core": minor
"@openagentaudit/adapters": minor
"@openagentaudit/schema": minor
---

feat: address issues #12-#17 — policy audit noise reduction, batch CLI, adapter contract, non-JS docs, narrative hook

- #12: OAA-R-CAP-001 fires one info finding on empty manifest instead of N high findings
- #13: toEventsBatch added to SourceFormatAdapter interface and documented
- #14: CLI from-aep supports --batch for aggregate reports from multiple AEP records
- #15: Adapter maps permission_gate/capability_decision to human_approval, preventing OVERSIGHT-001 false positives
- #16: Integration guide for Python/Go runtimes added
- #17: ReportMeta gains narrative_intro and narrative_conclusion optional fields
