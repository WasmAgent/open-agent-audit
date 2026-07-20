-- Federation tables for cross-org Trust Passport registry
CREATE TABLE IF NOT EXISTS registered_passports (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  status_list_id TEXT NOT NULL DEFAULT 'default',
  status_list_index INTEGER NOT NULL,
  is_revoked INTEGER NOT NULL DEFAULT 0,
  issued_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  passport_jwt TEXT NOT NULL,
  metadata TEXT,
  UNIQUE(agent_id)
);

CREATE TABLE IF NOT EXISTS status_lists (
  id TEXT PRIMARY KEY DEFAULT 'default',
  bitstring TEXT NOT NULL DEFAULT '',
  credential_count INTEGER NOT NULL DEFAULT 0,
  last_updated TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_passports_agent ON registered_passports(agent_id);
CREATE INDEX IF NOT EXISTS idx_passports_org ON registered_passports(org_id);

-- Initialize default status list
INSERT OR IGNORE INTO status_lists (id, bitstring, credential_count, last_updated)
VALUES ('default', '', 0, datetime('now'));
