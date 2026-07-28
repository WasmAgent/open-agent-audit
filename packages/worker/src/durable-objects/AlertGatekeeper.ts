/** AlertGatekeeper — cross-run rate-limit + de-duplication Durable Object (Milestone 6 #209). */

import { emptyAlertGateState, gateAlerts } from '@openagentaudit/core';
import type {
  AlertEvent,
  AlertGateConfig,
  AlertGateResult,
  AlertGateState,
  SuppressedAlert,
} from '@openagentaudit/core';

/**
 * Persistent suppression state stored under {@link STATE_KEY}. One instance of
 * this Durable Object holds the gate for one scope (e.g. one tenant), so
 * de-duplication and rate limiting survive across consecutive audit runs and
 * batches of findings never produce a notification storm.
 */
const STATE_KEY = 'gate';

interface GateRequestBody {
  /** Fired alerts produced by `evaluateAlerts` for the current run/batch. */
  events: AlertEvent[];
  /** Suppression configuration (dedupe window + rate cap). `{}` disables both. */
  config: AlertGateConfig;
  /** Optional epoch-ms override (tests / determinism). Defaults to `Date.now()`. */
  now?: number;
}

/** Body returned from `/gate`: the alerts to dispatch plus what was held back. */
interface GateResponseBody {
  allowed: AlertEvent[];
  suppressed: SuppressedAlert[];
}

export class AlertGatekeeper {
  private readonly state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method.toUpperCase();

    if (method === 'POST' && pathname === '/gate') {
      return this.handleGate(request);
    }
    if (method === 'GET' && pathname === '/state') {
      return this.handleState();
    }
    if (method === 'POST' && pathname === '/reset') {
      return this.handleReset();
    }

    return new Response('Not found', { status: 404 });
  }

  /**
   * Run a batch of fired alerts through {@link gateAlerts}, persist the updated
   * state, and return only the alerts that survived de-duplication and the
   * rate cap. Callers dispatch the `allowed` alerts and drop the rest.
   */
  private async handleGate(request: Request): Promise<Response> {
    const body = await request.json() as GateRequestBody;
    const prev = await this.state.storage.get<AlertGateState>(STATE_KEY);
    const now = body.now ?? Date.now();
    const config = body.config ?? {};
    const events = body.events ?? [];
    const result: AlertGateResult = gateAlerts(events, prev, config, now);
    await this.state.storage.put(STATE_KEY, result.state);
    const responseBody: GateResponseBody = {
      allowed: result.allowed,
      suppressed: result.suppressed,
    };
    return new Response(JSON.stringify(responseBody), {
      headers: { 'content-type': 'application/json' },
    });
  }

  /** Return the current persisted gate state (a fresh state if none yet). */
  private async handleState(): Promise<Response> {
    const stored = await this.state.storage.get<AlertGateState>(STATE_KEY);
    const state = stored ?? emptyAlertGateState();
    return new Response(JSON.stringify(state), {
      headers: { 'content-type': 'application/json' },
    });
  }

  /** Clear all gate state so the next batch starts from a clean slate. */
  private async handleReset(): Promise<Response> {
    await this.state.storage.delete(STATE_KEY);
    return new Response(JSON.stringify({ reset: true }), {
      headers: { 'content-type': 'application/json' },
    });
  }
}
