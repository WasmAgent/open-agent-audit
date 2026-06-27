/** @openagentaudit/core/drift-guard */
import type { CanonicalEvent } from '@openagentaudit/schema';

export interface DriftWindow {
  label: string;
  events: CanonicalEvent[];
}

export interface DriftMetric {
  name: string;
  window_a: number;
  window_b: number;
  delta: number;
  relative_delta: number;
  drifted: boolean;
}

export interface DriftSummary {
  windows: number;
  drifted_metrics: string[];
  metrics: DriftMetric[];
  drift_score: number;
}

interface WindowStats {
  tool_call_rate: number;
  deny_rate: number;
  error_rate: number;
  human_approval_rate: number;
  avg_risk_tag_count: number;
  high_risk_action_fraction: number;
  unique_tools_count: number;
  model_output_token_rate: number;
}

function computeStats(events: CanonicalEvent[]): WindowStats {
  const total = events.length;

  let toolCallCount = 0;
  let policyDecisionCount = 0;
  let denyCount = 0;
  let errorCount = 0;
  let humanApprovalCount = 0;
  let riskTagSum = 0;
  let highRiskCount = 0;
  let tokenSum = 0;
  const toolNames = new Set<string>();

  for (const ev of events) {
    if (ev.type === 'tool_call') {
      toolCallCount += 1;
      if (ev.tool?.name !== undefined) {
        toolNames.add(ev.tool.name);
      }
      const tags = ev.tool?.risk_tags;
      if (tags !== undefined) {
        riskTagSum += tags.length;
        if (tags.some((t) => t === 'high_risk' || t === 'mutation')) {
          highRiskCount += 1;
        }
      }
    }
    if (ev.type === 'policy_decision') {
      policyDecisionCount += 1;
      if (ev.policy?.decision === 'deny') {
        denyCount += 1;
      }
    }
    if (ev.type === 'error') {
      errorCount += 1;
    }
    if (ev.type === 'human_approval') {
      humanApprovalCount += 1;
    }
    if (ev.type === 'model_output') {
      tokenSum += ev.model_output?.token_count ?? 0;
    }
  }

  const safeTotal = Math.max(total, 1);
  const safePolicyCount = Math.max(policyDecisionCount, 1);
  const safeToolCallCount = Math.max(toolCallCount, 1);

  return {
    tool_call_rate: toolCallCount / safeTotal,
    deny_rate: policyDecisionCount > 0 ? denyCount / safePolicyCount : 0,
    error_rate: errorCount / safeTotal,
    human_approval_rate: humanApprovalCount / safeTotal,
    avg_risk_tag_count: toolCallCount > 0 ? riskTagSum / safeToolCallCount : 0,
    high_risk_action_fraction: toolCallCount > 0 ? highRiskCount / safeToolCallCount : 0,
    unique_tools_count: toolNames.size,
    model_output_token_rate: tokenSum / safeTotal,
  };
}

const METRIC_NAMES: Array<keyof WindowStats> = [
  'tool_call_rate',
  'deny_rate',
  'error_rate',
  'human_approval_rate',
  'avg_risk_tag_count',
  'high_risk_action_fraction',
  'unique_tools_count',
  'model_output_token_rate',
];

export async function driftGuard(
  windowA: DriftWindow,
  windowB: DriftWindow,
  opts?: { threshold?: number },
): Promise<DriftSummary> {
  const threshold = opts?.threshold ?? 0.25;

  const statsA = computeStats(windowA.events);
  const statsB = computeStats(windowB.events);

  const metrics: DriftMetric[] = METRIC_NAMES.map((name) => {
    const a = statsA[name];
    const b = statsB[name];
    const delta = b - a;
    const relative_delta = delta / Math.max(Math.abs(a), 1e-9);
    const drifted = Math.abs(relative_delta) > threshold;
    return { name, window_a: a, window_b: b, delta, relative_delta, drifted };
  });

  const drifted_metrics = metrics.filter((m) => m.drifted).map((m) => m.name);
  const drift_score = Math.round((drifted_metrics.length / 8) * 100);

  return {
    windows: 2,
    drifted_metrics,
    metrics,
    drift_score,
  };
}
