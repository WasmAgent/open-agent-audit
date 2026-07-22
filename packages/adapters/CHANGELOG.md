# @openagentaudit/adapters

## 0.5.2

### Patch Changes

- [`8ef3744`](https://github.com/WasmAgent/open-agent-audit/commit/8ef374468c8f94c59a7aa551275baf1b99faccfb) Thanks [@robotdawn](https://github.com/robotdawn)! - fix: remove clean from prepublishOnly to prevent cross-dep build failure in changeset publish

## 0.5.1

### Patch Changes

- [`d65ff3a`](https://github.com/WasmAgent/open-agent-audit/commit/d65ff3ab8a302302c4d84f2d8668cbf92f143a3d) Thanks [@robotdawn](https://github.com/robotdawn)! - build: add prepublishOnly script to all publishable packages to prevent shipping without dist/

- Updated dependencies [[`d65ff3a`](https://github.com/WasmAgent/open-agent-audit/commit/d65ff3ab8a302302c4d84f2d8668cbf92f143a3d)]:
  - @openagentaudit/schema@0.5.1

## 0.5.0

### Minor Changes

- [`f7abf78`](https://github.com/WasmAgent/open-agent-audit/commit/f7abf78ea3dc14ffbd0e035fe5bba40fe39ed3d9) Thanks [@robotdawn](https://github.com/robotdawn)! - feat: full AEP v0.4 integration — DSSE attestation format, recording_mode scoring, drift-guard fidelity metric

### Patch Changes

- Updated dependencies [[`f7abf78`](https://github.com/WasmAgent/open-agent-audit/commit/f7abf78ea3dc14ffbd0e035fe5bba40fe39ed3d9)]:
  - @openagentaudit/schema@0.5.0

## 0.3.1

### Patch Changes

- [#62](https://github.com/WasmAgent/open-agent-audit/pull/62) [`0081193`](https://github.com/WasmAgent/open-agent-audit/commit/0081193bdbe2ef57ee576229ef5f1689513c050b) Thanks [@HainingYin](https://github.com/HainingYin)! - fix: renderReport null crash, tool_name alias, structured validation errors

## 0.2.5

### Patch Changes

- [#36](https://github.com/WasmAgent/open-agent-audit/pull/36) [`d62e6a1`](https://github.com/WasmAgent/open-agent-audit/commit/d62e6a1cbcfb87cce1ce75a11555300a699a9899) Thanks [@HainingYin](https://github.com/HainingYin)! - Fix ESM/CJS inconsistency: align exports field with conditional import/types subpaths matching @openagentaudit/core

## 0.2.4

### Patch Changes

- [#36](https://github.com/WasmAgent/open-agent-audit/pull/36) [`d5fa820`](https://github.com/WasmAgent/open-agent-audit/commit/d5fa8206c4118a3c4bd5e2ecb08c7ebb974176f2) Thanks [@HainingYin](https://github.com/HainingYin)! - Fix ESM/CJS inconsistency: align exports field with conditional import/types subpaths matching @openagentaudit/core

## 0.2.3

### Patch Changes

- [#34](https://github.com/WasmAgent/open-agent-audit/pull/34) [`ce926cd`](https://github.com/WasmAgent/open-agent-audit/commit/ce926cd9182c58f0f5f743401ba0545c8b6513a4) Thanks [@HainingYin](https://github.com/HainingYin)! - fix: accept aep/v0.3 records and preserve side_effect_class in adapter output ([#25](https://github.com/WasmAgent/open-agent-audit/issues/25), [#26](https://github.com/WasmAgent/open-agent-audit/issues/26))

## 0.2.2

### Patch Changes

- [`cba58df`](https://github.com/WasmAgent/open-agent-audit/commit/cba58df47c6cd787d84a5b595450da00d9651093) Thanks [@robotdawn](https://github.com/robotdawn)! - fix: Teller issues batch ([#12](https://github.com/WasmAgent/open-agent-audit/issues/12)-[#21](https://github.com/WasmAgent/open-agent-audit/issues/21))

  - OAA-R-CAP-001 no longer fires per tool_call on empty manifest; emits single info OAA-R-CAP-000 ([#12](https://github.com/WasmAgent/open-agent-audit/issues/12))
  - toEventsBatch documented on adapter contract ([#13](https://github.com/WasmAgent/open-agent-audit/issues/13))
  - CLI from-aep supports JSONL batch input ([#14](https://github.com/WasmAgent/open-agent-audit/issues/14))
  - OAA-R-OVERSIGHT-001 downgrades to medium when policy_decision exists ([#15](https://github.com/WasmAgent/open-agent-audit/issues/15))
  - Node.js and Python bridge examples for non-JS runtimes ([#16](https://github.com/WasmAgent/open-agent-audit/issues/16))
  - ReportMeta narrative hook for LLM-authored auditor voice ([#17](https://github.com/WasmAgent/open-agent-audit/issues/17))
  - objective_verification returns neutral 50 for non-verifier agents ([#20](https://github.com/WasmAgent/open-agent-audit/issues/20))
  - ARS documentation with penalty table and interpretation guide ([#21](https://github.com/WasmAgent/open-agent-audit/issues/21))

## 0.2.0

### Minor Changes

- [`9ae337b`](https://github.com/WasmAgent/open-agent-audit/commit/9ae337b8cbb42582fc13c84caaca44f2eaba3217) Thanks [@HainingYin](https://github.com/HainingYin)! - feat: address issues [#12](https://github.com/WasmAgent/open-agent-audit/issues/12)-[#17](https://github.com/WasmAgent/open-agent-audit/issues/17) — policy audit noise reduction, batch CLI, adapter contract, non-JS docs, narrative hook

  - [#12](https://github.com/WasmAgent/open-agent-audit/issues/12): OAA-R-CAP-001 fires one info finding on empty manifest instead of N high findings
  - [#13](https://github.com/WasmAgent/open-agent-audit/issues/13): toEventsBatch added to SourceFormatAdapter interface and documented
  - [#14](https://github.com/WasmAgent/open-agent-audit/issues/14): CLI from-aep supports --batch for aggregate reports from multiple AEP records
  - [#15](https://github.com/WasmAgent/open-agent-audit/issues/15): Adapter maps permission_gate/capability_decision to human_approval, preventing OVERSIGHT-001 false positives
  - [#16](https://github.com/WasmAgent/open-agent-audit/issues/16): Integration guide for Python/Go runtimes added
  - [#17](https://github.com/WasmAgent/open-agent-audit/issues/17): ReportMeta gains narrative_intro and narrative_conclusion optional fields

### Patch Changes

- Updated dependencies [[`9ae337b`](https://github.com/WasmAgent/open-agent-audit/commit/9ae337b8cbb42582fc13c84caaca44f2eaba3217)]:
  - @openagentaudit/schema@0.2.0

## 0.1.1

### Patch Changes

- e3b635a: Update wasmagent-js fixture to v1.4.0; confirm adapter compatibility with AEP emitter behavioral changes (Date.now timestamps, addAction capability_decision auto-sync, onVerifierResult callback)
- Updated dependencies [e3b635a]
  - @openagentaudit/schema@0.1.1
