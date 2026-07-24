/**
 * Structured error type for adapter failures.
 *
 * All adapters throw this when they encounter malformed, incomplete, or
 * unsupported source payloads, giving callers a machine-readable error code
 * alongside the human-readable message.
 *
 * Usage in consumers:
 * ```ts
 * try {
 *   adapter.toEvents(record);
 * } catch (e) {
 *   if (e instanceof AdapterError) {
 *     // e.code, e.adapter, e.message are available
 *   }
 * }
 * ```
 */

export type AdapterErrorCode =
  | 'missing_required_field'
  | 'unsupported_version'
  | 'malformed_payload';

export class AdapterError extends Error {
  /** Machine-readable error code. */
  readonly code: AdapterErrorCode;
  /** Identifier of the adapter that produced the error. */
  readonly adapter: string;

  constructor(adapter: string, code: AdapterErrorCode, message: string) {
    super(message);
    this.name = 'AdapterError';
    this.adapter = adapter;
    this.code = code;
  }
}
