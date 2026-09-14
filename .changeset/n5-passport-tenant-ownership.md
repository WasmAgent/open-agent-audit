---
"@openagentaudit/passport": minor
---

Bind Trust Passport issuance and write authority to the authenticated tenant
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
