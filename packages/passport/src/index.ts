export { issue } from './issue.js';
export { renew, revoke, status } from './lifecycle.js';
export { validateTrustPassport, isExpired } from './validate.js';
export { hashEvidence, addFact } from './evidence.js';
export type { ValidationResult, ValidationError } from './validate.js';
export type { EvidenceFact } from './evidence.js';
export type {
  AgentBomRef,
  Attestation,
  AuditRef,
  EvidenceSummary,
  FrameworkMapping,
  IssueOptions,
  PassportIdentity,
  PassportStatus,
  PostureRef,
  RenewOptions,
  RevokeOptions,
  Revocation,
  RiskSummary,
  TrustPassport,
  Validity,
} from './types.js';
