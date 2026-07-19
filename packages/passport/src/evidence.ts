import { createHash } from 'node:crypto';
import type { TrustPassport } from './types.js';

export interface EvidenceFact {
  content_hash: string; // "sha256:<hex>"
  recorded_at: string; // ISO 8601 UTC
}

/**
 * Produce a deterministic "sha256:<hex>" reference for any content.
 * If content is not a string, JSON.stringify it first.
 */
export function hashEvidence(content: unknown): string {
  const str = typeof content === 'string' ? content : JSON.stringify(content);
  const hex = createHash('sha256').update(str).digest('hex');
  return `sha256:${hex}`;
}

/**
 * Store a content-addressed fact under passport.evidence_facts[factId].
 * Mutates and returns the passport.
 */
export function addFact(
  passport: TrustPassport & { evidence_facts?: Record<string, EvidenceFact> },
  factId: string,
  content: unknown,
): TrustPassport & { evidence_facts: Record<string, EvidenceFact> } {
  const facts = passport.evidence_facts ?? {};
  facts[factId] = {
    content_hash: hashEvidence(content),
    recorded_at: new Date().toISOString(),
  };
  passport.evidence_facts = facts;
  return passport as TrustPassport & { evidence_facts: Record<string, EvidenceFact> };
}
