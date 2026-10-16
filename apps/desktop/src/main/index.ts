import { app, dialog } from 'electron';
import { DesktopApplication } from './application.js';
import type { QuitState } from './types.js';

const application = new DesktopApplication();
let quitState: QuitState = 'running';

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => application.show());
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', (event) => {
    if (quitState === 'stopped') return;
    event.preventDefault();
    if (quitState === 'stopping') return;
    quitState = 'stopping';
    void application
      .stop()
      .catch((error: unknown) => {
        process.stderr.write(
          `本机服务关闭失败：${error instanceof Error ? error.message : '未知错误'}\n`,
        );
      })
      .finally(() => {
        quitState = 'stopped';
        app.quit();
      });
  });
  void app
    .whenReady()
    .then(() => application.start())
    .catch((error: unknown) => {
      if (quitState !== 'running') return;
      dialog.showErrorBox('启动失败', error instanceof Error ? error.message : '无法启动本机服务');
      app.quit();
    });
}
