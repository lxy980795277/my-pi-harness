import type { DesktopBridge } from '@my-pi-harness/protocol';

declare global {
  interface Window {
    /** The finite preload bridge exists only in the desktop entry point. */
    desktop?: DesktopBridge;
  }
}
