/**
 * R2 local fault-injection harness — artifact model and TODO ledger.
 *
 * The harness exercises the REAL worker handlers against deterministic,
 * test-only dependency fakes (see `test/faults.ts`). No production calls, no
 * random chaos: every scenario names the dependency, the checkpoint, and the
 * injected fault kind, and produces a machine-readable
 * `wasmagent-runtime-fault/v1` artifact.
 *
 * Artifacts produced with `mode: 'local'` are LOCAL verification only — they
 * are never production evidence. Production/integration fault artifacts
 * (R2 proper) must use `mode: 'runtime'` and do not exist yet.
 */

export type InjectedFaultKind =
  | 'timeout'
  | 'unavailable'
  | 'quota_exhausted'
  | 'stale_read'
  | 'duplicate_delivery'
  | 'fail_after_write'
  | 'fail_before_ack';

export type FaultDependency = 'd1' | 'kv' | 'r2' | 'queue' | 'do';

export interface FaultArtifact {
  format: 'wasmagent-runtime-fault/v1';
  mode: 'local' | 'runtime';
  source_sha: string;
  scenario: string;
  fault: {
    dependency: FaultDependency;
    checkpoint: string;
    kind: InjectedFaultKind;
  };
  expected: {
    /** Expected HTTP status, or null when the surface is not HTTP. */
    http: number | null;
    /** True when the invariant is "no false success reaches the caller". */
    false_success: false;
  };
  observed: Record<string, unknown>;
  verdict: 'pass' | 'fail';
}

export interface FaultArtifactInput {
  sourceSha: string;
  scenario: string;
  dependency: FaultDependency;
  checkpoint: string;
  kind: InjectedFaultKind;
  expectedHttp: number | null;
  observed: Record<string, unknown>;
  pass: boolean;
}

export function buildFaultArtifact(input: FaultArtifactInput): FaultArtifact {
  return {
    format: 'wasmagent-runtime-fault/v1',
    mode: 'local',
    source_sha: input.sourceSha,
    scenario: input.scenario,
    fault: {
      dependency: input.dependency,
      checkpoint: input.checkpoint,
      kind: input.kind,
    },
    expected: {
      http: input.expectedHttp,
      false_success: false,
    },
    observed: input.observed,
    verdict: input.pass ? 'pass' : 'fail',
  };
}

// ---------------------------------------------------------------------------
// TODO ledger — scenarios the local harness cannot execute honestly yet
// ---------------------------------------------------------------------------

export interface LedgerEntry {
  scenario: string;
  title: string;
  status: 'pending_harness' | 'covered_elsewhere' | 'observed_failing';
  note: string;
}

/**
 * Scenarios from the R2 plan that this harness does NOT fake a closure for.
 * `observed_failing` entries are real local findings: the current worker
 * behavior violates the invariant, and a fix is tracked before R2 proper.
 */
export const R2_FAULT_LEDGER: LedgerEntry[] = [
  {
    scenario: 'R2-D1-05',
    title: 'quota_exhausted -> structured availability outcome',
    status: 'covered_elsewhere',
    note: 'Covered by the D1-ERR-01..08 suite of the D1 503 normalization change (dependency-errors).',
  },
  {
    scenario: 'R2-Q-02',
    title: 'duplicate report job produces one semantic result',
    status: 'pending_harness',
    note: 'Report-job path exists (processReportJob) but offline duplicate semantics are not yet exercised.',
  },
  {
    scenario: 'R2-Q-03',
    title: 'crash after durable side effect, before ACK -> replay converges',
    status: 'pending_harness',
    note: 'Requires fail_before_ack/fail_after_write checkpoints around handleQueue batch processing.',
  },
  {
    scenario: 'R2-Q-04',
    title: 'stale retry cannot overwrite newer state',
    status: 'pending_harness',
    note: 'Depends on the same delivery bookkeeping as R2-Q-01.',
  },
  {
    scenario: 'R2-DO-01',
    title: 'DO state write then response loss -> retry converges',
    status: 'pending_harness',
    note: 'Needs a DurableObjectState fake (storage + alarm) for AuditRunCoordinator/TenantLimiter.',
  },
  {
    scenario: 'R2-DO-02',
    title: '100 same-key concurrent operations preserve the invariant',
    status: 'pending_harness',
    note: 'Needs the DurableObjectState fake; concurrency requires deterministic scheduling.',
  },
  {
    scenario: 'R2-DO-03',
    title: 'restart/alarm race produces no duplicate terminal transition',
    status: 'pending_harness',
    note: 'Needs the DurableObjectState fake with alarm replay.',
  },
  {
    scenario: 'R2-DO-04',
    title: 'stale request gets a deterministic idempotent response',
    status: 'pending_harness',
    note: 'Needs the DurableObjectState fake.',
  },
];
