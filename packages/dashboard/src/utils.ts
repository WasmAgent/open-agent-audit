// Shared utility functions used by both App.tsx and page components

export interface RawEvent {
  schema_version?: string
  run_id?: string
  event_id?: string
  agent_id?: string
  model_id?: string
  timestamp?: string
  type?: string
  actor?: string
  tool_name?: string
  tool?: { name?: string; capability?: string; risk_tags?: string[] }
  policy?: { decision?: string; reason?: string; rule_id?: string }
  error?: { kind?: string; message?: string }
  human?: { reviewer_id?: string; decision?: string; justification?: string }
  observation?: { source?: string; byte_size?: number; content_hash?: string }
  model_output?: { token_count?: number; finish_reason?: string; content_hash?: string }
  evidence?: {
    evidence_id?: string
    hash?: string
    prev_hash?: string
    signature?: string
    signature_algorithm?: 'ed25519' | 'ecdsa-p256'
    signer_key_id?: string
    attestation_format?: 'legacy' | 'dsse'
    dsse_pre_verified?: boolean
  }
  recording_mode?: 'validation' | 'delta' | 'full'
  human_approval?: boolean
}

export interface AepMeta {
  run_id?: string
  model_id?: string
  model_provider?: string
  actions?: number
  schema_version?: string
  /** v0.5 attribution-grading fields (canonical wasmagent-protocol 0.1.9). */
  authorized_by?: string
  authority_origin?: string
  identity_source?: string
  attribution_backing?: string
  run_attribution_backing_floor?: string
}

export function parseJsonl(text: string): RawEvent[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      try {
        return JSON.parse(line) as RawEvent
      } catch {
        return null
      }
    })
    .filter((e): e is RawEvent => e !== null)
}

export function isAepJson(text: string): boolean {
  try {
    const obj = JSON.parse(text) as Record<string, unknown>
    return (
      obj !== null &&
      typeof obj === 'object' &&
      !Array.isArray(obj) &&
      typeof obj['schema_version'] === 'string' &&
      (obj['schema_version'] as string).startsWith('aep/')
    )
  } catch {
    return false
  }
}

export function buildAepMeta(aep: Record<string, unknown>): AepMeta {
  const m: AepMeta = {}
  if (typeof aep['run_id'] === 'string') m.run_id = aep['run_id']
  if (typeof aep['model_id'] === 'string') m.model_id = aep['model_id']
  if (typeof aep['model_provider'] === 'string') m.model_provider = aep['model_provider']
  if (Array.isArray(aep['actions'])) m.actions = (aep['actions'] as unknown[]).length
  if (typeof aep['schema_version'] === 'string') m.schema_version = aep['schema_version']
  // v0.5 attribution grading — surfaces who authorized the run and what
  // evidence stands behind that authorization.
  if (typeof aep['authorized_by'] === 'string') m.authorized_by = aep['authorized_by']
  if (typeof aep['authority_origin'] === 'string') m.authority_origin = aep['authority_origin']
  if (typeof aep['identity_source'] === 'string') m.identity_source = aep['identity_source']
  if (typeof aep['attribution_backing'] === 'string') m.attribution_backing = aep['attribution_backing']
  if (typeof aep['run_attribution_backing_floor'] === 'string')
    m.run_attribution_backing_floor = aep['run_attribution_backing_floor']
  return m
}

/** Format a trace timestamp for display. Trace files are untrusted input —
 * an unparseable timestamp must render as a placeholder, never throw out of
 * toISOString() and unmount the whole tree. */
export function formatTimestamp(ts: string | undefined): string {
  if (ts === undefined || ts === '') return '—'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts
  return d.toISOString().replace('T', ' ').replace('Z', ' UTC')
}
