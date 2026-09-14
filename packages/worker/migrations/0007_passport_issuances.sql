-- packages/worker/migrations/0007_passport_issuances.sql
--
-- Authoritative Trust Passport ownership registry (N5-P0-01).
--
-- A Passport id is a random public identifier, not an authorization boundary.
-- Authentication alone (a valid bearer key) does not prove that the caller owns
-- a Passport, so writes (revoke/renew) previously could target a foreign
-- tenant's Passport. This table is the strongly-consistent, server-owned owner
-- record. It deliberately lives in D1, not KV: KV's eventual consistency cannot
-- back an authorization decision.
--
-- The PRIMARY KEY on passport_id makes ownership a single authoritative row.
-- tenant_id is captured at issuance from the authenticated principal and is
-- never derived from a request header, agent id or Passport id.

CREATE TABLE IF NOT EXISTS passport_issuances (
  passport_id      TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL,
  issuance_digest  TEXT NOT NULL,
  report_id        TEXT,
  created_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_passport_issuances_tenant
  ON passport_issuances (tenant_id);
