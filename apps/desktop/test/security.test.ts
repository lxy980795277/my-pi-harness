import { APP_VERSION, type DesktopInfo } from '@my-pi-harness/protocol';
import { BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { secureWindow } from '../src/main/security.js';

type InfoHandler = (event: IpcMainInvokeEvent, ...arguments_: unknown[]) => DesktopInfo;
type PermissionRequest = (
  contents: unknown,
  permission: string,
  callback: (allowed: boolean) => void,
) => void;

const mocks = vi.hoisted(() => ({
  handle: vi.fn<(channel: string, listener: InfoHandler) => void>(),
  removeHandler: vi.fn<(channel: string) => void>(),
  windowOpen: vi.fn<(handler: () => { action: string }) => void>(),
  checkPermission: vi.fn<(handler: (() => boolean) | null) => void>(),
  requestPermission: vi.fn<(handler: PermissionRequest | null) => void>(),
  frames: [] as { url: string }[],
}));

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  class TestWindow extends EventEmitter {
    public readonly webContents;

    public constructor() {
      super();
      const frame = { url: 'http://127.0.0.1:1234/' };
      mocks.frames.push(frame);
      this.webContents = Object.assign(new EventEmitter(), {
        mainFrame: frame,
        session: {
          setPermissionCheckHandler: mocks.checkPermission,
          setPermissionRequestHandler: mocks.requestPermission,
        },
        setWindowOpenHandler: mocks.windowOpen,
      });
    }
  }
  return {
    BrowserWindow: TestWindow,
    ipcMain: { handle: mocks.handle, removeHandler: mocks.removeHandler },
  };
});

function invokeEvent(window: BrowserWindow): IpcMainInvokeEvent {
  return {
    type: 'frame',
    frameId: 1,
    processId: 1,
    sender: window.webContents,
    senderFrame: window.webContents.mainFrame,
    preventDefault: vi.fn(),
    defaultPrevented: false,
  };
}

function infoHandler(): InfoHandler {
  const registration = mocks.handle.mock.calls.at(-1);
  if (registration === undefined) throw new Error('Desktop bridge was not registered');
  return registration[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.frames.splice(0);
});

describe('desktop window security', () => {
  it.each(['will-frame-navigate', 'will-redirect'])(
    'blocks foreign and invalid %s targets',
    (name) => {
      const window = new BrowserWindow({});
      secureWindow(window, 'http://127.0.0.1:1234');
      for (const url of [
        'https://example.com/',
        'http://127.0.0.1:1234@example.com/',
        'blob:http://127.0.0.1:1234/application',
        'javascript:alert(1)',
        'invalid URL',
      ]) {
        const event = { url, preventDefault: vi.fn() };
        window.webContents.emit(name, event);
        expect(event.preventDefault).toHaveBeenCalledOnce();
      }
      const allowed = { url: 'http://127.0.0.1:1234/settings', preventDefault: vi.fn() };
      window.webContents.emit(name, allowed);
      expect(allowed.preventDefault).not.toHaveBeenCalled();
    },
  );

  it('denies new windows and permissions that M0 does not implement', () => {
    const window = new BrowserWindow({});
    secureWindow(window, 'http://127.0.0.1:1234');
    const open = mocks.windowOpen.mock.calls.at(-1)?.[0];
    const check = mocks.checkPermission.mock.calls.at(-1)?.[0];
    const request = mocks.requestPermission.mock.calls.at(-1)?.[0];
    if (open === undefined || check == null || request == null)
      throw new Error('Missing security policy');
    expect(open()).toEqual({ action: 'deny' });
    expect(check()).toBe(false);
    const callback = vi.fn<(allowed: boolean) => void>();
    request(window.webContents, 'media', callback);
    expect(callback).toHaveBeenCalledWith(false);
  });

  it('only serves metadata to its main frame without request arguments', () => {
    const window = new BrowserWindow({});
    secureWindow(window, 'http://127.0.0.1:1234');
    const handler = infoHandler();
    const event = invokeEvent(window);
    expect(handler(event)).toEqual({ appVersion: APP_VERSION, platform: process.platform });
    expect(() => handler(event, { path: '/tmp' })).toThrow('桌面请求参数无效');
    const other = new BrowserWindow({});
    expect(() => handler(invokeEvent(other))).toThrow('桌面请求来源无效');
    expect(() => handler({ ...event, senderFrame: other.webContents.mainFrame })).toThrow(
      '桌面请求来源无效',
    );
    expect(() => handler({ ...event, senderFrame: null })).toThrow('桌面请求来源无效');
    const frame = mocks.frames[0];
    if (frame === undefined) throw new Error('No main frame');
    frame.url = 'https://example.com/';
    expect(() => handler(event)).toThrow('桌面请求来源无效');
    frame.url = 'discarded frame URL';
    expect(() => handler(event)).toThrow('桌面请求来源无效');
  });

  it('removes its IPC handler when its window closes', () => {
    const window = new BrowserWindow({});
    secureWindow(window, 'http://127.0.0.1:1234');
    window.emit('closed');
    expect(mocks.removeHandler).toHaveBeenCalledExactlyOnceWith('desktop:get-info');
  });
});
