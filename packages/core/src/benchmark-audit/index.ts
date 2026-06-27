/** @openagentaudit/core/benchmark-audit */
import type { Finding } from '@openagentaudit/schema';
import { SPEC_VERSION } from '@openagentaudit/schema';

export interface BenchmarkPair {
  candidate: { samples_total: number; samples_pass: number; label?: string };
  baseline: { samples_total: number; samples_pass: number; label?: string };
  claim?: string;
}

export interface BenchmarkAuditResult {
  findings: Finding[];
  statistics: {
    candidate_rate: number;
    baseline_rate: number;
    absolute_delta: number;
    mcnemar_p?: number;
    wilson_ci?: [number, number];
    verdict: 'supports_claim' | 'rejects_claim' | 'inconclusive';
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
): Finding {
  return {
    schema_version: SPEC_VERSION,
    finding_id: btoa(ruleId),
    rule_id: ruleId,
    severity,
    category: 'benchmark',
    title,
    description,
    evidence_ids: [],
    recommendation,
  };
}

export async function benchmarkAudit(pair: BenchmarkPair): Promise<BenchmarkAuditResult> {
  const { candidate, baseline } = pair;

  const candidate_rate = candidate.samples_pass / candidate.samples_total;
  const baseline_rate = baseline.samples_pass / baseline.samples_total;
  const absolute_delta = candidate_rate - baseline_rate;

  // Wilson 95% CI on candidate rate
  const wilson_ci = wilsonCI(candidate_rate, candidate.samples_total);

  // McNemar: only when both totals are equal
  let mcnemar_p: number | undefined;
  if (candidate.samples_total === baseline.samples_total) {
    const b = Math.round(baseline_rate * baseline.samples_total);
    const c = Math.round(candidate_rate * candidate.samples_total);
    mcnemar_p = mcnemarP(b, c);
  }

  // Verdict
  const isStatSig = mcnemar_p !== undefined && mcnemar_p < 0.05;
  let verdict: 'supports_claim' | 'rejects_claim' | 'inconclusive';
  if (absolute_delta >= 0.05 && isStatSig) {
    verdict = 'supports_claim';
  } else if (absolute_delta < -0.02) {
    verdict = 'rejects_claim';
  } else {
    verdict = 'inconclusive';
  }

  // Findings
  const findings: Finding[] = [];

  // OAA-B-001: regression (high) — candidate is worse than baseline
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

  // OAA-B-002: small sample (<30) — medium severity
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

  // OAA-B-003: inconclusive claim — low severity, only when a claim was made
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

  const statistics: BenchmarkAuditResult['statistics'] = {
    candidate_rate,
    baseline_rate,
    absolute_delta,
    wilson_ci,
    verdict,
  };

  if (mcnemar_p !== undefined) {
    statistics.mcnemar_p = mcnemar_p;
  }

  return { findings, statistics };
}
