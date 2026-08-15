/** @openagentaudit/core/risk — configurable risk scoring over CanonicalEvent arrays. */
import type { CanonicalEvent } from '@openagentaudit/schema';

/**
 * Weight map keyed by event type or sub-type discriminator.
 * Callers may supply a partial map; missing keys fall back to defaults.
 */
export type RiskWeights = Record<string, number>;

/**
 * Default risk weights keyed by event type.
 * policy_decision(deny) is handled separately in getEventWeight.
 */
const DEFAULT_WEIGHTS: RiskWeights = {
  error: 5,
  policy_decision: 3,
  tool_call: 1,
  human_approval: 0,
  observation: 0,
  model_output: 0,
  final_answer: 0,
};

/** Extra weight added when a policy_decision event has decision=deny. */
const DENY_EXTRA = 7;
/** Extra weight added per high-risk tag on a tool_call event. */
const HIGH_RISK_TAG_EXTRA = 3;

/**
 * Returns the risk weight for a single event.
 * Resolution order:
 *  1. caller weights[event.type]
 *  2. DEFAULT_WEIGHTS[event.type]
 *  3. 0 (unknown type)
 * Plus bonus weights for policy denials and high-risk tool tags.
 */
export function getEventWeight(
  event: CanonicalEvent,
  weights?: RiskWeights,
): number {
  const base =
    weights?.[event.type] ??
    DEFAULT_WEIGHTS[event.type] ??
    0;

  let bonus = 0;

  // Extra weight for policy denials.
  if (
    event.type === 'policy_decision' &&
    event.policy?.decision === 'deny' &&
    weights?.['policy_decision_deny'] === undefined
  ) {
    bonus += DENY_EXTRA;
  } else if (
    event.type === 'policy_decision' &&
    event.policy?.decision === 'deny' &&
    weights?.['policy_decision_deny'] !== undefined
  ) {
    bonus += weights['policy_decision_deny'];
  }

  // Extra weight for high-risk tool tags.
  if (event.type === 'tool_call' && event.tool?.risk_tags) {
    for (const tag of event.tool.risk_tags) {
      if (tag === 'high_risk' || tag === 'mutation') {
        bonus +=
          weights?.['high_risk_tag'] !== undefined
            ? weights['high_risk_tag']
            : HIGH_RISK_TAG_EXTRA;
      }
    }
  }

  return base + bonus;
}

/**
 * Computes a numeric risk score for a set of AEP/canonical events for a given run.
 *
 * @param events  Array of CanonicalEvent objects to score.
 * @param runId   Identifier of the audit run (included in returned result for traceability).
 * @param weights Optional weight overrides keyed by event type. Overrides default weights.
 * @returns       An object containing the numeric score and the runId.
 */
export function computeRiskScore(
  events: CanonicalEvent[],
  runId: string,
  weights?: RiskWeights,
): { runId: string; score: number } {
  const score = events.reduce(
    (sum, event) => sum + getEventWeight(event, weights),
    0,
  );
  return { runId, score };
}
