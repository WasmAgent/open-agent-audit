# @openagentaudit/schema

## 0.6.0

### Minor Changes

- [`40db01f`](https://github.com/WasmAgent/open-agent-audit/commit/40db01fec233d8962fe4f9a6b3436d90c834c7f7) Thanks [@telleroutlook](https://github.com/telleroutlook)! - feat: expose schema coverage gaps in dashboard and worker

  - Add evidence chain visibility to event details (signature status, DSSE badge, chain integrity via prev_hash, signer key hint)
  - Fix writeRunToD1 to persist all Finding fields (description, event_id, confidence, false_positive_likelihood, first_seen/last_seen, occurrence_count, suppressed)
  - Add FindingsPanel component: fetches GET /api/v1/runs/:id/findings, severity/confidence badges, MITRE/NIST/OWASP framework pills, drill-down to triggering event
  - Add policy.rule_id to event details
  - Add recording_mode to audit summary card
  - Add finding_count and risk_score (ARS) columns to Runs list
  - Upgrade all dependencies to latest (biome 2.x, zod 4.x, React 19, @noble 3.x)
  - Remove duplicate RawEvent/AepMeta type declarations; delete dead pages/HomePage.tsx

## 0.5.1

### Patch Changes

- [`d65ff3a`](https://github.com/WasmAgent/open-agent-audit/commit/d65ff3ab8a302302c4d84f2d8668cbf92f143a3d) Thanks [@robotdawn](https://github.com/robotdawn)! - build: add prepublishOnly script to all publishable packages to prevent shipping without dist/

## 0.5.0

### Minor Changes

- [`f7abf78`](https://github.com/WasmAgent/open-agent-audit/commit/f7abf78ea3dc14ffbd0e035fe5bba40fe39ed3d9) Thanks [@robotdawn](https://github.com/robotdawn)! - feat: full AEP v0.4 integration — DSSE attestation format, recording_mode scoring, drift-guard fidelity metric

## 0.2.0

### Minor Changes

- [`9ae337b`](https://github.com/WasmAgent/open-agent-audit/commit/9ae337b8cbb42582fc13c84caaca44f2eaba3217) Thanks [@HainingYin](https://github.com/HainingYin)! - feat: address issues [#12](https://github.com/WasmAgent/open-agent-audit/issues/12)-[#17](https://github.com/WasmAgent/open-agent-audit/issues/17) — policy audit noise reduction, batch CLI, adapter contract, non-JS docs, narrative hook

  - [#12](https://github.com/WasmAgent/open-agent-audit/issues/12): OAA-R-CAP-001 fires one info finding on empty manifest instead of N high findings
  - [#13](https://github.com/WasmAgent/open-agent-audit/issues/13): toEventsBatch added to SourceFormatAdapter interface and documented
  - [#14](https://github.com/WasmAgent/open-agent-audit/issues/14): CLI from-aep supports --batch for aggregate reports from multiple AEP records
  - [#15](https://github.com/WasmAgent/open-agent-audit/issues/15): Adapter maps permission_gate/capability_decision to human_approval, preventing OVERSIGHT-001 false positives
  - [#16](https://github.com/WasmAgent/open-agent-audit/issues/16): Integration guide for Python/Go runtimes added
  - [#17](https://github.com/WasmAgent/open-agent-audit/issues/17): ReportMeta gains narrative_intro and narrative_conclusion optional fields

## 0.1.1

### Patch Changes

- e3b635a: Update wasmagent-js fixture to v1.4.0; confirm adapter compatibility with AEP emitter behavioral changes (Date.now timestamps, addAction capability_decision auto-sync, onVerifierResult callback)
