import { describe, expect, it } from 'bun:test';
import { contamination } from './index.js';
import type { CanonicalEvent } from '@openagentaudit/schema';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

let _idCounter = 0;

function makeEvent(
  overrides: Partial<CanonicalEvent> & { event_id?: string } = {},
): CanonicalEvent {
  _idCounter++;
  return {
    schema_version: 'open-agent-audit/v0.1',
    run_id: 'run-test',
    agent_id: 'agent-test',
    model_id: 'model-test',
    event_id: overrides.event_id ?? `evt-${_idCounter}`,
    timestamp: '2024-01-01T00:00:00.000Z',
    type: 'tool_call',
    actor: 'agent',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Empty train set
// ---------------------------------------------------------------------------

describe('contamination — empty train set', () => {
  it('returns contamination_score=0 and no pairs', async () => {
    const result = await contamination([], [makeEvent()]);
    expect(result.contamination_score).toBe(0);
    expect(result.pairs).toEqual([]);
    expect(result.high_similarity_pairs).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Empty test set
// ---------------------------------------------------------------------------

describe('contamination — empty test set', () => {
  it('returns contamination_score=0 and no pairs', async () => {
    const result = await contamination([makeEvent()], []);
    expect(result.contamination_score).toBe(0);
    expect(result.pairs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. Exact match by event_id
// ---------------------------------------------------------------------------

describe('contamination — exact method, same event_id', () => {
  it('produces a pair with similarity 1.0', async () => {
    const shared = makeEvent({ event_id: 'shared-id' });
    const trainClone = { ...shared };
    const testClone = { ...shared };

    const result = await contamination([trainClone], [testClone], { method: 'exact' });

    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0]!.similarity).toBe(1.0);
    expect(result.pairs[0]!.train_event_id).toBe('shared-id');
    expect(result.pairs[0]!.test_event_id).toBe('shared-id');
    expect(result.pairs[0]!.method).toBe('exact');
  });
});

// ---------------------------------------------------------------------------
// 4. Same tool name + type → similarity 0.9 in exact method
// ---------------------------------------------------------------------------

describe('contamination — exact method, same tool name and type', () => {
  it('produces a pair with similarity 0.9', async () => {
    const train = makeEvent({ event_id: 'train-1', type: 'tool_call', tool: { name: 'bash' } });
    const test = makeEvent({ event_id: 'test-1', type: 'tool_call', tool: { name: 'bash' } });

    const result = await contamination([train], [test], { method: 'exact', threshold: 0.8 });

    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0]!.similarity).toBe(0.9);
  });

  it('reports correct method on each pair', async () => {
    const train = makeEvent({ event_id: 'train-2', type: 'tool_call', tool: { name: 'read_file' } });
    const test = makeEvent({ event_id: 'test-2', type: 'tool_call', tool: { name: 'read_file' } });

    const result = await contamination([train], [test], { method: 'exact' });

    expect(result.method).toBe('exact');
    expect(result.pairs[0]!.method).toBe('exact');
  });
});

// ---------------------------------------------------------------------------
// 5. Different types → similarity 0 in exact method
// ---------------------------------------------------------------------------

describe('contamination — exact method, different types', () => {
  it('produces no pairs when types differ', async () => {
    const train = makeEvent({ event_id: 'train-3', type: 'tool_call', tool: { name: 'bash' } });
    const test = makeEvent({ event_id: 'test-3', type: 'observation', tool: { name: 'bash' } });

    const result = await contamination([train], [test], { method: 'exact', threshold: 0.8 });

    expect(result.pairs).toHaveLength(0);
    expect(result.contamination_score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 6. ngram method: identical tokenString → high similarity
// ---------------------------------------------------------------------------

describe('contamination — ngram method, identical events', () => {
  it('produces similarity 1.0 for events with the same token string', async () => {
    const base = makeEvent({
      type: 'tool_call',
      actor: 'agent',
      tool: { name: 'bash' },
    });
    const train = { ...base, event_id: 'train-ng-1' };
    const test = { ...base, event_id: 'test-ng-1' };

    const result = await contamination([train], [test], { method: 'ngram', threshold: 0.8 });

    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0]!.similarity).toBe(1.0);
    expect(result.pairs[0]!.method).toBe('ngram');
  });
});

// ---------------------------------------------------------------------------
// 7. ngram method: completely different events → similarity below threshold
// ---------------------------------------------------------------------------

describe('contamination — ngram method, completely different events', () => {
  it('produces no pairs when events are structurally dissimilar', async () => {
    const train = makeEvent({
      event_id: 'train-ng-2',
      type: 'tool_call',
      actor: 'agent',
      tool: { name: 'bash' },
    });
    const test = makeEvent({
      event_id: 'test-ng-2',
      type: 'observation',
      actor: 'system',
      observation: { source: 'filesystem' },
    });

    const result = await contamination([train], [test], { method: 'ngram', threshold: 0.8 });

    // Different type means ngramSimilarity returns 0.0, so no pairs above threshold
    expect(result.pairs).toHaveLength(0);
  });

  it('similarity is zero when types differ (ngram pre-filter)', async () => {
    const train = makeEvent({ event_id: 'tr-ngf', type: 'tool_call', actor: 'agent' });
    const test = makeEvent({ event_id: 'te-ngf', type: 'error', actor: 'system' });

    // With threshold 0.0, similarity >= 0.0 is always true, so the pair IS included —
    // but ngramSimilarity short-circuits to 0.0 for different types.
    const result = await contamination([train], [test], { method: 'ngram', threshold: 0.0 });

    const matchingPair = result.pairs.find(
      p => p.train_event_id === 'tr-ngf' && p.test_event_id === 'te-ngf',
    );
    expect(matchingPair).toBeDefined();
    expect(matchingPair!.similarity).toBe(0.0);

    // With a positive threshold the pair is excluded entirely
    const strict = await contamination([train], [test], { method: 'ngram', threshold: 0.01 });
    expect(strict.pairs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 8. minhash method: identical events → high similarity
// ---------------------------------------------------------------------------

describe('contamination — minhash method, identical events', () => {
  it('produces similarity 1.0 for identical token strings', async () => {
    const base = makeEvent({
      type: 'model_output',
      actor: 'agent',
      tool: { name: 'summarise' },
    });
    const train = { ...base, event_id: 'train-mh-1' };
    const test = { ...base, event_id: 'test-mh-1' };

    const result = await contamination([train], [test], { method: 'minhash', threshold: 0.8 });

    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0]!.similarity).toBe(1.0);
    expect(result.pairs[0]!.method).toBe('minhash');
  });
});

// ---------------------------------------------------------------------------
// 9. contamination_score scales with number of high-similarity pairs
// ---------------------------------------------------------------------------

describe('contamination — score scaling', () => {
  it('score is higher when more pairs match', async () => {
    // 4 train × 1 test, all sharing same event_id pattern via same tool name
    const train1 = makeEvent({ event_id: 'sc-tr-1', type: 'tool_call', tool: { name: 'x' } });
    const train2 = makeEvent({ event_id: 'sc-tr-2', type: 'tool_call', tool: { name: 'x' } });
    const test1 = makeEvent({ event_id: 'sc-te-1', type: 'tool_call', tool: { name: 'x' } });

    // 2 train events matching 1 test: 2 out of 2 candidate pairs → score 100
    const result = await contamination([train1, train2], [test1], { method: 'exact', threshold: 0.8 });

    expect(result.high_similarity_pairs).toBe(2);
    expect(result.candidate_pairs).toBe(2);
    // score = min(100, round(2/2 * 500)) = min(100, 500) = 100
    expect(result.contamination_score).toBe(100);
  });

  it('score is 0 when no pairs match', async () => {
    const train = makeEvent({ event_id: 'sc-no-tr', type: 'tool_call', tool: { name: 'alpha' } });
    const test = makeEvent({ event_id: 'sc-no-te', type: 'error', actor: 'system' });

    const result = await contamination([train], [test], { method: 'exact', threshold: 0.8 });

    expect(result.contamination_score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 10. threshold option: raising threshold reduces pairs found
// ---------------------------------------------------------------------------

describe('contamination — threshold option', () => {
  it('lowering threshold from 1.0 to 0.85 exposes similarity-0.9 pairs', async () => {
    const train = makeEvent({ event_id: 'th-tr-1', type: 'tool_call', tool: { name: 'write' } });
    const test = makeEvent({ event_id: 'th-te-1', type: 'tool_call', tool: { name: 'write' } });

    const strict = await contamination([train], [test], { method: 'exact', threshold: 1.0 });
    const loose = await contamination([train], [test], { method: 'exact', threshold: 0.85 });

    expect(strict.pairs).toHaveLength(0);
    expect(loose.pairs).toHaveLength(1);
  });

  it('result reflects the requested threshold value', async () => {
    const result = await contamination([], [], { threshold: 0.95 });
    expect(result.threshold).toBe(0.95);
  });

  it('default threshold is 0.8', async () => {
    const result = await contamination([], []);
    expect(result.threshold).toBe(0.8);
  });
});

// ---------------------------------------------------------------------------
// 11. method option: explicit 'ngram' forces ngram even for small sets
// ---------------------------------------------------------------------------

describe('contamination — method option', () => {
  it('uses ngram when explicitly requested even for small pair counts', async () => {
    const base = makeEvent({ type: 'tool_call', actor: 'agent', tool: { name: 'fetch' } });
    const train = { ...base, event_id: 'mopt-tr-1' };
    const test = { ...base, event_id: 'mopt-te-1' };

    const result = await contamination([train], [test], { method: 'ngram' });

    expect(result.method).toBe('ngram');
    expect(result.pairs[0]!.method).toBe('ngram');
  });

  it('auto-selects exact when total pairs <= 10000 and no method specified', async () => {
    const train = makeEvent();
    const test = makeEvent();

    const result = await contamination([train], [test]);

    expect(result.method).toBe('exact');
  });

  it('uses minhash when explicitly requested', async () => {
    const base = makeEvent({ type: 'tool_call', actor: 'agent', tool: { name: 'grep' } });
    const train = { ...base, event_id: 'mh-opt-tr' };
    const test = { ...base, event_id: 'mh-opt-te' };

    const result = await contamination([train], [test], { method: 'minhash' });

    expect(result.method).toBe('minhash');
    expect(result.pairs[0]!.method).toBe('minhash');
  });
});

// ---------------------------------------------------------------------------
// 12. High contamination_score capped at 100
// ---------------------------------------------------------------------------

describe('contamination — score capped at 100', () => {
  it('contamination_score never exceeds 100', async () => {
    // Create many matching pairs to drive the raw score above 100
    const trains = Array.from({ length: 10 }, (_, i) =>
      makeEvent({ event_id: `cap-tr-${i}`, type: 'tool_call', tool: { name: 'tool-x' } }),
    );
    const tests = Array.from({ length: 10 }, (_, i) =>
      makeEvent({ event_id: `cap-te-${i}`, type: 'tool_call', tool: { name: 'tool-x' } }),
    );

    // 10 × 10 = 100 candidate pairs, all with similarity 0.9 (same tool name + type)
    const result = await contamination(trains, tests, { method: 'exact', threshold: 0.8 });

    expect(result.contamination_score).toBeLessThanOrEqual(100);
    expect(result.contamination_score).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// 13. Structural integrity: result fields
// ---------------------------------------------------------------------------

describe('contamination — result structure', () => {
  it('always returns all required fields', async () => {
    const result = await contamination([], []);

    expect(result).toHaveProperty('candidate_pairs');
    expect(result).toHaveProperty('high_similarity_pairs');
    expect(result).toHaveProperty('threshold');
    expect(result).toHaveProperty('method');
    expect(result).toHaveProperty('pairs');
    expect(result).toHaveProperty('contamination_score');
    expect(Array.isArray(result.pairs)).toBe(true);
  });

  it('candidate_pairs equals trainEvents.length × testEvents.length', async () => {
    const trains = [makeEvent(), makeEvent(), makeEvent()];
    const tests = [makeEvent(), makeEvent()];

    const result = await contamination(trains, tests, { method: 'exact' });

    expect(result.candidate_pairs).toBe(6);
  });
});
