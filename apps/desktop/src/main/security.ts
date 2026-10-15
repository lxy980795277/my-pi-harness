import { APP_VERSION, DesktopInfoSchema, type DesktopInfo } from '@my-pi-harness/protocol';
import type { BrowserWindow } from 'electron';
import { dialog, ipcMain } from 'electron';
import { Value } from 'typebox/value';
import { resolveWorkspaceDirectory } from './workspace-directory.js';

function isTrustedUrl(value: string, origin: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && url.origin === origin;
  } catch {
    // Electron URLs can describe a discarded frame or an invalid navigation target.
    return false;
  }
}

/**
 * Restrict navigation, permissions and the desktop bridge to this window's local main frame.
 * @param window The only window allowed to use the desktop bridge.
 * @param origin The validated local Web origin used by this window.
 */
export function secureWindow(
  window: BrowserWindow,
  origin: string,
  openAuth?: (flowId: string) => Promise<void>,
): void {
  const contents = window.webContents;
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.session.setPermissionCheckHandler(() => false);
  contents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  contents.on('will-frame-navigate', (event) => {
    if (!isTrustedUrl(event.url, origin)) event.preventDefault();
  });
  contents.on('will-redirect', (event) => {
    if (!isTrustedUrl(event.url, origin)) event.preventDefault();
  });
  ipcMain.handle(
    'desktop:choose-workspace-directory',
    async (event, ...arguments_: unknown[]): Promise<string | null> => {
      const frame = event.senderFrame;
      if (
        arguments_.length !== 0 ||
        event.sender !== contents ||
        frame !== contents.mainFrame ||
        !isTrustedUrl(frame.url, origin)
      )
        throw new Error('桌面请求来源无效');
      const result = await dialog.showOpenDialog(window, {
        title: '选择工作区',
        properties: ['openDirectory'],
      });
      if (result.canceled) return null;
      if (result.filePaths.length !== 1) throw new Error('请选择一个本机文件夹');
      return await resolveWorkspaceDirectory(result.filePaths[0]);
    },
  );
  ipcMain.handle(
    'desktop:get-dropped-workspace-directory',
    async (event, ...arguments_: unknown[]): Promise<string> => {
      const frame = event.senderFrame;
      if (
        event.sender !== contents ||
        frame !== contents.mainFrame ||
        !isTrustedUrl(frame.url, origin)
      )
        throw new Error('桌面请求来源无效');
      if (arguments_.length !== 1) throw new Error('请选择一个本机文件夹');
      return await resolveWorkspaceDirectory(arguments_[0]);
    },
  );
  ipcMain.handle('desktop:get-info', (event, ...arguments_: unknown[]): DesktopInfo => {
    if (arguments_.length !== 0) throw new Error('桌面请求参数无效');
    const frame = event.senderFrame;
    if (
      event.sender !== contents ||
      frame !== contents.mainFrame ||
      !isTrustedUrl(frame.url, origin)
    ) {
      throw new Error('桌面请求来源无效');
    }
    const info = { appVersion: APP_VERSION, platform: process.platform };
    if (!Value.Check(DesktopInfoSchema, info)) throw new Error('当前平台尚未支持');
    return info;
  });
  if (openAuth) {
    ipcMain.handle('desktop:open-auth', async (event, ...arguments_: unknown[]): Promise<void> => {
      const frame = event.senderFrame;
      if (
        event.sender !== contents ||
        frame !== contents.mainFrame ||
        !isTrustedUrl(frame.url, origin)
      )
        throw new Error('桌面请求来源无效');
      const id = arguments_[0];
      if (arguments_.length !== 1 || typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(id))
        throw new Error('认证流程参数无效');
      await openAuth(id);
    });
  }
  window.once('closed', () => {
    ipcMain.removeHandler('desktop:get-info');
    ipcMain.removeHandler('desktop:choose-workspace-directory');
    ipcMain.removeHandler('desktop:get-dropped-workspace-directory');
    if (openAuth) ipcMain.removeHandler('desktop:open-auth');
  });
}
