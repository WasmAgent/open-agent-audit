import { describe, expect, it } from 'bun:test';
import { computeRiskScore } from './index.js';
import type { CanonicalEvent } from '@openagentaudit/schema';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeToolCall(id: string, runId = 'run-test'): CanonicalEvent {
  return {
    schema_version: 'open-agent-audit/v0.1',
    run_id: runId,
    agent_id: 'agent-test',
    model_id: 'model-test',
    event_id: id,
    timestamp: '2023-11-14T22:13:20.000Z',
    type: 'tool_call',
    actor: 'agent',
    tool: { name: 'bash' },
  };
}

function withHashChain(events: CanonicalEvent[], withSignature: boolean): CanonicalEvent[] {
  let prevHash = '0'.repeat(64);
  return events.map((ev, i) => {
    const hash = `hash-${i}`;
    const evidence: CanonicalEvent['evidence'] = {
      hash,
      prev_hash: prevHash,
      ...(withSignature ? { signature: `sig-${i}`, signature_algorithm: 'ed25519' as const, signer_key_id: 'k1' } : {}),
    };
    prevHash = hash;
    return { ...ev, evidence };
  });
}

// ---------------------------------------------------------------------------
// computeProvenanceIntegrity via computeRiskScore
// ---------------------------------------------------------------------------

describe('computeRiskScore — provenance_integrity scoring', () => {
  it('returns 100 when all events have ed25519 signatures (no AEP provenance)', async () => {
    const events = withHashChain([makeToolCall('e1'), makeToolCall('e2')], true);
    const score = await computeRiskScore(events, 'r1');
    expect(score.components['provenance_integrity']).toBe(100);
  });

  it('returns 60 when hash chain present but no signatures', async () => {
    const events = withHashChain([makeToolCall('e1'), makeToolCall('e2')], false);
    const score = await computeRiskScore(events, 'r1');
    expect(score.components['provenance_integrity']).toBe(60);
  });

  it('adds +5 per AEP provenance field when base=60 (no sigs)', async () => {
    const events = withHashChain([makeToolCall('e1'), makeToolCall('e2')], false);

    const score1 = await computeRiskScore(events, 'r1', { repo_commit: 'abc' });
    expect(score1.components['provenance_integrity']).toBe(65);

    const score2 = await computeRiskScore(events, 'r1', {
      repo_commit: 'abc',
      runtime_version: 'v1',
    });
    expect(score2.components['provenance_integrity']).toBe(70);

    const score4 = await computeRiskScore(events, 'r1', {
      repo_commit: 'abc',
      runtime_version: 'v1',
      policy_bundle_digest: 'p'.repeat(64),
      tool_manifest_digest: 't'.repeat(64),
    });
    expect(score4.components['provenance_integrity']).toBe(80);
  });

  it('caps provenance_integrity at 100 even when all 4 fields present and base=100', async () => {
    const events = withHashChain([makeToolCall('e1')], true);
    const score = await computeRiskScore(events, 'r1', {
      repo_commit: 'abc',
      runtime_version: 'v1',
      policy_bundle_digest: 'p'.repeat(64),
      tool_manifest_digest: 't'.repeat(64),
    });
    expect(score.components['provenance_integrity']).toBe(100);
  });

  it('returns 20 when no events have evidence at all', async () => {
    const events = [makeToolCall('e1'), makeToolCall('e2')];
    const score = await computeRiskScore(events, 'r1');
    expect(score.components['provenance_integrity']).toBe(20);
  });

  it('returns 0 when hash chain is broken', async () => {
    const events = withHashChain([makeToolCall('e1'), makeToolCall('e2')], true);
    // Break the chain on the second event
    const broken = [
      events[0]!,
      { ...events[1]!, evidence: { ...events[1]!.evidence, prev_hash: 'wrong-hash' } },
    ];
    const score = await computeRiskScore(broken, 'r1');
    expect(score.components['provenance_integrity']).toBe(0);
  });

  it('AEP provenance bonus does NOT apply when no aepProvenance passed', async () => {
    const events = withHashChain([makeToolCall('e1')], false);
    const score = await computeRiskScore(events, 'r1');
    expect(score.components['provenance_integrity']).toBe(60);
  });
});
