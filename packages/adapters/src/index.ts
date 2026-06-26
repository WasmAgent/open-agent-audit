/**
 * @openagentaudit/adapters — Source-format adapters.
 *
 * Each adapter is a versioned contract that maps a source format into
 * OpenAgentAudit canonical events. See docs/adapter-contract.md.
 *
 * Status: skeleton. Adapter implementation begins after the schema
 * freeze gate clears; see docs/schema-versioning.md.
 */

import type { AuditRun, CanonicalEvent } from '@openagentaudit/schema';

export interface SourceFormatAdapter<TSource> {
  readonly id: string;
  readonly version: string;
  beginRun(input: TSource): AuditRun;
  toEvents(record: TSource): CanonicalEvent[];
  finalizeRun?(run: AuditRun): AuditRun;
}

export interface AdapterCoverage {
  source_records_total: number;
  events_emitted: number;
  fields_populated: Record<string, number>;
  fields_missing: Record<string, number>;
  notes: string[];
}

// Adapter modules — placeholders.
export * as aepV0_2 from './aep-v0_2.js';
export * as complianceEvalRecord from './compliance-eval-record.js';
export * as bscode from './bscode.js';
export * as otel from './otel.js';
export * as langfuse from './langfuse.js';
export * as langsmith from './langsmith.js';
