/** @openagentaudit/core/validate — implementation. */
import type { CanonicalEvent } from '@openagentaudit/schema';
import { validateEvents } from '@openagentaudit/schema';

export interface ValidationResult {
  total: number;
  errors: Array<{ event_id: string; path: string; message: string }>;
  warnings: Array<{ event_id: string; path: string; message: string }>;
  // Summary of cryptographic verification status
  crypto_summary: {
    events_with_hash: number;
    hashes_content_verified: number;
    hashes_content_mismatch: number;
    events_with_signature: number;
    signatures_verified: number;
    signatures_failed: number;
  };
}

export type Ed25519KeyRegistry = Map<string, CryptoKey>;

const SPEC_VERSION = 'open-agent-audit/v0.1';

const VALID_EVENT_TYPES = new Set([
  'tool_call',
  'policy_decision',
  'human_approval',
  'observation',
  'model_output',
  'final_answer',
  'error',
]);

const VALID_ACTORS = new Set([
  'agent',
  'user',
  'system',
  'tool',
  'human_reviewer',
]);

function isValidRfc3339(ts: string): boolean {
  if (!ts) return false;
  const ms = Date.parse(ts);
  return !isNaN(ms);
}

async function computeEventHash(event: CanonicalEvent): Promise<string> {
  // Canonical JSON: sorted keys, strip evidence field itself (hash/prev_hash/signature)
  const forHashing: Record<string, unknown> = {};
  const keys: Array<keyof CanonicalEvent> = [
    'schema_version', 'run_id', 'event_id', 'timestamp', 'type', 'actor',
    'agent_id', 'model_id', 'session_id', 'tool', 'policy', 'human',
    'error', 'model_output', 'observation',
  ];
  for (const k of keys) {
    if (event[k] !== undefined) forHashing[k] = event[k];
  }
  const canonical = JSON.stringify(forHashing, Object.keys(forHashing).sort());
  const encoded = new TextEncoder().encode(canonical);
  const hashBuf = await crypto.subtle.digest('SHA-256', encoded);
  const hex = Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return hex;
}

async function verifyEd25519Signature(
  event: CanonicalEvent,
  keyRegistry: Ed25519KeyRegistry,
): Promise<'verified' | 'failed' | 'no_key' | 'skipped'> {
  const sig = event.evidence?.signature;
  const alg = event.evidence?.signature_algorithm;
  const keyId = event.evidence?.signer_key_id;

  if (!sig || alg !== 'ed25519') return 'skipped';
  if (!keyId) return 'no_key';

  const key = keyRegistry.get(keyId);
  if (!key) return 'no_key';

  try {
    // signature is hex or base64 — try hex first, then base64
    let sigBytes: Uint8Array<ArrayBuffer>;
    if (/^[0-9a-fA-F]{128}$/.test(sig)) {
      // 64-byte Ed25519 signature as 128 hex chars
      const buf = new ArrayBuffer(64);
      sigBytes = new Uint8Array(buf);
      const pairs = sig.match(/.{2}/g)!;
      for (let i = 0; i < pairs.length; i++) sigBytes[i] = parseInt(pairs[i]!, 16);
    } else {
      // assume base64
      const binary = atob(sig);
      const buf = new ArrayBuffer(binary.length);
      sigBytes = new Uint8Array(buf);
      for (let i = 0; i < binary.length; i++) sigBytes[i] = binary.charCodeAt(i);
    }

    // The signed message is the same canonical JSON used for hash computation
    const forSigning: Record<string, unknown> = {};
    const signingKeys: Array<keyof CanonicalEvent> = [
      'schema_version', 'run_id', 'event_id', 'timestamp', 'type', 'actor',
      'agent_id', 'model_id', 'session_id', 'tool', 'policy', 'human',
      'error', 'model_output', 'observation',
    ];
    for (const k of signingKeys) {
      if (event[k] !== undefined) forSigning[k] = event[k];
    }
    const canonical = JSON.stringify(forSigning, Object.keys(forSigning).sort());
    const message = new TextEncoder().encode(canonical);

    const valid = await crypto.subtle.verify('Ed25519', key, sigBytes, message);
    return valid ? 'verified' : 'failed';
  } catch {
    return 'failed';
  }
}

export async function validate(
  events: CanonicalEvent[],
  keyRegistry?: Ed25519KeyRegistry,
): Promise<ValidationResult> {
  const errors: Array<{ event_id: string; path: string; message: string }> = [];
  const warnings: Array<{ event_id: string; path: string; message: string }> = [];

  // 1. Schema validation via Zod (validateEvents from @openagentaudit/schema)
  const schemaResult = validateEvents(events as unknown[]);
  for (const schemaError of schemaResult.errors) {
    const event = events[schemaError.index];
    const event_id = event?.event_id ?? `index:${schemaError.index}`;
    errors.push({
      event_id,
      path: 'schema',
      message: schemaError.message,
    });
  }

  // 2. Required-field checks + cross-event checks
  const seenEventIds = new Map<string, number>();
  const runIds = new Set<string>();
  let firstRunId: string | undefined;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const event_id = event?.event_id ?? `index:${i}`;

    if (!event) continue;

    // schema_version
    if (event.schema_version !== SPEC_VERSION) {
      errors.push({
        event_id,
        path: 'schema_version',
        message: `schema_version must be '${SPEC_VERSION}', got '${String(event.schema_version)}'`,
      });
    }

    // run_id non-empty
    if (typeof event.run_id !== 'string' || event.run_id.length === 0) {
      errors.push({
        event_id,
        path: 'run_id',
        message: 'run_id must be a non-empty string',
      });
    } else {
      runIds.add(event.run_id);
      if (firstRunId === undefined) {
        firstRunId = event.run_id;
      }
    }

    // event_id non-empty
    if (typeof event.event_id !== 'string' || event.event_id.length === 0) {
      errors.push({
        event_id,
        path: 'event_id',
        message: 'event_id must be a non-empty string',
      });
    }

    // timestamp valid RFC 3339
    if (!isValidRfc3339(event.timestamp)) {
      errors.push({
        event_id,
        path: 'timestamp',
        message: `timestamp '${event.timestamp}' is not a valid RFC 3339 date string`,
      });
    }

    // type must be a valid EventType
    if (!VALID_EVENT_TYPES.has(event.type)) {
      errors.push({
        event_id,
        path: 'type',
        message: `type '${String(event.type)}' is not a valid EventType`,
      });
    }

    // actor must be a valid Actor
    if (!VALID_ACTORS.has(event.actor)) {
      errors.push({
        event_id,
        path: 'actor',
        message: `actor '${String(event.actor)}' is not a valid Actor`,
      });
    }

    // forged signature detection: signature_algorithm present but signature missing or empty
    if (
      event.evidence?.signature_algorithm !== undefined &&
      (event.evidence.signature === undefined || event.evidence.signature === '')
    ) {
      errors.push({
        event_id,
        path: 'evidence.signature',
        message: `signature_algorithm '${event.evidence.signature_algorithm}' is set but signature is missing or empty`,
      });
    }

    // type-specific field presence checks
    if (event.type === 'tool_call') {
      if (!event.tool) {
        errors.push({
          event_id,
          path: 'tool',
          message: 'tool field must be present when type is tool_call',
        });
      } else if (typeof event.tool.name !== 'string' || event.tool.name.length === 0) {
        errors.push({
          event_id,
          path: 'tool.name',
          message: 'tool.name must be a non-empty string when type is tool_call',
        });
      }
    }

    if (event.type === 'policy_decision' && !event.policy) {
      errors.push({
        event_id,
        path: 'policy',
        message: 'policy field must be present when type is policy_decision',
      });
    }

    if (event.type === 'human_approval' && !event.human) {
      errors.push({
        event_id,
        path: 'human',
        message: 'human field must be present when type is human_approval',
      });
    }

    if (event.type === 'error' && !event.error) {
      errors.push({
        event_id,
        path: 'error',
        message: 'error field must be present when type is error',
      });
    }

    // 4. Duplicate event_id detection
    if (typeof event.event_id === 'string' && event.event_id.length > 0) {
      const prev = seenEventIds.get(event.event_id);
      if (prev !== undefined) {
        errors.push({
          event_id,
          path: 'event_id',
          message: `Duplicate event_id '${event.event_id}' (first seen at index ${prev})`,
        });
      } else {
        seenEventIds.set(event.event_id, i);
      }
    }
  }

  // 5. Cross-run consistency — all events must share the same run_id
  if (runIds.size > 1) {
    const ids = Array.from(runIds).join(', ');
    // Report an error on every event whose run_id differs from the first
    for (const event of events) {
      if (!event) continue;
      if (event.run_id !== firstRunId) {
        errors.push({
          event_id: event.event_id ?? '',
          path: 'run_id',
          message: `run_id '${event.run_id}' does not match the first run_id '${firstRunId ?? ''}' in this batch (found: ${ids})`,
        });
      }
    }
  }

  // 3. Hash chain validation
  // Collect only events that have evidence.hash present, in order
  const chainEvents = events.filter(
    (e): e is CanonicalEvent & { evidence: { hash: string } } =>
      typeof e?.evidence?.hash === 'string' && e.evidence.hash.length > 0,
  );

  for (let i = 0; i < chainEvents.length; i++) {
    const e = chainEvents[i];
    if (!e) continue;
    const ev_id = e.event_id ?? `index:${i}`;
    const prevHash = e.evidence?.prev_hash;

    if (i === 0) {
      // First chained event: prev_hash must be all zeros (64 chars)
      const expectedGenesis = '0'.repeat(64);
      if (prevHash !== undefined && prevHash !== expectedGenesis) {
        warnings.push({
          event_id: ev_id,
          path: 'evidence.prev_hash',
          message: `First event in hash chain has prev_hash '${prevHash}' but expected all-zero genesis hash ('${'0'.repeat(64)}')`,
        });
      }
    } else {
      const prevEvent = chainEvents[i - 1];
      if (prevEvent) {
        const expectedPrevHash = prevEvent.evidence?.hash;
        if (
          prevHash !== undefined &&
          expectedPrevHash !== undefined &&
          prevHash !== expectedPrevHash
        ) {
          warnings.push({
            event_id: ev_id,
            path: 'evidence.prev_hash',
            message: `Hash chain broken: event '${ev_id}' has prev_hash '${prevHash}' but previous event '${prevEvent.event_id ?? ''}' has hash '${expectedPrevHash}'`,
          });
        } else if (prevHash === undefined && expectedPrevHash !== undefined) {
          warnings.push({
            event_id: ev_id,
            path: 'evidence.prev_hash',
            message: `Hash chain gap: event '${ev_id}' is missing prev_hash (expected '${expectedPrevHash}')`,
          });
        }
      }
    }
  }

  // Hash content verification: recompute SHA-256 over event content, compare to evidence.hash
  let contentMismatchCount = 0;
  for (const e of chainEvents) {
    if (!e.evidence?.hash) continue;
    const recomputed = await computeEventHash(e);
    if (recomputed !== e.evidence.hash) {
      contentMismatchCount++;
      warnings.push({
        event_id: e.event_id ?? '',
        path: 'evidence.hash',
        message: `Hash content mismatch: stored hash '${e.evidence.hash.slice(0, 16)}…' does not match recomputed SHA-256 '${recomputed.slice(0, 16)}…'. Event content may have been tampered.`,
      });
    }
  }

  const events_with_hash = chainEvents.length;
  const hashes_content_mismatch = contentMismatchCount;
  const hashes_content_verified = events_with_hash - hashes_content_mismatch;
  const events_with_signature = events.filter(e => e.evidence?.signature !== undefined).length;

  // Ed25519 signature verification (only when keyRegistry is provided)
  let signatures_verified = 0;
  let signatures_failed = 0;

  if (keyRegistry !== undefined) {
    for (const e of events) {
      if (e.evidence?.signature === undefined) continue;
      const result = await verifyEd25519Signature(e, keyRegistry);
      if (result === 'verified') {
        signatures_verified++;
      } else if (result === 'failed') {
        signatures_failed++;
        errors.push({
          event_id: e.event_id ?? '',
          path: 'evidence.signature',
          message: `Ed25519 signature verification FAILED for event '${e.event_id}' (key_id: '${e.evidence.signer_key_id ?? 'none'}').`,
        });
      } else if (result === 'no_key') {
        warnings.push({
          event_id: e.event_id ?? '',
          path: 'evidence.signer_key_id',
          message: `No key found in registry for signer_key_id '${e.evidence.signer_key_id ?? 'none'}' — signature not verified.`,
        });
      }
    }
  }

  return {
    total: events.length,
    errors,
    warnings,
    crypto_summary: {
      events_with_hash,
      hashes_content_verified,
      hashes_content_mismatch,
      events_with_signature,
      signatures_verified,
      signatures_failed,
    },
  };
}
