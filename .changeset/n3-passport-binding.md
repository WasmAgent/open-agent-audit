---
"@openagentaudit/passport": minor
---

Harden passport revocation binding, authenticity semantics and renewal (third-round audit).

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
