import { fileURLToPath } from 'node:url';
import { BrowserWindow } from 'electron';
import { secureWindow } from './security.js';

/**
 * Create the isolated application window without loading its page.
 * @param rendererUrl Validated local Web URL used for navigation and bridge authorization.
 * @returns An owned window ready for loadURL.
 */
export function createMainWindow(
  rendererUrl: string,
  openAuth?: (flowId: string) => Promise<void>,
  revealSkill?: (skillId: string, workspaceId: string | null) => Promise<void>,
): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 940,
    minHeight: 680,
    title: 'My Pi Harness',
    show: false,
    webPreferences: {
      preload: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
    },
  });
  secureWindow(window, new URL(rendererUrl).origin, openAuth, revealSkill);
  window.once('ready-to-show', () => {
    if (!window.isDestroyed()) window.show();
  });
  return window;
}
