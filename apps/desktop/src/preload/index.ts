import { contextBridge, ipcRenderer } from 'electron';
import { DesktopInfoSchema, type DesktopBridge, type DesktopInfo } from '@my-pi-harness/protocol';
import { Value } from 'typebox/value';

const bridge: DesktopBridge = {
  async getInfo(): Promise<DesktopInfo> {
    const result: unknown = await ipcRenderer.invoke('desktop:get-info');
    if (!Value.Check(DesktopInfoSchema, result)) throw new Error('桌面信息无效');
    return result;
  },
};
contextBridge.exposeInMainWorld('desktop', Object.freeze(bridge));
