/** @openagentaudit/core/inventory */
import type { CanonicalEvent } from '@openagentaudit/schema';

export interface ToolSummary {
  name: string;
  capability?: string;
  calls: number;
  failures: number;
  denied: number;
  approved: number;
  risk_tags: string[];
}

export interface HighRiskAction {
  event_id: string;
  tool_name: string;
  risk_tags: string[];
  has_approval: boolean;
  timestamp: string;
}

export interface HumanApprovalRecord {
  event_id: string;
  reviewer_id: string;
  decision: string;
  timestamp: string;
}

export interface CapabilitySummary {
  capability: string;
  tools: string[];
  policy_count: number;
}

export interface InventoryReport {
  tools: ToolSummary[];
  capabilities: CapabilitySummary[];
  high_risk_actions: HighRiskAction[];
  human_approvals: HumanApprovalRecord[];
  total_events: number;
  tool_call_count: number;
  policy_decision_count: number;
  human_approval_count: number;
  error_count: number;
}

const HIGH_RISK_TAGS = new Set<string>([
  'human_required',
  'high_risk',
  'mutation',
  'filesystem',
  'network',
  'secret',
]);

export async function inventory(events: CanonicalEvent[]): Promise<InventoryReport> {
  // ----- counts -----
  let tool_call_count = 0;
  let policy_decision_count = 0;
  let human_approval_count = 0;
  let error_count = 0;

  // ----- tool inventory -----
  // tool name → mutable accumulator
  const toolMap = new Map<
    string,
    {
      calls: number;
      failures: number;
      denied: number;
      approved: number;
      risk_tags: Set<string>;
      capability: string | undefined;
    }
  >();

  const ensureTool = (name: string) => {
    if (!toolMap.has(name)) {
      toolMap.set(name, {
        calls: 0,
        failures: 0,
        denied: 0,
        approved: 0,
        risk_tags: new Set(),
        capability: undefined,
      });
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return toolMap.get(name)!;
  };

  // Track tool_call event ordering: event_id → tool_name for error linking
  // We correlate errors that appear after a tool_call by looking at the
  // immediately preceding tool_call context within the same run.
  //
  // Strategy: walk events in order; whenever we see a tool_call we note the
  // active tool per run. If the next non-tool_call event within the same run
  // is an error we attribute that error to the active tool.
  const activeToolPerRun = new Map<string, string>(); // run_id → tool_name

  // Human approval timestamps for has_approval lookup (by run_id)
  const approvalTimestampsByRun = new Map<string, number[]>(); // run_id → sorted ms timestamps

  // First pass: collect human approval timestamps
  for (const ev of events) {
    if (ev.type === 'human_approval' && ev.human) {
      const ts = Date.parse(ev.timestamp);
      if (!isNaN(ts)) {
        const list = approvalTimestampsByRun.get(ev.run_id) ?? [];
        list.push(ts);
        approvalTimestampsByRun.set(ev.run_id, list);
      }
    }
  }
  // Sort approval timestamp lists
  for (const [rid, list] of approvalTimestampsByRun) {
    approvalTimestampsByRun.set(rid, list.sort((a, b) => a - b));
  }

  // Second pass: main accumulation
  for (const ev of events) {
    switch (ev.type) {
      case 'tool_call': {
        tool_call_count++;
        const toolName = ev.tool?.name;
        if (toolName !== undefined) {
          const entry = ensureTool(toolName);
          entry.calls++;
          if (ev.tool?.capability !== undefined && entry.capability === undefined) {
            entry.capability = ev.tool.capability;
          }
          for (const tag of ev.tool?.risk_tags ?? []) {
            entry.risk_tags.add(tag);
          }
          activeToolPerRun.set(ev.run_id, toolName);
        }
        break;
      }
      case 'policy_decision': {
        policy_decision_count++;
        const toolName = ev.tool?.name;
        if (toolName !== undefined && ev.policy !== undefined) {
          const entry = ensureTool(toolName);
          if (ev.policy.decision === 'deny') {
            entry.denied++;
          } else if (ev.policy.decision === 'allow') {
            entry.approved++;
          }
        }
        break;
      }
      case 'human_approval': {
        human_approval_count++;
        break;
      }
      case 'error': {
        error_count++;
        const activeTool = activeToolPerRun.get(ev.run_id);
        if (activeTool !== undefined) {
          const entry = ensureTool(activeTool);
          entry.failures++;
          // Clear so we don't double-count multiple errors for the same tool_call
          activeToolPerRun.delete(ev.run_id);
        }
        break;
      }
      default:
        break;
    }
  }

  // ----- build ToolSummary[] -----
  const tools: ToolSummary[] = [];
  for (const [name, entry] of toolMap) {
    const summary: ToolSummary = {
      name,
      calls: entry.calls,
      failures: entry.failures,
      denied: entry.denied,
      approved: entry.approved,
      risk_tags: Array.from(entry.risk_tags),
    };
    if (entry.capability !== undefined) {
      summary.capability = entry.capability;
    }
    tools.push(summary);
  }

  // ----- build CapabilitySummary[] -----
  // capability → { tools: Set<string>, policy_count: number }
  const capMap = new Map<string, { tools: Set<string>; policy_count: number }>();

  for (const ts of tools) {
    if (ts.capability !== undefined) {
      const cap = ts.capability;
      if (!capMap.has(cap)) {
        capMap.set(cap, { tools: new Set(), policy_count: 0 });
      }
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      capMap.get(cap)!.tools.add(ts.name);
    }
  }

  // Count policy_decision events per capability by matching tool name
  for (const ev of events) {
    if (ev.type === 'policy_decision' && ev.tool?.name !== undefined) {
      const toolName = ev.tool.name;
      const entry = toolMap.get(toolName);
      if (entry?.capability !== undefined) {
        const cap = entry.capability;
        const capEntry = capMap.get(cap);
        if (capEntry !== undefined) {
          capEntry.policy_count++;
        }
      }
    }
  }

  const capabilities: CapabilitySummary[] = [];
  for (const [cap, entry] of capMap) {
    capabilities.push({
      capability: cap,
      tools: Array.from(entry.tools),
      policy_count: entry.policy_count,
    });
  }

  // ----- build HighRiskAction[] -----
  const high_risk_actions: HighRiskAction[] = [];

  for (const ev of events) {
    if (ev.type !== 'tool_call') continue;
    const toolName = ev.tool?.name;
    const riskTags = ev.tool?.risk_tags ?? [];
    const isHighRisk = riskTags.some((tag) => HIGH_RISK_TAGS.has(tag));
    if (!isHighRisk || toolName === undefined) continue;

    // Check if there is a human_approval event in the same run that occurs
    // at or after this event's timestamp.
    const evTs = Date.parse(ev.timestamp);
    const runApprovals = approvalTimestampsByRun.get(ev.run_id) ?? [];
    const has_approval = !isNaN(evTs) && runApprovals.some((aTs) => aTs >= evTs);

    high_risk_actions.push({
      event_id: ev.event_id,
      tool_name: toolName,
      risk_tags: riskTags,
      has_approval,
      timestamp: ev.timestamp,
    });
  }

  // ----- build HumanApprovalRecord[] -----
  const human_approvals: HumanApprovalRecord[] = [];

  for (const ev of events) {
    if (ev.type !== 'human_approval' || ev.human === undefined) continue;
    human_approvals.push({
      event_id: ev.event_id,
      reviewer_id: ev.human.reviewer_id,
      decision: ev.human.decision,
      timestamp: ev.timestamp,
    });
  }

  return {
    tools,
    capabilities,
    high_risk_actions,
    human_approvals,
    total_events: events.length,
    tool_call_count,
    policy_decision_count,
    human_approval_count,
    error_count,
  };
}
