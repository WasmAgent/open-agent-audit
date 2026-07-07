---
"@openagentaudit/core": patch
"@openagentaudit/adapters": patch
"@openagentaudit/cli": patch
---

fix: Teller issues batch (#12-#21)

- OAA-R-CAP-001 no longer fires per tool_call on empty manifest; emits single info OAA-R-CAP-000 (#12)
- toEventsBatch documented on adapter contract (#13)
- CLI from-aep supports JSONL batch input (#14)
- OAA-R-OVERSIGHT-001 downgrades to medium when policy_decision exists (#15)
- Node.js and Python bridge examples for non-JS runtimes (#16)
- ReportMeta narrative hook for LLM-authored auditor voice (#17)
- objective_verification returns neutral 50 for non-verifier agents (#20)
- ARS documentation with penalty table and interpretation guide (#21)
