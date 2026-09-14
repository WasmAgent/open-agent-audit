export { issue, EVIDENCE_QUALITY_THRESHOLDS } from './issue.js';
export { renew, revoke, status } from './lifecycle.js';
export { validateTrustPassport, isExpired } from './validate.js';
export { hashEvidence, addFact } from './evidence.js';
export { inspectTrustPassport } from './inspect.js';
export { signPassport, verifySignature, verifySignatureOnly, issuancePayload, issuanceDigest } from './sign.js';
export {
  PASSPORT_REVOCATION_TYPE,
  createRevocationRecord,
  revocationPayload,
  statusFromRevocation,
  verifyPassportLayers,
  verifyRevocation,
} from './revocation.js';
export type { InspectOptions } from './inspect.js';
export type { PassportSigner, SignedPassport, VerifyResult } from './sign.js';
export type { ValidationResult, ValidationError } from './validate.js';
export type { EvidenceFact } from './evidence.js';
export type {
  CreateRevocationOptions,
  LayerAuthenticity,
  PassportVerificationLayers,
  RevocationStatus,
  RevocationVerifyResult,
  StatusFreshness,
  TrustPassportRevocation,
  VerifyLayersOptions,
} from './revocation.js';
export type {
  AgentBomRef,
  Attestation,
  AuditRef,
  EvidenceSummary,
  FrameworkMapping,
  IssueOptions,
  KnownFrameworkProfile,
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
export { KNOWN_FRAMEWORK_PROFILES } from './types.js';
