/**
 * Shared mapping utilities for source-format adapters.
 *
 * These helpers capture the repeated mapping logic used across the
 * langsmith, langfuse, otel, and aep-v0_2 adapters when translating
 * vendor-specific trace / span records into CanonicalEvents. Keeping them
 * in one typed place avoids drift in the per-event shape (actor, type,
 * optional sub-objects) and lets each adapter focus on its own field
 * extraction.
 *
 * No Node.js APIs are used; this module is compatible with Cloudflare
 * Workers / Web Crypto runtimes.
 */

import type { Actor, CanonicalEvent } from '@openagentaudit/schema';
import { SPEC_VERSION } from '@openagentaudit/schema';

// ---------------------------------------------------------------------------
// Timestamp conversion
// ---------------------------------------------------------------------------

/** Convert a millisecond Unix timestamp to an ISO-8601 string. */
export function msToIso(ms: number): string {
  return new Date(ms).toISOString();
}

/** Convert a nanosecond Unix timestamp to an ISO-8601 string. */
export function nanoToIso(nanos: number): string {
  return new Date(nanos / 1e6).toISOString();
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

/** Base64-encode an arbitrary UTF-8 string.
 * `btoa` throws InvalidCharacterError for any code point above U+00FF, and
 * adapter inputs (run ids, rollout ids) are arbitrary external strings — so
 * the input is UTF-8 encoded first. */
export function base64Utf8(raw: string): string {
  const bytes = new TextEncoder().encode(raw);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

// ---------------------------------------------------------------------------
// Event base
// ---------------------------------------------------------------------------

/**
 * The fields common to every CanonicalEvent regardless of source format.
 * Adapters build this once per source record and pass it to the variant
 * factories below, which spread it into the final event.
 */
export interface EventBase {
  schema_version: typeof SPEC_VERSION;
  run_id: string;
  agent_id: string;
  model_id: string;
  event_id: string;
  timestamp: string;
}

/**
 * Input for {@link buildEventBase} — everything except `schema_version`,
 * which the helper stamps in for the caller.
 */
export interface EventBaseInput {
  run_id: string;
  agent_id: string;
  model_id: string;
  event_id: string;
  timestamp: string;
}

/**
 * Build the common base fields shared by every CanonicalEvent. The returned
 * object is meant to be spread into a typed variant via the make*Event helpers.
 */
export function buildEventBase(input: EventBaseInput): EventBase {
  return {
    schema_version: SPEC_VERSION,
    run_id: input.run_id,
    agent_id: input.agent_id,
    model_id: input.model_id,
    event_id: input.event_id,
    timestamp: input.timestamp,
  };
}

// ---------------------------------------------------------------------------
// Variant factories
//
// Each factory spreads an EventBase and layers on the type-specific fields,
// producing a fully-formed CanonicalEvent. Optional sub-fields are omitted
// (not set to undefined) so the output matches the hand-written adapters.
// ---------------------------------------------------------------------------

/** Build an `error` event (actor: system). */
export function makeErrorEvent(
  base: EventBase,
  error: { kind: string; message: string },
): CanonicalEvent {
  return {
    ...base,
    type: 'error',
    actor: 'system',
    error,
  };
}

/** Build a `model_output` event (actor: agent). token_count / finish_reason are omitted when undefined. */
export function makeModelOutputEvent(
  base: EventBase,
  model_output: { token_count?: number | undefined; finish_reason?: string | undefined },
): CanonicalEvent {
  const out: NonNullable<CanonicalEvent['model_output']> = {};
  if (model_output.token_count !== undefined) {
    out.token_count = model_output.token_count;
  }
  if (model_output.finish_reason !== undefined) {
    out.finish_reason = model_output.finish_reason;
  }
  return {
    ...base,
    type: 'model_output',
    actor: 'agent',
    model_output: out,
  };
}

/** Build a `tool_call` event (actor: agent). capability is omitted when undefined. */
export function makeToolCallEvent(
  base: EventBase,
  tool: { name: string; capability?: string | undefined },
): CanonicalEvent {
  const t: NonNullable<CanonicalEvent['tool']> = { name: tool.name };
  if (tool.capability !== undefined) {
    t.capability = tool.capability;
  }
  return {
    ...base,
    type: 'tool_call',
    actor: 'agent',
    tool: t,
  };
}

/** Build an `observation` event with a configurable actor. */
export function makeObservationEvent(
  base: EventBase,
  observation: { actor: Actor; source: string },
): CanonicalEvent {
  return {
    ...base,
    type: 'observation',
    actor: observation.actor,
    observation: { source: observation.source },
  };
}
