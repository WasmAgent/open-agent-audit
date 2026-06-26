/** @openagentaudit/core/validate — skeleton. */
import type { CanonicalEvent } from '@openagentaudit/schema';

export interface ValidationResult {
  total: number;
  errors: Array<{ event_id: string; path: string; message: string }>;
  warnings: Array<{ event_id: string; path: string; message: string }>;
}

export async function validate(events: CanonicalEvent[]): Promise<ValidationResult> {
  // TODO: implement after Phase 2 freeze gate. See docs/schema-versioning.md.
  return { total: events.length, errors: [], warnings: [] };
}
