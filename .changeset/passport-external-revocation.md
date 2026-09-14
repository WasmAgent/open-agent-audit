---
"@openagentaudit/passport": minor
---

Add external, signed passport revocation records so revocation no longer mutates
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
