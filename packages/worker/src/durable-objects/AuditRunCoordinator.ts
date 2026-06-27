/** AuditRunCoordinator — per-run state Durable Object. */

interface RunState {
  run_id: string;
  status: 'running' | 'completed' | 'failed';
  created_at: string;
  completed_at?: string;
  chunks_complete: number;
  chunks_total?: number;
}

export class AuditRunCoordinator {
  private readonly state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method.toUpperCase();

    if (method === 'POST' && pathname === '/init') {
      return this.handleInit(request);
    }

    if (method === 'POST' && pathname === '/chunk-complete') {
      return this.handleChunkComplete(request);
    }

    if (method === 'POST' && pathname === '/finalize') {
      return this.handleFinalize();
    }

    if (method === 'GET' && pathname === '/status') {
      return this.handleStatus();
    }

    return new Response('Not found', { status: 404 });
  }

  private async handleInit(request: Request): Promise<Response> {
    const body = await request.json() as { run_id?: string; chunks_total?: number };
    const run_id = body.run_id ?? crypto.randomUUID();

    const existing = await this.state.storage.get<RunState>('run');
    if (existing !== undefined) {
      return new Response(
        JSON.stringify({ error: 'Run already initialized', run_id: existing.run_id }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      );
    }

    const runState: RunState = {
      run_id,
      status: 'running',
      created_at: new Date().toISOString(),
      chunks_complete: 0,
    };
    if (body.chunks_total !== undefined) {
      runState.chunks_total = body.chunks_total;
    }

    await this.state.storage.put('run', runState);

    return new Response(JSON.stringify({ run_id, status: 'running' }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  }

  private async handleChunkComplete(request: Request): Promise<Response> {
    const body = await request.json() as { chunk_index?: number };
    const runState = await this.state.storage.get<RunState>('run');

    if (runState === undefined) {
      return new Response(
        JSON.stringify({ error: 'Run not initialized' }),
        { status: 404, headers: { 'content-type': 'application/json' } },
      );
    }

    runState.chunks_complete += 1;
    await this.state.storage.put('run', runState);

    return new Response(
      JSON.stringify({
        run_id: runState.run_id,
        chunks_complete: runState.chunks_complete,
        chunks_total: runState.chunks_total,
        chunk_index: body.chunk_index,
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  }

  private async handleFinalize(): Promise<Response> {
    const runState = await this.state.storage.get<RunState>('run');

    if (runState === undefined) {
      return new Response(
        JSON.stringify({ error: 'Run not initialized' }),
        { status: 404, headers: { 'content-type': 'application/json' } },
      );
    }

    runState.status = 'completed';
    runState.completed_at = new Date().toISOString();
    await this.state.storage.put('run', runState);

    return new Response(
      JSON.stringify({ run_id: runState.run_id, status: 'completed', completed_at: runState.completed_at }),
      { headers: { 'content-type': 'application/json' } },
    );
  }

  private async handleStatus(): Promise<Response> {
    const runState = await this.state.storage.get<RunState>('run');

    if (runState === undefined) {
      return new Response(
        JSON.stringify({ error: 'Run not initialized' }),
        { status: 404, headers: { 'content-type': 'application/json' } },
      );
    }

    return new Response(JSON.stringify(runState), {
      headers: { 'content-type': 'application/json' },
    });
  }
}
