/** AuditRunCoordinator — per-run state Durable Object skeleton. */
export class AuditRunCoordinator {
  async fetch(_request: Request): Promise<Response> {
    return new Response('AuditRunCoordinator skeleton', { status: 501 });
  }
}
