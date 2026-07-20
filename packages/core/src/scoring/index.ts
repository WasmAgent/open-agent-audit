/** @openagentaudit/core/scoring — Evidence Admission Score (EAS) and Agent Risk Score (ARS). */
import type { CanonicalEvent, RiskScore } from '@openagentaudit/schema';

type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface AepProvenanceForScoring {
  repo_commit?: string;
  runtime_version?: string;
  policy_bundle_digest?: string;
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

  return Math.max(0, score);
}

function computeProvenanceIntegrity(
  events: CanonicalEvent[],
  aepProvenance?: AepProvenanceForScoring,
  cryptoSummary?: { events_with_hash: number; hashes_content_verified: number; hashes_content_mismatch: number },
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
    (ev) =>
      ev.evidence?.signature_algorithm !== undefined && ev.evidence?.signature === undefined,
  );

  if (hasSignatureAlgorithmWithoutSignature) {
    return 0;
  }

  const allHaveSignature = eventsWithEvidence.every(
    (ev) => ev.evidence?.signature !== undefined,
  );

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

function computeContaminationRiskInverted(contaminationResult?: { contamination_score: number }): number {
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
  penalty += Math.min(30, denyCount * 5);           // policy denials: up to 30
  penalty += Math.min(20, highRiskToolCount * 3);   // high-risk tools: up to 20
  penalty += Math.min(15, errorCount * 3);           // errors: up to 15
  penalty += Math.min(25, highRiskUnapproved * 10); // unapproved high-risk: up to 25
  if (chainBroken) penalty += 20;                   // chain break: 20

  return Math.max(0, 100 - penalty);
}

/**
 * Compute the Evidence Admission Score (EAS) and Agent Risk Score (ARS) for
 * a set of canonical events.
 *
 * EAS formula:
 *   0.20 * trace_completeness
 * + 0.20 * provenance_integrity
 * + 0.20 * objective_verification
 * + 0.15 * policy_coverage
 * + 0.15 * human_oversight_evidence
 * + 0.10 * contamination_risk_inverted
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
 * @returns RiskScore containing EAS, ARS, and component breakdowns
 *
 * @see computeObjectiveVerification — details on the 50-point default
 */
export async function computeRiskScore(
  events: CanonicalEvent[],
  runId?: string,
  aepProvenance?: AepProvenanceForScoring,
  cryptoSummary?: { events_with_hash: number; hashes_content_verified: number; hashes_content_mismatch: number },
  contaminationResult?: { contamination_score: number },
): Promise<RiskScore> {
  const trace_completeness = computeTraceCompleteness(events);
  const provenance_integrity = computeProvenanceIntegrity(events, aepProvenance, cryptoSummary);
  const objective_verification = computeObjectiveVerification(events);
  const policy_coverage = computePolicyCoverage(events);
  const human_oversight_evidence = computeHumanOversightEvidence(events);
  const contamination_risk_inverted = computeContaminationRiskInverted(contaminationResult);

  const eas =
    0.2 * trace_completeness +
    0.2 * provenance_integrity +
    0.2 * objective_verification +
    0.15 * policy_coverage +
    0.15 * human_oversight_evidence +
    0.1 * contamination_risk_inverted;

  const easRounded = Math.round(eas);
  const arsRounded = computeAgentRiskScore(events);

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
