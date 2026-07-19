import type { TrustPassport } from './types.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const ISO_8601_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

const POLLUTION_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const VALID_COVERAGE = new Set([
  'selected_technical_evidence',
  'partial',
  'none',
]);

function hasPollutionKeys(obj: unknown): boolean {
  if (typeof obj !== 'object' || obj === null) return false;
  for (const key of Object.getOwnPropertyNames(obj)) {
    if (POLLUTION_KEYS.has(key)) return true;
    const value = (obj as Record<string, unknown>)[key];
    if (typeof value === 'object' && value !== null && hasPollutionKeys(value)) {
      return true;
    }
  }
  return false;
}

function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

/**
 * Validates an unknown payload against the TrustPassport schema.
 */
export function validateTrustPassport(data: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isObject(data)) {
    return { valid: false, errors: ['data must be an object'] };
  }

  // Prototype-pollution guard
  if (hasPollutionKeys(data)) {
    errors.push('object contains disallowed prototype-pollution key');
    return { valid: false, errors };
  }

  // Required-field enforcement
  if (data['passport_version'] !== '0.1') {
    errors.push("passport_version must be '0.1'");
  }

  if (!isObject(data['identity'])) {
    errors.push('identity must be an object');
  }

  if (!isObject(data['validity'])) {
    errors.push('validity must be an object');
  }

  if (!isObject(data['revocation'])) {
    errors.push('revocation must be an object');
  }

  if (!isObject(data['attestation'])) {
    errors.push('attestation must be an object');
  }

  // ISO 8601 UTC enforcement on validity timestamps
  if (isObject(data['validity'])) {
    const validity = data['validity'] as Record<string, unknown>;
    if (typeof validity['issued_at'] === 'string') {
      if (!ISO_8601_UTC_RE.test(validity['issued_at'])) {
        errors.push('validity.issued_at must be ISO 8601 UTC (ending in Z)');
      }
    }
    if (typeof validity['expires_at'] === 'string') {
      if (!ISO_8601_UTC_RE.test(validity['expires_at'])) {
        errors.push('validity.expires_at must be ISO 8601 UTC (ending in Z)');
      }
    }
  }

  // coverage enum check
  if (isObject(data['evidence_summary'])) {
    const es = data['evidence_summary'] as Record<string, unknown>;
    if (Array.isArray(es['framework_mappings'])) {
      for (const mapping of es['framework_mappings'] as Array<Record<string, unknown>>) {
        if (
          typeof mapping['coverage'] === 'string' &&
          !VALID_COVERAGE.has(mapping['coverage'])
        ) {
          errors.push(
            `invalid coverage value: '${mapping['coverage']}'; must be one of: selected_technical_evidence, partial, none`,
          );
        }
      }
    }
  }

  // revocation_triggers array check
  if (isObject(data['revocation'])) {
    const rev = data['revocation'] as Record<string, unknown>;
    if (
      rev['revocation_triggers'] !== undefined &&
      !Array.isArray(rev['revocation_triggers'])
    ) {
      errors.push('revocation.revocation_triggers must be an array');
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Returns true if the passport's validity.expires_at is in the past.
 * Returns false when expires_at is absent/undefined.
 * Does NOT check revocation status.
 */
export function isExpired(passport: TrustPassport): boolean {
  const expiresAt = passport.validity?.expires_at;
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() < Date.now();
}
