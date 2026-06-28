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

// ---------------------------------------------------------------------------
// computeAgentRiskScore via computeRiskScore — agent_risk_score (ARS)
// ---------------------------------------------------------------------------

describe('computeRiskScore — agent_risk_score (ARS)', () => {
  it('无风险信号时 ARS 为 100', async () => {
    const events: CanonicalEvent[] = [
      makeToolCall('e1'),
      {
        schema_version: 'open-agent-audit/v0.1',
        run_id: 'run-test',
        agent_id: 'agent-test',
        model_id: 'model-test',
        event_id: 'p1',
        timestamp: '2023-11-14T22:13:20.000Z',
        type: 'policy_decision',
        actor: 'system',
        policy: { decision: 'allow', reason: 'allowed by policy' },
      },
    ];
    const score = await computeRiskScore(events, 'r1');
    expect(score.agent_risk_score.score).toBe(100);
  });

  it('每个 deny 扣 5 分，上限 30', async () => {
    // 7 denies => 7*5=35 => capped at 30 => ARS = 70
    const events: CanonicalEvent[] = Array.from({ length: 7 }, (_, i) => ({
      schema_version: 'open-agent-audit/v0.1' as const,
      run_id: 'run-test',
      agent_id: 'agent-test',
      model_id: 'model-test',
      event_id: `deny-${i}`,
      timestamp: '2023-11-14T22:13:20.000Z',
      type: 'policy_decision' as const,
      actor: 'system' as const,
      policy: { decision: 'deny' as const, reason: 'denied' },
    }));
    const score = await computeRiskScore(events, 'r1');
    expect(score.agent_risk_score.score).toBe(70);
  });

  it('error 事件每个扣 3 分', async () => {
    // 3 errors => 3*3=9 => ARS = 91
    const events: CanonicalEvent[] = Array.from({ length: 3 }, (_, i) => ({
      schema_version: 'open-agent-audit/v0.1' as const,
      run_id: 'run-test',
      agent_id: 'agent-test',
      model_id: 'model-test',
      event_id: `err-${i}`,
      timestamp: '2023-11-14T22:13:20.000Z',
      type: 'error' as const,
      actor: 'system' as const,
      error: { kind: 'RuntimeError', message: 'something failed' },
    }));
    const score = await computeRiskScore(events, 'r1');
    expect(score.agent_risk_score.score).toBe(91);
  });

  it('高风险工具每个扣 3 分', async () => {
    // 2 high_risk tool_calls => 2*3=6 => ARS = 94
    const events: CanonicalEvent[] = [
      {
        ...makeToolCall('t1'),
        tool: { name: 'bash', risk_tags: ['high_risk'] },
      },
      {
        ...makeToolCall('t2'),
        tool: { name: 'bash', risk_tags: ['high_risk'] },
      },
    ];
    const score = await computeRiskScore(events, 'r1');
    expect(score.agent_risk_score.score).toBe(94);
  });

  it('human_required 无审批每个扣 10 分', async () => {
    // 2 human_required tool_calls, no human_approval => 2*10=20 => ARS = 80
    const events: CanonicalEvent[] = [
      {
        ...makeToolCall('t1', 'run-hr'),
        tool: { name: 'deploy', risk_tags: ['human_required'] },
      },
      {
        ...makeToolCall('t2', 'run-hr'),
        tool: { name: 'deploy', risk_tags: ['human_required'] },
      },
    ];
    const score = await computeRiskScore(events, 'r1');
    expect(score.agent_risk_score.score).toBe(80);
  });

  it('human_required 有审批不扣分', async () => {
    // 2 human_required tool_calls + 1 human_approval in same run => penalty = 0 => ARS = 100
    const events: CanonicalEvent[] = [
      {
        ...makeToolCall('t1', 'run-hr'),
        tool: { name: 'deploy', risk_tags: ['human_required'] },
      },
      {
        ...makeToolCall('t2', 'run-hr'),
        tool: { name: 'deploy', risk_tags: ['human_required'] },
      },
      {
        schema_version: 'open-agent-audit/v0.1',
        run_id: 'run-hr',
        agent_id: 'agent-test',
        model_id: 'model-test',
        event_id: 'ha1',
        timestamp: '2023-11-14T22:13:20.000Z',
        type: 'human_approval',
        actor: 'human_reviewer',
        human: { reviewer_id: 'reviewer-1', decision: 'approve' },
      },
    ];
    const score = await computeRiskScore(events, 'r1');
    expect(score.agent_risk_score.score).toBe(100);
  });

  it('hash chain break 扣 20 分', async () => {
    // Build a chain and break the second event's prev_hash => ARS = 80
    const chained = withHashChain([makeToolCall('e1'), makeToolCall('e2')], false);
    const broken: CanonicalEvent[] = [
      chained[0]!,
      { ...chained[1]!, evidence: { ...chained[1]!.evidence, prev_hash: 'wrong-hash' } },
    ];
    const score = await computeRiskScore(broken, 'r1');
    expect(score.agent_risk_score.score).toBe(80);
  });

  it('多种信号叠加计算', async () => {
    // 1 deny(-5) + 1 error(-3) + 1 human_required 无审批(-10) = penalty 18 => ARS = 82
    const events: CanonicalEvent[] = [
      {
        schema_version: 'open-agent-audit/v0.1',
        run_id: 'run-multi',
        agent_id: 'agent-test',
        model_id: 'model-test',
        event_id: 'deny-1',
        timestamp: '2023-11-14T22:13:20.000Z',
        type: 'policy_decision',
        actor: 'system',
        policy: { decision: 'deny', reason: 'denied' },
      },
      {
        schema_version: 'open-agent-audit/v0.1',
        run_id: 'run-multi',
        agent_id: 'agent-test',
        model_id: 'model-test',
        event_id: 'err-1',
        timestamp: '2023-11-14T22:13:20.000Z',
        type: 'error',
        actor: 'system',
        error: { kind: 'RuntimeError', message: 'failed' },
      },
      {
        ...makeToolCall('t-hr', 'run-multi'),
        tool: { name: 'deploy', risk_tags: ['human_required'] },
      },
    ];
    const score = await computeRiskScore(events, 'r1');
    expect(score.agent_risk_score.score).toBe(82);
  });
});
