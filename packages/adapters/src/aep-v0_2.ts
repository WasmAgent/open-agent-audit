/**
 * AEP v0.2 adapter — maps an AEPRecord into OpenAgentAudit CanonicalEvents.
 * See rfcs/0004-aep-adapter-contract.md.
 *
 * No Node.js APIs are used. All code is compatible with Cloudflare Workers /
 * Web Crypto runtimes.
 */

import type { AuditRun, CanonicalEvent } from '@openagentaudit/schema';
import type { SourceFormatAdapter } from './index.js';
import { base64Utf8, msToIso } from './mapping-utils.js';

// ---------------------------------------------------------------------------
// Local AEPRecord projection.
//
// This is a deliberately narrow, read-only projection of the canonical
// @wasmagent/protocol `aep-record` schema (pinned 0.1.10), NOT an independent
// contract. It provides ergonomic TS types for the adapter's inputs; the
// authoritative shape always comes from `getSchema('aep-record')`. The mirror
// is enforced by the canonical drift gate in `canonical-drift.test.ts`, which
// fails if this projection declares any field the canonical schema does not
// define or advertises a schema_version the canonical enum does not list.
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
  // v0.3 optional fields
  side_effect_class?: string;
  argument_drift?: string;
  approval_mode?: string;
  // v0.4 optional fields
  recording_mode?: 'validation' | 'delta' | 'full';
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

/** Supported AEP schema versions. v0.3 is a strict superset of v0.2, v0.4 adds DSSE and recording_mode, v0.5 adds attribution grading (additive only). */
export const SUPPORTED_AEP_VERSIONS = ['aep/v0.1', 'aep/v0.2', 'aep/v0.3', 'aep/v0.4', 'aep/v0.5'] as const;
export type SupportedAepVersion = (typeof SUPPORTED_AEP_VERSIONS)[number];

/** Guarded projection of the canonical aep-record schema (wasmagent-protocol
 *  0.1.10). Not an independent contract — see the drift gate note above. */
export interface AEPRecordInput {
  schema_version: SupportedAepVersion;
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
  /** v0.4: DSSE/in-toto attestation envelope wrapping the record signature. */
  dsse_envelope?: {
    payloadType: string;
    payload: string;
    signatures: Array<{
      keyid: string;
      sig: string;
    }>;
  };
  /** v0.5: attribution-grading fields (canonical aep/v0.5, additive). Accepted
   *  and type-mirrored; mapping into AuditRun awaits downstream schema slots
   *  (same status as user_id today). */
  authorized_by?: string;
  authority_origin?:
    | 'subject_consented'
    | 'administrator_assigned'
    | 'organization_wide'
    | 'unknown';
  identity_source?:
    | 'self_asserted'
    | 'organization_attested'
    | 'notified_eid'
    | 'qualified_certificate'
    | 'unknown';
  attribution_backing?:
    | 'operator_asserted'
    | 'principal_key_signed'
    | 'qualified_signature'
    | 'unknown';
  run_attribution_backing_floor?:
    | 'operator_asserted'
    | 'principal_key_signed'
    | 'qualified_signature'
    | 'unknown';
  run_attribution_backing_observed?: Array<
    'operator_asserted' | 'principal_key_signed' | 'qualified_signature' | 'unknown'
  >;
  /** v0.5: selective-omission defense (canonical wasmagent-protocol 0.1.10). */
  authorization_evidence_count?: number;
  /** v0.3 mirror completion: run-level identity fields the canonical schema
   *  has carried since aep/v0.3. Accepted; unmapped downstream (see v0.5
   *  note above). */
  user_id?: string;
  subject_id?: string;
}

/**
 * OAA-3: runtime inventory of the local projection's fields, pinned to the
 * interface by `satisfies` so it cannot silently fall out of sync. The
 * canonical drift gate (canonical-drift.test.ts) asserts this set is a subset
 * of the canonical `aep-record` schema properties, so the mirror can never
 * invent — or retain after upstream removal — a field the canonical contract
 * does not define.
 */
export const AEP_RECORD_INPUT_KEYS = {
  schema_version: true,
  run_id: true,
  trace_id: true,
  parent_trace_id: true,
  repo_commit: true,
  runtime_version: true,
  model_provider: true,
  model_id: true,
  policy_bundle_digest: true,
  tool_manifest_digest: true,
  mcp_server_card_digest: true,
  input_refs: true,
  output_refs: true,
  capability_decisions: true,
  actions: true,
  verifier_results: true,
  budget_ledger: true,
  created_at_ms: true,
  run_context: true,
  signature: true,
  dsse_envelope: true,
  authorized_by: true,
  authority_origin: true,
  identity_source: true,
  attribution_backing: true,
  run_attribution_backing_floor: true,
  run_attribution_backing_observed: true,
  authorization_evidence_count: true,
  user_id: true,
  subject_id: true,
} as const satisfies Record<keyof AEPRecordInput, true>;

// ---------------------------------------------------------------------------
// Upstream provenance
// ---------------------------------------------------------------------------

/**
 * Upstream provenance fields extracted from an AEPRecordInput.
 * Consumers (CLI, Worker) can attach these to ReportMeta to preserve
 * the full audit trail back to the originating AEP run.
 */
export interface AepProvenance {
  repo_commit?: string;
  runtime_version?: string;
  policy_bundle_digest?: string;
  tool_manifest_digest?: string;
  mcp_server_card_digest?: string;
  parent_trace_id?: string;
  delegation_chain?: string[];
  model_provider?: string;
}

/**
 * Extract aep/v0.5 attribution-grading fields from an AEPRecordInput.
 * Returns undefined when the record carries none of them, so callers can
 * distinguish "absent" (producer makes no claim) from field values.
 */
export function getAttribution(record: AEPRecordInput): AuditRun['attribution'] {
  const a: NonNullable<AuditRun['attribution']> = {};
  if (record.user_id !== undefined) a.user_id = record.user_id;
  if (record.authorized_by !== undefined) a.authorized_by = record.authorized_by;
  if (record.authority_origin !== undefined) a.authority_origin = record.authority_origin;
  if (record.identity_source !== undefined) a.identity_source = record.identity_source;
  if (record.attribution_backing !== undefined) a.attribution_backing = record.attribution_backing;
  if (record.run_attribution_backing_floor !== undefined) {
    a.run_attribution_backing_floor = record.run_attribution_backing_floor;
  }
  if (record.run_attribution_backing_observed !== undefined) {
    a.run_attribution_backing_observed = record.run_attribution_backing_observed;
  }
  if (record.authorization_evidence_count !== undefined) {
    a.authorization_evidence_count = record.authorization_evidence_count;
  }
  return Object.keys(a).length > 0 ? a : undefined;
}

/**
 * Extract upstream provenance fields from an AEPRecordInput.
 * Only defined (non-null) fields are included in the returned object.
 */
export function getProvenance(record: AEPRecordInput): AepProvenance {
  const prov: AepProvenance = {};

  if (record.repo_commit !== undefined) {
    prov.repo_commit = record.repo_commit;
  }
  if (record.runtime_version !== undefined) {
    prov.runtime_version = record.runtime_version;
  }
  if (record.policy_bundle_digest !== undefined) {
    prov.policy_bundle_digest = record.policy_bundle_digest;
  }
  if (record.tool_manifest_digest !== undefined) {
    prov.tool_manifest_digest = record.tool_manifest_digest;
  }
  // mcp_server_card_digest is string | null | undefined — only carry it through when it is a non-null string
  if (record.mcp_server_card_digest !== undefined && record.mcp_server_card_digest !== null) {
    prov.mcp_server_card_digest = record.mcp_server_card_digest;
  }
  // parent_trace_id is string | null | undefined — same treatment
  if (record.parent_trace_id !== undefined && record.parent_trace_id !== null) {
    prov.parent_trace_id = record.parent_trace_id;
  }
  if (record.run_context?.delegation_chain !== undefined) {
    prov.delegation_chain = record.run_context.delegation_chain;
  }
  if (record.model_provider !== undefined) {
    prov.model_provider = record.model_provider;
  }

  return prov;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SPEC_VERSION = 'open-agent-audit/v0.1' as const;

/** Base-64 encode a string using the Web Crypto / btoa API. UTF-8 safe for
 * non-ASCII run ids. */
function makeEventId(raw: string): string {
  return base64Utf8(raw);
}

// ---------------------------------------------------------------------------
// Adapter implementation
// ---------------------------------------------------------------------------

/**
 * Validate required AEP fields and throw an actionable error if any are missing.
 * Called by both toEvents() and beginRun() so callers get the error at parse time.
 */
function validateRecord(record: AEPRecordInput): void {
  const missing: string[] = [];
  if (!record.run_id) missing.push('run_id');
  if (!record.schema_version) missing.push('schema_version');
  if (typeof record.created_at_ms !== 'number') missing.push('created_at_ms');
  if (!record.signature?.alg) missing.push('signature.alg');
  if (!record.signature?.key_id) missing.push('signature.key_id');
  if (!record.signature?.sig) missing.push('signature.sig');
  // Hostile-key rejection: a literal "__proto__" own key on a JSON.parse'd
  // record is inert here, but carrying it downstream hands every JS
  // consumer a prototype-pollution primitive.
  for (const key of Object.keys(record)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      throw new Error(`AEP adapter: record contains forbidden key "${key}"`);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `AEP adapter: missing required fields [${missing.join(', ')}]. ` +
        'Ensure the AEPRecord was produced by a compliant emitter (aep/v0.2).',
    );
  }
  if (!(SUPPORTED_AEP_VERSIONS as readonly string[]).includes(record.schema_version)) {
    throw new Error(
      `AEP adapter: unsupported schema_version "${record.schema_version}". ` +
        `Expected one of: ${SUPPORTED_AEP_VERSIONS.join(', ')}.`,
    );
  }
}

/**
 * Convert an AEPRecordInput into an array of CanonicalEvents.
 *
 * Mapping contract:
 *   - action              → tool_call (actor: agent)
 *   - capability_decision → policy_decision (actor: system)
 *   - verifier_result (failed) → observation (actor: system)
 */
function toEvents(record: AEPRecordInput, opts?: { prevHash?: string }): CanonicalEvent[] {
  validateRecord(record);
  const events: CanonicalEvent[] = [];

  const runId = record.run_id;
  const agentId = record.run_context?.agent_id ?? runId;
  const modelId = record.model_id ?? 'unknown';

  // v0.4: When a DSSE envelope is present, extract the signature from the envelope
  // rather than from record.signature.sig directly.
  const hasDsse = record.dsse_envelope !== undefined && record.dsse_envelope.signatures.length > 0;
  const sigSig = hasDsse
    ? record.dsse_envelope!.signatures[0]!.sig
    : record.signature.sig;
  const sigKeyId = hasDsse
    ? record.dsse_envelope!.signatures[0]!.keyid
    : record.signature.key_id;

  // Build up prev_hash chain. Continues from opts.prevHash when provided.
  let prevHash = opts?.prevHash ?? '0'.repeat(64);

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
        evidence_id: eventId,
        hash,
        prev_hash: prevHash,
        signature: sigSig,
        signature_algorithm: 'ed25519',
        signer_key_id: sigKeyId,
        // OAA-5: an envelope's mere presence is NOT cryptographic verification.
        // attestation_format records the shape; dsse_pre_verified stays unset
        // until a real DSSE verification pass has run (never assert it here).
        ...(hasDsse ? { attestation_format: 'dsse' as const } : {}),
      },
      ...partial,
    };

    prevHash = hash;
    return event;
  }

  // -- Actions -> tool_call events -----------------------------------------
  const actions = record.actions ?? [];
  // Capability → action timestamps, so capability_decisions below can anchor
  // to a matching action without an O(actions) scan per decision.
  const actionTimestampsByCapability = new Map<string, number[]>();
  for (const action of actions) {
    const riskTags: string[] = [
      ...(action.input_taint_labels ?? []),
      ...(action.output_taint_labels ?? []),
    ];

    // v0.3 fields: preserve side_effect_class, argument_drift, approval_mode
    // in risk_tags so downstream rules can inspect them.
    if (action.side_effect_class) {
      riskTags.push(`side_effect_class:${action.side_effect_class}`);
    } else if (!action.state_changing) {
      // Read-only actions carry no state-change marker otherwise; encode one
      // so the inverse adapter (aep-record.ts) can reconstruct
      // state_changing=false instead of defaulting to write.
      riskTags.push('side_effect_class:read');
    }
    if (action.argument_drift) {
      riskTags.push(`argument_drift:${action.argument_drift}`);
    }
    if (action.approval_mode) {
      riskTags.push(`approval_mode:${action.approval_mode}`);
    }

    if (action.capability_decision?.capability !== undefined) {
      const cap = action.capability_decision.capability;
      const timestamps = actionTimestampsByCapability.get(cap);
      if (timestamps !== undefined) {
        timestamps.push(action.timestamp_ms);
      } else {
        actionTimestampsByCapability.set(cap, [action.timestamp_ms]);
      }
    }

    const toolObj: CanonicalEvent['tool'] = {
      name: action.tool_name,
    };

    if (action.capability_decision?.capability !== undefined) {
      toolObj.capability = action.capability_decision.capability;
    }

    if (riskTags.length > 0) {
      toolObj.risk_tags = riskTags;
    }

    // Issue #15: If the action has a capability_decision with decision
    // 'allow' or 'dry_run' (platform-approved), set human_approval=true
    // so that OAA-R-OVERSIGHT-001 does not fire false positives.
    const hasApprovalSignal =
      action.capability_decision !== undefined &&
      (action.capability_decision.decision === 'allow' ||
        action.capability_decision.decision === 'dry_run');

    const event = nextEvent({
      timestamp: msToIso(action.timestamp_ms),
      type: 'tool_call',
      actor: 'agent',
      tool_name: action.tool_name,
      tool: toolObj,
      ...(hasApprovalSignal ? { human_approval: true } : {}),
      ...(action.recording_mode ? { recording_mode: action.recording_mode } : {}),
    });

    events.push(event);
  }

  // -- Capability decisions -> policy_decision events ----------------------
  const capabilityDecisions = record.capability_decisions ?? [];
  // Occurrence counter per capability: multiple decisions sharing one
  // capability anchor to successive matching actions and get distinct
  // +1/+2/… offsets so timestamp sorts stay deterministic.
  const decisionOccurrence = new Map<string, number>();
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

    // Use the matching action's timestamp so policy_decision sorts correctly
    // relative to its tool_call event (avoids hash chain breakage after sort).
    const matching = actionTimestampsByCapability.get(cd.capability);
    let ts = record.created_at_ms;
    if (matching !== undefined && matching.length > 0) {
      const occurrence = decisionOccurrence.get(cd.capability) ?? 0;
      const anchor = matching[Math.min(occurrence, matching.length - 1)]!;
      decisionOccurrence.set(cd.capability, occurrence + 1);
      ts = anchor + occurrence + 1;
    }

    events.push(
      nextEvent({
        timestamp: msToIso(ts),
        type: 'policy_decision',
        actor: 'system',
        policy: policyObj,
      }),
    );
  }

  // -- Failed verifier results -> observation events -----------------------
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
  validateRecord(record);
  const agentId = record.run_context?.agent_id ?? record.run_id;
  const modelId = record.model_id ?? 'unknown';
  const attribution = getAttribution(record);

  return {
    schema_version: SPEC_VERSION,
    run_id: record.run_id,
    agent_id: agentId,
    model_id: modelId,
    created_at: msToIso(record.created_at_ms),
    event_count: 0,
    source_adapter: 'aep-adapter',
    input_format: record.schema_version,
    task: {
      id: record.run_id,
      description: `AEP run ${record.run_id}`,
      risk_level: 'low',
    },
    ...(attribution !== undefined && { attribution }),
  };
}

/**
 * Convert multiple AEP records into a single continuous event chain.
 * Maintains prev_hash continuity across record boundaries.
 */
export function toEventsBatch(
  records: AEPRecordInput[],
  initialPrevHash = '0'.repeat(64),
): CanonicalEvent[] {
  const all: CanonicalEvent[] = [];
  let prevHash = initialPrevHash;
  for (const record of records) {
    const events = toEvents(record, { prevHash });
    all.push(...events);
    prevHash = all[all.length - 1]?.evidence?.hash ?? prevHash;
  }
  return all;
}

export const id = 'aep-v0.2' as const;
export const version = '0.1.0' as const;

export const AepV0_2Adapter: SourceFormatAdapter<AEPRecordInput> = {
  id,
  version,
  beginRun,
  toEvents,
  toEventsBatch,
};
