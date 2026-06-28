/** @openagentaudit/core/scoring — Evidence Admission Score (EAS) implementation. */
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
  if (events.length === 0) return 100;

  let score = 100;

  for (const ev of events) {
    if (!ev.evidence?.evidence_id) {
      score -= 5;
    }
    if (!ev.timestamp || Number.isNaN(Date.parse(ev.timestamp))) {
      score -= 10;
    }
  }

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
  return 0;
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

  return {
    schema_version: 'open-agent-audit/v0.1',
    run_id: events[0]?.run_id ?? runId ?? 'unknown',
    generated_at: new Date().toISOString(),
    evidence_admission_score: {
      score: easRounded,
      grade: toGrade(easRounded),
    },
    agent_risk_score: { score: easRounded },
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
