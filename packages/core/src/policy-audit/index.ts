/** @openagentaudit/core/policy-audit — implementation. */
import type { CanonicalEvent, Finding } from '@openagentaudit/schema';
import { SPEC_VERSION } from '@openagentaudit/schema';

export interface CapabilityManifest {
  declared_capabilities: string[];  // e.g. ["filesystem.read", "network.fetch"]
  high_risk_capabilities: string[]; // capabilities requiring human approval
  denied_capabilities: string[];    // capabilities that must never be invoked
}

export interface PolicyAuditContext {
  manifest: CapabilityManifest;
  profile_id?: string;              // e.g. "owasp-agentic-top10-2026"
}

/** Deterministic finding_id as required by spec. */
function makeFindingId(rule_id: string, event_id: string): string {
  return btoa(rule_id + ':' + event_id);
}

export async function policyAudit(
  events: CanonicalEvent[],
  ctx: PolicyAuditContext,
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const { manifest } = ctx;

  const declaredSet = new Set(manifest.declared_capabilities);
  const deniedSet = new Set(manifest.denied_capabilities);
  const highRiskSet = new Set(manifest.high_risk_capabilities);

  // Precompute derived sets for multi-event rules.

  // Set of run_ids that have at least one human_approval event.
  const runsWithApproval = new Set<string>();
  for (const ev of events) {
    if (ev.type === 'human_approval') {
      runsWithApproval.add(ev.run_id);
    }
  }

  // Set of tool names that have a policy_decision="deny" at some point,
  // keyed by the index of that denial so we can detect subsequent calls.
  // We record (toolName -> Set<index>) for all deny decisions.
  const denyDecisionIndexByTool = new Map<string, number[]>();
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (
      ev !== undefined &&
      ev.type === 'policy_decision' &&
      ev.policy?.decision === 'deny' &&
      ev.tool?.name !== undefined
    ) {
      const name = ev.tool.name;
      const existing = denyDecisionIndexByTool.get(name);
      if (existing !== undefined) {
        existing.push(i);
      } else {
        denyDecisionIndexByTool.set(name, [i]);
      }
    }
  }

  // Set of tool names that have any policy_decision event (allow or deny).
  const toolsWithAnyPolicyDecision = new Set<string>();
  for (const ev of events) {
    if (ev.type === 'policy_decision' && ev.tool?.name !== undefined) {
      toolsWithAnyPolicyDecision.add(ev.tool.name);
    }
  }

  // Main event loop.
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev === undefined) continue;

    // ------------------------------------------------------------------
    // R1 — UNDECLARED_CAPABILITY
    // ------------------------------------------------------------------
    if (
      ev.type === 'tool_call' &&
      ev.tool?.capability !== undefined &&
      !declaredSet.has(ev.tool.capability)
    ) {
      const ruleId = 'OAA-R-CAP-001';
      findings.push({
        schema_version: SPEC_VERSION,
        finding_id: makeFindingId(ruleId, ev.event_id),
        rule_id: ruleId,
        severity: 'high',
        category: 'capability_boundary',
        title: 'Tool invoked with undeclared capability',
        description:
          `Event "${ev.event_id}": tool "${ev.tool.name ?? '(unknown)'}" invoked capability ` +
          `"${ev.tool.capability}" which is not listed in the capability manifest.`,
        evidence_ids: [ev.event_id],
        recommendation:
          'Add the capability to the manifest if it is intentional, or remove the tool call.',
        confidence: 'high',
      });
    }

    // ------------------------------------------------------------------
    // R2 — DENIED_CAPABILITY_INVOKED
    // ------------------------------------------------------------------
    if (
      ev.type === 'tool_call' &&
      ev.tool?.capability !== undefined &&
      deniedSet.has(ev.tool.capability)
    ) {
      const ruleId = 'OAA-R-CAP-002';
      findings.push({
        schema_version: SPEC_VERSION,
        finding_id: makeFindingId(ruleId, ev.event_id),
        rule_id: ruleId,
        severity: 'critical',
        category: 'capability_boundary',
        title: 'Denied capability was invoked',
        description:
          `Event "${ev.event_id}": tool "${ev.tool.name ?? '(unknown)'}" invoked capability ` +
          `"${ev.tool.capability}" which is explicitly denied in the capability manifest.`,
        evidence_ids: [ev.event_id],
        recommendation:
          'Immediately revoke the tool call and investigate how a denied capability was reached.',
        confidence: 'high',
      });
    }

    // ------------------------------------------------------------------
    // R3 — HIGH_RISK_NO_APPROVAL
    // ------------------------------------------------------------------
    if (
      ev.type === 'tool_call' &&
      ev.tool?.capability !== undefined &&
      highRiskSet.has(ev.tool.capability) &&
      !runsWithApproval.has(ev.run_id)
    ) {
      const ruleId = 'OAA-R-OVERSIGHT-001';
      findings.push({
        schema_version: SPEC_VERSION,
        finding_id: makeFindingId(ruleId, ev.event_id),
        rule_id: ruleId,
        severity: 'high',
        category: 'human_oversight',
        title: 'High-risk capability invoked without human approval',
        description:
          `Event "${ev.event_id}": tool "${ev.tool.name ?? '(unknown)'}" invoked high-risk ` +
          `capability "${ev.tool.capability}" but run "${ev.run_id}" has no human_approval event.`,
        evidence_ids: [ev.event_id],
        recommendation:
          'Require a human_approval event before or after any high-risk capability invocation.',
        confidence: 'high',
      });
    }

    // ------------------------------------------------------------------
    // R4 — EXPLICIT_DENY_IGNORED
    // Trigger: tool_call at index i where tool.name had a deny decision at
    // some earlier index j < i.
    // ------------------------------------------------------------------
    if (ev.type === 'tool_call' && ev.tool?.name !== undefined) {
      const denyIndices = denyDecisionIndexByTool.get(ev.tool.name);
      if (denyIndices !== undefined) {
        const hasPriorDeny = denyIndices.some((j) => j < i);
        if (hasPriorDeny) {
          const ruleId = 'OAA-R-POLICY-001';
          findings.push({
            schema_version: SPEC_VERSION,
            finding_id: makeFindingId(ruleId, ev.event_id),
            rule_id: ruleId,
            severity: 'critical',
            category: 'policy_violation',
            title: 'Tool call proceeded after explicit policy deny',
            description:
              `Event "${ev.event_id}": tool "${ev.tool.name}" was invoked despite a prior ` +
              `policy_decision="deny" for the same tool earlier in the event sequence.`,
            evidence_ids: [ev.event_id],
            recommendation:
              'Investigate why the policy enforcement did not prevent the subsequent tool call.',
            confidence: 'high',
          });
        }
      }
    }

    // ------------------------------------------------------------------
    // R5 — MISSING_POLICY_FOR_HIGH_RISK
    // ------------------------------------------------------------------
    if (ev.type === 'tool_call' && ev.tool?.name !== undefined) {
      const tags = ev.tool.risk_tags ?? [];
      const isHighRisk = tags.includes('high_risk') || tags.includes('mutation');
      if (isHighRisk && !toolsWithAnyPolicyDecision.has(ev.tool.name)) {
        const ruleId = 'OAA-R-POLICY-002';
        findings.push({
          schema_version: SPEC_VERSION,
          finding_id: makeFindingId(ruleId, ev.event_id),
          rule_id: ruleId,
          severity: 'medium',
          category: 'policy_coverage',
          title: 'High-risk tool invoked without any policy decision',
          description:
            `Event "${ev.event_id}": tool "${ev.tool.name}" carries risk tag(s) ` +
            `[${tags.join(', ')}] but no policy_decision event was found for this tool.`,
          evidence_ids: [ev.event_id],
          recommendation:
            'Add a policy_decision event for every tool that carries high_risk or mutation tags.',
          confidence: 'medium',
        });
      }
    }

    // ------------------------------------------------------------------
    // R6 — CHAIN_BREAK_DETECTED
    // Check whether this event's evidence.prev_hash matches the previous
    // event's evidence.hash. Only fires when both fields are present.
    // ------------------------------------------------------------------
    if (
      i > 0 &&
      ev.evidence?.prev_hash !== undefined
    ) {
      const prevEv = events[i - 1];
      if (prevEv !== undefined && prevEv.evidence?.hash !== undefined) {
        if (ev.evidence.prev_hash !== prevEv.evidence.hash) {
          const ruleId = 'OAA-R-INTEGRITY-001';
          findings.push({
            schema_version: SPEC_VERSION,
            finding_id: makeFindingId(ruleId, ev.event_id),
            rule_id: ruleId,
            severity: 'medium',
            category: 'evidence_integrity',
            title: 'Evidence hash chain break detected',
            description:
              `Event "${ev.event_id}": evidence.prev_hash "${ev.evidence.prev_hash}" does not ` +
              `match the preceding event "${prevEv.event_id}" evidence.hash "${prevEv.evidence.hash}".`,
            evidence_ids: [prevEv.event_id, ev.event_id],
            recommendation:
              'Investigate whether events were reordered, tampered with, or are missing from the bundle.',
            confidence: 'high',
          });
        }
      }
    }
  }

  return findings;
}
