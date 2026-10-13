import { app } from 'electron';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  start: vi.fn<() => Promise<void>>(),
  stop: vi.fn<() => Promise<void>>(),
  show: vi.fn<() => void>(),
  quit: vi.fn<() => void>(),
  showError: vi.fn<(title: string, message: string) => void>(),
}));

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    app: Object.assign(new EventEmitter(), {
      requestSingleInstanceLock: () => true,
      whenReady: () => Promise.resolve(),
      quit: mocks.quit,
    }),
    dialog: { showErrorBox: mocks.showError },
  };
});
vi.mock('../src/main/application.js', () => ({
  DesktopApplication: class {
    public start = mocks.start;
    public stop = mocks.stop;
    public show = mocks.show;
  },
}));

describe('desktop quit events', () => {
  it('holds every quit request until pending cleanup finishes', async () => {
    let finishStop: (() => void) | undefined;
    let failStart: ((error: Error) => void) | undefined;
    mocks.start.mockReturnValue(
      new Promise<void>((_resolve, reject) => {
        failStart = reject;
      }),
    );
    mocks.stop.mockReturnValue(
      new Promise<void>((resolve) => {
        finishStop = resolve;
      }),
    );
    try {
      await import('../src/main/index.js');
      await vi.waitFor(() => expect(mocks.start).toHaveBeenCalledOnce());
      const first = { preventDefault: vi.fn() };
      const second = { preventDefault: vi.fn() };
      app.emit('before-quit', first);
      app.emit('before-quit', second);
      expect(first.preventDefault).toHaveBeenCalledOnce();
      expect(second.preventDefault).toHaveBeenCalledOnce();
      expect(mocks.stop).toHaveBeenCalledOnce();
      expect(mocks.quit).not.toHaveBeenCalled();
      if (failStart === undefined || finishStop === undefined)
        throw new Error('No lifetime waiter');
      failStart(new Error('Owner canceled startup'));
      finishStop();
      await vi.waitFor(() => expect(mocks.quit).toHaveBeenCalledOnce());
      expect(mocks.showError).not.toHaveBeenCalled();
      const completed = { preventDefault: vi.fn() };
      app.emit('before-quit', completed);
      expect(completed.preventDefault).not.toHaveBeenCalled();
    } finally {
      app.removeAllListeners();
      finishStop?.();
      failStart?.(new Error('Test completed'));
    }
  });
});
