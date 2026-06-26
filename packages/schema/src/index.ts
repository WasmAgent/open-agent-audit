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
}
