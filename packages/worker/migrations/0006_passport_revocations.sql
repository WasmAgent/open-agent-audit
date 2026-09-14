-- packages/worker/migrations/0006_passport_revocations.sql
--
-- Authoritative Trust Passport revocation registry (N4-P1-03).
--
-- Workers KV is eventually consistent: negative lookups are cached, writes can
-- take ~60s to propagate, and concurrent get/put cannot compare-and-set. Using
-- KV as the sole source of ACTIVE/REVOKED therefore produced false ACTIVE
-- (stale-negative) and double-revoke transitions.
--
-- D1 is the strongly-consistent, serialized owner of revocation state. The
-- PRIMARY KEY on passport_id makes the revocation transition atomic outside the
-- Worker: a second INSERT collides and changes=0, so exactly one transition can
-- win. KV may still mirror this table as a cache but is never a trust source.
--
-- Note: effective_at is deliberately not UNIQUE/enforced in the future here;
-- temporal validity is evaluated by the verifier (N4-P2-02).

CREATE TABLE IF NOT EXISTS passport_revocations (
  passport_id  TEXT PRIMARY KEY,
  record       TEXT NOT NULL,
  sequence     INTEGER NOT NULL DEFAULT 1,
  effective_at TEXT NOT NULL,
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_passport_revocations_effective_at
  ON passport_revocations (effective_at);
