import { APP_VERSION } from '@my-pi-harness/protocol';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { secureWindow } from '../src/main/security.js';

type InfoHandler = (event: IpcMainInvokeEvent, ...arguments_: unknown[]) => unknown;
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
  chooseDirectory: vi.fn<() => Promise<{ canceled: boolean; filePaths: string[] }>>(),
  openExternal: vi.fn<(url: string) => Promise<void>>(),
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
    dialog: { showOpenDialog: mocks.chooseDirectory },
    shell: { openExternal: mocks.openExternal },
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
  it('opens only explicit HTTP links from its own main frame', async () => {
    const window = new BrowserWindow({});
    secureWindow(window, 'http://127.0.0.1:1234');
    const handler = mocks.handle.mock.calls.find(
      ([channel]) => channel === 'desktop:open-external',
    )?.[1];
    if (!handler) throw new Error('Missing external link handler');
    const event = invokeEvent(window);
    await handler(event, 'https://example.com/guide?q=hello#part');
    expect(mocks.openExternal).toHaveBeenCalledExactlyOnceWith(
      'https://example.com/guide?q=hello#part',
    );
    for (const value of [
      'file:///tmp/private',
      'javascript:alert(1)',
      'data:text/html,test',
      'mailto:user@example.com',
      'https://user:pass@example.com',
      'https://example.com/\n',
      {},
      null,
    ]) {
      await expect(handler(event, value)).rejects.toThrow();
    }
    await expect(handler(event)).rejects.toThrow('链接请求参数无效');
    await expect(handler(event, 'https://example.com', 'extra')).rejects.toThrow(
      '链接请求参数无效',
    );
    const other = new BrowserWindow({});
    await expect(handler(invokeEvent(other), 'https://example.com')).rejects.toThrow(
      '桌面请求来源无效',
    );
    await expect(
      handler({ ...event, senderFrame: other.webContents.mainFrame }, 'https://example.com'),
    ).rejects.toThrow('桌面请求来源无效');
    await expect(handler({ ...event, senderFrame: null }, 'https://example.com')).rejects.toThrow(
      '桌面请求来源无效',
    );
    const frame = mocks.frames[0];
    if (!frame) throw new Error('No main frame');
    frame.url = 'https://example.com/';
    await expect(handler(event, 'https://example.com')).rejects.toThrow('桌面请求来源无效');
    expect(mocks.openExternal).toHaveBeenCalledTimes(1);
  });

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

  it('only opens the workspace directory picker for the owned main frame', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'my-pi-picker-'));
    try {
      const window = new BrowserWindow({});
      secureWindow(window, 'http://127.0.0.1:1234');
      const handler = mocks.handle.mock.calls.find(
        ([channel]) => channel === 'desktop:choose-workspace-directory',
      )?.[1];
      if (!handler) throw new Error('Missing workspace picker');
      const event = invokeEvent(window);
      mocks.chooseDirectory.mockResolvedValueOnce({ canceled: false, filePaths: [directory] });
      expect(await handler(event)).toBe(await realpath(directory));
      mocks.chooseDirectory.mockResolvedValueOnce({ canceled: true, filePaths: [] });
      expect(await handler(event)).toBeNull();
      mocks.chooseDirectory.mockResolvedValueOnce({ canceled: false, filePaths: [] });
      await expect(handler(event)).rejects.toThrow('请选择一个本机文件夹');
      mocks.chooseDirectory.mockResolvedValueOnce({
        canceled: false,
        filePaths: [directory, directory],
      });
      await expect(handler(event)).rejects.toThrow('请选择一个本机文件夹');
      const file = join(directory, 'regular.txt');
      await writeFile(file, 'not a directory');
      mocks.chooseDirectory.mockResolvedValueOnce({ canceled: false, filePaths: [file] });
      await expect(handler(event)).rejects.toThrow('请选择文件夹，不能选择文件');
      const other = new BrowserWindow({});
      await expect(handler(invokeEvent(other))).rejects.toThrow('桌面请求来源无效');
      await expect(handler(event, '/private')).rejects.toThrow('桌面请求来源无效');
      expect(mocks.chooseDirectory).toHaveBeenCalledTimes(5);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('only resolves one existing dropped directory for its owned main frame', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'my-pi-drop-'));
    try {
      const window = new BrowserWindow({});
      secureWindow(window, 'http://127.0.0.1:1234');
      const handler = mocks.handle.mock.calls.find(
        ([channel]) => channel === 'desktop:get-dropped-workspace-directory',
      )?.[1];
      if (!handler) throw new Error('Missing workspace drop handler');
      const event = invokeEvent(window);
      expect(await handler(event, directory)).toBe(await realpath(directory));
      const target = join(directory, '工作区');
      const alias = join(directory, 'alias');
      await mkdir(target);
      await symlink(target, alias, 'junction');
      expect(await handler(event, alias)).toBe(await realpath(target));
      const other = new BrowserWindow({});
      await expect(handler(invokeEvent(other), directory)).rejects.toThrow('桌面请求来源无效');
      await expect(
        handler({ ...event, senderFrame: other.webContents.mainFrame }, directory),
      ).rejects.toThrow('桌面请求来源无效');
      await expect(handler({ ...event, senderFrame: null }, directory)).rejects.toThrow(
        '桌面请求来源无效',
      );
      const frame = mocks.frames[0];
      if (!frame) throw new Error('No main frame');
      frame.url = 'https://example.com/';
      await expect(handler(event, directory)).rejects.toThrow('桌面请求来源无效');
      frame.url = 'http://127.0.0.1:1234/';
      await expect(handler(event)).rejects.toThrow('请选择一个本机文件夹');
      await expect(handler(event, directory, directory)).rejects.toThrow('请选择一个本机文件夹');
      for (const path of [null, {}, '', 'relative/path', `${directory}\0`, 'a'.repeat(4097)])
        await expect(handler(event, path)).rejects.toThrow('请选择有效的本机文件夹');
      await expect(handler(event, join(directory, 'missing'))).rejects.toThrow(
        '请选择有效的本机文件夹',
      );
      const file = join(directory, 'regular.txt');
      await writeFile(file, 'not a directory');
      await expect(handler(event, file)).rejects.toThrow('请选择文件夹，不能选择文件');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('removes its IPC handler when its window closes', () => {
    const window = new BrowserWindow({});
    secureWindow(window, 'http://127.0.0.1:1234');
    window.emit('closed');
    expect(mocks.removeHandler).toHaveBeenCalledWith('desktop:get-info');
    expect(mocks.removeHandler).toHaveBeenCalledWith('desktop:choose-workspace-directory');
    expect(mocks.removeHandler).toHaveBeenCalledWith('desktop:get-dropped-workspace-directory');
    expect(mocks.removeHandler).toHaveBeenCalledWith('desktop:open-external');
    expect(mocks.removeHandler).toHaveBeenCalledTimes(4);
  });
});
