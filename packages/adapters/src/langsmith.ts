/**
 * LangSmith export adapter.
 *
 * Maps LangSmith trace exports into OpenAgentAudit CanonicalEvents.
 * No Node.js APIs are used; this module is compatible with Cloudflare
 * Workers / Web Crypto runtimes.
 */

import type { AuditRun, CanonicalEvent } from '@openagentaudit/schema';
import { SPEC_VERSION } from '@openagentaudit/schema';
import type { SourceFormatAdapter } from './index.js';
import {
  buildEventBase,
  makeErrorEvent,
  makeModelOutputEvent,
  makeObservationEvent,
  makeToolCallEvent,
} from './mapping-utils.js';

// ---------------------------------------------------------------------------
// Public LangSmith input types
// ---------------------------------------------------------------------------

export interface LangSmithRun {
  id: string;
  name: string;
  run_type: 'llm' | 'chain' | 'tool' | 'retriever' | 'embedding' | 'prompt' | 'parser';
  start_time: string;
  end_time?: string;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  error?: string;
  extra?: Record<string, unknown>;
  tags?: string[];
  parent_run_id?: string;
  trace_id: string;
  session_name?: string;
  execution_order?: number;
  child_runs?: LangSmithRun[];
}

export interface LangSmithTrace {
  id: string;
  name?: string;
  start_time: string;
  runs: LangSmithRun[];
}

// ---------------------------------------------------------------------------
// Adapter id / version
// ---------------------------------------------------------------------------

export const id = 'langsmith-export-v0.1' as const;
export const version = '0.1.0' as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map a single LangSmithRun to a CanonicalEvent. */
function runToEvent(run: LangSmithRun, traceId: string, agentId: string): CanonicalEvent {
  const modelId =
    (run.extra?.['invocation_params'] as Record<string, unknown> | undefined)?.[
      'model_name'
    ] as string | undefined ??
    run.name ??
    'unknown';

  const base = buildEventBase({
    run_id: traceId,
    agent_id: agentId,
    model_id: modelId,
    event_id: run.id,
    timestamp: run.start_time,
  });

  // Error event takes priority
  if (run.error !== undefined) {
    return makeErrorEvent(base, { kind: run.run_type, message: run.error });
  }

  if (run.run_type === 'llm') {
    const tokenCount = (
      (run.outputs?.['llm_output'] as Record<string, unknown> | undefined)?.[
        'token_usage'
      ] as Record<string, unknown> | undefined
    )?.['total_tokens'] as number | undefined;

    const finishReason = (
      (
        (run.outputs?.['generations'] as unknown[][] | undefined)?.[0]?.[0] as
          | Record<string, unknown>
          | undefined
      )?.['generation_info'] as Record<string, unknown> | undefined
    )?.['finish_reason'] as string | undefined;

    return makeModelOutputEvent(base, {
      token_count: tokenCount,
      finish_reason: finishReason,
    });
  }

  if (run.run_type === 'tool') {
    return makeToolCallEvent(base, { name: run.name });
  }

  if (run.run_type === 'retriever') {
    return makeObservationEvent(base, { actor: 'tool', source: 'retriever:' + run.name });
  }

  if (run.run_type === 'chain') {
    return makeObservationEvent(base, { actor: 'agent', source: 'chain:' + run.name });
  }

  // Default: embedding, prompt, parser, or unknown
  return makeObservationEvent(base, { actor: 'system', source: 'langsmith:' + run.name });
}

// ---------------------------------------------------------------------------
// Adapter implementation
// ---------------------------------------------------------------------------

function toEvents(record: LangSmithTrace): CanonicalEvent[] {
  const agentId = record.name ?? 'langsmith-agent';
  return record.runs.map((run) => runToEvent(run, record.id, agentId));
}

function beginRun(record: LangSmithTrace): AuditRun {
  return {
    schema_version: SPEC_VERSION,
    run_id: record.id,
    agent_id: record.name ?? 'langsmith-agent',
    model_id: 'langsmith-import',
    created_at: record.start_time,
    event_count: record.runs.length,
    task: {
      id: 'langsmith-import',
      description: record.name ?? 'LangSmith trace import',
      risk_level: 'low',
    },
    source_adapter: id,
  };
}

export const LangSmithAdapter: SourceFormatAdapter<LangSmithTrace> = {
  id,
  version,
  beginRun,
  toEvents,
};
