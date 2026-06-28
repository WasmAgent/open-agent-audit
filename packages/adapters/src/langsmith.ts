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

  const base = {
    schema_version: SPEC_VERSION,
    run_id: traceId,
    agent_id: agentId,
    model_id: modelId,
    event_id: run.id,
    timestamp: run.start_time,
  } as const;

  // Error event takes priority
  if (run.error !== undefined) {
    const ev: CanonicalEvent = {
      ...base,
      type: 'error',
      actor: 'system',
      error: {
        kind: run.run_type,
        message: run.error,
      },
    };
    return ev;
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

    const ev: CanonicalEvent = {
      ...base,
      type: 'model_output',
      actor: 'agent',
      model_output: {
        ...(tokenCount !== undefined ? { token_count: tokenCount } : {}),
        ...(finishReason !== undefined ? { finish_reason: finishReason } : {}),
      },
    };
    return ev;
  }

  if (run.run_type === 'tool') {
    const ev: CanonicalEvent = {
      ...base,
      type: 'tool_call',
      actor: 'agent',
      tool: {
        name: run.name,
      },
    };
    return ev;
  }

  if (run.run_type === 'retriever') {
    const ev: CanonicalEvent = {
      ...base,
      type: 'observation',
      actor: 'tool',
      observation: {
        source: 'retriever:' + run.name,
      },
    };
    return ev;
  }

  if (run.run_type === 'chain') {
    const ev: CanonicalEvent = {
      ...base,
      type: 'observation',
      actor: 'agent',
      observation: {
        source: 'chain:' + run.name,
      },
    };
    return ev;
  }

  // Default: embedding, prompt, parser, or unknown
  const ev: CanonicalEvent = {
    ...base,
    type: 'observation',
    actor: 'system',
    observation: {
      source: 'langsmith:' + run.name,
    },
  };
  return ev;
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
