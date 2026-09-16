# @openagentaudit/passport

## 0.7.0

### Minor Changes

- d68f327: Harden passport revocation binding, authenticity semantics and renewal (third-round audit).

  - Revocation records bind to the **canonical issuance digest** recomputed from
    the passport (attestation excluded), and require
    `revocation.passport_id === passport.identity.passport_id`; a signed status
    record without the digest fails closed (N3-P1-06).
  - `issuance_authenticity` and `revocation_authenticity` now return
    `valid | invalid | not-present`, so an unsigned passport is `not-present`, not
    conflated with a cryptographically invalid one (N3-P1-07).
  - An unsigned revocation is only authoritative when the caller marks the status
    source trusted; the Worker registry does so explicitly (N3-P1-07).
  - Worker renewal mints a new immutable issuance (new id, `renewed_from`
    lineage, fresh attestation) instead of mutating the signed passport in place;
    a signed passport cannot be renewed without a signer (N3-P1-08).
  - The multi-tenant `GET /r/:reportId` short link now requires a valid principal
    and verifies run ownership before serving the R2 report (N3-P0-01).

- fe61840: Bind Trust Passport issuance and write authority to the authenticated tenant
  (fifth-round audit — N5-P0-01 / N5-P1-01).

  - Passport writes (`POST /passport/issue`, `/:id/revoke`, `/:id/renew`) now
    resolve the full principal and require the caller's tenant to own the
    Passport (`passport_issuances.tenant_id == principal.tenantId`). A foreign
    Passport is answered `404`; an unowned legacy Passport fails closed in
    multi-tenant mode.
  - New authoritative D1 ownership registry `passport_issuances` (migration
    `0007`), self-bootstrapped on demand like the revocation registry. KV is no
    longer consulted for Passport authority. If the owner row cannot be written,
    issuance/renewal is rolled back and fails closed.
  - Production issuance accepts `{"runId": "run-…"}` and builds the Passport from
    the canonical persisted `runs/<runId>/report.json` owned by the tenant, so
    caller-supplied report bytes can no longer fabricate evidence provenance.
    A direct `report` remains available only for dev/demo and is marked
    `issuance_context: "self-issued"`.
  - `issue()` now resolves the Evidence Admission Score from either the top-level
    `evidence_admission_score` (direct API) or the persisted report bundle's
    nested `risk_score.evidence_admission_score`, so server-audited issuance
    derives the same evidence quality as direct issuance.
  - Renewal preserves the owner tenant on the new issuance
    (`old owner == renewed owner`).
  - Worker README storage truth updated: D1 owns Passport ownership + revocation;
    KV holds immutable documents and a best-effort revocation mirror.

- 1a540ba: Add external, signed passport revocation records so revocation no longer mutates
  the signed issuance (which invalidated its signature and made verifiers report
  "tampered" instead of "authentic, revoked").

  - `createRevocationRecord` / `verifyRevocation` build and verify a separate
    `TrustPassportRevocation` status object.
  - `verifyPassportLayers` returns independent layers:
    `issuance_authenticity`, `revocation_status`, `revocation_authenticity`,
    `status_freshness` — never a single collapsed boolean.
  - `verifySignatureOnly` verifies the issuance signature while deliberately
    ignoring expiry, so expired != tampered.
  - `revoke()` is deprecated for legacy embedded-revocation parsing only; the
    Worker now stores revocation externally and leaves the passport bytes
    untouched.

## 0.6.2

### Patch Changes

- Updated dependencies [450fae0]
  - @openagentaudit/schema@0.7.0
  - @openagentaudit/core@0.8.0

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
