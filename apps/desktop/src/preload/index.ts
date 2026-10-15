import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { DesktopInfoSchema, type DesktopBridge, type DesktopInfo } from '@my-pi-harness/protocol';
import { Value } from 'typebox/value';

const bridge: DesktopBridge = {
  async getDroppedWorkspaceDirectory(file: unknown): Promise<string> {
    if (!(file instanceof File)) throw new Error('请拖入本机文件夹');
    let path: string;
    try {
      path = webUtils.getPathForFile(file);
    } catch {
      // The native File check rejects values that are not browser-owned File objects.
      throw new Error('请拖入本机文件夹');
    }
    if (path.length === 0 || path.length > 4096 || path.includes('\0'))
      throw new Error('请拖入本机文件夹');
    const result: unknown = await ipcRenderer.invoke(
      'desktop:get-dropped-workspace-directory',
      path,
    );
    if (typeof result === 'string' && result.length > 0 && result.length <= 4096) return result;
    throw new Error('工作区目录响应无效');
  },
  async chooseWorkspaceDirectory(): Promise<string | null> {
    const result: unknown = await ipcRenderer.invoke('desktop:choose-workspace-directory');
    if (
      result === null ||
      (typeof result === 'string' && result.length > 0 && result.length <= 4096)
    )
      return result;
    throw new Error('工作区目录响应无效');
  },
  async openAuth(flowId: string): Promise<void> {
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(flowId)) throw new Error('认证流程参数无效');
    await ipcRenderer.invoke('desktop:open-auth', flowId);
  },
  async getInfo(): Promise<DesktopInfo> {
    const result: unknown = await ipcRenderer.invoke('desktop:get-info');
    if (!Value.Check(DesktopInfoSchema, result)) throw new Error('桌面信息无效');
    return result;
  },
};
contextBridge.exposeInMainWorld('desktop', Object.freeze(bridge));
