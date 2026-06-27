/** TenantLimiter — per-tenant rate-limiting Durable Object. */

const LIMIT_PER_MINUTE = 100;
const WINDOW_MS = 60_000;

interface TenantWindow {
  window_start: number;
  count: number;
}

export class TenantLimiter {
  private readonly state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method.toUpperCase();

    if (method === 'POST' && pathname === '/check') {
      return this.handleCheck(request);
    }

    return new Response('Not found', { status: 404 });
  }

  private async handleCheck(request: Request): Promise<Response> {
    const body = await request.json() as { tenant_id?: string };
    const tenant_id = body.tenant_id ?? 'unknown';

    const storageKey = `window:${tenant_id}`;
    const now = Date.now();

    let window = await this.state.storage.get<TenantWindow>(storageKey);

    if (window === undefined || now - window.window_start >= WINDOW_MS) {
      // New or expired window — reset
      window = { window_start: now, count: 0 };
    }

    const allowed = window.count < LIMIT_PER_MINUTE;
    if (allowed) {
      window.count += 1;
    }

    await this.state.storage.put(storageKey, window);

    const remaining = Math.max(0, LIMIT_PER_MINUTE - window.count);
    const reset_at = window.window_start + WINDOW_MS;

    return new Response(
      JSON.stringify({ allowed, remaining, reset_at, count: window.count }),
      { headers: { 'content-type': 'application/json' } },
    );
  }
}
