/**
 * aep-record adapter — maps CanonicalEvents back into an AEPRecordInput.
 *
 * This is the inverse of the aep-v0_2 adapter. It accepts a list of
 * CanonicalEvents (all sharing the same run_id) and reconstructs a best-effort
 * AEPRecordInput suitable for storage, replay, or cross-system compliance exports.
 *
 * Mapping contract (inverse of aep-v0_2):
 *   tool_call events         → actions[]
 *   policy_decision events   → capability_decisions[]
 *   observation (verifier:*) → verifier_results[] (passed: false)
 *   evidence fields          → signature block (first event)
 *   earliest timestamp       → created_at_ms
 *
 * Reconstruction is necessarily lossy: fields not preserved in the canonical
 * format (e.g. repo_commit, budget_ledger, pre/post state digests) are omitted.
 * schema_version defaults to 'aep/v0.2' since the original version is not
 * carried through CanonicalEvent.
 *
 * No Node.js APIs are used. All code is compatible with Cloudflare Workers /
 * Web Crypto runtimes.
 */

import type { CanonicalEvent } from '@openagentaudit/schema';
import type {
  AEPRecordInput,
  ActionEvidenceInput,
  CapabilityDecisionInput,
  VerifierResultInput,
} from './aep-v0_2.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse an ISO-8601 timestamp string to milliseconds since epoch. */
function isoToMs(iso: string): number {
  return new Date(iso).getTime();
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateEvents(events: CanonicalEvent[]): void {
  if (events.length === 0) {
    throw new Error('aep-record adapter: events array must not be empty');
  }
  const runId = events[0]!.run_id;
  for (const ev of events) {
    if (ev.run_id !== runId) {
      throw new Error(
        `aep-record adapter: run_id mismatch — expected "${runId}", ` +
          `got "${ev.run_id}". All events must belong to the same run.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/**
 * Convert an array of CanonicalEvents (all sharing the same run_id) into a
 * reconstructed AEPRecordInput.
 */
export function fromCanonicalEvents(events: CanonicalEvent[]): AEPRecordInput {
  validateEvents(events);

  const runId = events[0]!.run_id;
  const agentId = events[0]!.agent_id;
  const modelId = events[0]!.model_id;

  // -- Signature block from first event's evidence ------------------------
  const firstEvidence = events[0]!.evidence;
  const signature: AEPRecordInput['signature'] = {
    alg: 'ed25519',
    key_id: firstEvidence?.signer_key_id ?? '',
    sig: firstEvidence?.signature ?? '',
  };

  // -- created_at_ms: earliest event timestamp ----------------------------
  const createdAtMs = Math.min(...events.map((e) => isoToMs(e.timestamp)));

  // -- Map tool_call events → actions[] -----------------------------------
  const actions: ActionEvidenceInput[] = events
    .filter((e) => e.type === 'tool_call')
    .map((e): ActionEvidenceInput => {
      const toolName = e.tool?.name ?? e.tool_name ?? 'unknown';
      const riskTags = e.tool?.risk_tags ?? [];

      // v0.3 extension tags were packed into risk_tags by the forward adapter.
      const v3Prefixes = ['side_effect_class:', 'argument_drift:', 'approval_mode:'] as const;
      const inputTaintLabels = riskTags.filter(
        (t) => !v3Prefixes.some((p) => t.startsWith(p)),
      );

      // state_changing heuristic: absence of 'read_only' tag implies a write.
      const stateChanging = !riskTags.includes('read_only');

      const action: ActionEvidenceInput = {
        action_id: e.event_id,
        tool_name: toolName,
        state_changing: stateChanging,
        timestamp_ms: isoToMs(e.timestamp),
        input_taint_labels: inputTaintLabels,
        output_taint_labels: [],
      };

      // Reconstruct v0.3 extension fields from prefixed risk_tags.
      const sideEffectTag = riskTags.find((t) => t.startsWith('side_effect_class:'));
      if (sideEffectTag !== undefined) {
        action.side_effect_class = sideEffectTag.slice('side_effect_class:'.length);
      }
      const argDriftTag = riskTags.find((t) => t.startsWith('argument_drift:'));
      if (argDriftTag !== undefined) {
        action.argument_drift = argDriftTag.slice('argument_drift:'.length);
      }
      const approvalModeTag = riskTags.find((t) => t.startsWith('approval_mode:'));
      if (approvalModeTag !== undefined) {
        action.approval_mode = approvalModeTag.slice('approval_mode:'.length);
      }

      // Capability decision from tool.capability when available.
      if (e.tool?.capability !== undefined) {
        action.capability_decision = {
          capability: e.tool.capability,
          subject: agentId,
          resource: '',
          decision: 'allow',
        };
      }

      if (e.recording_mode !== undefined) {
        action.recording_mode = e.recording_mode;
      }

      return action;
    });

  // -- Map policy_decision events → capability_decisions[] ---------------
  const capabilityDecisions: CapabilityDecisionInput[] = events
    .filter((e) => e.type === 'policy_decision')
    .map((e): CapabilityDecisionInput => {
      const decision =
        e.policy!.decision === 'deny'
          ? ('deny' as const)
          : e.policy!.decision === 'ask_user'
            ? ('ask_user' as const)
            : ('allow' as const);
      const reasonCode = e.policy!.reason !== '' ? e.policy!.reason : undefined;
      return {
        capability: '',
        subject: agentId,
        resource: '',
        decision,
        ...(reasonCode !== undefined ? { reason_code: reasonCode } : {}),
      };
    });

  // -- Map observation (verifier:*) events → verifier_results[] ----------
  const verifierResults: VerifierResultInput[] = events
    .filter(
      (e) =>
        e.type === 'observation' &&
        typeof e.observation?.source === 'string' &&
        e.observation.source.startsWith('verifier:'),
    )
    .map((e): VerifierResultInput => ({
      verifier_id: e.observation!.source!.slice('verifier:'.length),
      passed: false,
    }));

  // -- Assemble AEPRecordInput --------------------------------------------
  const record: AEPRecordInput = {
    schema_version: 'aep/v0.2',
    run_id: runId,
    model_id: modelId,
    run_context: { agent_id: agentId },
    actions,
    created_at_ms: createdAtMs,
    signature,
  };

  if (capabilityDecisions.length > 0) {
    record.capability_decisions = capabilityDecisions;
  }
  if (verifierResults.length > 0) {
    record.verifier_results = verifierResults;
  }

  return record;
}

export const id = 'aep-record' as const;
export const version = '0.1.0' as const;
