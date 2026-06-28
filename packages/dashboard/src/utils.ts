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
  tool?: { name?: string; capability?: string; risk_tags?: string[] }
  policy?: { decision?: string; reason?: string; rule_id?: string }
  error?: { kind?: string; message?: string }
  human?: { reviewer_id?: string; decision?: string; justification?: string }
  observation?: { source?: string; byte_size?: number; content_hash?: string }
  model_output?: { token_count?: number; finish_reason?: string; content_hash?: string }
}

export interface AepMeta {
  run_id?: string
  model_id?: string
  model_provider?: string
  actions?: number
  schema_version?: string
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
  return m
}
