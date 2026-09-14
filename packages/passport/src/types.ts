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
  /** Prior issuance this passport was re-issued from (renewal lineage). */
  renewed_from?: string;
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
  /** Raw EAS (Evidence Admission Score) value used to derive evidence_quality. */
  eas_score?: number;
  framework_mappings?: FrameworkMapping[];
  /** Attestation format used for the underlying evidence (e.g. 'dsse' for DSSE/in-toto). */
  attestation_format?: 'legacy' | 'dsse';
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
  /**
   * Why this issuance exists relative to the previous one. `reaudit` means a
   * fresh audit report backed the renewal; `administrative_extension` means the
   * validity window was extended without new audit evidence (N4-P2-03). Never
   * let the new `issued_at` imply the evidence is equally new.
   */
  renewal_basis?: 'administrative_extension' | 'reaudit';
  /**
   * Timestamp of the audit evidence this issuance relies on. For an
   * administrative extension this is the original evidence time, not the
   * renewal time (N4-P2-03).
   */
  evidence_as_of?: string;
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
  report?: unknown;
  agentbom?: unknown;
  posture?: unknown;
  validityDays?: number;
  /**
   * Optional signer. Renewal always mints a fresh issuance; when the source
   * passport is signed a signer is required so the new issuance is signed too
   * (N3-P1-08). Without a signer only unsigned passports can be renewed.
   */
  signer?: import('./sign.js').PassportSigner;
  /**
   * Opt-in cap on how old the relied-upon audit evidence may be for an
   * administrative extension. Without a fresh `report`, renewal is recorded as
   * `administrative_extension` with `evidence_as_of` = the original evidence
   * time; if that evidence is older than this many days the renewal fails
   * closed (N4-P2-03). Undefined disables the cap.
   */
  maxEvidenceAgeDays?: number;
}

export interface RevokeOptions {
  passport: TrustPassport;
  reason: string;
}

export type PassportStatus = 'valid' | 'expired' | 'revoked';

/**
 * Known audit framework profile identifiers.
 *
 * Custom strings are allowed and will pass through without error,
 * but a console warning is emitted for unrecognized profiles to
 * help catch typos.
 */
export type KnownFrameworkProfile =
  | 'owasp-agentic-top10-2026'
  | 'nist-ai-rmf-1.0'
  | 'eu-ai-act-2024'
  | 'iso-42001'
  | 'eu-ai-act-annex-iv'
  | 'iso-iec-42001';

/** Set of recognized framework profile strings for validation. */
export const KNOWN_FRAMEWORK_PROFILES: ReadonlySet<string> = new Set<string>([
  'owasp-agentic-top10-2026',
  'nist-ai-rmf-1.0',
  'eu-ai-act-2024',
  'iso-42001',
  'eu-ai-act-annex-iv',
  'iso-iec-42001',
]);
