import { createElement, type FC } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { useAsyncEvent, type AsyncEvent } from '../src/hooks/use-async-event';

interface Gate {
  promise: Promise<void>;
  release: (failure?: Error) => void;
}

const gate = (): Gate => {
  let release: Gate['release'] = () => {
    throw new Error('Fixture gate was not initialized');
  };
  const promise = new Promise<void>((resolve, reject) => {
    release = (failure): void => {
      if (failure !== undefined) reject(failure);
      else resolve();
    };
  });
  return { promise, release };
};

const readEvent = (
  operation: (signal: AbortSignal, name: string) => Promise<void>,
): AsyncEvent<[string]> => {
  let event: AsyncEvent<[string]> | undefined;
  const Probe: FC = () => {
    event = useAsyncEvent(operation);
    return null;
  };
  renderToStaticMarkup(createElement(Probe));
  if (event === undefined) throw new Error('Fixture event was not rendered');
  return event;
};

describe('explicit UI task cancellation', () => {
  it.each(['success', 'failure'])(
    'ignores the old %s while a new target is pending',
    async (outcome) => {
      const first = gate();
      const second = gate();
      const calls: { signal: AbortSignal; name: string; operation: Promise<void> }[] = [];
      const completed: string[] = [];
      const event = readEvent((signal, name) => {
        const execute = async (): Promise<void> => {
          if (name === 'first') await first.promise;
          if (name === 'second') await second.promise;
          signal.throwIfAborted();
          completed.push(name);
        };
        const operation = execute();
        calls.push({ signal, name, operation });
        return operation;
      });
      try {
        event.run('first');
        event.run('duplicate first');
        expect(calls.map((call) => call.name)).toEqual(['first']);
        event.cancel();
        expect(calls[0]?.signal.aborted).toBe(true);
        event.run('second');
        if (outcome === 'failure') first.release(new Error('Old target failed'));
        else first.release();
        const firstOperation = calls[0]?.operation;
        if (firstOperation === undefined) throw new Error('Missing first operation');
        await Promise.allSettled([firstOperation]);
        event.run('duplicate second');
        expect(calls.map((call) => call.name)).toEqual(['first', 'second']);
        expect(calls[1]?.signal.aborted).toBe(false);
        second.release();
        const secondOperation = calls[1]?.operation;
        if (secondOperation === undefined) throw new Error('Missing second operation');
        await secondOperation;
        event.run('third');
        expect(completed).toEqual(['second', 'third']);
      } finally {
        event.cancel();
        first.release();
        second.release();
        await Promise.allSettled(calls.map((call) => call.operation));
      }
    },
  );
});
