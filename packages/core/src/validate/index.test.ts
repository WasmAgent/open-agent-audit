import { describe, test, expect } from 'bun:test';
import { validate } from './index.js';
import type { CanonicalEvent } from '@openagentaudit/schema';

function makeEvent(overrides: Partial<CanonicalEvent> = {}): CanonicalEvent {
  return {
    schema_version: 'open-agent-audit/v0.1',
    run_id: 'run-001',
    agent_id: 'agent-001',
    model_id: 'model-001',
    event_id: crypto.randomUUID(),
    timestamp: '2024-01-01T00:00:00Z',
    type: 'observation',
    actor: 'system',
    ...overrides,
  };
}

describe('validate', () => {
  // 1. Valid events — no errors, no warnings
  test('valid single event produces no errors and no warnings', async () => {
    const result = await validate([makeEvent()]);
    expect(result.total).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  test('valid multiple events produce no errors and no warnings', async () => {
    const events = [makeEvent(), makeEvent(), makeEvent()];
    const result = await validate(events);
    expect(result.total).toBe(3);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  // 14. Empty event array — valid, total=0, no errors
  test('empty array is valid with total=0', async () => {
    const result = await validate([]);
    expect(result.total).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  // 2. Missing schema_version — error on schema_version field
  test('missing schema_version produces an error', async () => {
    const event = makeEvent({ schema_version: undefined as unknown as 'open-agent-audit/v0.1' });
    const result = await validate([event]);
    expect(result.errors.length).toBeGreaterThan(0);
    const schemaVersionErrors = result.errors.filter(
      (e) => e.path === 'schema_version' || e.path === 'schema',
    );
    expect(schemaVersionErrors.length).toBeGreaterThan(0);
  });

  // 3. Wrong schema_version — error
  test('wrong schema_version produces an error on schema_version path', async () => {
    const event = makeEvent({
      schema_version: 'open-agent-audit/v0.2' as unknown as 'open-agent-audit/v0.1',
    });
    const result = await validate([event]);
    const schemaVersionErrors = result.errors.filter((e) => e.path === 'schema_version');
    expect(schemaVersionErrors.length).toBeGreaterThan(0);
    expect(schemaVersionErrors[0]!.message).toContain('open-agent-audit/v0.1');
  });

  // 4. Missing run_id — error
  test('missing run_id produces an error on run_id path', async () => {
    const event = makeEvent({ run_id: '' });
    const result = await validate([event]);
    const runIdErrors = result.errors.filter((e) => e.path === 'run_id');
    expect(runIdErrors.length).toBeGreaterThan(0);
    expect(runIdErrors[0]!.message).toContain('run_id');
  });

  // 5. Duplicate event_ids — error
  test('duplicate event_ids produce an error', async () => {
    const sharedId = crypto.randomUUID();
    const e1 = makeEvent({ event_id: sharedId });
    const e2 = makeEvent({ event_id: sharedId });
    const result = await validate([e1, e2]);
    const dupErrors = result.errors.filter(
      (e) => e.path === 'event_id' && e.message.includes('Duplicate'),
    );
    expect(dupErrors.length).toBeGreaterThan(0);
    expect(dupErrors[0]!.event_id).toBe(sharedId);
    expect(dupErrors[0]!.message).toContain('index 0');
  });

  // 6. Mixed run_ids (cross-run) — error on all events with different run_id
  test('mixed run_ids produce errors on events with non-first run_id', async () => {
    const e1 = makeEvent({ run_id: 'run-A' });
    const e2 = makeEvent({ run_id: 'run-B' });
    const e3 = makeEvent({ run_id: 'run-A' });
    const result = await validate([e1, e2, e3]);
    const crossRunErrors = result.errors.filter(
      (e) => e.path === 'run_id' && e.message.includes('does not match'),
    );
    // Only e2 (run-B) differs from the first run_id (run-A)
    expect(crossRunErrors.length).toBe(1);
    expect(crossRunErrors[0]!.event_id).toBe(e2.event_id);
  });

  // 7. Invalid timestamp — error
  test('invalid timestamp produces an error on timestamp path', async () => {
    const event = makeEvent({ timestamp: 'not-a-date' });
    const result = await validate([event]);
    const tsErrors = result.errors.filter((e) => e.path === 'timestamp');
    expect(tsErrors.length).toBeGreaterThan(0);
    expect(tsErrors[0]!.message).toContain('not-a-date');
  });

  // 8. Invalid event type — error
  test('invalid event type produces an error on type path', async () => {
    const event = makeEvent({ type: 'unknown_type' as unknown as 'observation' });
    const result = await validate([event]);
    const typeErrors = result.errors.filter((e) => e.path === 'type');
    expect(typeErrors.length).toBeGreaterThan(0);
    expect(typeErrors[0]!.message).toContain('unknown_type');
  });

  // 9. tool_call without tool field — error
  test('tool_call event without tool field produces an error on tool path', async () => {
    const event = makeEvent({ type: 'tool_call', actor: 'agent' });
    const result = await validate([event]);
    const toolErrors = result.errors.filter((e) => e.path === 'tool');
    expect(toolErrors.length).toBeGreaterThan(0);
    expect(toolErrors[0]!.message).toContain('tool field must be present');
  });

  test('tool_call event with tool field is valid', async () => {
    const event = makeEvent({
      type: 'tool_call',
      actor: 'agent',
      tool: { name: 'bash' },
    });
    const result = await validate([event]);
    expect(result.errors.filter((e) => e.path === 'tool')).toHaveLength(0);
  });

  // 10. policy_decision without policy field — error
  test('policy_decision event without policy field produces an error on policy path', async () => {
    const event = makeEvent({ type: 'policy_decision', actor: 'system' });
    const result = await validate([event]);
    const policyErrors = result.errors.filter((e) => e.path === 'policy');
    expect(policyErrors.length).toBeGreaterThan(0);
    expect(policyErrors[0]!.message).toContain('policy field must be present');
  });

  test('policy_decision event with policy field is valid', async () => {
    const event = makeEvent({
      type: 'policy_decision',
      actor: 'system',
      policy: { decision: 'allow', reason: 'Safe operation' },
    });
    const result = await validate([event]);
    expect(result.errors.filter((e) => e.path === 'policy')).toHaveLength(0);
  });

  // 11. Valid hash chain — no chain-linkage warnings; content hash verification
  // NOTE: The hash values here ('abc123', 'def456', 'ghi789') are intentional dummy values
  // and will NOT match the SHA-256 recomputed from event content. The chain-linkage check
  // passes (prev_hash == previous hash), but the content-hash verification emits warnings
  // for each event. This is the correct behavior — content hash verification is intentionally
  // not tested with real SHA-256 values in this test (see hash-content-verification test below).
  test('valid hash chain with correct prev_hash produces no chain-linkage warnings', async () => {
    const e1 = makeEvent({
      event_id: 'evt-1',
      evidence: {
        hash: 'abc123',
        prev_hash: '0'.repeat(64),
      },
    });
    const e2 = makeEvent({
      event_id: 'evt-2',
      evidence: {
        hash: 'def456',
        prev_hash: 'abc123',
      },
    });
    const e3 = makeEvent({
      event_id: 'evt-3',
      evidence: {
        hash: 'ghi789',
        prev_hash: 'def456',
      },
    });
    const result = await validate([e1, e2, e3]);
    expect(result.errors).toHaveLength(0);
    // No chain-linkage warnings (prev_hash == previous hash for all)
    const chainLinkageWarnings = result.warnings.filter(
      (w) => w.path === 'evidence.prev_hash',
    );
    expect(chainLinkageWarnings).toHaveLength(0);
    // Content hash warnings fire because dummy hashes don't match SHA-256
    const contentWarnings = result.warnings.filter(
      (w) => w.path === 'evidence.hash' && w.message.includes('content mismatch'),
    );
    expect(contentWarnings).toHaveLength(3);
    // crypto_summary reflects the mismatches
    expect(result.crypto_summary.events_with_hash).toBe(3);
    expect(result.crypto_summary.hashes_content_mismatch).toBe(3);
    expect(result.crypto_summary.hashes_content_verified).toBe(0);
  });

  // 12. Broken hash chain — warning
  test('broken hash chain produces a warning on evidence.prev_hash path', async () => {
    const e1 = makeEvent({
      event_id: 'evt-1',
      evidence: {
        hash: 'abc123',
        prev_hash: '0'.repeat(64),
      },
    });
    const e2 = makeEvent({
      event_id: 'evt-2',
      evidence: {
        hash: 'def456',
        prev_hash: 'wrong-prev-hash', // should be 'abc123'
      },
    });
    const result = await validate([e1, e2]);
    const chainWarnings = result.warnings.filter((w) => w.path === 'evidence.prev_hash');
    expect(chainWarnings.length).toBeGreaterThan(0);
    expect(chainWarnings[0]!.event_id).toBe('evt-2');
    expect(chainWarnings[0]!.message).toContain('Hash chain broken');
  });

  // 13. Genesis hash with wrong prev_hash (not all zeros) — warning
  test('first chained event with non-zero prev_hash produces a warning', async () => {
    const e1 = makeEvent({
      event_id: 'evt-genesis',
      evidence: {
        hash: 'abc123',
        prev_hash: 'not-all-zeros', // should be '0'.repeat(64)
      },
    });
    const result = await validate([e1]);
    const genesisWarnings = result.warnings.filter((w) => w.path === 'evidence.prev_hash');
    expect(genesisWarnings.length).toBeGreaterThan(0);
    expect(genesisWarnings[0]!.event_id).toBe('evt-genesis');
    expect(genesisWarnings[0]!.message).toContain('genesis hash');
  });

  // Additional edge cases for completeness

  test('result total reflects array length', async () => {
    const events = Array.from({ length: 5 }, () => makeEvent());
    const result = await validate(events);
    expect(result.total).toBe(5);
  });

  test('hash chain missing prev_hash on non-genesis event produces a warning', async () => {
    const e1 = makeEvent({
      event_id: 'evt-1',
      evidence: { hash: 'abc123', prev_hash: '0'.repeat(64) },
    });
    const e2 = makeEvent({
      event_id: 'evt-2',
      // prev_hash absent but hash present — gap warning expected
      evidence: { hash: 'def456' },
    });
    const result = await validate([e1, e2]);
    const gapWarnings = result.warnings.filter(
      (w) => w.path === 'evidence.prev_hash' && w.message.includes('gap'),
    );
    expect(gapWarnings.length).toBeGreaterThan(0);
    expect(gapWarnings[0]!.event_id).toBe('evt-2');
  });

  test('events without evidence.hash are excluded from hash chain checks', async () => {
    const e1 = makeEvent({ event_id: 'evt-no-hash' }); // no evidence at all
    const e2 = makeEvent({ event_id: 'evt-also-no-hash', evidence: {} }); // evidence without hash
    const result = await validate([e1, e2]);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    expect(result.crypto_summary.events_with_hash).toBe(0);
    expect(result.crypto_summary.hashes_content_mismatch).toBe(0);
  });

  test('human_approval without human field produces an error on human path', async () => {
    const event = makeEvent({ type: 'human_approval', actor: 'human_reviewer' });
    const result = await validate([event]);
    const humanErrors = result.errors.filter((e) => e.path === 'human');
    expect(humanErrors.length).toBeGreaterThan(0);
    expect(humanErrors[0]!.message).toContain('human field must be present');
  });

  test('error event without error field produces an error on error path', async () => {
    const event = makeEvent({ type: 'error', actor: 'system' });
    const result = await validate([event]);
    const errFieldErrors = result.errors.filter((e) => e.path === 'error');
    expect(errFieldErrors.length).toBeGreaterThan(0);
    expect(errFieldErrors[0]!.message).toContain('error field must be present');
  });

  // 15. crypto_summary — present on all results
  test('crypto_summary is present on result even when no events have hashes', async () => {
    const result = await validate([makeEvent()]);
    expect(result.crypto_summary).toBeDefined();
    expect(result.crypto_summary.events_with_hash).toBe(0);
    expect(result.crypto_summary.hashes_content_verified).toBe(0);
    expect(result.crypto_summary.hashes_content_mismatch).toBe(0);
    expect(result.crypto_summary.events_with_signature).toBe(0);
  });

  test('crypto_summary counts events_with_signature correctly', async () => {
    const e1 = makeEvent({
      evidence: { hash: 'abc', signature: 'sig1' },
    });
    const e2 = makeEvent({
      evidence: { hash: 'def' },
    });
    const result = await validate([e1, e2]);
    expect(result.crypto_summary.events_with_signature).toBe(1);
    expect(result.crypto_summary.events_with_hash).toBe(2);
  });

  // 16. Hash content mismatch warning — dummy hash triggers warning
  test('event with a non-SHA-256 dummy hash triggers content mismatch warning', async () => {
    const event = makeEvent({
      event_id: 'evt-dummy-hash',
      evidence: {
        hash: 'not-a-real-sha256-hash',
        prev_hash: '0'.repeat(64),
      },
    });
    const result = await validate([event]);
    const contentWarnings = result.warnings.filter(
      (w) => w.path === 'evidence.hash' && w.message.includes('content mismatch'),
    );
    expect(contentWarnings).toHaveLength(1);
    expect(contentWarnings[0]!.event_id).toBe('evt-dummy-hash');
    expect(result.crypto_summary.hashes_content_mismatch).toBe(1);
    expect(result.crypto_summary.hashes_content_verified).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Adversarial fixtures — CONSTRAINTS.md §8
// ---------------------------------------------------------------------------

describe('adversarial fixtures', () => {
  // forged signature: signature_algorithm set but signature missing
  test('forged signature — signature_algorithm 存在但 signature 缺失', async () => {
    const event = makeEvent({
      event_id: 'forged-1',
      evidence: {
        hash: 'abc123',
        signature_algorithm: 'ed25519',
        // signature intentionally absent
      },
    });
    const result = await validate([event]);
    const sigErrors = result.errors.filter((e) => e.path === 'evidence.signature');
    expect(sigErrors.length).toBeGreaterThan(0);
    expect(sigErrors[0]!.event_id).toBe('forged-1');
  });

  // forged signature: signature_algorithm set but signature is empty string
  test('forged signature — signature_algorithm 存在但 signature 为空字符串', async () => {
    const event = makeEvent({
      event_id: 'forged-2',
      evidence: {
        hash: 'abc123',
        signature_algorithm: 'ed25519',
        signature: '',
      },
    });
    const result = await validate([event]);
    const sigErrors = result.errors.filter((e) => e.path === 'evidence.signature');
    expect(sigErrors.length).toBeGreaterThan(0);
    expect(sigErrors[0]!.event_id).toBe('forged-2');
  });

  // replay attack: same event_id appears twice
  test('replay attack — 同一 event_id 出现两次', async () => {
    const sharedId = 'replay-evt-001';
    const e1 = makeEvent({ event_id: sharedId });
    const e2 = makeEvent({ event_id: sharedId });
    const result = await validate([e1, e2]);
    const dupErrors = result.errors.filter(
      (e) => e.message.toLowerCase().includes('duplicate') && e.event_id === sharedId,
    );
    expect(dupErrors.length).toBeGreaterThan(0);
  });

  // replay attack: bulk — 5 different event_ids each appearing 3 times (15 events total)
  test('replay attack — 5 个不同 event_id 各重放 3 次，共 15 个事件', async () => {
    const ids = ['r1', 'r2', 'r3', 'r4', 'r5'];
    const events = ids.flatMap((id) => [
      makeEvent({ event_id: id }),
      makeEvent({ event_id: id }),
      makeEvent({ event_id: id }),
    ]);
    const result = await validate(events);
    // Each of 5 ids has 2 duplicates => at least 10 duplicate errors
    const dupErrors = result.errors.filter((e) =>
      e.message.toLowerCase().includes('duplicate'),
    );
    expect(dupErrors.length).toBeGreaterThanOrEqual(10);
  });

  // schema-violating: invalid event type
  test('schema-violating event — type 为无效值', async () => {
    const event = makeEvent({
      type: 'invalid_event_type' as unknown as 'observation',
    });
    const result = await validate([event]);
    const typeErrors = result.errors.filter((e) => e.path === 'type');
    expect(typeErrors.length).toBeGreaterThan(0);
  });
});

describe('adversarial fixtures', () => {
  // 1. Forged signature — signature_algorithm present but signature missing
  test('forged signature — signature_algorithm present but signature missing', async () => {
    const event = makeEvent({
      evidence: { hash: 'abc', signature_algorithm: 'ed25519' },
    });
    const result = await validate([event]);
    const sigErrors = result.errors.filter((e) => e.path === 'evidence.signature');
    expect(sigErrors.length).toBeGreaterThan(0);
  });

  // 2. Forged signature — signature_algorithm present but signature is empty string
  test('forged signature — signature_algorithm present but signature is empty string', async () => {
    const event = makeEvent({
      evidence: { hash: 'abc', signature_algorithm: 'ed25519', signature: '' },
    });
    const result = await validate([event]);
    const sigErrors = result.errors.filter((e) => e.path === 'evidence.signature');
    expect(sigErrors.length).toBeGreaterThan(0);
  });

  // 3. Replay attack — same event_id appears twice
  test('replay attack — same event_id appears twice', async () => {
    const sharedId = 'replay-evt-001';
    const e1 = makeEvent({ event_id: sharedId });
    const e2 = makeEvent({ event_id: sharedId });
    const result = await validate([e1, e2]);
    const dupErrors = result.errors.filter(
      (e) => e.message.toLowerCase().includes('duplicate') && e.event_id === sharedId,
    );
    expect(dupErrors.length).toBeGreaterThan(0);
    expect(dupErrors[0]!.event_id).toBe(sharedId);
  });

  // 4. Replay attack — 5 distinct event_ids, each repeated 3 times (15 events total)
  test('replay attack — 5 distinct ids each appearing 3 times produces >= 10 errors', async () => {
    const ids = ['replay-a', 'replay-b', 'replay-c', 'replay-d', 'replay-e'];
    const events: ReturnType<typeof makeEvent>[] = [];
    for (const id of ids) {
      for (let rep = 0; rep < 3; rep++) {
        events.push(makeEvent({ event_id: id }));
      }
    }
    expect(events).toHaveLength(15);
    const result = await validate(events);
    // Each of the 5 ids has 2 duplicate occurrences (2nd and 3rd), so at least 10 duplicate errors
    const dupErrors = result.errors.filter((e) =>
      e.message.toLowerCase().includes('duplicate'),
    );
    expect(dupErrors.length).toBeGreaterThanOrEqual(10);
  });

  // 5. Schema-violating event — type is an invalid value
  test('schema-violating event — type is invalid value produces error on type path', async () => {
    const event = makeEvent({ type: 'invalid_type' as unknown as 'observation' });
    const result = await validate([event]);
    const typeErrors = result.errors.filter((e) => e.path === 'type');
    expect(typeErrors.length).toBeGreaterThan(0);
  });
});
