/**
 * @openagentaudit/adapters — Source-format adapters.
 *
 * Each adapter is a versioned pure function that maps a source format into
 * OpenAgentAudit canonical events. See docs/adapter-contract.md.
 */

import type { AuditRun, CanonicalEvent } from '@openagentaudit/schema';

export interface SourceFormatAdapter<TSource> {
  readonly id: string;
  readonly version: string;
  beginRun(input: TSource): AuditRun;
  toEvents(record: TSource): CanonicalEvent[];
  /**
   * Convert multiple source records into a single flat array of CanonicalEvents.
   *
   * This method maintains hash-chain continuity across record boundaries,
   * producing one continuous event stream suitable for aggregate reporting.
   * Useful when auditing a batch of AEP records from the same agent session
   * or across multiple runs.
   *
   * @param records - Array of source-format records to convert.
   * @param initialPrevHash - Optional starting prev_hash for the chain (defaults to 64 zero chars).
   * @returns A flat array of CanonicalEvents with a continuous evidence hash chain.
   */
  toEventsBatch?(records: TSource[], initialPrevHash?: string): CanonicalEvent[];
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
export * as aepRecord from './aep-record.js';

// Shared mapping utilities reused across adapters (event base + variant
// factories + timestamp converters). See mapping-utils.ts.
export * as mappingUtils from './mapping-utils.js';
