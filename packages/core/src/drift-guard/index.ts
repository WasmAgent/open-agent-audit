/** @openagentaudit/core/drift-guard */
import type { CanonicalEvent, PolicyDecision, Severity } from '@openagentaudit/schema';

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
  /** Average recording mode fidelity (full=3, delta=2, validation=1, none=0). */
  recording_mode_fidelity: number;
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
  let recordingModeSum = 0;
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
      // recording_mode fidelity: full=3, delta=2, validation=1, absent=0
      if (ev.recording_mode === 'full') {
        recordingModeSum += 3;
      } else if (ev.recording_mode === 'delta') {
        recordingModeSum += 2;
      } else if (ev.recording_mode === 'validation') {
        recordingModeSum += 1;
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
    recording_mode_fidelity: toolCallCount > 0 ? recordingModeSum / safeToolCallCount : 0,
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
  'recording_mode_fidelity',
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
  const drift_score = Math.round((drifted_metrics.length / METRIC_NAMES.length) * 100);

  return {
    windows: 2,
    drifted_metrics,
    metrics,
    drift_score,
  };
}

// ---------------------------------------------------------------------------
// Audit-level drift detection (issue #196 — Milestone 6)
//
// `driftGuard` above compares two event *windows* using rate-based metrics
// (tool_call_rate, deny_rate, …). It cannot surface the categorical,
// security-critical deltas that matter between two consecutive *audits*:
//   - a permission that used to be denied/restricted is now allowed,
//   - a tool that was never used before has appeared,
//   - a policy decision or rule has changed for an existing tool.
// `auditDrift` fills that gap with a set/categorical comparison and returns
// structured findings for exactly those three categories.
// ---------------------------------------------------------------------------

export interface PermissionEscalation {
  tool: string;
  capability?: string;
  /** Most permissive decision for this tool in the previous audit. */
  previous_decision: PolicyDecision;
  /** Most permissive decision for this tool in the current audit. */
  current_decision: PolicyDecision;
  severity: Severity;
}

export interface NewToolUsage {
  tool: string;
  capability?: string;
  risk_tags: string[];
}

export interface PolicyChange {
  tool: string;
  capability?: string;
  /** Sorted unique decisions observed for this tool in the previous audit. */
  previous_decisions: PolicyDecision[];
  /** Sorted unique decisions observed for this tool in the current audit. */
  current_decisions: PolicyDecision[];
  previous_rule_ids: string[];
  current_rule_ids: string[];
}

export interface AuditDriftReport {
  permission_escalations: PermissionEscalation[];
  new_tools: NewToolUsage[];
  policy_changes: PolicyChange[];
  total_changes: number;
  drift_detected: boolean;
}

interface ToolPolicyProfile {
  decisions: Set<PolicyDecision>;
  rule_ids: Set<string>;
  capability?: string;
  risk_tags: Set<string>;
}

function buildToolPolicyProfiles(events: CanonicalEvent[]): Map<string, ToolPolicyProfile> {
  const profiles = new Map<string, ToolPolicyProfile>();
  const ensure = (name: string): ToolPolicyProfile => {
    const existing = profiles.get(name);
    if (existing !== undefined) return existing;
    const created: ToolPolicyProfile = {
      decisions: new Set(),
      rule_ids: new Set(),
      risk_tags: new Set(),
    };
    profiles.set(name, created);
    return created;
  };

  for (const ev of events) {
    if (ev.type === 'policy_decision' && ev.tool?.name !== undefined && ev.policy !== undefined) {
      const profile = ensure(ev.tool.name);
      profile.decisions.add(ev.policy.decision);
      if (ev.policy.rule_id !== undefined) {
        profile.rule_ids.add(ev.policy.rule_id);
      }
      if (ev.tool.capability !== undefined) {
        profile.capability = ev.tool.capability;
      }
    }
    if (ev.type === 'tool_call' && ev.tool?.name !== undefined) {
      const profile = ensure(ev.tool.name);
      if (ev.tool.capability !== undefined) {
        profile.capability = ev.tool.capability;
      }
      for (const tag of ev.tool.risk_tags ?? []) {
        profile.risk_tags.add(tag);
      }
    }
  }
  return profiles;
}

/** Most permissive decision in a set, or undefined when the set is empty. */
function mostPermissiveDecision(decisions: Set<PolicyDecision>): PolicyDecision | undefined {
  if (decisions.size === 0) return undefined;
  if (decisions.has('allow')) return 'allow';
  if (decisions.has('ask_user')) return 'ask_user';
  return 'deny';
}

function rankOf(decision: PolicyDecision): number {
  if (decision === 'allow') return 2;
  if (decision === 'ask_user') return 1;
  return 0;
}

function escalationSeverity(prevRank: number, currRank: number): Severity {
  // Caller guarantees currRank > prevRank.
  if (prevRank === 0 && currRank === 2) return 'critical'; // deny → allow
  if (currRank === 2) return 'high'; // ask_user → allow
  return 'medium'; // deny → ask_user
}

function sortedDecisions(decisions: Set<PolicyDecision>): PolicyDecision[] {
  const out: PolicyDecision[] = [];
  if (decisions.has('deny')) out.push('deny');
  if (decisions.has('ask_user')) out.push('ask_user');
  if (decisions.has('allow')) out.push('allow');
  return out;
}

function sameSortedArray(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Compare two consecutive audits and flag the three security-relevant drift
 * categories from Milestone 6: permission escalations, new tool usage, and
 * policy changes.
 *
 * Each audit is the raw `CanonicalEvent[]` evidence for one audit run. Only
 * tools that carried a `policy_decision` in *both* audits are eligible for the
 * escalation / policy-change comparison (an escalation requires a prior
 * decision to escalate from). Tools that appeared via `tool_call` in the
 * current audit but not the previous are reported as new tool usage.
 */
export async function auditDrift(
  previous: CanonicalEvent[],
  current: CanonicalEvent[],
): Promise<AuditDriftReport> {
  const profilesA = buildToolPolicyProfiles(previous);
  const profilesB = buildToolPolicyProfiles(current);

  // --- New tool usage: tools invoked in `current` but never in `previous`. ---
  const previousTools = new Set<string>();
  for (const ev of previous) {
    if (ev.type === 'tool_call' && ev.tool?.name !== undefined) {
      previousTools.add(ev.tool.name);
    }
  }
  const newToolNames = new Set<string>();
  for (const ev of current) {
    if (
      ev.type === 'tool_call' &&
      ev.tool?.name !== undefined &&
      !previousTools.has(ev.tool.name)
    ) {
      newToolNames.add(ev.tool.name);
    }
  }
  const new_tools: NewToolUsage[] = [];
  for (const name of newToolNames) {
    const profile = profilesB.get(name);
    const entry: NewToolUsage = {
      tool: name,
      risk_tags: profile ? Array.from(profile.risk_tags).sort() : [],
    };
    if (profile?.capability !== undefined) {
      entry.capability = profile.capability;
    }
    new_tools.push(entry);
  }
  new_tools.sort((a, b) => a.tool.localeCompare(b.tool));

  // --- Permission escalations & non-escalating policy changes. ---
  // Comparable only when the tool had ≥1 policy_decision in BOTH audits.
  const permission_escalations: PermissionEscalation[] = [];
  const policy_changes: PolicyChange[] = [];

  for (const [name, profileA] of profilesA) {
    if (profileA.decisions.size === 0) continue;
    const profileB = profilesB.get(name);
    if (profileB === undefined || profileB.decisions.size === 0) continue;

    const decisionsA = sortedDecisions(profileA.decisions);
    const decisionsB = sortedDecisions(profileB.decisions);
    const rulesA = Array.from(profileA.rule_ids).sort();
    const rulesB = Array.from(profileB.rule_ids).sort();

    const decisionsChanged = !sameSortedArray(decisionsA, decisionsB);
    const rulesChanged = !sameSortedArray(rulesA, rulesB);
    if (!decisionsChanged && !rulesChanged) continue;

    const prevTop = mostPermissiveDecision(profileA.decisions);
    const currTop = mostPermissiveDecision(profileB.decisions);
    const capability = profileB.capability ?? profileA.capability;

    if (prevTop !== undefined && currTop !== undefined && rankOf(currTop) > rankOf(prevTop)) {
      const escalation: PermissionEscalation = {
        tool: name,
        previous_decision: prevTop,
        current_decision: currTop,
        severity: escalationSeverity(rankOf(prevTop), rankOf(currTop)),
      };
      if (capability !== undefined) {
        escalation.capability = capability;
      }
      permission_escalations.push(escalation);
    } else {
      const change: PolicyChange = {
        tool: name,
        previous_decisions: decisionsA,
        current_decisions: decisionsB,
        previous_rule_ids: rulesA,
        current_rule_ids: rulesB,
      };
      if (capability !== undefined) {
        change.capability = capability;
      }
      policy_changes.push(change);
    }
  }

  permission_escalations.sort((a, b) => a.tool.localeCompare(b.tool));
  policy_changes.sort((a, b) => a.tool.localeCompare(b.tool));

  const total_changes = permission_escalations.length + new_tools.length + policy_changes.length;

  return {
    permission_escalations,
    new_tools,
    policy_changes,
    total_changes,
    drift_detected: total_changes > 0,
  };
}
