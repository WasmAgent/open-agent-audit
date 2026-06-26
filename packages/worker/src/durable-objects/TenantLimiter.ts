/** TenantLimiter — per-tenant rate-limiting Durable Object skeleton. */
export class TenantLimiter {
  async fetch(_request: Request): Promise<Response> {
    return new Response('TenantLimiter skeleton', { status: 501 });
  }
}
