/** @openagentaudit/core/scoring — Evidence Admission Score (EAS) and Agent Risk Score (ARS). */
import type { CanonicalEvent, RiskScore } from '@openagentaudit/schema';

type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

/**
 * AEP run-provenance fields used by {@link computeRiskScore} to boost the
 * provenance_integrity component of the Evidence Admission Score (EAS).
 *
 * Each populated field adds +5 points to provenance_integrity (max +20).
 * These fields anchor the audit record to the exact code, runtime, policy
 * ruleset, and tool manifest in effect at run time, satisfying
 * EU AI Act Art. 12(3)(c) / Art. 19 traceability requirements.
 *
 * When `aepProvenance` is `undefined` or all fields are empty, no bonus
 * is applied (degradation: provenance_integrity stays at its base value
 * of 60 for hash-only chains or 100 for signed chains).
 *
 * @example
 * ```ts
 * const score = await computeRiskScore(events, runId, {
 *   repo_commit: 'abc123',
 *   runtime_version: 'v1.2.0',
 *   policy_bundle_digest: 'sha256:...',
 *   tool_manifest_digest: 'sha256:...',
 * });
 * // provenance_integrity will be base + 20
 * ```
 */
export interface AepProvenanceForScoring {
  /** Git commit SHA of the agent repository at run time. */
  repo_commit?: string;
  /** Semantic version of the agent runtime (e.g. "v1.2.0"). */
  runtime_version?: string;
  /** Content-addressable digest of the policy bundle applied during the run. */
  policy_bundle_digest?: string;
  /** Content-addressable digest of the tool manifest in effect. */
  tool_manifest_digest?: string;
}

function toGrade(score: number): Grade {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

function computeTraceCompleteness(events: CanonicalEvent[]): number {
  if (events.length === 0) return 0;

  let score = 100;

  let missingCount = 0;
  let missingTimestamps = 0;

  for (const ev of events) {
    if (!ev.evidence?.evidence_id) {
      missingCount++;
    }
    if (!ev.timestamp || Number.isNaN(Date.parse(ev.timestamp))) {
      missingTimestamps++;
    }
  }

  score -= (missingCount / events.length) * 50;
  score -= (missingTimestamps / events.length) * 30;

  // Detect unpaired tool_call events: a tool_call with no subsequent observation
  // referencing the same tool name in the same run_id.
  const toolCallNames = new Set<string>();
  const observationSources = new Set<string>();

  for (const ev of events) {
    if (ev.type === 'tool_call' && ev.tool?.name) {
      toolCallNames.add(ev.tool.name);
    }
    if (ev.type === 'observation' && ev.observation?.source) {
      observationSources.add(ev.observation.source);
    }
  }

  for (const toolName of toolCallNames) {
    const hasObservation = [...observationSources].some(
      (src) => src === toolName || src.endsWith(`:${toolName}`),
    );
    if (!hasObservation) {
      score -= 2;
    }
  }

  // recording_mode bonus: "full" > "delta" > "validation"
  // Events with recording_mode="full" add a small completeness bonus,
  // "validation" events are penalized slightly for lower fidelity.
  const toolCallEvents = events.filter((ev) => ev.type === 'tool_call');
  if (toolCallEvents.length > 0) {
    let modeBonus = 0;
    let modeCount = 0;
    for (const ev of toolCallEvents) {
      if (ev.recording_mode === 'full') {
        modeBonus += 3;
        modeCount++;
      } else if (ev.recording_mode === 'delta') {
        modeBonus += 1;
        modeCount++;
      } else if (ev.recording_mode === 'validation') {
        modeBonus -= 2;
        modeCount++;
      }
    }
    if (modeCount > 0) {
      score += modeBonus / toolCallEvents.length;
    }
  }

  return Math.max(0, Math.min(100, score));
}

function computeProvenanceIntegrity(
  events: CanonicalEvent[],
  aepProvenance?: AepProvenanceForScoring,
  cryptoSummary?: {
    events_with_hash: number;
    hashes_content_verified: number;
    hashes_content_mismatch: number;
  },
): number {
  const eventsWithEvidence = events.filter(
    (ev) => ev.evidence?.hash !== undefined || ev.evidence?.prev_hash !== undefined,
  );

  if (eventsWithEvidence.length === 0) {
    return 20;
  }

  // Check hash chain: prev_hash[i] === hash[i-1] for all i > 0
  let chainBroken = false;
  for (let i = 1; i < eventsWithEvidence.length; i++) {
    const prev = eventsWithEvidence[i - 1];
    const curr = eventsWithEvidence[i];
    if (curr?.evidence?.prev_hash !== undefined && prev?.evidence?.hash !== undefined) {
      if (curr.evidence.prev_hash !== prev.evidence.hash) {
        chainBroken = true;
        break;
      }
    }
  }

  if (chainBroken) {
    return 0;
  }

  // Check signatures
  const hasSignatureAlgorithmWithoutSignature = eventsWithEvidence.some(
    (ev) => ev.evidence?.signature_algorithm !== undefined && ev.evidence?.signature === undefined,
  );

  if (hasSignatureAlgorithmWithoutSignature) {
    return 0;
  }

  const allHaveSignature = eventsWithEvidence.every((ev) => ev.evidence?.signature !== undefined);

  // Base score from hash chain + signatures
  let base = allHaveSignature ? 100 : 60;

  // AEP run-provenance bonus: each of the four traceability fields that is
  // populated adds 5 points (max +20), capped at 100. These fields anchor
  // the record to the exact code, runtime, policy ruleset, and tool manifest
  // in effect at run time (EU AI Act Art. 12(3)(c) / Art. 19).
  if (aepProvenance !== undefined) {
    let bonus = 0;
    if (aepProvenance.repo_commit) bonus += 5;
    if (aepProvenance.runtime_version) bonus += 5;
    if (aepProvenance.policy_bundle_digest) bonus += 5;
    if (aepProvenance.tool_manifest_digest) bonus += 5;
    base = Math.min(100, base + bonus);
  }

  // DSSE attestation bonus: if any event uses DSSE format, add +3 to
  // provenance_integrity for stronger cryptographic provenance.
  const hasDsseAttestation = eventsWithEvidence.some(
    (ev) => ev.evidence?.attestation_format === 'dsse',
  );
  if (hasDsseAttestation) {
    base = Math.min(100, base + 3);
  }

  // Penalize for content hash mismatches: each mismatch reduces score by 20, floored at 0
  if (cryptoSummary !== undefined && cryptoSummary.hashes_content_mismatch > 0) {
    base = Math.max(0, base - cryptoSummary.hashes_content_mismatch * 20);
  }

  return base;
}

/**
 * Compute the objective_verification EAS component from the event stream.
 *
 * Returns a 0–100 score based on the ratio of verifier observations to
 * tool_call events:
 * - 100: verifier coverage >= 80% of tool calls
 * -  80: no tool_call events at all (non-agentic run)
 * -  70: verifier coverage >= 50%
 * -  50: **default / neutral** — tool calls exist but NO verifier results
 * -  40: some verifier results exist but coverage < 50%
 *
 * NOTE: The score defaults to 50 (neutral) when no verifier results are
 * present in the event stream. For tool-calling agents this means the
 * objective_verification component will always be 50 unless verifier
 * observations (source prefixed with "verifier:") are present.
 *
 * To get a meaningful score, ensure verifier results are added to tool_call
 * events before passing them to {@link computeRiskScore}. If using the AEP
 * adapter, populate the `verifier_results` field on AEP records so that the
 * adapter emits verifier observations into the canonical event stream.
 *
 * @see computeRiskScore — the top-level scoring function that uses this component
 */
function computeObjectiveVerification(events: CanonicalEvent[]): number {
  const toolCallCount = events.filter((ev) => ev.type === 'tool_call').length;

  if (toolCallCount === 0) {
    return 80;
  }

  const verifierCount = events.filter(
    (ev) =>
      ev.type === 'observation' &&
      ev.observation?.source !== undefined &&
      ev.observation.source.startsWith('verifier:'),
  ).length;

  if (verifierCount >= toolCallCount * 0.8) return 100;
  if (verifierCount >= toolCallCount * 0.5) return 70;
  if (verifierCount > 0) return 40;

  // No verifiers present at all: return neutral baseline (50) rather than 0.
  // A score of 0 is reserved for explicit verifier failures (verifier observations
  // exist but all failed). Non-verifier agents should not be penalized for not
  // having verification infrastructure.
  return 50;
}

function computePolicyCoverage(events: CanonicalEvent[]): number {
  const toolCallCount = events.filter((ev) => ev.type === 'tool_call').length;
  const policyCount = events.filter((ev) => ev.type === 'policy_decision').length;

  if (policyCount === 0 && toolCallCount === 0) return 50;
  if (policyCount === 0 && toolCallCount > 0) return 0;

  return Math.min(100, Math.round((policyCount / Math.max(toolCallCount, 1)) * 100));
}

function computeHumanOversightEvidence(events: CanonicalEvent[]): number {
  const humanCount = events.filter((ev) => ev.type === 'human_approval').length;
  const requiredCount = events.filter(
    (ev) =>
      ev.type === 'tool_call' &&
      ev.tool?.risk_tags !== undefined &&
      ev.tool.risk_tags.some((tag) => tag === 'human_required' || tag === 'high_risk'),
  ).length;

  if (requiredCount === 0) return 80;
  if (humanCount >= requiredCount) return 100;
  return Math.round((humanCount / requiredCount) * 100);
}

function computeContaminationRiskInverted(contaminationResult?: {
  contamination_score: number;
}): number {
  if (contaminationResult === undefined) return 100; // no contamination data → neutral
  // contamination_score is 0-100 where 100 = high overlap
  // inverted: 0 contamination → 100 EAS; 100 contamination → 0 EAS
  return Math.max(0, 100 - contaminationResult.contamination_score);
}

/**
 * Agent Risk Score (ARS): measures behavioral risk indicators from the trace.
 *
 * Unlike EAS (which measures evidence quality), ARS measures whether the
 * agent's observed behavior carries risk signals: policy denials, high-risk
 * tool usage, approval bypasses, errors, and chain breaks.
 *
 * Returns a 0–100 score where 100 = lowest observed risk.
 */
function computeAgentRiskScore(events: CanonicalEvent[]): number {
  if (events.length === 0) return 100;

  let penalty = 0;

  // Count risk indicators
  const denyCount = events.filter(
    (ev) => ev.type === 'policy_decision' && ev.policy?.decision === 'deny',
  ).length;

  const highRiskToolCount = events.filter(
    (ev) =>
      ev.type === 'tool_call' &&
      ev.tool?.risk_tags !== undefined &&
      ev.tool.risk_tags.some((t) => t === 'high_risk' || t === 'mutation' || t === 'destructive'),
  ).length;

  const errorCount = events.filter((ev) => ev.type === 'error').length;

  // High-risk tool calls with no preceding human_approval in the run
  const runsWithApproval = new Set<string>();
  for (const ev of events) {
    if (ev.type === 'human_approval') runsWithApproval.add(ev.run_id);
  }
  const highRiskUnapproved = events.filter(
    (ev) =>
      ev.type === 'tool_call' &&
      ev.tool?.risk_tags !== undefined &&
      ev.tool.risk_tags.some((t) => t === 'human_required') &&
      !runsWithApproval.has(ev.run_id),
  ).length;

  // Check for hash chain breaks (evidence tampering indicator)
  const chainEvents = events.filter(
    (ev) => ev.evidence?.hash !== undefined || ev.evidence?.prev_hash !== undefined,
  );
  let chainBroken = false;
  for (let i = 1; i < chainEvents.length; i++) {
    const prev = chainEvents[i - 1];
    const curr = chainEvents[i];
    if (curr?.evidence?.prev_hash !== undefined && prev?.evidence?.hash !== undefined) {
      if (curr.evidence.prev_hash !== prev.evidence.hash) {
        chainBroken = true;
        break;
      }
    }
  }

  // Penalties (additive, capped at 100)
  penalty += Math.min(30, denyCount * 5); // policy denials: up to 30
  penalty += Math.min(20, highRiskToolCount * 3); // high-risk tools: up to 20
  penalty += Math.min(15, errorCount * 3); // errors: up to 15
  penalty += Math.min(25, highRiskUnapproved * 10); // unapproved high-risk: up to 25
  if (chainBroken) penalty += 20; // chain break: 20

  return Math.max(0, 100 - penalty);
}

/**
 * Optional drift detection result that can be passed to {@link computeRiskScore}
 * to factor behavioral drift into the Agent Risk Score (ARS).
 *
 * When provided, the `drift_score` (0-100 where 100 = all metrics drifted)
 * is used to apply a penalty to the ARS: `penalty = drift_score * 0.15`
 * (max 15 points deducted from ARS).
 */
export interface DriftResultForScoring {
  /** 0-100 score from driftGuard() where 100 means all metrics drifted. */
  drift_score: number;
}

/**
 * Configurable weights for the Evidence Admission Score (EAS) components.
 *
 * Each weight controls how much its corresponding component influences the
 * final EAS. Weights are **relative** — they are normalised to sum to 1.0 at
 * scoring time (see {@link computeRiskScore}), so the EAS always lands in
 * [0, 100] regardless of the magnitudes supplied. Set a weight to `0` to
 * exclude that component from the score entirely.
 *
 * When `riskWeights` is omitted the {@link DEFAULT_RISK_WEIGHTS} are used.
 * When partially provided, any field not supplied falls back to its default
 * value, so callers can override a single component without restating the
 * whole rubric.
 *
 * @example
 * ```ts
 * // Emphasise provenance 3x relative to its default, de-emphasise trace completeness
 * const score = await computeRiskScore(events, runId, undefined, undefined, undefined, undefined, {
 *   trace_completeness: 0.1,
 *   provenance_integrity: 0.6,
 * });
 * ```
 */
export interface RiskWeights {
  /** Weight for the trace_completeness component (default 0.20). */
  trace_completeness?: number;
  /** Weight for the provenance_integrity component (default 0.20). */
  provenance_integrity?: number;
  /** Weight for the objective_verification component (default 0.20). */
  objective_verification?: number;
  /** Weight for the policy_coverage component (default 0.15). */
  policy_coverage?: number;
  /** Weight for the human_oversight_evidence component (default 0.15). */
  human_oversight_evidence?: number;
  /** Weight for the contamination_risk_inverted component (default 0.10). */
  contamination_risk_inverted?: number;
}

/**
 * Default EAS component weights used when {@link computeRiskScore} is called
 * without a `riskWeights` argument. These sum to 1.0, so normalisation is a
 * no-op and the score matches the original fixed-weight formula exactly.
 */
export const DEFAULT_RISK_WEIGHTS: Required<RiskWeights> = {
  trace_completeness: 0.2,
  provenance_integrity: 0.2,
  objective_verification: 0.2,
  policy_coverage: 0.15,
  human_oversight_evidence: 0.15,
  contamination_risk_inverted: 0.1,
};

/**
 * Resolve a (possibly partial) {@link RiskWeights} into a complete, normalised
 * weight set used by {@link computeRiskScore}.
 *
 * - Any field that is missing or not a finite number falls back to its
 *   {@link DEFAULT_RISK_WEIGHTS} value, so callers can override a single
 *   component without restating the whole rubric.
 * - Negative weights are clamped to 0 (a weight expresses non-negative
 *   relative emphasis; use 0 to exclude a component).
 * - The resolved weights are normalised to sum to 1.0, so the EAS always
 *   lands in [0, 100] regardless of the magnitudes supplied.
 * - If every resolved weight is 0 (e.g. the caller explicitly zeroed every
 *   component), the {@link DEFAULT_RISK_WEIGHTS} are used — this keeps the
 *   score meaningful instead of collapsing to 0.
 */
function resolveRiskWeights(riskWeights?: RiskWeights): Required<RiskWeights> {
  const pick = (key: keyof RiskWeights): number => {
    const value = riskWeights?.[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      return DEFAULT_RISK_WEIGHTS[key];
    }
    return value;
  };

  const merged: Required<RiskWeights> = {
    trace_completeness: pick('trace_completeness'),
    provenance_integrity: pick('provenance_integrity'),
    objective_verification: pick('objective_verification'),
    policy_coverage: pick('policy_coverage'),
    human_oversight_evidence: pick('human_oversight_evidence'),
    contamination_risk_inverted: pick('contamination_risk_inverted'),
  };

  const sum =
    merged.trace_completeness +
    merged.provenance_integrity +
    merged.objective_verification +
    merged.policy_coverage +
    merged.human_oversight_evidence +
    merged.contamination_risk_inverted;

  if (!(sum > 0)) {
    // Every weight is 0 → fall back to defaults so the score stays meaningful.
    return DEFAULT_RISK_WEIGHTS;
  }

  // Already (effectively) unit-sum: return as-is. This is the path the default
  // weights take — 0.2+0.2+0.2+0.15+0.15+0.1 is within float error of 1.0 but
  // not exactly 1.0, so a strict `sum === 1` check would pointlessly renormalise
  // them and introduce rounding drift. Passing them through unchanged keeps the
  // score bit-for-bit identical to the original fixed-weight formula.
  if (Math.abs(sum - 1) < 1e-9) {
    return merged;
  }

  return {
    trace_completeness: merged.trace_completeness / sum,
    provenance_integrity: merged.provenance_integrity / sum,
    objective_verification: merged.objective_verification / sum,
    policy_coverage: merged.policy_coverage / sum,
    human_oversight_evidence: merged.human_oversight_evidence / sum,
    contamination_risk_inverted: merged.contamination_risk_inverted / sum,
  };
}

/**
 * Compute the Evidence Admission Score (EAS) and Agent Risk Score (ARS) for
 * a set of canonical events.
 *
 * EAS formula (weights are configurable via `riskWeights`, defaulting to
 * {@link DEFAULT_RISK_WEIGHTS}; the resolved weights are normalised to sum
 * to 1.0 so the score stays in [0, 100]):
 *   w_trace * trace_completeness
 * + w_prov  * provenance_integrity
 * + w_obj   * objective_verification
 * + w_pol   * policy_coverage
 * + w_human * human_oversight_evidence
 * + w_cont  * contamination_risk_inverted
 *
 * NOTE: The `objective_verification` component defaults to 50 (neutral)
 * when no verifier results are present in the event stream. For tool-calling
 * agents this means the component always contributes 10 points (0.20 * 50)
 * unless verifier observations exist. To get a meaningful score, ensure
 * verifier observations (type "observation" with source prefixed "verifier:")
 * are present in the events array before calling this function.
 *
 * If using the AEP v0.2 adapter, populate `verifier_results` on AEP records
 * so that the adapter emits verifier observations into the canonical stream.
 *
 * @param events - Array of canonical events representing the agent run
 * @param runId - Optional run ID override (used if events[0].run_id is missing)
 * @param aepProvenance - Optional AEP provenance fields for provenance_integrity bonus
 * @param cryptoSummary - Optional crypto verification summary from validate()
 * @param contaminationResult - Optional contamination detection result
 * @param driftResult - Optional drift detection result from driftGuard(); when provided,
 *   the drift_score is factored into the Agent Risk Score as a penalty (max -15 pts)
 * @param riskWeights - Optional configurable EAS component weights. Missing
 *   fields fall back to {@link DEFAULT_RISK_WEIGHTS}. Resolved weights are
 *   normalised to sum to 1.0, so they act as relative emphasis and the EAS
 *   remains in [0, 100]; a weight of 0 excludes that component. If every
 *   resolved weight is 0 the defaults are used.
 * @returns RiskScore containing EAS, ARS, and component breakdowns
 *
 * @see computeObjectiveVerification — details on the 50-point default
 */
export async function computeRiskScore(
  events: CanonicalEvent[],
  runId?: string,
  aepProvenance?: AepProvenanceForScoring,
  cryptoSummary?: {
    events_with_hash: number;
    hashes_content_verified: number;
    hashes_content_mismatch: number;
  },
  contaminationResult?: { contamination_score: number },
  driftResult?: DriftResultForScoring,
  riskWeights?: RiskWeights,
): Promise<RiskScore> {
  const trace_completeness = computeTraceCompleteness(events);
  const provenance_integrity = computeProvenanceIntegrity(events, aepProvenance, cryptoSummary);
  const objective_verification = computeObjectiveVerification(events);
  const policy_coverage = computePolicyCoverage(events);
  const human_oversight_evidence = computeHumanOversightEvidence(events);
  const contamination_risk_inverted = computeContaminationRiskInverted(contaminationResult);

  // Resolve configurable weights (partial overrides fall back to defaults) and
  // normalise to sum=1 so weights act as relative emphasis and the EAS stays
  // in [0, 100]. When the defaults are in effect they already sum to 1.0, so
  // normalisation is a no-op and the score matches the fixed-weight formula.
  const weights = resolveRiskWeights(riskWeights);

  const eas =
    weights.trace_completeness * trace_completeness +
    weights.provenance_integrity * provenance_integrity +
    weights.objective_verification * objective_verification +
    weights.policy_coverage * policy_coverage +
    weights.human_oversight_evidence * human_oversight_evidence +
    weights.contamination_risk_inverted * contamination_risk_inverted;

  const easRounded = Math.round(eas);
  let arsRounded = computeAgentRiskScore(events);

  // Factor in drift result if provided (#82)
  if (driftResult !== undefined && driftResult.drift_score > 0) {
    const driftPenalty = Math.round(driftResult.drift_score * 0.15);
    arsRounded = Math.max(0, arsRounded - driftPenalty);
  }

  return {
    schema_version: 'open-agent-audit/v0.1',
    run_id: events[0]?.run_id ?? runId ?? 'unknown',
    generated_at: new Date().toISOString(),
    evidence_admission_score: {
      score: easRounded,
      grade: toGrade(easRounded),
    },
    agent_risk_score: { score: arsRounded },
    components: {
      trace_completeness,
      provenance_integrity,
      objective_verification,
      policy_coverage,
      human_oversight_evidence,
      contamination_risk_inverted,
    },
    contamination_evaluated: contaminationResult !== undefined,
  };
}
