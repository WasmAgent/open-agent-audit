/** @openagentaudit/core/benchmark-audit */
import type { Finding } from '@openagentaudit/schema';
import { SPEC_VERSION } from '@openagentaudit/schema';

export interface PairedSample {
  sample_id: string;
  baseline_pass: boolean;
  candidate_pass: boolean;
  evidence_event_ids?: string[];
}

export interface BenchmarkPairPaired {
  mode: 'paired';
  samples: PairedSample[];
  candidate_label?: string;
  baseline_label?: string;
  claim?: string;
}

export interface BenchmarkPairAggregate {
  mode?: 'aggregate' | undefined;
  candidate: { samples_total: number; samples_pass: number; label?: string };
  baseline: { samples_total: number; samples_pass: number; label?: string };
  claim?: string;
}

export type BenchmarkPair = BenchmarkPairPaired | BenchmarkPairAggregate;

export interface BenchmarkAuditResult {
  findings: Finding[];
  statistics: {
    candidate_rate: number;
    baseline_rate: number;
    absolute_delta: number;
    mcnemar_p?: number;
    wilson_ci?: [number, number];
    verdict: 'supports_claim' | 'rejects_claim' | 'inconclusive';
    audit_sufficiency: 'paired' | 'aggregate_only';
    paired_sample_count?: number;
    discordant_b?: number;
    discordant_c?: number;
  };
}

function wilsonCI(p: number, n: number): [number, number] {
  const z = 1.96;
  const z2 = z * z;
  const center = (p + z2 / (2 * n)) / (1 + z2 / n);
  const margin = (z / (1 + z2 / n)) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

function mcnemarP(b: number, c: number): number {
  const chi2 = b + c > 0 ? Math.pow(Math.abs(b - c) - 1, 2) / (b + c) : 0;
  return Math.exp(-0.5 * chi2);
}

function makeFinding(
  ruleId: string,
  severity: Finding['severity'],
  title: string,
  description: string,
  recommendation: string,
  evidence_ids: string[] = [],
): Finding {
  return {
    schema_version: SPEC_VERSION,
    finding_id: btoa(ruleId),
    rule_id: ruleId,
    severity,
    category: 'benchmark',
    title,
    description,
    evidence_ids,
    recommendation,
  };
}

export async function benchmarkAudit(pair: BenchmarkPair): Promise<BenchmarkAuditResult> {
  const findings: Finding[] = [];

  if (pair.mode === 'paired') {
    const { samples } = pair;
    const n = samples.length;

    const candidate_pass_count = samples.filter(s => s.candidate_pass).length;
    const baseline_pass_count = samples.filter(s => s.baseline_pass).length;

    const candidate_rate = candidate_pass_count / n;
    const baseline_rate = baseline_pass_count / n;
    const absolute_delta = candidate_rate - baseline_rate;

    const wilson_ci = wilsonCI(candidate_rate, n);

    const discordant_b_samples = samples.filter(s => s.baseline_pass && !s.candidate_pass);
    const discordant_c_samples = samples.filter(s => !s.baseline_pass && s.candidate_pass);
    const b = discordant_b_samples.length;
    const c = discordant_c_samples.length;

    let mcnemar_p: number | undefined;
    if (b + c >= 10) {
      mcnemar_p = mcnemarP(b, c);
    }

    const isStatSig = mcnemar_p !== undefined && mcnemar_p < 0.05;
    let verdict: 'supports_claim' | 'rejects_claim' | 'inconclusive';
    if (absolute_delta >= 0.05 && isStatSig) {
      verdict = 'supports_claim';
    } else if (absolute_delta < -0.02) {
      verdict = 'rejects_claim';
    } else {
      verdict = 'inconclusive';
    }

    // OAA-B-001: regression — evidence_ids are discordant pair sample_ids
    if (absolute_delta < 0) {
      const regression_evidence = discordant_b_samples.map(s => s.sample_id);
      findings.push(
        makeFinding(
          'OAA-B-001',
          'high',
          'Benchmark regression detected',
          `Candidate pass rate (${(candidate_rate * 100).toFixed(1)}%) is lower than baseline (${(baseline_rate * 100).toFixed(1)}%). Absolute delta: ${(absolute_delta * 100).toFixed(1)}pp.`,
          'Review recent model or prompt changes that may have caused the regression before promoting the candidate.',
          regression_evidence,
        ),
      );
    }

    // OAA-B-002: small sample (<30)
    if (n < 30) {
      findings.push(
        makeFinding(
          'OAA-B-002',
          'medium',
          'Small benchmark sample size',
          `The benchmark set has fewer than 30 samples (n=${n}). Statistical conclusions may be unreliable.`,
          'Increase the evaluation set to at least 30 samples to improve statistical power.',
        ),
      );
    }

    // OAA-B-003: inconclusive claim
    if (pair.claim !== undefined && pair.claim !== null && verdict === 'inconclusive') {
      const all_ids = samples.slice(0, 50).map(s => s.sample_id);
      findings.push(
        makeFinding(
          'OAA-B-003',
          'low',
          'Benchmark claim is inconclusive',
          `The stated claim "${pair.claim}" could not be statistically supported or rejected (verdict: inconclusive, delta: ${(absolute_delta * 100).toFixed(1)}pp).`,
          'Collect more samples or reconsider the claim threshold before publishing benchmark results.',
          all_ids,
        ),
      );
    }

    const statistics: BenchmarkAuditResult['statistics'] = {
      candidate_rate,
      baseline_rate,
      absolute_delta,
      wilson_ci,
      verdict,
      audit_sufficiency: 'paired',
      paired_sample_count: n,
      discordant_b: b,
      discordant_c: c,
    };

    if (mcnemar_p !== undefined) {
      statistics.mcnemar_p = mcnemar_p;
    }

    return { findings, statistics };
  } else {
    // aggregate mode
    const { candidate, baseline } = pair;

    const candidate_rate = candidate.samples_pass / candidate.samples_total;
    const baseline_rate = baseline.samples_pass / baseline.samples_total;
    const absolute_delta = candidate_rate - baseline_rate;

    const wilson_ci = wilsonCI(candidate_rate, candidate.samples_total);

    let verdict: 'supports_claim' | 'rejects_claim' | 'inconclusive';
    if (absolute_delta < -0.02) {
      verdict = 'rejects_claim';
    } else {
      verdict = 'inconclusive';
    }

    // OAA-B-001: regression
    if (absolute_delta < 0) {
      findings.push(
        makeFinding(
          'OAA-B-001',
          'high',
          'Benchmark regression detected',
          `Candidate pass rate (${(candidate_rate * 100).toFixed(1)}%) is lower than baseline (${(baseline_rate * 100).toFixed(1)}%). Absolute delta: ${(absolute_delta * 100).toFixed(1)}pp.`,
          'Review recent model or prompt changes that may have caused the regression before promoting the candidate.',
        ),
      );
    }

    // OAA-B-002: small sample (<30)
    if (candidate.samples_total < 30 || baseline.samples_total < 30) {
      findings.push(
        makeFinding(
          'OAA-B-002',
          'medium',
          'Small benchmark sample size',
          `One or both benchmark sets have fewer than 30 samples (candidate: ${candidate.samples_total}, baseline: ${baseline.samples_total}). Statistical conclusions may be unreliable.`,
          'Increase the evaluation set to at least 30 samples per split to improve statistical power.',
        ),
      );
    }

    // OAA-B-003: inconclusive claim
    if (pair.claim !== undefined && pair.claim !== null && verdict === 'inconclusive') {
      findings.push(
        makeFinding(
          'OAA-B-003',
          'low',
          'Benchmark claim is inconclusive',
          `The stated claim "${pair.claim}" could not be statistically supported or rejected (verdict: inconclusive, delta: ${(absolute_delta * 100).toFixed(1)}pp).`,
          'Collect more samples or reconsider the claim threshold before publishing benchmark results.',
        ),
      );
    }

    // OAA-B-004: aggregate mode cannot support McNemar
    if (pair.claim !== undefined && pair.claim !== null) {
      findings.push(
        makeFinding(
          'OAA-B-004',
          'low',
          'Aggregate data cannot support McNemar test',
          'Aggregate data cannot support McNemar test. Upgrade to paired samples for statistically valid comparison.',
          'Provide paired sample data (mode: "paired") to enable the McNemar significance test.',
        ),
      );
    }

    const statistics: BenchmarkAuditResult['statistics'] = {
      candidate_rate,
      baseline_rate,
      absolute_delta,
      wilson_ci,
      verdict,
      audit_sufficiency: 'aggregate_only',
    };

    return { findings, statistics };
  }
}
