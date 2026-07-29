-- packages/worker/migrations/0003_findings_extended.sql
-- Add missing Finding schema fields to the findings table.
-- These were present in the TypeScript Finding type but not persisted to D1.

ALTER TABLE findings ADD COLUMN description        TEXT;
ALTER TABLE findings ADD COLUMN event_id           TEXT;
ALTER TABLE findings ADD COLUMN confidence         TEXT;
ALTER TABLE findings ADD COLUMN false_positive_likelihood REAL;
ALTER TABLE findings ADD COLUMN first_seen         TEXT;
ALTER TABLE findings ADD COLUMN last_seen          TEXT;
ALTER TABLE findings ADD COLUMN occurrence_count   INTEGER;
ALTER TABLE findings ADD COLUMN suppressed         INTEGER;
ALTER TABLE findings ADD COLUMN suppression_reason TEXT;
