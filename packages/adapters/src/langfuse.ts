/**
 * Langfuse export adapter.
 *
 * Maps Langfuse traces (with nested observations) into OpenAgentAudit
 * CanonicalEvents. No Node.js APIs are used; this module is compatible with
 * Cloudflare Workers / Web Crypto runtimes.
 */

import type { AuditRun, CanonicalEvent } from '@openagentaudit/schema';
import { SPEC_VERSION } from '@openagentaudit/schema';
import type { SourceFormatAdapter } from './index.js';

// ---------------------------------------------------------------------------
// Public Langfuse input types
// ---------------------------------------------------------------------------

export interface LangfuseObservation {
  id: string;
  traceId: string;
  name: string;
  type: 'SPAN' | 'GENERATION' | 'EVENT';
  startTime: string;        // ISO 8601
  endTime?: string;
  model?: string;
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
  usage?: { input?: number; output?: number; total?: number };
  level: 'DEFAULT' | 'DEBUG' | 'WARNING' | 'ERROR';
  statusMessage?: string;
  parentObservationId?: string;
}

export interface LangfuseTrace {
  id: string;
  name?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
  input?: unknown;
  output?: unknown;
  createdAt: string;
  observations: LangfuseObservation[];
}

// ---------------------------------------------------------------------------
// Adapter id / version
// ---------------------------------------------------------------------------

export const id = 'langfuse-export-v0.1' as const;
export const version = '0.1.0' as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TOOL_NAME_RE = /tool|function|action|call/i;
const VERIF_NAME_RE = /verif|check|assert/i;

/** Derive agent_id from trace fields. */
function resolveAgentId(record: LangfuseTrace): string {
  return record.userId ?? record.name ?? 'langfuse-agent';
}

/** Map a single LangfuseObservation to a CanonicalEvent. */
function obsToEvent(obs: LangfuseObservation, record: LangfuseTrace): CanonicalEvent {
  const base = {
    schema_version: SPEC_VERSION,
    run_id: record.id,
    agent_id: resolveAgentId(record),
    model_id: obs.model ?? 'unknown',
    event_id: obs.id,
    timestamp: obs.startTime,
  } as const;

  // ERROR level takes priority over type classification
  if (obs.level === 'ERROR') {
    const ev: CanonicalEvent = {
      ...base,
      type: 'error',
      actor: 'system',
      error: {
        kind: obs.name,
        message: obs.statusMessage ?? obs.name,
      },
    };
    return ev;
  }

  // GENERATION → model_output
  if (obs.type === 'GENERATION') {
    const inputTokens = obs.usage?.input ?? 0;
    const outputTokens = obs.usage?.output ?? 0;
    const tokenCount =
      obs.usage?.total !== undefined
        ? obs.usage.total
        : inputTokens + outputTokens || undefined;

    const ev: CanonicalEvent = {
      ...base,
      type: 'model_output',
      actor: 'agent',
      model_output: {
        ...(tokenCount !== undefined ? { token_count: tokenCount } : {}),
        ...(obs.statusMessage ? { finish_reason: obs.statusMessage } : {}),
      },
    };
    return ev;
  }

  // SPAN with tool/function/action/call in the name → tool_call
  if (obs.type === 'SPAN' && TOOL_NAME_RE.test(obs.name)) {
    const ev: CanonicalEvent = {
      ...base,
      type: 'tool_call',
      actor: 'agent',
      tool: {
        name: obs.name,
      },
    };
    return ev;
  }

  // SPAN with verif/check/assert in the name → observation (verifier source)
  if (obs.type === 'SPAN' && VERIF_NAME_RE.test(obs.name)) {
    const ev: CanonicalEvent = {
      ...base,
      type: 'observation',
      actor: 'system',
      observation: {
        source: 'verifier:' + obs.name,
      },
    };
    return ev;
  }

  // EVENT type → observation
  if (obs.type === 'EVENT') {
    const ev: CanonicalEvent = {
      ...base,
      type: 'observation',
      actor: 'system',
      observation: {
        source: 'langfuse:' + obs.name,
      },
    };
    return ev;
  }

  // Default (SPAN with no special name match) → observation
  const ev: CanonicalEvent = {
    ...base,
    type: 'observation',
    actor: 'system',
    observation: {
      source: 'langfuse:' + obs.name,
    },
  };
  return ev;
}

// ---------------------------------------------------------------------------
// Adapter implementation
// ---------------------------------------------------------------------------

function toEvents(record: LangfuseTrace): CanonicalEvent[] {
  return record.observations.map((obs) => obsToEvent(obs, record));
}

function beginRun(record: LangfuseTrace): AuditRun {
  return {
    schema_version: SPEC_VERSION,
    run_id: record.id,
    agent_id: resolveAgentId(record),
    model_id: 'langfuse-import',
    created_at: record.createdAt,
    event_count: record.observations.length,
    task: {
      id: 'langfuse-import',
      description: record.name ?? 'Langfuse trace import',
      risk_level: 'low',
    },
    source_adapter: id,
  };
}

export const LangfuseAdapter: SourceFormatAdapter<LangfuseTrace> = {
  id,
  version,
  beginRun,
  toEvents,
};
