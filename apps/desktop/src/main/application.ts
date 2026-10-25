import { app, type BrowserWindow } from 'electron';
import { startDaemon, type ManagedDaemon } from './daemon.js';
import { resolveRendererUrl, waitForRenderer } from './renderer.js';
import { createMainWindow } from './window.js';

/** Owns startup, the application window and daemon cleanup through desktop shutdown. */
export class DesktopApplication {
  private readonly lifetime = new AbortController();
  private daemon: ManagedDaemon | undefined;
  private window: BrowserWindow | undefined;
  private starting: Promise<void> | undefined;
  private stopping: Promise<void> | undefined;

  /** Start once and reclaim any completed resources when startup fails. */
  public start(): Promise<void> {
    this.starting ??= this.launch().catch(async (error: unknown) => {
      this.destroyWindow();
      await this.stopDaemon();
      throw error;
    });
    return this.starting;
  }

  /** Reveal the existing window when another desktop instance requests focus. */
  public show(): void {
    const window = this.window;
    if (window === undefined || window.isDestroyed()) return;
    window.show();
    window.focus();
  }

  /** Cancel pending startup and await the same cleanup for every quit request. */
  public stop(): Promise<void> {
    this.stopping ??= (async () => {
      this.lifetime.abort(new Error('桌面正在退出'));
      try {
        await this.starting;
      } catch {
        // start() reports its own startup failure after reclaiming completed resources.
      }
      this.destroyWindow();
      await this.stopDaemon();
    })();
    return this.stopping;
  }

  private destroyWindow(): void {
    const window = this.window;
    this.window = undefined;
    if (window !== undefined && !window.isDestroyed()) window.destroy();
  }

  private async stopDaemon(): Promise<void> {
    const daemon = this.daemon;
    this.daemon = undefined;
    await daemon?.stop();
  }

  private async launch(): Promise<void> {
    const signal = this.lifetime.signal;
    signal.throwIfAborted();
    const developmentRenderer = app.isPackaged
      ? undefined
      : resolveRendererUrl(process.env['MY_PI_HARNESS_RENDERER_URL'] ?? 'http://127.0.0.1:5174');
    this.daemon = await startDaemon({ signal });
    signal.throwIfAborted();
    const renderer = developmentRenderer ?? resolveRendererUrl(this.daemon.origin);
    if (!app.isPackaged) await waitForRenderer(renderer, signal);
    signal.throwIfAborted();
    await this.daemon.authorizeRenderer(new URL(renderer).origin);
    signal.throwIfAborted();
    const daemon = this.daemon;
    const window = createMainWindow(
      renderer,
      (flowId) => daemon.openAuth(flowId),
      (skillId, workspaceId) => daemon.revealSkillDirectory(skillId, workspaceId),
    );
    this.window = window;
    window.once('closed', () => {
      if (this.window === window) this.window = undefined;
    });
    const cancelNavigation = (): void => {
      if (!window.isDestroyed()) window.destroy();
    };
    signal.addEventListener('abort', cancelNavigation, { once: true });
    try {
      await window.loadURL(renderer);
      signal.throwIfAborted();
    } finally {
      signal.removeEventListener('abort', cancelNavigation);
    }
  }
}
