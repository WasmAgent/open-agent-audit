/**
 * @openagentaudit/schema — Canonical evidence schema types.
 *
 * Status: alpha skeleton. Authoritative schema documents live in
 * `../../schemas/v0.1/*.schema.json`. This package re-exports TypeScript
 * types that mirror the JSON schemas and helpers for runtime validation.
 *
 * Implementation is blocked on the Phase 2 freeze gate. See
 * `docs/schema-versioning.md`.
 */

import { z } from 'zod';

export const SPEC_VERSION = 'open-agent-audit/v0.1' as const;

export type SpecVersion = typeof SPEC_VERSION;

export type EventType =
  | 'tool_call'
  | 'policy_decision'
  | 'human_approval'
  | 'observation'
  | 'model_output'
  | 'final_answer'
  | 'error';

export type Actor = 'agent' | 'user' | 'system' | 'tool' | 'human_reviewer';

export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export type PolicyDecision = 'allow' | 'deny' | 'ask_user';

export type HumanDecision = 'approve' | 'deny' | 'escalate';

export interface CanonicalEvent {
  schema_version: SpecVersion;
  run_id: string;
  session_id?: string;
  agent_id: string;
  model_id: string;
  event_id: string;
  timestamp: string;
  type: EventType;
  actor: Actor;
  tool?: {
    name: string;
    capability?: string;
    args_hash?: string;
    result_hash?: string;
    risk_tags?: string[];
  };
  policy?: {
    decision: PolicyDecision;
    reason: string;
    rule_id?: string;
  };
  human?: {
    reviewer_id: string;
    decision: HumanDecision;
    justification?: string;
  };
  error?: {
    kind: string;
    message: string;
  };
  model_output?: {
    content_hash?: string;
    token_count?: number;
    finish_reason?: string;
  };
  observation?: {
    source?: string;
    content_hash?: string;
    byte_size?: number;
  };
  evidence?: {
    evidence_id?: string;
    hash?: string;
    prev_hash?: string;
    signature?: string;
    signature_algorithm?: 'ed25519' | 'ecdsa-p256';
    signer_key_id?: string;
  };
}

export interface AuditRun {
  schema_version: SpecVersion;
  run_id: string;
  session_id?: string;
  tenant_id?: string;
  project_id?: string;
  agent_id: string;
  model_id: string;
  created_at: string;
  completed_at?: string;
  task: {
    id: string;
    description: string;
    risk_level: 'low' | 'medium' | 'high' | 'critical';
  };
  capability_manifest_ref?: string;
  event_count: number;
  input_format?: string;
  source_adapter?: string;
  profiles?: string[];
  engine_version?: string;
}

export interface Finding {
  schema_version: SpecVersion;
  finding_id: string;
  rule_id: string;
  severity: Severity;
  category: string;
  title: string;
  description: string;
  evidence_ids: string[];
  recommendation: string;
  standard_mappings?: Array<{
    profile: string;
    control_id: string;
    limitation: string;
  }>;
  confidence?: 'low' | 'medium' | 'high';
  false_positive_likelihood?: number;
  first_seen?: string;
  last_seen?: string;
  occurrence_count?: number;
  suppressed?: boolean;
  suppression_reason?: string;
}

export interface RiskScore {
  schema_version: SpecVersion;
  run_id: string;
  generated_at: string;
  evidence_admission_score: { score: number; grade: 'A' | 'B' | 'C' | 'D' | 'F' };
  agent_risk_score: { score: number };
  components: Record<string, number>;
  rubric_version?: string;
  contamination_evaluated: boolean;
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const CanonicalEventSchema = z.object({
  schema_version: z.literal(SPEC_VERSION),
  run_id: z.string(),
  session_id: z.string().optional(),
  agent_id: z.string(),
  model_id: z.string(),
  event_id: z.string(),
  timestamp: z.string(),
  type: z.enum([
    'tool_call',
    'policy_decision',
    'human_approval',
    'observation',
    'model_output',
    'final_answer',
    'error',
  ]),
  actor: z.enum(['agent', 'user', 'system', 'tool', 'human_reviewer']),
  tool: z
    .object({
      name: z.string(),
      capability: z.string().optional(),
      args_hash: z.string().optional(),
      result_hash: z.string().optional(),
      risk_tags: z.array(z.string()).optional(),
    })
    .optional(),
  policy: z
    .object({
      decision: z.enum(['allow', 'deny', 'ask_user']),
      reason: z.string(),
      rule_id: z.string().optional(),
    })
    .optional(),
  human: z
    .object({
      reviewer_id: z.string(),
      decision: z.enum(['approve', 'deny', 'escalate']),
      justification: z.string().optional(),
    })
    .optional(),
  error: z
    .object({
      kind: z.string(),
      message: z.string(),
    })
    .optional(),
  model_output: z
    .object({
      content_hash: z.string().optional(),
      token_count: z.number().optional(),
      finish_reason: z.string().optional(),
    })
    .optional(),
  observation: z
    .object({
      source: z.string().optional(),
      content_hash: z.string().optional(),
      byte_size: z.number().optional(),
    })
    .optional(),
  evidence: z
    .object({
      evidence_id: z.string().optional(),
      hash: z.string().optional(),
      prev_hash: z.string().optional(),
      signature: z.string().optional(),
      signature_algorithm: z.enum(['ed25519', 'ecdsa-p256']).optional(),
      signer_key_id: z.string().optional(),
    })
    .optional(),
});

export const AuditRunSchema = z.object({
  schema_version: z.literal(SPEC_VERSION),
  run_id: z.string(),
  session_id: z.string().optional(),
  tenant_id: z.string().optional(),
  project_id: z.string().optional(),
  agent_id: z.string(),
  model_id: z.string(),
  created_at: z.string(),
  completed_at: z.string().optional(),
  task: z.object({
    id: z.string(),
    description: z.string(),
    risk_level: z.enum(['low', 'medium', 'high', 'critical']),
  }),
  capability_manifest_ref: z.string().optional(),
  event_count: z.number(),
  input_format: z.string().optional(),
  source_adapter: z.string().optional(),
  profiles: z.array(z.string()).optional(),
  engine_version: z.string().optional(),
});

export const FindingSchema = z.object({
  schema_version: z.literal(SPEC_VERSION),
  finding_id: z.string(),
  rule_id: z.string(),
  severity: z.enum(['info', 'low', 'medium', 'high', 'critical']),
  category: z.string(),
  title: z.string(),
  description: z.string(),
  evidence_ids: z.array(z.string()),
  recommendation: z.string(),
  standard_mappings: z
    .array(
      z.object({
        profile: z.string(),
        control_id: z.string(),
        limitation: z.string(),
      }),
    )
    .optional(),
  confidence: z.enum(['low', 'medium', 'high']).optional(),
  false_positive_likelihood: z.number().optional(),
  first_seen: z.string().optional(),
  last_seen: z.string().optional(),
  occurrence_count: z.number().optional(),
  suppressed: z.boolean().optional(),
  suppression_reason: z.string().optional(),
});

export const RiskScoreSchema = z.object({
  schema_version: z.literal(SPEC_VERSION),
  run_id: z.string(),
  generated_at: z.string(),
  evidence_admission_score: z.object({
    score: z.number(),
    grade: z.enum(['A', 'B', 'C', 'D', 'F']),
  }),
  agent_risk_score: z.object({
    score: z.number(),
  }),
  components: z.record(z.string(), z.number()),
  rubric_version: z.string().optional(),
  contamination_evaluated: z.boolean().default(false),
});

// ---------------------------------------------------------------------------
// Runtime validation helpers
// ---------------------------------------------------------------------------

/**
 * Parse an array of unknown values as CanonicalEvent[].
 * Throws a ZodError if any element fails validation.
 */
export function parseEvents(raw: unknown[]): CanonicalEvent[] {
  return CanonicalEventSchema.array().parse(raw) as unknown as CanonicalEvent[];
}

/**
 * Validate an array of unknown values as CanonicalEvent[], collecting errors
 * per element rather than throwing on the first failure.
 */
export function validateEvents(raw: unknown[]): {
  valid: CanonicalEvent[];
  errors: Array<{ index: number; message: string }>;
} {
  const valid: CanonicalEvent[] = [];
  const errors: Array<{ index: number; message: string }> = [];

  for (let i = 0; i < raw.length; i++) {
    const result = CanonicalEventSchema.safeParse(raw[i]);
    if (result.success) {
      valid.push(result.data as unknown as CanonicalEvent);
    } else {
      errors.push({ index: i, message: result.error.message });
    }
  }

  return { valid, errors };
}
