import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DesktopApplication } from '../src/main/application.js';
import { startDaemon, type ManagedDaemon } from '../src/main/daemon.js';

const window = vi.hoisted(() => ({
  create: vi.fn(),
  once: vi.fn<(event: string, listener: () => void) => void>(),
  loadURL: vi.fn<(url: string) => Promise<void>>(),
  isDestroyed: vi.fn<() => boolean>(),
  destroy: vi.fn<() => void>(),
  show: vi.fn<() => void>(),
  focus: vi.fn<() => void>(),
}));

vi.mock('electron', () => ({ app: { isPackaged: true } }));
vi.mock('../src/main/daemon.js', () => ({ startDaemon: vi.fn() }));
vi.mock('../src/main/window.js', () => ({ createMainWindow: window.create }));

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: Error): void;
}

function deferred<T>(): Deferred<T> {
  let resolve: ((value: T) => void) | undefined;
  let reject: ((error: Error) => void) | undefined;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return {
    promise,
    resolve(value: T): void {
      if (resolve === undefined) throw new Error('No promise resolver');
      resolve(value);
    },
    reject(error: Error): void {
      if (reject === undefined) throw new Error('No promise rejection');
      reject(error);
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  window.create.mockReturnValue(window);
  window.isDestroyed.mockReturnValue(false);
  window.destroy.mockImplementation(() => window.isDestroyed.mockReturnValue(true));
});

describe('desktop application lifetime', () => {
  it('prevents a later startup once desktop shutdown has begun', async () => {
    const application = new DesktopApplication();
    await application.stop();
    await expect(application.start()).rejects.toThrow('桌面正在退出');
    expect(startDaemon).not.toHaveBeenCalled();
    expect(window.create).not.toHaveBeenCalled();
  });

  it('waits for pending startup and child cleanup before repeated stop callers complete', async () => {
    const startup = deferred<ManagedDaemon>();
    const cleanup = deferred<void>();
    const stopDaemon = vi.fn<() => Promise<void>>(() => cleanup.promise);
    vi.mocked(startDaemon).mockReturnValue(startup.promise);
    const application = new DesktopApplication();
    const rejected = expect(application.start()).rejects.toThrow('桌面正在退出');
    let stopped = false;
    const first = application.stop().then(() => {
      stopped = true;
    });
    const second = application.stop();
    expect(vi.mocked(startDaemon).mock.calls[0]?.[0]?.signal?.aborted).toBe(true);
    startup.resolve({ origin: 'http://127.0.0.1:1234', stop: stopDaemon });
    await vi.waitFor(() => expect(stopDaemon).toHaveBeenCalledOnce());
    expect(stopped).toBe(false);
    cleanup.resolve();
    await Promise.all([first, second, rejected]);
    expect(stopped).toBe(true);
    expect(window.create).not.toHaveBeenCalled();
    expect(stopDaemon).toHaveBeenCalledOnce();
  });

  it('destroys pending navigation and reclaims its ready child on shutdown', async () => {
    const navigation = deferred<void>();
    const stopDaemon = vi.fn<() => Promise<void>>().mockResolvedValue();
    vi.mocked(startDaemon).mockResolvedValue({ origin: 'http://127.0.0.1:1234', stop: stopDaemon });
    window.loadURL.mockReturnValue(navigation.promise);
    window.destroy.mockImplementation(() => {
      window.isDestroyed.mockReturnValue(true);
      navigation.reject(new Error('Navigation canceled'));
    });
    const application = new DesktopApplication();
    const rejected = expect(application.start()).rejects.toThrow('Navigation canceled');
    await vi.waitFor(() => expect(window.loadURL).toHaveBeenCalledOnce());
    await application.stop();
    await rejected;
    application.show();
    expect(window.destroy).toHaveBeenCalledOnce();
    expect(stopDaemon).toHaveBeenCalledOnce();
    expect(window.show).not.toHaveBeenCalled();
  });
});
