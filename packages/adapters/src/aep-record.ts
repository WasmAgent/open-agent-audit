/**
 * aep-record adapter — maps CanonicalEvents back into a RECONSTRUCTED PROJECTION
 * of an AEPRecordInput, explicitly labeled as a legacy aep/v0.2 compatibility
 * projection (OAA-4).
 *
 * This is NOT the original AEP record, and is NOT a validly-signed record.
 * Reconstruction is lossy and bytewise divergent from the original: signature
 * verification of the output WILL fail even when the signature bytes carried
 * over are authentic. The output must never be presented as an authenticated
 * aep/v0.5 record.
 *
 * The only sanctioned path to a current (aep/v0.5) record is:
 *   1. use this projection to obtain the canonical unsigned content,
 *   2. pass current semantic validation, and
 *   3. re-sign through the real current DSSE path in @wasmagent/aep.
 * No silent generic v0.2 downgrade is offered by this package.
 *
 * Mapping contract (inverse of aep-v0_2):
 *   tool_call events         → actions[]
 *   policy_decision events   → capability_decisions[]
 *   observation (verifier:*) → verifier_results[] (passed: false)
 *   evidence fields          → signature block (first event; evidence bytes only)
 *   earliest timestamp       → created_at_ms
 *
 * Reconstruction is necessarily lossy: fields not preserved in the canonical
 * format (e.g. repo_commit, budget_ledger, pre/post state digests) are omitted.
 * schema_version is explicitly 'aep/v0.2' because the original version is not
 * carried through CanonicalEvent; the output is a legacy compatibility
 * projection only.
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

function validateEvents(events: CanonicalEvent[]): CanonicalEvent {
  // Returns the first event (validated non-empty) so callers never need a
  // non-null assertion on indexed access.
  const first = events.at(0);
  if (first === undefined) {
    throw new Error('aep-record adapter: events array must not be empty');
  }
  const runId = first.run_id;
  for (const ev of events) {
    if (ev.run_id !== runId) {
      throw new Error(
        `aep-record adapter: run_id mismatch — expected "${runId}", ` +
          `got "${ev.run_id}". All events must belong to the same run.`,
      );
    }
    if (Number.isNaN(new Date(ev.timestamp).getTime())) {
      throw new Error(
        `aep-record adapter: event "${ev.event_id}" has an unparseable ` +
          `timestamp "${ev.timestamp}" (expected ISO 8601).`,
      );
    }
  }
  return first;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/**
 * Explicit serialization target for the lossy inverse adapter. Only the legacy
 * aep/v0.2 projection is supported; the caller must name it — there is no
 * default, so a v0.2 downgrade can never happen silently.
 */
export type LegacyAepTargetVersion = 'aep/v0.2';

/**
 * Convert an array of CanonicalEvents (all sharing the same run_id) into a
 * reconstructed aep/v0.2 projection. The output is a legacy reconstruction,
 * not a validly-signed record — see the module doc for the compliance boundary.
 *
 * `targetVersion` is required (OAA-4): serialization must be an explicit,
 * auditable choice, and only the legacy `aep/v0.2` target is offered here.
 * Current (aep/v0.5) output requires re-signing through the real DSSE path.
 */
export function fromCanonicalEventsLegacyV02(
  targetVersion: LegacyAepTargetVersion,
  events: CanonicalEvent[],
): AEPRecordInput {
  if (targetVersion !== 'aep/v0.2') {
    throw new Error(
      `aep-record adapter: unsupported target version "${targetVersion}". ` +
        'Only the legacy aep/v0.2 projection is produced here; current AEP ' +
        'output must be reconstructed and re-signed through the DSSE path.',
    );
  }
  const firstEvent = validateEvents(events);

  const runId = firstEvent.run_id;
  const agentId = firstEvent.agent_id;
  const modelId = firstEvent.model_id;

  // -- Signature block from first event's evidence ------------------------
  const firstEvidence = firstEvent.evidence;
  const signature: AEPRecordInput['signature'] = {
    alg: 'ed25519',
    key_id: firstEvidence?.signer_key_id ?? '',
    sig: firstEvidence?.signature ?? '',
  };

  // -- created_at_ms: earliest event timestamp (loop: no spread — large
  // event arrays would hit the engine's argument limit) -------------------
  let createdAtMs = Number.POSITIVE_INFINITY;
  for (const e of events) {
    const ms = isoToMs(e.timestamp);
    if (ms < createdAtMs) createdAtMs = ms;
  }

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

      // state_changing heuristic: an explicit read-only marker implies a read.
      // The forward adapter stamps 'side_effect_class:read' onto read-only
      // actions (and never emits 'read_only' itself), so an original
      // state_changing=false survives the round trip instead of flipping to
      // a write.
      const stateChanging =
        !riskTags.includes('read_only') && !riskTags.includes('side_effect_class:read');

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
    .flatMap((e): CapabilityDecisionInput[] => {
      const policy = e.policy;
      if (e.type !== 'policy_decision' || policy === undefined) return [];
      const decision =
        policy.decision === 'deny'
          ? ('deny' as const)
          : policy.decision === 'ask_user'
            ? ('ask_user' as const)
            : ('allow' as const);
      const reasonCode = policy.reason !== '' ? policy.reason : undefined;
      return [
        {
          capability: '',
          subject: agentId,
          resource: '',
          decision,
          ...(reasonCode !== undefined ? { reason_code: reasonCode } : {}),
        },
      ];
    });

  // -- Map observation (verifier:*) events → verifier_results[] ----------
  const verifierResults: VerifierResultInput[] = events.flatMap(
    (e): VerifierResultInput[] => {
      if (e.type !== 'observation' || e.observation === undefined) return [];
      const source = e.observation.source;
      if (typeof source !== 'string' || !source.startsWith('verifier:')) return [];
      return [{ verifier_id: source.slice('verifier:'.length), passed: false }];
    },
  );

  // -- Assemble AEPRecordInput --------------------------------------------
  const record: AEPRecordInput = {
    schema_version: targetVersion,
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

/**
 * NOTE (OAA-4): there is intentionally no generic `fromCanonicalEvents`
 * alias. A generic name silently produced an aep/v0.2 downgrade; callers must
 * invoke `fromCanonicalEventsLegacyV02('aep/v0.2', events)` so the legacy
 * projection is explicit at every call site.
 */

export const id = 'aep-record' as const;
export const version = '0.1.0' as const;
