/**
 * AEP v0.2 adapter — maps an AEPRecord into OpenAgentAudit CanonicalEvents.
 * See rfcs/0004-aep-adapter-contract.md.
 *
 * No Node.js APIs are used. All code is compatible with Cloudflare Workers /
 * Web Crypto runtimes.
 */

import type { AuditRun, CanonicalEvent } from '@openagentaudit/schema';
import type { SourceFormatAdapter } from './index.js';

// ---------------------------------------------------------------------------
// Local AEPRecord type — mirrors @wasmagent/aep without importing it.
// ---------------------------------------------------------------------------

export interface CapabilityDecisionInput {
  capability: string;
  subject: string;
  resource: string;
  decision: 'allow' | 'deny' | 'ask_user' | 'dry_run';
  reason_code?: string;
}

export interface ActionEvidenceInput {
  action_id: string;
  tool_name: string;
  state_changing: boolean;
  timestamp_ms: number;
  capability_decision?: CapabilityDecisionInput;
  input_taint_labels?: string[];
  output_taint_labels?: string[];
  pre_state_digest?: string;
  post_state_digest?: string;
  evidence_refs?: string[];
  parent_action_id?: string;
  causal_chain_id?: string;
}

export interface VerifierResultInput {
  verifier_id: string;
  passed: boolean;
  score?: number;
  claim_ids?: string[];
}

export interface InputRefInput {
  uri: string;
  digest?: string;
  taint_labels?: string[];
}

export interface OutputRefInput {
  uri: string;
  digest?: string;
  redaction_profile?: string;
}

export interface BudgetEntryInput {
  limit?: number;
  spent: number;
}

export interface BudgetLedgerInput {
  token_budget?: BudgetEntryInput;
  latency_budget?: { limit_ms?: number; actual_ms: number };
  tool_budget?: BudgetEntryInput;
  risk_budget?: BudgetEntryInput;
  retry_budget?: BudgetEntryInput;
  human_approval_budget?: BudgetEntryInput;
}

export interface RunContextInput {
  agent_id?: string;
  agent_version?: string;
  subagent_id?: string;
  delegation_chain?: string[];
  environment_digest?: string;
  dependency_lock_digest?: string;
}

/** Local mirror of the AEPRecord type from @wasmagent/aep. */
export interface AEPRecordInput {
  schema_version: 'aep/v0.1' | 'aep/v0.2';
  run_id: string;
  trace_id?: string;
  parent_trace_id?: string | null;
  repo_commit?: string;
  runtime_version?: string;
  model_provider?: string;
  model_id?: string;
  policy_bundle_digest?: string;
  tool_manifest_digest?: string;
  mcp_server_card_digest?: string | null;
  input_refs?: InputRefInput[];
  output_refs?: OutputRefInput[];
  capability_decisions?: CapabilityDecisionInput[];
  actions?: ActionEvidenceInput[];
  verifier_results?: VerifierResultInput[];
  budget_ledger?: BudgetLedgerInput;
  created_at_ms: number;
  run_context?: RunContextInput;
  signature: {
    alg: 'ed25519';
    key_id: string;
    sig: string;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SPEC_VERSION = 'open-agent-audit/v0.1' as const;

/** Base-64 encode a string using the Web Crypto / btoa API. */
function makeEventId(raw: string): string {
  // btoa is available in both browsers and Cloudflare Workers.
  return btoa(raw);
}

/** Convert a millisecond timestamp to an ISO-8601 string. */
function msToIso(ms: number): string {
  return new Date(ms).toISOString();
}

// ---------------------------------------------------------------------------
// Adapter implementation
// ---------------------------------------------------------------------------

/**
 * Convert an AEPRecordInput into an array of CanonicalEvents.
 *
 * Mapping contract:
 *   - action              → tool_call (actor: agent)
 *   - capability_decision → policy_decision (actor: system)
 *   - verifier_result (failed) → observation (actor: system)
 */
function toEvents(record: AEPRecordInput): CanonicalEvent[] {
  const events: CanonicalEvent[] = [];

  const runId = record.run_id;
  const agentId = record.run_context?.agent_id ?? runId;
  const modelId = record.model_id ?? 'unknown';
  const sigSig = record.signature.sig;
  const sigKeyId = record.signature.key_id;

  // Build up prev_hash chain. First event points back to the zero hash.
  let prevHash = '0'.repeat(64);

  let globalIndex = 0;

  function nextEvent(
    partial: Omit<CanonicalEvent, 'schema_version' | 'run_id' | 'agent_id' | 'model_id' | 'event_id' | 'evidence'>,
  ): CanonicalEvent {
    const idx = globalIndex++;
    const eventId = makeEventId(`${runId}:${partial.type}:${idx}`);

    // For the first event, use the AEP sig as the hash.
    const hash = idx === 0 ? sigSig : makeEventId(`${runId}:hash:${idx}`);

    const event: CanonicalEvent = {
      schema_version: SPEC_VERSION,
      run_id: runId,
      agent_id: agentId,
      model_id: modelId,
      event_id: eventId,
      evidence: {
        hash,
        prev_hash: prevHash,
        signature: sigSig,
        signature_algorithm: 'ed25519',
        signer_key_id: sigKeyId,
      },
      ...partial,
    };

    prevHash = hash;
    return event;
  }

  // ── Actions → tool_call events ─────────────────────────────────────────
  const actions = record.actions ?? [];
  for (const action of actions) {
    const riskTags: string[] = [
      ...(action.input_taint_labels ?? []),
      ...(action.output_taint_labels ?? []),
    ];

    const toolObj: CanonicalEvent['tool'] = {
      name: action.tool_name,
    };

    if (action.capability_decision?.capability !== undefined) {
      toolObj.capability = action.capability_decision.capability;
    }

    if (riskTags.length > 0) {
      toolObj.risk_tags = riskTags;
    }

    const event = nextEvent({
      timestamp: msToIso(action.timestamp_ms),
      type: 'tool_call',
      actor: 'agent',
      tool: toolObj,
    });

    events.push(event);
  }

  // ── Capability decisions → policy_decision events ──────────────────────
  const capabilityDecisions = record.capability_decisions ?? [];
  for (const cd of capabilityDecisions) {
    // Map AEP decision to canonical PolicyDecision
    // "dry_run" is not a canonical PolicyDecision — map it to "allow" (closest semantic).
    const policyDecision: 'allow' | 'deny' | 'ask_user' =
      cd.decision === 'deny'
        ? 'deny'
        : cd.decision === 'ask_user'
          ? 'ask_user'
          : 'allow';

    const policyObj: NonNullable<CanonicalEvent['policy']> = {
      decision: policyDecision,
      reason: cd.reason_code ?? '',
    };

    events.push(
      nextEvent({
        timestamp: msToIso(record.created_at_ms),
        type: 'policy_decision',
        actor: 'system',
        policy: policyObj,
      }),
    );
  }

  // ── Failed verifier results → observation events ───────────────────────
  const verifierResults = record.verifier_results ?? [];
  for (const vr of verifierResults) {
    if (!vr.passed) {
      events.push(
        nextEvent({
          timestamp: msToIso(record.created_at_ms),
          type: 'observation',
          actor: 'system',
          observation: {
            source: `verifier:${vr.verifier_id}`,
          },
        }),
      );
    }
  }

  return events;
}

function beginRun(record: AEPRecordInput): AuditRun {
  const agentId = record.run_context?.agent_id ?? record.run_id;
  const modelId = record.model_id ?? 'unknown';

  return {
    schema_version: SPEC_VERSION,
    run_id: record.run_id,
    agent_id: agentId,
    model_id: modelId,
    created_at: msToIso(record.created_at_ms),
    event_count: 0,
    source_adapter: 'aep-v0.2',
    input_format: 'aep/v0.2',
    task: {
      id: record.run_id,
      description: `AEP run ${record.run_id}`,
      risk_level: 'low',
    },
  };
}

export const id = 'aep-v0.2' as const;
export const version = '0.1.0' as const;

export const AepV0_2Adapter: SourceFormatAdapter<AEPRecordInput> = {
  id,
  version,
  beginRun,
  toEvents,
};
