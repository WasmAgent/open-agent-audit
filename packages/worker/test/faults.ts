/**
 * Test-only deterministic fault injectors for the R2 local harness
 * (packages/worker/src/runtime-faults.ts defines the artifact model).
 *
 * Every injector wraps a working fake from harness.ts and fails EXACTLY at the
 * checkpoint its scenario names — no randomness, no production access.
 */
import type { SqliteD1, SqliteStatement } from './harness.js';
import type { MemoryKV } from './harness.js';
import type { MemoryR2 } from './harness.js';

/** D1 fake that throws when a SQL statement matches `failOn`, else delegates. */
export class FaultD1 {
  constructor(
    private readonly inner: SqliteD1,
    readonly checkpoint: string,
    private readonly failOn: RegExp,
    private readonly error: Error,
  ) {}

  prepare(sql: string): SqliteStatement {
    if (this.failOn.test(sql)) throw this.error;
    return this.inner.prepare(sql);
  }

  async batch(statements: SqliteStatement[]): Promise<Array<{ success: true; meta: Record<string, unknown> }>> {
    return this.inner.batch(statements);
  }

  async exec(sql: string): Promise<void> {
    if (this.failOn.test(sql)) throw this.error;
    return this.inner.exec(sql);
  }

  /** Fixture setup that must bypass the injected fault. */
  seed(sql: string, params: unknown[] = []): void {
    this.inner.seed(sql, params);
  }

  get db(): SqliteD1 {
    return this.inner;
  }
}

interface FaultKvOptions {
  failOnGet?: (key: string) => boolean;
  failOnPut?: (key: string) => boolean;
  error: Error;
}

/** KV fake with per-predicate get/put failure checkpoints. */
export class FaultKV {
  constructor(
    private readonly inner: MemoryKV,
    readonly checkpoint: string,
    private readonly options: FaultKvOptions,
  ) {}

  async get(key: string): Promise<string | null> {
    if (this.options.failOnGet?.(key)) throw this.options.error;
    return this.inner.get(key);
  }

  async put(key: string, value: string): Promise<void> {
    if (this.options.failOnPut?.(key)) throw this.options.error;
    return this.inner.put(key, value);
  }

  async delete(key: string): Promise<void> {
    return this.inner.delete(key);
  }

  async list(opts: { prefix?: string } = {}): Promise<{ keys: Array<{ name: string }>; list_complete: boolean }> {
    return this.inner.list(opts);
  }
}

interface FaultR2Options {
  failOnGet?: (key: string) => boolean;
  failOnPut?: (key: string) => boolean;
  error: Error;
}

/** R2 fake with per-predicate get/put failure checkpoints. */
export class FaultR2 {
  constructor(
    private readonly inner: MemoryR2,
    readonly checkpoint: string,
    private readonly options: FaultR2Options,
  ) {}

  async put(key: string, value: string | Uint8Array): Promise<void> {
    if (this.options.failOnPut?.(key)) throw this.options.error;
    return this.inner.put(key, value);
  }

  async get(key: string): Promise<null | { body: Uint8Array; text(): Promise<string>; json<T>(): Promise<T> }> {
    if (this.options.failOnGet?.(key)) throw this.options.error;
    return this.inner.get(key);
  }

  async delete(key: string): Promise<void> {
    return this.inner.delete(key);
  }
}

export interface FakeQueueMessage<T = unknown> {
  body: T;
  ack(): void;
  retry(): void;
}

export interface FakeMessageBatch<T = unknown> {
  queue: string;
  messages: FakeQueueMessage<T>[];
  events: { acked: number; retried: number };
}

/** At-least-once batch fake recording ack/retry outcomes per delivery. */
export function fakeBatch<T>(queue: string, bodies: T[]): FakeMessageBatch<T> {
  const events = { acked: 0, retried: 0 };
  const messages = bodies.map((body) => ({
    body,
    ack: () => {
      events.acked++;
    },
    retry: () => {
      events.retried++;
    },
  }));
  return { queue, messages, events };
}
