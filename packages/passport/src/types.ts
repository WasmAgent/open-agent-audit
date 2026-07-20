export interface TrustPassport {
  passport_version: '0.1';
  identity: PassportIdentity;
  agentbom_ref?: AgentBomRef;
  audit_ref?: AuditRef;
  posture_ref?: PostureRef;
  evidence_summary?: EvidenceSummary;
  risk_summary?: RiskSummary;
  validity: Validity;
  revocation: Revocation;
  attestation: Attestation;
  evidence_facts?: Record<string, import('./evidence.js').EvidenceFact>;
}

export interface PassportIdentity {
  passport_id: string;
  agent_id: string;
  agent_name?: string;
  issuer: string;
  issuance_context?: 'self-issued' | 'trustavo';
}

export interface AgentBomRef {
  agentbom_id?: string;
  agentbom_hash?: string;
  captured_at?: string;
}

export interface AuditRef {
  report_id?: string;
  report_hash?: string;
  generated_at?: string;
}

export interface PostureRef {
  snapshot_id?: string;
  snapshot_hash?: string;
  captured_at?: string;
}

export interface FrameworkMapping {
  framework: string;
  coverage: 'selected_technical_evidence' | 'partial' | 'none';
  note?: string;
}

export interface EvidenceSummary {
  evidence_quality?: 'high' | 'medium' | 'low' | 'insufficient';
  framework_mappings?: FrameworkMapping[];
}

export interface RiskSummary {
  critical?: number;
  high?: number;
  medium?: number;
  low?: number;
  open_findings?: number;
}

export interface Validity {
  issued_at: string;
  expires_at: string;
  renewal_triggers?: string[];
  renewed_at?: string;
  renewal_count?: number;
}

export interface Revocation {
  revoked?: boolean;
  revoked_at?: string;
  revocation_reason?: string;
  revocation_triggers?: string[];
}

export interface Attestation {
  issuer: string;
  signing_method?: 'none' | 'sigstore' | 'ed25519';
  passport_hash?: string;
  signature?: string;
  key_id?: string;
  signed_at?: string;
}

export interface IssueOptions {
  report: unknown;
  agentId: string;
  agentName?: string;
  agentbom?: unknown;
  posture?: unknown;
  validityDays?: number;
  issuer?: string;
  issuanceContext?: 'self-issued' | 'trustavo';
  signer?: import('./sign.js').PassportSigner;
}

export interface RenewOptions {
  passport: TrustPassport;
  report: unknown;
  agentbom?: unknown;
  posture?: unknown;
  validityDays?: number;
}

export interface RevokeOptions {
  passport: TrustPassport;
  reason: string;
}

export type PassportStatus = 'valid' | 'expired' | 'revoked';
