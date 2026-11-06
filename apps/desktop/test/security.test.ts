import { APP_VERSION } from '@my-pi-harness/protocol';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BrowserWindow,
  type IpcMainInvokeEvent,
  type PermissionRequest,
  type Session,
} from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { secureWindow } from '../src/main/security';

type InfoHandler = (event: IpcMainInvokeEvent, ...arguments_: unknown[]) => unknown;
type PermissionCheckHandler = NonNullable<Parameters<Session['setPermissionCheckHandler']>[0]>;
type PermissionRequestHandler = NonNullable<Parameters<Session['setPermissionRequestHandler']>[0]>;

const mocks = vi.hoisted(() => ({
  handle: vi.fn<(channel: string, listener: InfoHandler) => void>(),
  removeHandler: vi.fn<(channel: string) => void>(),
  windowOpen: vi.fn<(handler: () => { action: string }) => void>(),
  checkPermission: vi.fn<(handler: PermissionCheckHandler | null) => void>(),
  requestPermission: vi.fn<(handler: PermissionRequestHandler | null) => void>(),
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
        isDestroyed: vi.fn(() => false),
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

function permissionHandlers(): {
  check: PermissionCheckHandler;
  request: PermissionRequestHandler;
} {
  const check = mocks.checkPermission.mock.calls.at(-1)?.[0];
  const request = mocks.requestPermission.mock.calls.at(-1)?.[0];
  if (check == null || request == null) throw new Error('Missing permission policy');
  return { check, request };
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

  it('denies new windows, clipboard reads and unrelated permissions', () => {
    const window = new BrowserWindow({});
    secureWindow(window, 'http://127.0.0.1:1234');
    const open = mocks.windowOpen.mock.calls.at(-1)?.[0];
    if (open === undefined) throw new Error('Missing window policy');
    const { check, request } = permissionHandlers();
    const origin = 'http://127.0.0.1:1234';
    const details = { isMainFrame: true, requestingUrl: `${origin}/` };
    expect(open()).toEqual({ action: 'deny' });
    for (const permission of ['clipboard-read', 'media', 'geolocation'] as const) {
      expect(check(window.webContents, permission, origin, details)).toBe(false);
      const callback = vi.fn<(allowed: boolean) => void>();
      request(window.webContents, permission, callback, details);
      expect(callback).toHaveBeenCalledExactlyOnceWith(false);
    }
    expect(check(window.webContents, 'deprecated-sync-clipboard-read', origin, details)).toBe(
      false,
    );
  });

  it('allows clipboard writes from its trusted main frame in both permission handlers', () => {
    const window = new BrowserWindow({});
    const origin = 'http://127.0.0.1:1234';
    secureWindow(window, origin);
    const { check, request } = permissionHandlers();
    const details = { isMainFrame: true, requestingUrl: `${origin}/sessions/accepted` };
    for (const requestingOrigin of [origin, `${origin}/`]) {
      expect(
        check(window.webContents, 'clipboard-sanitized-write', requestingOrigin, details),
      ).toBe(true);
    }
    const callback = vi.fn<(allowed: boolean) => void>();
    request(window.webContents, 'clipboard-sanitized-write', callback, details);
    expect(callback).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('denies clipboard writes from other windows, subframes and non-document checks', () => {
    const window = new BrowserWindow({});
    const other = new BrowserWindow({});
    const origin = 'http://127.0.0.1:1234';
    secureWindow(window, origin);
    const { check, request } = permissionHandlers();
    const details = { isMainFrame: true, requestingUrl: `${origin}/` };
    const subframe = { ...details, isMainFrame: false };
    expect(check(other.webContents, 'clipboard-sanitized-write', origin, details)).toBe(false);
    expect(check(window.webContents, 'clipboard-sanitized-write', origin, subframe)).toBe(false);
    expect(check(null, 'clipboard-sanitized-write', origin, { isMainFrame: false })).toBe(false);
    expect(
      check(window.webContents, 'clipboard-sanitized-write', origin, { isMainFrame: true }),
    ).toBe(false);
    for (const [requester, requestDetails] of [
      [other.webContents, details],
      [window.webContents, subframe],
    ] as const) {
      const callback = vi.fn<(allowed: boolean) => void>();
      request(requester, 'clipboard-sanitized-write', callback, requestDetails);
      expect(callback).toHaveBeenCalledExactlyOnceWith(false);
    }
  });

  it('denies clipboard writes when the requesting URL or check origin is untrusted', () => {
    const window = new BrowserWindow({});
    const origin = 'http://127.0.0.1:1234';
    secureWindow(window, origin);
    const { check, request } = permissionHandlers();
    for (const requestingUrl of [
      'https://example.com/',
      'http://127.0.0.1:12345/',
      'http://localhost:1234/',
      'https://127.0.0.1:1234/',
      'http://127.0.0.1:1234@example.com/',
      'blob:http://127.0.0.1:1234/document',
      'discarded frame URL',
    ]) {
      const details: PermissionRequest = { isMainFrame: true, requestingUrl };
      expect(check(window.webContents, 'clipboard-sanitized-write', origin, details)).toBe(false);
      expect(
        check(window.webContents, 'clipboard-sanitized-write', requestingUrl, {
          isMainFrame: true,
          requestingUrl: `${origin}/`,
        }),
      ).toBe(false);
      const callback = vi.fn<(allowed: boolean) => void>();
      request(window.webContents, 'clipboard-sanitized-write', callback, details);
      expect(callback).toHaveBeenCalledExactlyOnceWith(false);
    }
  });

  it('denies clipboard writes after its main frame navigates away or is destroyed', () => {
    const window = new BrowserWindow({});
    const origin = 'http://127.0.0.1:1234';
    secureWindow(window, origin);
    const { check, request } = permissionHandlers();
    const details = { isMainFrame: true, requestingUrl: `${origin}/` };
    const frame = mocks.frames[0];
    if (!frame) throw new Error('Missing main frame');
    frame.url = 'https://example.com/';
    expect(check(window.webContents, 'clipboard-sanitized-write', origin, details)).toBe(false);
    const navigated = vi.fn<(allowed: boolean) => void>();
    request(window.webContents, 'clipboard-sanitized-write', navigated, details);
    expect(navigated).toHaveBeenCalledExactlyOnceWith(false);
    frame.url = `${origin}/`;
    vi.spyOn(window.webContents, 'isDestroyed').mockReturnValue(true);
    expect(check(window.webContents, 'clipboard-sanitized-write', origin, details)).toBe(false);
    const destroyed = vi.fn<(allowed: boolean) => void>();
    request(window.webContents, 'clipboard-sanitized-write', destroyed, details);
    expect(destroyed).toHaveBeenCalledExactlyOnceWith(false);
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

it('restricts Skill reveal to the owned main frame and two bounded identity arguments', async () => {
  const window = new BrowserWindow({});
  const reveal = vi
    .fn<(id: string, workspaceId: string | null) => Promise<void>>()
    .mockResolvedValue();
  secureWindow(window, 'http://127.0.0.1:1234', undefined, reveal);
  const handler = mocks.handle.mock.calls.find(
    ([channel]) => channel === 'desktop:reveal-skill-directory',
  )?.[1];
  if (!handler) throw new Error('Missing Skill reveal handler');
  await handler(invokeEvent(window), 'registered', null);
  expect(reveal).toHaveBeenCalledExactlyOnceWith('registered', null);
  const other = new BrowserWindow({});
  await expect(handler(invokeEvent(other), 'registered', null)).rejects.toThrow('桌面请求来源无效');
  for (const args of [[], [''], ['registered', {}], ['registered', null, '/tmp']])
    await expect(handler(invokeEvent(window), ...args)).rejects.toThrow('Skill目录请求参数无效');
  window.emit('closed');
  expect(mocks.removeHandler).toHaveBeenCalledWith('desktop:reveal-skill-directory');
  expect(reveal).toHaveBeenCalledTimes(1);
});
