import type { ServerResponse } from 'node:http';
import type { RuntimeReadyEvent } from '@my-pi-harness/protocol';

const HEARTBEAT_INTERVAL_MS = 15_000;

/** Owns live SSE responses and releases every heartbeat when its response closes. */
export class RuntimeEventStreams {
  private readonly subscriptions = new Map<ServerResponse, () => void>();

  public constructor(private readonly readyEvent: RuntimeReadyEvent) {}

  /** Number of live responses owned by this daemon instance. */
  public get activeConnections(): number {
    return this.subscriptions.size;
  }

  /**
   * Start a response with the daemon identity and periodic SSE comments.
   * @param response An HTTP response that Fastify has handed to this stream.
   */
  public subscribe(response: ServerResponse): void {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.write(`event: runtime.ready\ndata: ${JSON.stringify(this.readyEvent)}\n\n`);
    const heartbeat = setInterval(() => {
      if (!response.destroyed && !response.writableEnded && !response.writableNeedDrain) {
        response.write(': heartbeat\n\n');
      }
    }, HEARTBEAT_INTERVAL_MS);
    heartbeat.unref();
    const release = (): void => {
      clearInterval(heartbeat);
      this.subscriptions.delete(response);
      response.off('close', release);
      response.off('error', release);
    };
    this.subscriptions.set(response, release);
    response.once('close', release);
    response.once('error', release);
  }

  /** End every stream before the HTTP server waits for active connections. */
  public close(): void {
    for (const [response, release] of this.subscriptions) {
      release();
      if (!response.destroyed && !response.writableEnded) response.end();
    }
  }
}
