import { afterEach, describe, expect, it, vi } from 'vitest';
import { watchParentProcess } from '../src/application/parent-monitor.js';

const disposers: Array<() => void> = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('daemon parent monitoring', () => {
  it('checks immediately, keeps probing permission-denied parents, and stops when disposed', () => {
    vi.useFakeTimers();
    const permissionDenied = Object.assign(new Error('Permission denied'), { code: 'EPERM' });
    const probe = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw permissionDenied;
    });
    const onExit = vi.fn();
    const onError = vi.fn();
    const dispose = watchParentProcess(42, onExit, onError);
    disposers.push(dispose);
    expect(probe).toHaveBeenCalledWith(42, 0);
    expect(probe).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_000);
    expect(probe).toHaveBeenCalledTimes(2);
    expect(onExit).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();

    dispose();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1_000);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('reports a missing parent once and releases the probe timer', () => {
    vi.useFakeTimers();
    const missing = Object.assign(new Error('No such process'), { code: 'ESRCH' });
    const probe = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw missing;
    });
    const onExit = vi.fn();
    const onError = vi.fn();
    disposers.push(watchParentProcess(42, onExit, onError));
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(5_000);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('reports unexpected probe failures once and releases the probe timer', () => {
    vi.useFakeTimers();
    const failure = new Error('OS probe failed');
    const probe = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw failure;
    });
    const onExit = vi.fn();
    const onError = vi.fn();
    disposers.push(watchParentProcess(42, onExit, onError));
    expect(onError).toHaveBeenCalledWith(failure);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onExit).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(5_000);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
