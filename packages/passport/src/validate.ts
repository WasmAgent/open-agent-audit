import type { TrustPassport } from './types.js';

export interface ValidationError {
  field: string;
  errorCode: string;
  message: string;
  received?: unknown;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];              // kept for backward compat
  structuredErrors: ValidationError[];
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

function addError(
  errors: ValidationError[],
  field: string,
  errorCode: string,
  message: string,
  received?: unknown,
): void {
  errors.push({ field, errorCode, message, received });
}

/**
 * Validates an unknown payload against the TrustPassport schema.
 */
export function validateTrustPassport(data: unknown): ValidationResult {
  const structuredErrors: ValidationError[] = [];

  if (!isObject(data)) {
    addError(structuredErrors, 'data', 'invalid_type', 'data must be an object', typeof data);
    return {
      valid: false,
      errors: structuredErrors.map(e => e.message),
      structuredErrors,
    };
  }

  // Prototype-pollution guard
  if (hasPollutionKeys(data)) {
    addError(structuredErrors, 'data', 'prototype_pollution', 'object contains disallowed prototype-pollution key');
    return {
      valid: false,
      errors: structuredErrors.map(e => e.message),
      structuredErrors,
    };
  }

  // Required-field enforcement
  if (data['passport_version'] !== '0.1') {
    addError(
      structuredErrors,
      'passport_version',
      'invalid_format',
      "passport_version must be '0.1'",
      data['passport_version'],
    );
  }

  if (!isObject(data['identity'])) {
    addError(structuredErrors, 'identity', 'required', 'identity must be an object', data['identity']);
  }

  if (!isObject(data['validity'])) {
    addError(structuredErrors, 'validity', 'required', 'validity must be an object', data['validity']);
  }

  if (!isObject(data['revocation'])) {
    addError(structuredErrors, 'revocation', 'required', 'revocation must be an object', data['revocation']);
  }

  if (!isObject(data['attestation'])) {
    addError(structuredErrors, 'attestation', 'required', 'attestation must be an object', data['attestation']);
  }

  // ISO 8601 UTC enforcement on validity timestamps
  if (isObject(data['validity'])) {
    const validity = data['validity'] as Record<string, unknown>;
    if (typeof validity['issued_at'] === 'string') {
      if (!ISO_8601_UTC_RE.test(validity['issued_at'])) {
        addError(
          structuredErrors,
          'validity.issued_at',
          'invalid_format',
          'validity.issued_at must be ISO 8601 UTC (ending in Z)',
          validity['issued_at'],
        );
      }
    }
    if (typeof validity['expires_at'] === 'string') {
      if (!ISO_8601_UTC_RE.test(validity['expires_at'])) {
        addError(
          structuredErrors,
          'validity.expires_at',
          'invalid_format',
          'validity.expires_at must be ISO 8601 UTC (ending in Z)',
          validity['expires_at'],
        );
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
          addError(
            structuredErrors,
            'evidence_summary.framework_mappings[].coverage',
            'invalid_format',
            `invalid coverage value: '${mapping['coverage']}'; must be one of: selected_technical_evidence, partial, none`,
            mapping['coverage'],
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
      addError(
        structuredErrors,
        'revocation.revocation_triggers',
        'invalid_type',
        'revocation.revocation_triggers must be an array',
        rev['revocation_triggers'],
      );
    }
  }

  return {
    valid: structuredErrors.length === 0,
    errors: structuredErrors.map(e => e.message),
    structuredErrors,
  };
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
