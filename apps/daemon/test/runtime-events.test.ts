import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { PROTOCOL_VERSION, type RuntimeReadyEvent } from '@my-pi-harness/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RuntimeEventStreams } from '../src/runtime-events.js';

const identity: RuntimeReadyEvent = {
  type: 'runtime.ready',
  protocolVersion: PROTOCOL_VERSION,
  instanceId: 'test-daemon',
  startedAt: 1,
};
const subscriptions: RuntimeEventStreams[] = [];
const responses: ServerResponse[] = [];

afterEach(() => {
  for (const streams of subscriptions.splice(0)) streams.close();
  for (const response of responses.splice(0)) response.destroy();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function createResponse(): ServerResponse {
  const response = new ServerResponse(new IncomingMessage(new Socket()));
  responses.push(response);
  return response;
}

function createStreams(): RuntimeEventStreams {
  const streams = new RuntimeEventStreams(identity);
  subscriptions.push(streams);
  return streams;
}

describe('runtime stream heartbeats', () => {
  it('skips heartbeats while the response is backed up and resumes after it drains', () => {
    vi.useFakeTimers();
    const response = createResponse();
    let backedUp = true;
    vi.spyOn(response, 'writableNeedDrain', 'get').mockImplementation(() => backedUp);
    const write = vi.spyOn(response, 'write').mockReturnValue(false);
    const streams = createStreams();
    streams.subscribe(response);
    expect(write).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(45_000);
    expect(write).toHaveBeenCalledTimes(1);

    backedUp = false;
    write.mockReturnValue(true);
    vi.advanceTimersByTime(15_000);
    expect(write).toHaveBeenLastCalledWith(': heartbeat\n\n');
    expect(write).toHaveBeenCalledTimes(2);
  });

  it.each(['close', 'error'] as const)(
    'releases the subscription, heartbeat, and listeners after response %s',
    (event) => {
      vi.useFakeTimers();
      const response = createResponse();
      const write = vi.spyOn(response, 'write').mockReturnValue(true);
      const streams = createStreams();
      streams.subscribe(response);
      expect(streams.activeConnections).toBe(1);
      expect(vi.getTimerCount()).toBe(1);

      response.emit(event, ...(event === 'error' ? [new Error('Connection failed')] : []));
      expect(streams.activeConnections).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      expect(response.listenerCount('close')).toBe(0);
      expect(response.listenerCount('error')).toBe(0);
      vi.advanceTimersByTime(30_000);
      expect(write).toHaveBeenCalledTimes(1);
    },
  );
});
