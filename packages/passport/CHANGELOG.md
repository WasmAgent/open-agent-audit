# @openagentaudit/passport

## 0.6.1

### Patch Changes

- Updated dependencies [35b54bb]
  - @openagentaudit/core@0.7.0

## 0.6.0

### Patch Changes

- [`40db01f`](https://github.com/WasmAgent/open-agent-audit/commit/40db01fec233d8962fe4f9a6b3436d90c834c7f7) Thanks [@telleroutlook](https://github.com/telleroutlook)! - feat: expose schema coverage gaps in dashboard and worker

  - Add evidence chain visibility to event details (signature status, DSSE badge, chain integrity via prev_hash, signer key hint)
  - Fix writeRunToD1 to persist all Finding fields (description, event_id, confidence, false_positive_likelihood, first_seen/last_seen, occurrence_count, suppressed)
  - Add FindingsPanel component: fetches GET /api/v1/runs/:id/findings, severity/confidence badges, MITRE/NIST/OWASP framework pills, drill-down to triggering event
  - Add policy.rule_id to event details
  - Add recording_mode to audit summary card
  - Add finding_count and risk_score (ARS) columns to Runs list
  - Upgrade all dependencies to latest (biome 2.x, zod 4.x, React 19, @noble 3.x)
  - Remove duplicate RawEvent/AepMeta type declarations; delete dead pages/HomePage.tsx

- Updated dependencies [[`40db01f`](https://github.com/WasmAgent/open-agent-audit/commit/40db01fec233d8962fe4f9a6b3436d90c834c7f7)]:
  - @openagentaudit/schema@0.6.0
  - @openagentaudit/core@0.6.0

## 0.5.2

### Patch Changes

- Updated dependencies [[`8ef3744`](https://github.com/WasmAgent/open-agent-audit/commit/8ef374468c8f94c59a7aa551275baf1b99faccfb)]:
  - @openagentaudit/core@0.5.2

## 0.5.1

### Patch Changes

- [`d65ff3a`](https://github.com/WasmAgent/open-agent-audit/commit/d65ff3ab8a302302c4d84f2d8668cbf92f143a3d) Thanks [@robotdawn](https://github.com/robotdawn)! - build: add prepublishOnly script to all publishable packages to prevent shipping without dist/

- Updated dependencies [[`d65ff3a`](https://github.com/WasmAgent/open-agent-audit/commit/d65ff3ab8a302302c4d84f2d8668cbf92f143a3d), [`255c169`](https://github.com/WasmAgent/open-agent-audit/commit/255c169cc33857c98aee83d486ec51e20646d48d)]:
  - @openagentaudit/core@0.5.1
  - @openagentaudit/schema@0.5.1

## 0.5.0

### Minor Changes

- [`f7abf78`](https://github.com/WasmAgent/open-agent-audit/commit/f7abf78ea3dc14ffbd0e035fe5bba40fe39ed3d9) Thanks [@robotdawn](https://github.com/robotdawn)! - feat: full AEP v0.4 integration — DSSE attestation format, recording_mode scoring, drift-guard fidelity metric

### Patch Changes

- Updated dependencies [[`f7abf78`](https://github.com/WasmAgent/open-agent-audit/commit/f7abf78ea3dc14ffbd0e035fe5bba40fe39ed3d9)]:
  - @openagentaudit/schema@0.5.0
  - @openagentaudit/core@0.5.0

## 0.4.0

### Minor Changes

- [#67](https://github.com/WasmAgent/open-agent-audit/pull/67) [`1129e45`](https://github.com/WasmAgent/open-agent-audit/commit/1129e45e5d3e099d7bb112b6fb14bd584047c909) Thanks [@HainingYin](https://github.com/HainingYin)! - feat(passport): EdDSA signing, verification, inspect, and renew endpoint — completes migration from agent-trust-infra

## 0.3.2

### Patch Changes

- [#64](https://github.com/WasmAgent/open-agent-audit/pull/64) [`7189e2a`](https://github.com/WasmAgent/open-agent-audit/commit/7189e2a8eaaf9840a6458a521515516eb79260eb) Thanks [@HainingYin](https://github.com/HainingYin)! - docs: document evidence_quality thresholds and computeRiskScore verifier dependency

- Updated dependencies [[`7189e2a`](https://github.com/WasmAgent/open-agent-audit/commit/7189e2a8eaaf9840a6458a521515516eb79260eb)]:
  - @openagentaudit/core@0.3.2

## 0.3.1

### Patch Changes

- [#62](https://github.com/WasmAgent/open-agent-audit/pull/62) [`0081193`](https://github.com/WasmAgent/open-agent-audit/commit/0081193bdbe2ef57ee576229ef5f1689513c050b) Thanks [@HainingYin](https://github.com/HainingYin)! - fix: renderReport null crash, tool_name alias, structured validation errors

- Updated dependencies [[`0081193`](https://github.com/WasmAgent/open-agent-audit/commit/0081193bdbe2ef57ee576229ef5f1689513c050b)]:
  - @openagentaudit/core@0.3.1

## 0.3.0

### Minor Changes

- [#55](https://github.com/WasmAgent/open-agent-audit/pull/55) [`13cb1d0`](https://github.com/WasmAgent/open-agent-audit/commit/13cb1d0e888445e7899b7ed7fcb8de984b511d4a) Thanks [@HainingYin](https://github.com/HainingYin)! - Add validateTrustPassport() with prototype-pollution guard, required-field enforcement, ISO 8601 UTC validation, coverage enum check, and revocation_triggers array check. Add isExpired() helper. Add hashEvidence() and addFact() for content-addressed evidence storage. Add Trust Passport v0.1 specification document.

## 0.2.5

### Patch Changes

- Updated dependencies [[`de315b8`](https://github.com/WasmAgent/open-agent-audit/commit/de315b81ee14146b4e93117ab163ccb37e7a9d3f)]:
  - @openagentaudit/core@0.2.5
