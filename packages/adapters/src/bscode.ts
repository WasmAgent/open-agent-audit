/**
 * bscode RolloutWireRecord -> CanonicalEvent adapter.
 *
 * Converts bscode rollout JSONL records (rollout-wire/v1) into OpenAgentAudit
 * canonical events. No Node.js APIs are used; the code runs in Cloudflare Workers.
 */

import type { AuditRun, CanonicalEvent } from '@openagentaudit/schema';
import type { SourceFormatAdapter } from './index.js';

// ---------------------------------------------------------------------------
// Local RolloutWireRecord type — mirrors bscode without importing it.
// ---------------------------------------------------------------------------

export interface ToolCallEvent {
  event: 'tool_call' | 'tool_result';
  data: Record<string, unknown>;
  timestamp_ms?: number;
}

export interface BuildResultSnapshot {
  status: 'success' | 'failed' | 'running' | 'unknown';
  exitCode?: number;
  stderr?: string;
  wallTimeMs?: number;
  ranAtMs: number;
}

export interface RolloutProvenance {
  source: 'bscode';
  session_id: string;
  job_id: string;
  exported_at_ms: number;
  schema_version?: string;
  evidence_source?: string;
  redaction_version?: string;
}

export interface RolloutWireRecord {
  schema_version: 'rollout-wire/v1';
  rollout_id: string;
  task: string;
  branch_index: number;
  temperature: number;
  session_id: string;
  tool_call_sequence: ToolCallEvent[];
  final_answer: string;
  build_result: BuildResultSnapshot | null;
  objective_score: 0 | 1;
  objective_status: 'pass' | 'fail' | 'unknown';
  rank: number;
  total_score: number;
  provenance: RolloutProvenance;
  aep_evidence?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Upstream provenance
// ---------------------------------------------------------------------------

/**
 * Upstream provenance fields extracted from a RolloutWireRecord.
 * Consumers (CLI, Worker) can attach these to ReportMeta to preserve
 * the full audit trail back to the originating bscode rollout.
 */
export interface BscodeProvenance {
  job_id: string;
  exported_at_ms: number;
  evidence_source: string;
  redaction_version: string;
  batch_manifest_hash?: string;
  objective_status: string;
  objective_score: number;
}

/**
 * Extract upstream provenance fields from a RolloutWireRecord.
 * evidence_source and redaction_version fall back to empty string when
 * the optional RolloutProvenance fields are absent.
 */
export function getProvenance(record: RolloutWireRecord): BscodeProvenance {
  const prov: BscodeProvenance = {
    job_id: record.provenance.job_id,
    exported_at_ms: record.provenance.exported_at_ms,
    evidence_source: record.provenance.evidence_source ?? '',
    redaction_version: record.provenance.redaction_version ?? '',
    objective_status: record.objective_status,
    objective_score: record.objective_score,
  };

  // batch_manifest_hash is not present on RolloutProvenance today; reserve
  // the slot for forward compatibility and omit it unless a caller sets it.

  return prov;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SPEC_VERSION = 'open-agent-audit/v0.1' as const;

function makeEventId(raw: string): string {
  return btoa(raw);
}

function msToIso(ms: number): string {
  return new Date(ms).toISOString();
}

// ---------------------------------------------------------------------------
// Adapter implementation
// ---------------------------------------------------------------------------

function toEvents(record: RolloutWireRecord): CanonicalEvent[] {
  const events: CanonicalEvent[] = [];

  const runId = record.rollout_id;
  const sessionId = record.session_id;
  const fallbackTs = record.provenance.exported_at_ms;

  let idx = 0;

  function nextEvent(
    partial: Omit<CanonicalEvent, 'schema_version' | 'run_id' | 'session_id' | 'agent_id' | 'model_id' | 'event_id'>,
  ): CanonicalEvent {
    const i = idx++;
    const eventId = makeEventId(`${runId}:${i}`);

    return {
      schema_version: SPEC_VERSION,
      run_id: runId,
      session_id: sessionId,
      agent_id: 'bscode-agent',
      model_id: 'unknown',
      event_id: eventId,
      ...partial,
    };
  }

  // -- Tool call sequence --------------------------------------------------
  for (const ev of record.tool_call_sequence) {
    const ts = msToIso(ev.timestamp_ms ?? fallbackTs);

    if (ev.event === 'tool_call') {
      const toolName =
        typeof ev.data['name'] === 'string' ? ev.data['name'] : 'unknown';

      events.push(
        nextEvent({
          timestamp: ts,
          type: 'tool_call',
          actor: 'agent',
          tool: {
            name: toolName,
          },
        }),
      );
    } else if (ev.event === 'tool_result') {
      events.push(
        nextEvent({
          timestamp: ts,
          type: 'observation',
          actor: 'tool',
          observation: {
            source: 'tool_result',
          },
        }),
      );
    }
  }

  // -- Final answer --------------------------------------------------------
  events.push(
    nextEvent({
      timestamp: msToIso(fallbackTs),
      type: 'final_answer',
      actor: 'agent',
    }),
  );

  // -- Build result --------------------------------------------------------
  if (record.build_result !== null) {
    const br = record.build_result;

    events.push(
      nextEvent({
        timestamp: msToIso(br.ranAtMs),
        type: 'observation',
        actor: 'system',
        observation: {
          source: 'build_verifier',
        },
      }),
    );

    // Emit a verifier observation when objective passed.
    if (record.objective_score === 1) {
      events.push(
        nextEvent({
          timestamp: msToIso(br.ranAtMs),
          type: 'observation',
          actor: 'system',
          observation: {
            source: 'verifier:bscode-build-verifier',
          },
        }),
      );
    }
  }

  return events;
}

function beginRun(record: RolloutWireRecord): AuditRun {
  const description = record.task.length > 200 ? record.task.slice(0, 200) : record.task;

  return {
    schema_version: SPEC_VERSION,
    run_id: record.rollout_id,
    session_id: record.session_id,
    agent_id: 'bscode-agent',
    model_id: 'unknown',
    created_at: msToIso(record.provenance.exported_at_ms),
    event_count: 0,
    source_adapter: 'bscode-rollout-v1',
    input_format: 'rollout-wire/v1',
    task: {
      id: record.rollout_id,
      description,
      risk_level: 'low',
    },
  };
}

export const id = 'bscode-rollout-v1' as const;
export const version = '0.1.0' as const;

export const BscodeAdapter: SourceFormatAdapter<RolloutWireRecord> = {
  id,
  version,
  beginRun,
  toEvents,
};
