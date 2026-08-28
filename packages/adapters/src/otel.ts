/**
 * OpenTelemetry GenAI spans adapter.
 *
 * Maps OTel traces that follow the GenAI semantic conventions into
 * OpenAgentAudit CanonicalEvents.  No Node.js APIs are used; this module is
 * compatible with Cloudflare Workers / Web Crypto runtimes.
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
  nanoToIso,
} from './mapping-utils.js';

// ---------------------------------------------------------------------------
// Public OTel input types
// ---------------------------------------------------------------------------

export interface OtelSpan {
  trace_id: string;
  span_id: string;
  parent_span_id?: string;
  name: string;
  start_time_unix_nano: number;
  end_time_unix_nano: number;
  status?: { code: 'OK' | 'ERROR'; message?: string };
  attributes?: Record<string, string | number | boolean>;
}

export interface OtelTrace {
  resource_spans?: Array<{
    resource?: { attributes?: Record<string, string> };
    scope_spans: Array<{
      spans: OtelSpan[];
    }>;
  }>;
  /** Flat import alternative — a bare list of spans. */
  spans?: OtelSpan[];
}

// ---------------------------------------------------------------------------
// Adapter id / version
// ---------------------------------------------------------------------------

export const id = 'otel-genai-v0.1' as const;
export const version = '0.1.0' as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pull every OtelSpan out of an OtelTrace regardless of nesting form. */
function flattenSpans(record: OtelTrace): Array<{ span: OtelSpan; serviceAttrs: Record<string, string> }> {
  const result: Array<{ span: OtelSpan; serviceAttrs: Record<string, string> }> = [];

  if (record.resource_spans) {
    for (const rs of record.resource_spans) {
      const serviceAttrs = rs.resource?.attributes ?? {};
      for (const ss of rs.scope_spans) {
        for (const span of ss.spans) {
          result.push({ span, serviceAttrs });
        }
      }
    }
  }

  if (record.spans) {
    for (const span of record.spans) {
      result.push({ span, serviceAttrs: {} });
    }
  }

  return result;
}

/** Return the trace_id of the first span found in the record, or a fallback. */
function firstTraceId(record: OtelTrace): string {
  if (record.resource_spans) {
    for (const rs of record.resource_spans) {
      for (const ss of rs.scope_spans) {
        const first = ss.spans[0];
        if (first) return first.trace_id;
      }
    }
  }
  const firstFlat = record.spans?.[0];
  if (firstFlat) return firstFlat.trace_id;
  return 'unknown';
}

/** Derive a stable agent_id from resource / span attributes. */
function agentId(serviceAttrs: Record<string, string>, spanAttrs: Record<string, string | number | boolean>): string {
  return (
    (serviceAttrs['service.name'] as string | undefined) ??
    (spanAttrs['gen_ai.system'] as string | undefined) ??
    'otel-agent'
  );
}

/** Derive a model identifier from span attributes. */
function modelId(spanAttrs: Record<string, string | number | boolean>): string {
  return (
    (spanAttrs['gen_ai.request.model'] as string | undefined) ??
    (spanAttrs['gen_ai.response.model'] as string | undefined) ??
    'unknown'
  );
}

// Operation name sets for classification
const MODEL_OUTPUT_OPS = new Set(['chat', 'text_completion', 'embeddings', 'chat_completion']);
const TOOL_CALL_OPS = new Set(['execute_tool', 'tool_call']);

/** Map a single OtelSpan to a CanonicalEvent. */
function spanToEvent(
  span: OtelSpan,
  serviceAttrs: Record<string, string>,
  runId: string,
): CanonicalEvent {
  const attrs = span.attributes ?? {};
  const opName = (attrs['gen_ai.operation.name'] as string | undefined) ?? span.name;
  const lowerOp = opName.toLowerCase();

  const base = buildEventBase({
    run_id: runId,
    agent_id: agentId(serviceAttrs, attrs),
    model_id: modelId(attrs),
    event_id: span.span_id,
    timestamp: nanoToIso(span.start_time_unix_nano),
  });

  // ERROR spans
  if (span.status?.code === 'ERROR') {
    return makeErrorEvent(base, {
      kind: span.name,
      message: span.status.message ?? 'span error',
    });
  }

  // Model-output operations
  if (MODEL_OUTPUT_OPS.has(lowerOp)) {
    // GenAI semantic-convention usage attributes (the older un-namespaced
    // `gen_ai.input.tokens` / `gen_ai.output.tokens` variants are accepted as
    // a fallback for pre-convention emitters).
    const inputTokens =
      (attrs['gen_ai.usage.input_tokens'] as number | undefined) ??
      (attrs['gen_ai.usage.prompt_tokens'] as number | undefined) ??
      (attrs['gen_ai.input.tokens'] as number | undefined);
    const outputTokens =
      (attrs['gen_ai.usage.output_tokens'] as number | undefined) ??
      (attrs['gen_ai.usage.completion_tokens'] as number | undefined) ??
      (attrs['gen_ai.output.tokens'] as number | undefined);
    const tokenCount =
      inputTokens !== undefined && outputTokens !== undefined
        ? inputTokens + outputTokens
        : inputTokens ?? outputTokens;

    // finish_reasons is defined as a string array in the convention; some
    // emitters ship a comma-joined string instead — accept both.
    const finishReasonsRaw = attrs['gen_ai.response.finish_reasons'];
    let finishReason: string | undefined;
    if (Array.isArray(finishReasonsRaw)) {
      finishReason = finishReasonsRaw.map((r) => String(r).trim()).find((r) => r !== '');
    } else if (typeof finishReasonsRaw === 'string' && finishReasonsRaw !== '') {
      finishReason = finishReasonsRaw.split(',')[0]?.trim() || undefined;
    }

    return makeModelOutputEvent(base, {
      token_count: tokenCount,
      finish_reason: finishReason,
    });
  }

  // Tool-call operations (by op name or by presence of gen_ai.tool.name attribute)
  const toolName = attrs['gen_ai.tool.name'] as string | undefined;
  if (TOOL_CALL_OPS.has(lowerOp) || toolName !== undefined) {
    const resolvedToolName = toolName ?? span.name;
    return makeToolCallEvent(base, { name: resolvedToolName, capability: toolName });
  }

  // Default: observation
  return makeObservationEvent(base, { actor: 'system', source: 'otel:' + span.name });
}

// ---------------------------------------------------------------------------
// Adapter implementation
// ---------------------------------------------------------------------------

function toEvents(record: OtelTrace): CanonicalEvent[] {
  const runId = firstTraceId(record);
  const entries = flattenSpans(record);
  return entries.map(({ span, serviceAttrs }) => spanToEvent(span, serviceAttrs, runId));
}

function beginRun(record: OtelTrace): AuditRun {
  const entries = flattenSpans(record);
  const runId = firstTraceId(record);

  // Derive agent_id and model_id from the first span if available
  let derivedAgentId = 'otel-agent';
  let derivedModelId = 'unknown';
  let createdAt = new Date().toISOString();
  const firstEntry = entries[0];
  if (firstEntry !== undefined) {
    derivedAgentId = agentId(firstEntry.serviceAttrs, firstEntry.span.attributes ?? {});
    derivedModelId = modelId(firstEntry.span.attributes ?? {});
    createdAt = nanoToIso(firstEntry.span.start_time_unix_nano);
  }

  const events = toEvents(record);

  return {
    schema_version: SPEC_VERSION,
    run_id: runId,
    agent_id: derivedAgentId,
    model_id: derivedModelId,
    created_at: createdAt,
    task: {
      id: 'otel-import',
      description: 'Imported from OpenTelemetry trace',
      risk_level: 'low',
    },
    event_count: events.length,
    source_adapter: id,
  };
}

export const OtelAdapter: SourceFormatAdapter<OtelTrace> = {
  id,
  version,
  beginRun,
  toEvents,
};
