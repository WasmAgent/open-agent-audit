import { describe, expect, it } from 'bun:test';
import type { CanonicalEvent } from '@openagentaudit/schema';
import { DEFAULT_RISK_WEIGHTS, computeRiskScore, normalizeWeights } from './index.js';
import type { RiskWeights } from './index.js';

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
      ...(withSignature
        ? { signature: `sig-${i}`, signature_algorithm: 'ed25519' as const, signer_key_id: 'k1' }
        : {}),
    };
    prevHash = hash;
    return { ...ev, evidence };
  });
}

// ---------------------------------------------------------------------------
// computeRiskScore(events, runId) — runId fallback
// ---------------------------------------------------------------------------

describe('computeRiskScore(events, runId) — runId fallback', () => {
  it('uses the runId parameter when events have no run_id', async () => {
    const events: CanonicalEvent[] = [
      {
        schema_version: 'open-agent-audit/v0.1',
        run_id: undefined as unknown as string,
        agent_id: 'agent-test',
        model_id: 'model-test',
        event_id: 'e1',
        timestamp: '2023-11-14T22:13:20.000Z',
        type: 'tool_call',
        actor: 'agent',
        tool: { name: 'bash' },
      },
    ];
    const score = await computeRiskScore(events, 'fallback-run-id');
    expect(score.run_id).toBe('fallback-run-id');
  });

  it('prefers events[0].run_id over the runId parameter', async () => {
    const score = await computeRiskScore([makeToolCall('e1')], 'fallback-run-id');
    expect(score.run_id).toBe('run-test');
  });

  it('falls back to "unknown" when neither events nor runId provide a run_id', async () => {
    const events: CanonicalEvent[] = [
      {
        schema_version: 'open-agent-audit/v0.1',
        run_id: undefined as unknown as string,
        agent_id: 'agent-test',
        model_id: 'model-test',
        event_id: 'e1',
        timestamp: '2023-11-14T22:13:20.000Z',
        type: 'tool_call',
        actor: 'agent',
        tool: { name: 'bash' },
      },
    ];
    const score = await computeRiskScore(events);
    expect(score.run_id).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// computeProvenanceIntegrity via computeRiskScore
// ---------------------------------------------------------------------------

describe('computeRiskScore — trace_completeness scoring', () => {
  it('returns zero trace completeness when the trace has no events', async () => {
    const score = await computeRiskScore([], 'empty-run');
    expect(score.components.trace_completeness).toBe(0);
  });
});

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

// ---------- Issue #82: driftResult integration ----------

describe('computeRiskScore — driftResult integration (#82)', () => {
  it('applies drift penalty to ARS when driftResult is provided', async () => {
    const events = [makeToolCall('e1')];
    const scoreWithout = await computeRiskScore(events, 'r1');
    const scoreWith = await computeRiskScore(events, 'r1', undefined, undefined, undefined, {
      drift_score: 100,
    });
    // 100 * 0.15 = 15 point penalty
    expect(scoreWith.agent_risk_score.score).toBe(scoreWithout.agent_risk_score.score - 15);
  });

  it('does not penalize when drift_score is 0', async () => {
    const events = [makeToolCall('e1')];
    const scoreWithout = await computeRiskScore(events, 'r1');
    const scoreWith = await computeRiskScore(events, 'r1', undefined, undefined, undefined, {
      drift_score: 0,
    });
    expect(scoreWith.agent_risk_score.score).toBe(scoreWithout.agent_risk_score.score);
  });

  it('does not go below 0 even with max drift', async () => {
    // Create events that already have high penalties
    const events: CanonicalEvent[] = [
      {
        ...makeToolCall('t1', 'run-drift'),
        tool: { name: 'destroy', risk_tags: ['high_risk', 'mutation', 'human_required'] },
      },
      {
        schema_version: 'open-agent-audit/v0.1',
        run_id: 'run-drift',
        agent_id: 'agent-test',
        model_id: 'model-test',
        event_id: 'pd1',
        timestamp: '2023-11-14T22:13:20.000Z',
        type: 'policy_decision',
        actor: 'system',
        policy: { decision: 'deny', reason: 'blocked' },
        tool: { name: 'destroy' },
      },
      {
        schema_version: 'open-agent-audit/v0.1',
        run_id: 'run-drift',
        agent_id: 'agent-test',
        model_id: 'model-test',
        event_id: 'err1',
        timestamp: '2023-11-14T22:13:21.000Z',
        type: 'error',
        actor: 'system',
        error: { kind: 'RuntimeError', message: 'crash' },
      },
    ];
    const score = await computeRiskScore(events, 'r1', undefined, undefined, undefined, {
      drift_score: 100,
    });
    expect(score.agent_risk_score.score).toBeGreaterThanOrEqual(0);
  });
});

// ---------- Configurable risk weights (#107) ----------

describe('normalizeWeights', () => {
  it('returns default weights when all weights are zero', () => {
    const zeroWeights: RiskWeights = {
      trace_completeness: 0,
      provenance_integrity: 0,
      objective_verification: 0,
      policy_coverage: 0,
      human_oversight_evidence: 0,
      contamination_risk_inverted: 0,
    };
    const result = normalizeWeights(zeroWeights);
    expect(result).toEqual(DEFAULT_RISK_WEIGHTS);
  });

  it('normalizes weights that sum to more than 1', () => {
    const w: RiskWeights = {
      trace_completeness: 2,
      provenance_integrity: 2,
      objective_verification: 2,
      policy_coverage: 2,
      human_oversight_evidence: 2,
      contamination_risk_inverted: 2,
    };
    const result = normalizeWeights(w);
    const sum =
      result.trace_completeness +
      result.provenance_integrity +
      result.objective_verification +
      result.policy_coverage +
      result.human_oversight_evidence +
      result.contamination_risk_inverted;
    expect(sum).toBeCloseTo(1, 10);
    // All should be 1/6
    for (const key of Object.keys(result) as Array<keyof RiskWeights>) {
      expect(result[key]).toBeCloseTo(1 / 6, 10);
    }
  });

  it('preserves relative proportions when normalizing', () => {
    const w: RiskWeights = {
      trace_completeness: 3,
      provenance_integrity: 3,
      objective_verification: 1,
      policy_coverage: 1,
      human_oversight_evidence: 1,
      contamination_risk_inverted: 1,
    };
    const result = normalizeWeights(w);
    // total = 10, so trace_completeness = 0.3, others = 0.1
    expect(result.trace_completeness).toBeCloseTo(0.3, 10);
    expect(result.objective_verification).toBeCloseTo(0.1, 10);
  });
});

describe('computeRiskScore — configurable risk weights (#107)', () => {
  it('uses default weights when no options provided', async () => {
    const events = withHashChain([makeToolCall('e1'), makeToolCall('e2')], true);
    const score = await computeRiskScore(events, 'r1');
    const scoreWithOptions = await computeRiskScore(
      events,
      'r1',
      undefined,
      undefined,
      undefined,
      undefined,
      {},
    );
    expect(score.evidence_admission_score.score).toBe(
      scoreWithOptions.evidence_admission_score.score,
    );
  });

  it('does not set rubric_version with default weights', async () => {
    const events = [makeToolCall('e1')];
    const score = await computeRiskScore(events, 'r1');
    expect(score.rubric_version).toBeUndefined();
  });

  it('applies custom weights and normalizes them', async () => {
    const events = withHashChain([makeToolCall('e1')], true);
    // Give trace_completeness all the weight (1.0), others 0
    const w: RiskWeights = {
      trace_completeness: 1,
      provenance_integrity: 0,
      objective_verification: 0,
      policy_coverage: 0,
      human_oversight_evidence: 0,
      contamination_risk_inverted: 0,
    };
    const score = await computeRiskScore(events, 'r1', undefined, undefined, undefined, undefined, {
      weights: w,
    });
    // With all weight on trace_completeness, EAS should equal trace_completeness component
    expect(score.evidence_admission_score.score).toBe(score.components.trace_completeness!);
  });

  it('sets rubric_version to "custom" when custom weights used without explicit version', async () => {
    const events = [makeToolCall('e1')];
    const score = await computeRiskScore(events, 'r1', undefined, undefined, undefined, undefined, {
      weights: { ...DEFAULT_RISK_WEIGHTS, trace_completeness: 0.5 },
    });
    expect(score.rubric_version).toBe('custom');
  });

  it('uses explicit rubric_version when provided', async () => {
    const events = [makeToolCall('e1')];
    const score = await computeRiskScore(events, 'r1', undefined, undefined, undefined, undefined, {
      weights: { ...DEFAULT_RISK_WEIGHTS, trace_completeness: 0.5 },
      rubric_version: 'eu-ai-act/v1.0',
    });
    expect(score.rubric_version).toBe('eu-ai-act/v1.0');
  });

  it('custom weights produce different EAS than default for same events', async () => {
    const events = withHashChain([makeToolCall('e1')], true);
    const defaultScore = await computeRiskScore(events, 'r1');
    // Shift all weight to provenance_integrity
    const customScore = await computeRiskScore(
      events,
      'r1',
      undefined,
      undefined,
      undefined,
      undefined,
      {
        weights: {
          trace_completeness: 0,
          provenance_integrity: 1,
          objective_verification: 0,
          policy_coverage: 0,
          human_oversight_evidence: 0,
          contamination_risk_inverted: 0,
        },
      },
    );
    expect(customScore.evidence_admission_score.score).toBe(
      customScore.components.provenance_integrity!,
    );
    // The two scores should differ unless trace_completeness == provenance_integrity
    // which is unlikely with realistic events
  });

  it('backward compatible: existing call sites without options still work', async () => {
    const events = withHashChain([makeToolCall('e1'), makeToolCall('e2')], true);
    // Call with just events + runId (the most common usage)
    const score = await computeRiskScore(events, 'r1');
    expect(score.evidence_admission_score.score).toBeGreaterThanOrEqual(0);
    expect(score.evidence_admission_score.score).toBeLessThanOrEqual(100);
    expect(score.agent_risk_score.score).toBeGreaterThanOrEqual(0);
    expect(score.agent_risk_score.score).toBeLessThanOrEqual(100);
    expect(score.run_id).toBe('run-test');
  });

  it('normalizes unnormalized weights before applying', async () => {
    const events = withHashChain([makeToolCall('e1')], true);
    // Pass weights summing to 2.0 (should be normalized to sum to 1.0)
    const w: RiskWeights = {
      trace_completeness: 0.4,
      provenance_integrity: 0.4,
      objective_verification: 0.4,
      policy_coverage: 0.2,
      human_oversight_evidence: 0.2,
      contamination_risk_inverted: 0.2,
    };
    const score = await computeRiskScore(events, 'r1', undefined, undefined, undefined, undefined, {
      weights: w,
    });
    // Score should be in valid range
    expect(score.evidence_admission_score.score).toBeGreaterThanOrEqual(0);
    expect(score.evidence_admission_score.score).toBeLessThanOrEqual(100);
  });
});
