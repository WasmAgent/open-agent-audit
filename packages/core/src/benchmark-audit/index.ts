/** @openagentaudit/core/benchmark-audit — skeleton. */
import type { Finding } from '@openagentaudit/schema';

export interface BenchmarkPair {
  candidate: { samples_total: number; samples_pass: number };
  baseline: { samples_total: number; samples_pass: number };
  claim?: string;
}

export interface BenchmarkAuditResult {
  findings: Finding[];
  statistics: {
    mcnemar_p?: number;
    wilson_ci?: [number, number];
  };
}

export async function benchmarkAudit(_pair: BenchmarkPair): Promise<BenchmarkAuditResult> {
  return { findings: [], statistics: {} };
}
