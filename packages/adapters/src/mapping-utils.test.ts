/**
 * Tests for the shared adapter mapping utilities.
 */

import { describe, expect, it } from 'bun:test';
import {
  buildEventBase,
  makeErrorEvent,
  makeModelOutputEvent,
  makeObservationEvent,
  makeToolCallEvent,
  msToIso,
  nanoToIso,
} from './mapping-utils.js';
import type { EventBase } from './mapping-utils.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function baseFixture(overrides: Partial<EventBase> = {}): EventBase {
  return buildEventBase({
    run_id: 'run-1',
    agent_id: 'agent-1',
    model_id: 'model-1',
    event_id: 'event-1',
    timestamp: '2024-01-15T10:00:00.000Z',
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Timestamp converters
// ---------------------------------------------------------------------------

describe('msToIso', () => {
  it('converts a millisecond epoch to an ISO-8601 string', () => {
    expect(msToIso(0)).toBe('1970-01-01T00:00:00.000Z');
  });

  it('produces a parseable Date', () => {
    const iso = msToIso(1_700_000_000_000);
    expect(new Date(iso).getTime()).toBe(1_700_000_000_000);
  });
});

describe('nanoToIso', () => {
  it('converts a nanosecond epoch by dividing by 1e6', () => {
    expect(nanoToIso(0)).toBe('1970-01-01T00:00:00.000Z');
  });

  it('agrees with msToIso for the same instant', () => {
    const ms = 1_700_000_000_000;
    expect(nanoToIso(ms * 1e6)).toBe(msToIso(ms));
  });
});

// ---------------------------------------------------------------------------
// buildEventBase
// ---------------------------------------------------------------------------

describe('buildEventBase', () => {
  it('stamps the canonical schema_version', () => {
    expect(baseFixture().schema_version).toBe('open-agent-audit/v0.1');
  });

  it('copies through the provided identifiers', () => {
    const base = baseFixture();
    expect(base.run_id).toBe('run-1');
    expect(base.agent_id).toBe('agent-1');
    expect(base.model_id).toBe('model-1');
    expect(base.event_id).toBe('event-1');
    expect(base.timestamp).toBe('2024-01-15T10:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// makeErrorEvent
// ---------------------------------------------------------------------------

describe('makeErrorEvent', () => {
  it('produces an error event with actor system', () => {
    const ev = makeErrorEvent(baseFixture(), { kind: 'Timeout', message: 'timed out' });
    expect(ev.type).toBe('error');
    expect(ev.actor).toBe('system');
    expect(ev.error).toEqual({ kind: 'Timeout', message: 'timed out' });
  });

  it('preserves base fields', () => {
    const ev = makeErrorEvent(baseFixture(), { kind: 'k', message: 'm' });
    expect(ev.run_id).toBe('run-1');
    expect(ev.event_id).toBe('event-1');
  });
});

// ---------------------------------------------------------------------------
// makeModelOutputEvent
// ---------------------------------------------------------------------------

describe('makeModelOutputEvent', () => {
  it('includes both token_count and finish_reason when provided', () => {
    const ev = makeModelOutputEvent(baseFixture(), { token_count: 42, finish_reason: 'stop' });
    expect(ev.type).toBe('model_output');
    expect(ev.actor).toBe('agent');
    expect(ev.model_output?.token_count).toBe(42);
    expect(ev.model_output?.finish_reason).toBe('stop');
  });

  it('omits token_count and finish_reason keys entirely when undefined', () => {
    const ev = makeModelOutputEvent(baseFixture(), {});
    expect(ev.model_output).toEqual({});
    expect('token_count' in (ev.model_output ?? {})).toBe(false);
    expect('finish_reason' in (ev.model_output ?? {})).toBe(false);
  });

  it('includes only token_count when finish_reason is absent', () => {
    const ev = makeModelOutputEvent(baseFixture(), { token_count: 7 });
    expect(ev.model_output?.token_count).toBe(7);
    expect(ev.model_output?.finish_reason).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// makeToolCallEvent
// ---------------------------------------------------------------------------

describe('makeToolCallEvent', () => {
  it('includes capability when provided', () => {
    const ev = makeToolCallEvent(baseFixture(), { name: 'web_search', capability: 'web_search' });
    expect(ev.type).toBe('tool_call');
    expect(ev.actor).toBe('agent');
    expect(ev.tool).toEqual({ name: 'web_search', capability: 'web_search' });
  });

  it('omits the capability key entirely when undefined', () => {
    const ev = makeToolCallEvent(baseFixture(), { name: 'bash' });
    expect(ev.tool).toEqual({ name: 'bash' });
    expect('capability' in (ev.tool ?? {})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// makeObservationEvent
// ---------------------------------------------------------------------------

describe('makeObservationEvent', () => {
  it('honours the actor argument and sets the source', () => {
    const ev = makeObservationEvent(baseFixture(), { actor: 'tool', source: 'retriever:vec' });
    expect(ev.type).toBe('observation');
    expect(ev.actor).toBe('tool');
    expect(ev.observation).toEqual({ source: 'retriever:vec' });
  });

  it('supports any valid actor', () => {
    const ev = makeObservationEvent(baseFixture(), { actor: 'system', source: 'otel:chat' });
    expect(ev.actor).toBe('system');
  });
});
