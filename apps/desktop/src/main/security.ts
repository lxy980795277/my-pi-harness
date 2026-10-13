import { APP_VERSION, DesktopInfoSchema, type DesktopInfo } from '@my-pi-harness/protocol';
import type { BrowserWindow } from 'electron';
import { ipcMain } from 'electron';
import { Value } from 'typebox/value';

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
export function secureWindow(window: BrowserWindow, origin: string): void {
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
  window.once('closed', () => ipcMain.removeHandler('desktop:get-info'));
}
