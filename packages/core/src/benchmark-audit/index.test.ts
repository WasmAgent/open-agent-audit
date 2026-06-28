import { describe, test, it, expect } from 'bun:test';
import { benchmarkAudit } from './index.js';
import type { PairedSample, BenchmarkPairAggregate } from './index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSamples(
  specs: Array<{ id?: string; baseline: boolean; candidate: boolean }>,
): PairedSample[] {
  return specs.map((s, i) => ({
    sample_id: s.id ?? `s-${i}`,
    baseline_pass: s.baseline,
    candidate_pass: s.candidate,
  }));
}

// ---------------------------------------------------------------------------
// 1. Paired mode — correct McNemar with known discordant pairs
// ---------------------------------------------------------------------------

describe('paired mode — McNemar statistics', () => {
  test('b=3, c=2, 3 concordant: discordant counts are correct', async () => {
    // 8 samples total:
    //   3 discordant-B: baseline=T, candidate=F  → b
    //   2 discordant-C: baseline=F, candidate=T  → c
    //   3 concordant (2 both-pass, 1 both-fail)
    const samples = makeSamples([
      { id: 'b0', baseline: true,  candidate: false },
      { id: 'b1', baseline: true,  candidate: false },
      { id: 'b2', baseline: true,  candidate: false },
      { id: 'c0', baseline: false, candidate: true  },
      { id: 'c1', baseline: false, candidate: true  },
      { id: 'p0', baseline: true,  candidate: true  },
      { id: 'p1', baseline: true,  candidate: true  },
      { id: 'f0', baseline: false, candidate: false },
    ]);

    const result = await benchmarkAudit({ mode: 'paired', samples });

    expect(result.statistics.discordant_b).toBe(3);
    expect(result.statistics.discordant_c).toBe(2);
    expect(result.statistics.paired_sample_count).toBe(8);
  });

  // 2. mcnemar_p is undefined when b+c < 10 (same 8-sample set: b+c = 5)
  test('mcnemar_p is undefined when b+c < 10', async () => {
    const samples = makeSamples([
      { baseline: true,  candidate: false },
      { baseline: true,  candidate: false },
      { baseline: true,  candidate: false },
      { baseline: false, candidate: true  },
      { baseline: false, candidate: true  },
      { baseline: true,  candidate: true  },
      { baseline: true,  candidate: true  },
      { baseline: false, candidate: false },
    ]);

    const result = await benchmarkAudit({ mode: 'paired', samples });

    expect(result.statistics.mcnemar_p).toBeUndefined();
  });

  test('mcnemar_p is defined when b+c >= 10', async () => {
    // 40 samples: 6 b + 4 c = 10 discordant, 30 concordant-pass
    const specs = [
      ...Array.from({ length: 6  }, (_, i) => ({ id: `b${i}`, baseline: true,  candidate: false })),
      ...Array.from({ length: 4  }, (_, i) => ({ id: `c${i}`, baseline: false, candidate: true  })),
      ...Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, baseline: true,  candidate: true  })),
    ];

    const result = await benchmarkAudit({ mode: 'paired', samples: makeSamples(specs) });

    expect(result.statistics.discordant_b).toBe(6);
    expect(result.statistics.discordant_c).toBe(4);
    expect(result.statistics.mcnemar_p).toBeDefined();
    expect(typeof result.statistics.mcnemar_p).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// 2. Paired mode — regression detection (OAA-B-001)
// ---------------------------------------------------------------------------

describe('paired mode — OAA-B-001 regression detection', () => {
  test('OAA-B-001 is emitted when most samples are baseline=T, candidate=F', async () => {
    // 40 samples: 20 b (baseline=T, candidate=F), 5 c, 15 concordant-pass
    // candidate_rate = 20/40 = 0.5, baseline_rate = 35/40 = 0.875 → delta = -0.375
    const specs = [
      ...Array.from({ length: 20 }, (_, i) => ({ id: `b${i}`, baseline: true,  candidate: false })),
      ...Array.from({ length: 5  }, (_, i) => ({ id: `c${i}`, baseline: false, candidate: true  })),
      ...Array.from({ length: 15 }, (_, i) => ({ id: `p${i}`, baseline: true,  candidate: true  })),
    ];

    const result = await benchmarkAudit({ mode: 'paired', samples: makeSamples(specs) });

    const ruleIds = result.findings.map(f => f.rule_id);
    expect(ruleIds).toContain('OAA-B-001');
    expect(result.findings.find(f => f.rule_id === 'OAA-B-001')!.severity).toBe('high');
    expect(result.statistics.absolute_delta).toBeLessThan(0);
  });

  test('OAA-B-001 is NOT emitted when candidate rate is higher than baseline', async () => {
    // 40 samples: 5 b, 10 c, 25 concordant-pass → candidate_rate > baseline_rate
    const specs = [
      ...Array.from({ length: 5  }, (_, i) => ({ id: `b${i}`, baseline: true,  candidate: false })),
      ...Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, baseline: false, candidate: true  })),
      ...Array.from({ length: 25 }, (_, i) => ({ id: `p${i}`, baseline: true,  candidate: true  })),
    ];

    const result = await benchmarkAudit({ mode: 'paired', samples: makeSamples(specs) });

    expect(result.findings.map(f => f.rule_id)).not.toContain('OAA-B-001');
    expect(result.statistics.absolute_delta).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Paired mode — small sample (< 30 → OAA-B-002)
// ---------------------------------------------------------------------------

describe('paired mode — OAA-B-002 small sample', () => {
  test('OAA-B-002 is emitted when n < 30', async () => {
    const samples = makeSamples(
      Array.from({ length: 15 }, () => ({ baseline: true, candidate: true })),
    );

    const result = await benchmarkAudit({ mode: 'paired', samples });

    const f = result.findings.find(f => f.rule_id === 'OAA-B-002');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('medium');
  });

  test('OAA-B-002 is NOT emitted when n >= 30', async () => {
    const samples = makeSamples(
      Array.from({ length: 30 }, () => ({ baseline: true, candidate: true })),
    );

    const result = await benchmarkAudit({ mode: 'paired', samples });

    expect(result.findings.find(f => f.rule_id === 'OAA-B-002')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4. Paired mode — inconclusive claim (low delta, claim set → OAA-B-003)
// ---------------------------------------------------------------------------

describe('paired mode — OAA-B-003 inconclusive claim', () => {
  test('OAA-B-003 is emitted when claim is set and verdict is inconclusive (small positive delta)', async () => {
    // 40 samples: 3 b, 4 c, 30 concordant-pass, 3 concordant-fail
    // candidate_rate = (4+30)/40 = 0.85, baseline_rate = (3+30)/40 = 0.825 → delta = +2.5pp
    // b+c = 7 < 10 → mcnemar_p undefined → delta < 0.05 → verdict = inconclusive
    const specs = [
      ...Array.from({ length: 3  }, (_, i) => ({ id: `b${i}`, baseline: true,  candidate: false })),
      ...Array.from({ length: 4  }, (_, i) => ({ id: `c${i}`, baseline: false, candidate: true  })),
      ...Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, baseline: true,  candidate: true  })),
      ...Array.from({ length: 3  }, (_, i) => ({ id: `f${i}`, baseline: false, candidate: false })),
    ];

    const result = await benchmarkAudit({
      mode: 'paired',
      samples: makeSamples(specs),
      claim: 'Candidate passes at least 10pp more than baseline',
    });

    const f = result.findings.find(f => f.rule_id === 'OAA-B-003');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('low');
    expect(result.statistics.verdict).toBe('inconclusive');
    expect(f!.evidence_ids.length).toBeGreaterThan(0);
  });

  test('OAA-B-003 is NOT emitted when no claim is provided', async () => {
    const specs = [
      ...Array.from({ length: 3  }, (_, i) => ({ id: `b${i}`, baseline: true,  candidate: false })),
      ...Array.from({ length: 4  }, (_, i) => ({ id: `c${i}`, baseline: false, candidate: true  })),
      ...Array.from({ length: 33 }, (_, i) => ({ id: `p${i}`, baseline: true,  candidate: true  })),
    ];

    const result = await benchmarkAudit({ mode: 'paired', samples: makeSamples(specs) });

    expect(result.findings.find(f => f.rule_id === 'OAA-B-003')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 5. Paired mode — evidence_ids on regression finding includes discordant sample_ids
// ---------------------------------------------------------------------------

describe('paired mode — evidence_ids on OAA-B-001 regression finding', () => {
  test('evidence_ids contains discordant-B sample_ids but not discordant-C', async () => {
    const specs = [
      { id: 'regress-1', baseline: true,  candidate: false },
      { id: 'regress-2', baseline: true,  candidate: false },
      { id: 'regress-3', baseline: true,  candidate: false },
      { id: 'improve-1', baseline: false, candidate: true  },
      ...Array.from({ length: 26 }, (_, i) => ({ id: `ok${i}`, baseline: true, candidate: true })),
    ];

    const result = await benchmarkAudit({ mode: 'paired', samples: makeSamples(specs) });

    const f001 = result.findings.find(f => f.rule_id === 'OAA-B-001');
    expect(f001).toBeDefined();
    expect(f001!.evidence_ids).toContain('regress-1');
    expect(f001!.evidence_ids).toContain('regress-2');
    expect(f001!.evidence_ids).toContain('regress-3');
    // improve-1 is discordant-C (baseline=F, candidate=T) — must NOT appear
    expect(f001!.evidence_ids).not.toContain('improve-1');
  });

  test('evidence_ids count equals number of discordant-B samples', async () => {
    const specs = [
      ...Array.from({ length: 5 }, (_, i) => ({ id: `b${i}`, baseline: true,  candidate: false })),
      ...Array.from({ length: 2 }, (_, i) => ({ id: `c${i}`, baseline: false, candidate: true  })),
      ...Array.from({ length: 23 }, (_, i) => ({ id: `p${i}`, baseline: true,  candidate: true  })),
    ];

    const result = await benchmarkAudit({ mode: 'paired', samples: makeSamples(specs) });

    const f001 = result.findings.find(f => f.rule_id === 'OAA-B-001');
    expect(f001).toBeDefined();
    expect(f001!.evidence_ids.length).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// 6. Aggregate mode — regression detection (absolute_delta < 0 → OAA-B-001)
// ---------------------------------------------------------------------------

describe('aggregate mode — OAA-B-001 regression detection', () => {
  test('OAA-B-001 is emitted when absolute_delta < 0', async () => {
    const pair: BenchmarkPairAggregate = {
      mode: 'aggregate',
      candidate: { samples_total: 100, samples_pass: 60 },
      baseline:  { samples_total: 100, samples_pass: 80 },
    };

    const result = await benchmarkAudit(pair);

    const ruleIds = result.findings.map(f => f.rule_id);
    expect(ruleIds).toContain('OAA-B-001');
    expect(result.findings.find(f => f.rule_id === 'OAA-B-001')!.severity).toBe('high');
    expect(result.statistics.absolute_delta).toBeLessThan(0);
  });

  test('OAA-B-001 is NOT emitted when candidate rate equals or exceeds baseline', async () => {
    const pair: BenchmarkPairAggregate = {
      mode: 'aggregate',
      candidate: { samples_total: 100, samples_pass: 85 },
      baseline:  { samples_total: 100, samples_pass: 80 },
    };

    const result = await benchmarkAudit(pair);

    expect(result.findings.map(f => f.rule_id)).not.toContain('OAA-B-001');
    expect(result.statistics.absolute_delta).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// 7. Aggregate mode — small sample warning (OAA-B-002)
// ---------------------------------------------------------------------------

describe('aggregate mode — OAA-B-002 small sample', () => {
  test('OAA-B-002 is emitted when candidate.samples_total < 30', async () => {
    const pair: BenchmarkPairAggregate = {
      mode: 'aggregate',
      candidate: { samples_total: 20, samples_pass: 15 },
      baseline:  { samples_total: 100, samples_pass: 80 },
    };

    const result = await benchmarkAudit(pair);

    expect(result.findings.map(f => f.rule_id)).toContain('OAA-B-002');
  });

  test('OAA-B-002 is emitted when baseline.samples_total < 30', async () => {
    const pair: BenchmarkPairAggregate = {
      mode: 'aggregate',
      candidate: { samples_total: 100, samples_pass: 80 },
      baseline:  { samples_total: 10, samples_pass: 8 },
    };

    const result = await benchmarkAudit(pair);

    expect(result.findings.map(f => f.rule_id)).toContain('OAA-B-002');
  });

  test('OAA-B-002 is NOT emitted when both sets have >= 30 samples', async () => {
    const pair: BenchmarkPairAggregate = {
      mode: 'aggregate',
      candidate: { samples_total: 50, samples_pass: 40 },
      baseline:  { samples_total: 50, samples_pass: 38 },
    };

    const result = await benchmarkAudit(pair);

    expect(result.findings.map(f => f.rule_id)).not.toContain('OAA-B-002');
  });
});

// ---------------------------------------------------------------------------
// 8. Aggregate mode — no McNemar, verdict always inconclusive (OAA-B-004 when claim set)
// ---------------------------------------------------------------------------

describe('aggregate mode — no McNemar, OAA-B-004 on claim', () => {
  test('mcnemar_p is not set in aggregate mode', async () => {
    const pair: BenchmarkPairAggregate = {
      mode: 'aggregate',
      candidate: { samples_total: 100, samples_pass: 85 },
      baseline:  { samples_total: 100, samples_pass: 80 },
    };

    const result = await benchmarkAudit(pair);

    expect(result.statistics.mcnemar_p).toBeUndefined();
  });

  test('verdict is "inconclusive" for positive delta in aggregate mode (never supports_claim)', async () => {
    // Even with a very large positive delta, aggregate mode cannot produce supports_claim
    const pair: BenchmarkPairAggregate = {
      mode: 'aggregate',
      candidate: { samples_total: 100, samples_pass: 90 },
      baseline:  { samples_total: 100, samples_pass: 50 },
      claim: 'candidate is much better',
    };

    const result = await benchmarkAudit(pair);

    expect(result.statistics.verdict).not.toBe('supports_claim');
    expect(result.statistics.verdict).toBe('inconclusive');
  });

  test('verdict is "rejects_claim" when absolute_delta < -0.02 in aggregate mode', async () => {
    const pair: BenchmarkPairAggregate = {
      mode: 'aggregate',
      candidate: { samples_total: 100, samples_pass: 70 },
      baseline:  { samples_total: 100, samples_pass: 80 },
    };

    const result = await benchmarkAudit(pair);

    expect(result.statistics.verdict).toBe('rejects_claim');
  });

  test('OAA-B-004 is emitted when claim is set in aggregate mode', async () => {
    const pair: BenchmarkPairAggregate = {
      mode: 'aggregate',
      candidate: { samples_total: 100, samples_pass: 83 },
      baseline:  { samples_total: 100, samples_pass: 80 },
      claim: 'Candidate performs better than baseline',
    };

    const result = await benchmarkAudit(pair);

    const f004 = result.findings.find(f => f.rule_id === 'OAA-B-004');
    expect(f004).toBeDefined();
    expect(f004!.severity).toBe('low');
  });

  test('OAA-B-004 is NOT emitted when no claim is provided', async () => {
    const pair: BenchmarkPairAggregate = {
      mode: 'aggregate',
      candidate: { samples_total: 100, samples_pass: 83 },
      baseline:  { samples_total: 100, samples_pass: 80 },
    };

    const result = await benchmarkAudit(pair);

    expect(result.findings.map(f => f.rule_id)).not.toContain('OAA-B-004');
  });
});

// ---------------------------------------------------------------------------
// 9. Aggregate mode — audit_sufficiency = 'aggregate_only'
// ---------------------------------------------------------------------------

describe('aggregate mode — audit_sufficiency = aggregate_only', () => {
  test('audit_sufficiency is "aggregate_only"', async () => {
    const pair: BenchmarkPairAggregate = {
      mode: 'aggregate',
      candidate: { samples_total: 50, samples_pass: 40 },
      baseline:  { samples_total: 50, samples_pass: 38 },
    };

    const result = await benchmarkAudit(pair);

    expect(result.statistics.audit_sufficiency).toBe('aggregate_only');
  });

  test('discordant_b and discordant_c are not set in aggregate mode', async () => {
    const pair: BenchmarkPairAggregate = {
      mode: 'aggregate',
      candidate: { samples_total: 50, samples_pass: 40 },
      baseline:  { samples_total: 50, samples_pass: 38 },
    };

    const result = await benchmarkAudit(pair);

    expect(result.statistics.discordant_b).toBeUndefined();
    expect(result.statistics.discordant_c).toBeUndefined();
    expect(result.statistics.paired_sample_count).toBeUndefined();
  });

  test('works when mode field is omitted (default aggregate)', async () => {
    const result = await benchmarkAudit({
      candidate: { samples_total: 50, samples_pass: 40 },
      baseline:  { samples_total: 50, samples_pass: 38 },
    } as BenchmarkPairAggregate);

    expect(result.statistics.audit_sufficiency).toBe('aggregate_only');
    expect(result.statistics.candidate_rate).toBeCloseTo(0.8);
    expect(result.statistics.baseline_rate).toBeCloseTo(0.76);
  });
});

// ---------------------------------------------------------------------------
// 10. Paired mode — audit_sufficiency = 'paired'
// ---------------------------------------------------------------------------

describe('paired mode — audit_sufficiency = paired', () => {
  test('audit_sufficiency is "paired"', async () => {
    const samples = makeSamples(
      Array.from({ length: 30 }, () => ({ baseline: true, candidate: true })),
    );

    const result = await benchmarkAudit({ mode: 'paired', samples });

    expect(result.statistics.audit_sufficiency).toBe('paired');
  });

  test('paired_sample_count reflects number of samples passed', async () => {
    const samples = makeSamples(
      Array.from({ length: 42 }, () => ({ baseline: true, candidate: true })),
    );

    const result = await benchmarkAudit({ mode: 'paired', samples });

    expect(result.statistics.paired_sample_count).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// Rate and delta accuracy
// ---------------------------------------------------------------------------

describe('statistics accuracy — rates and wilson_ci', () => {
  test('candidate_rate, baseline_rate, absolute_delta correct in paired mode', async () => {
    // 40 samples: 20 concordant-pass, 10 b, 5 c, 5 concordant-fail
    // candidate_pass = 20 + 5 = 25 → 25/40 = 0.625
    // baseline_pass  = 20 + 10 = 30 → 30/40 = 0.75
    const specs = [
      ...Array.from({ length: 20 }, (_, i) => ({ id: `pp${i}`, baseline: true,  candidate: true  })),
      ...Array.from({ length: 10 }, (_, i) => ({ id: `b${i}`,  baseline: true,  candidate: false })),
      ...Array.from({ length: 5  }, (_, i) => ({ id: `c${i}`,  baseline: false, candidate: true  })),
      ...Array.from({ length: 5  }, (_, i) => ({ id: `ff${i}`, baseline: false, candidate: false })),
    ];

    const result = await benchmarkAudit({ mode: 'paired', samples: makeSamples(specs) });

    expect(result.statistics.candidate_rate).toBeCloseTo(25 / 40);
    expect(result.statistics.baseline_rate).toBeCloseTo(30 / 40);
    expect(result.statistics.absolute_delta).toBeCloseTo((25 - 30) / 40);
  });

  test('candidate_rate, baseline_rate, absolute_delta correct in aggregate mode', async () => {
    const pair: BenchmarkPairAggregate = {
      mode: 'aggregate',
      candidate: { samples_total: 200, samples_pass: 160 },
      baseline:  { samples_total: 200, samples_pass: 140 },
    };

    const result = await benchmarkAudit(pair);

    expect(result.statistics.candidate_rate).toBeCloseTo(0.8);
    expect(result.statistics.baseline_rate).toBeCloseTo(0.7);
    expect(result.statistics.absolute_delta).toBeCloseTo(0.1);
  });

  test('wilson_ci is a two-element tuple within [0,1] in paired mode', async () => {
    const samples = makeSamples(
      Array.from({ length: 50 }, (_, i) => ({
        baseline: true,
        candidate: i < 40, // 40 pass, 10 fail
      })),
    );

    const result = await benchmarkAudit({ mode: 'paired', samples });
    const ci = result.statistics.wilson_ci;

    expect(ci).toBeDefined();
    expect(Array.isArray(ci)).toBe(true);
    expect(ci!.length).toBe(2);
    expect(ci![0]).toBeGreaterThanOrEqual(0);
    expect(ci![1]).toBeLessThanOrEqual(1);
    expect(ci![0]).toBeLessThan(ci![1]);
  });

  test('wilson_ci is present and valid in aggregate mode', async () => {
    const pair: BenchmarkPairAggregate = {
      mode: 'aggregate',
      candidate: { samples_total: 100, samples_pass: 60 },
      baseline:  { samples_total: 100, samples_pass: 55 },
    };

    const result = await benchmarkAudit(pair);
    const [lo, hi] = result.statistics.wilson_ci!;

    expect(lo).toBeGreaterThanOrEqual(0);
    expect(hi).toBeLessThanOrEqual(1);
    expect(lo).toBeLessThan(hi);
  });
});

describe('mcnemar p-value — golden statistical fixtures', () => {
  // 通过 benchmarkAudit paired mode 间接测试 mcnemar_p

  it('b=0, c=0 时 mcnemar_p 未定义（样本不足）', async () => {
    // all concordant => no discordants => mcnemar_p undefined (b+c=0 < 10)
    const samples = Array.from({ length: 20 }, (_, i) => ({
      sample_id: `s${i}`,
      baseline_pass: true,
      candidate_pass: true,
    }));
    const result = await benchmarkAudit({ mode: 'paired', samples });
    expect(result.statistics.mcnemar_p).toBeUndefined();
  });

  it('b=c 时 p-value 约为 1.0（对称，无差异）', async () => {
    // 5 baseline-only, 5 candidate-only => b=5, c=5 => chi2 ≈ 0 => p ≈ 1
    const samples = [
      ...Array.from({ length: 5 }, (_, i) => ({ sample_id: `b${i}`, baseline_pass: true, candidate_pass: false })),
      ...Array.from({ length: 5 }, (_, i) => ({ sample_id: `c${i}`, baseline_pass: false, candidate_pass: true })),
      // pad to reach b+c >= 10
      ...Array.from({ length: 10 }, (_, i) => ({ sample_id: `cc${i}`, baseline_pass: true, candidate_pass: true })),
    ];
    const result = await benchmarkAudit({ mode: 'paired', samples });
    // p should be high (not significant)
    expect(result.statistics.mcnemar_p).toBeDefined();
    expect(result.statistics.mcnemar_p!).toBeGreaterThan(0.5);
  });

  it('强回归（b=20, c=0）时 p-value < 0.05', async () => {
    // 20 baseline-pass/candidate-fail, 0 reverse => very significant
    const samples = [
      ...Array.from({ length: 20 }, (_, i) => ({ sample_id: `b${i}`, baseline_pass: true, candidate_pass: false })),
      ...Array.from({ length: 10 }, (_, i) => ({ sample_id: `cc${i}`, baseline_pass: true, candidate_pass: true })),
    ];
    const result = await benchmarkAudit({ mode: 'paired', samples });
    expect(result.statistics.mcnemar_p).toBeDefined();
    expect(result.statistics.mcnemar_p!).toBeLessThan(0.05);
  });

  it('强改进（b=0, c=20）时 p-value < 0.05', async () => {
    const samples = [
      ...Array.from({ length: 20 }, (_, i) => ({ sample_id: `c${i}`, baseline_pass: false, candidate_pass: true })),
      ...Array.from({ length: 10 }, (_, i) => ({ sample_id: `cc${i}`, baseline_pass: true, candidate_pass: true })),
    ];
    const result = await benchmarkAudit({ mode: 'paired', samples });
    expect(result.statistics.mcnemar_p).toBeDefined();
    expect(result.statistics.mcnemar_p!).toBeLessThan(0.05);
  });
});
