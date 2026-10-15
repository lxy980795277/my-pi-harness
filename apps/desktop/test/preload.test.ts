import type { DesktopBridge } from '@my-pi-harness/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  expose: vi.fn<(name: string, bridge: DesktopBridge) => void>(),
  invoke: vi.fn<(channel: string, ...arguments_: unknown[]) => Promise<unknown>>(),
  pathForFile: vi.fn<(file: File) => string>(),
}));

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: mocks.expose },
  ipcRenderer: { invoke: mocks.invoke },
  webUtils: { getPathForFile: mocks.pathForFile },
}));

async function desktopBridge(): Promise<DesktopBridge> {
  await import('../src/preload/index.js');
  const bridge = mocks.expose.mock.calls.at(-1)?.[1];
  if (!bridge) throw new Error('Desktop bridge was not exposed');
  return bridge;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe('workspace drop preload bridge', () => {
  it('extracts the native File path before invoking its fixed directory handler', async () => {
    const bridge = await desktopBridge();
    const file = new File([], '工作区');
    mocks.pathForFile.mockReturnValue('/tmp/工作区');
    mocks.invoke.mockResolvedValue('/private/tmp/工作区');
    expect(await bridge.getDroppedWorkspaceDirectory(file)).toBe('/private/tmp/工作区');
    expect(mocks.pathForFile).toHaveBeenCalledWith(file);
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
      'desktop:get-dropped-workspace-directory',
      '/tmp/工作区',
    );
    expect(Object.isFrozen(bridge)).toBe(true);
  });

  it('rejects native File validation failures and synthetic or malformed paths without IPC', async () => {
    const bridge = await desktopBridge();
    const file = new File([], 'synthetic');
    mocks.pathForFile.mockImplementationOnce(() => {
      throw new TypeError('native File object required');
    });
    await expect(bridge.getDroppedWorkspaceDirectory(file)).rejects.toThrow('请拖入本机文件夹');
    for (const path of ['', '/tmp/invalid\0', 'a'.repeat(4097)]) {
      mocks.pathForFile.mockReturnValueOnce(path);
      await expect(bridge.getDroppedWorkspaceDirectory(file)).rejects.toThrow('请拖入本机文件夹');
    }
    for (const value of [null, {}, '/tmp/workspace'])
      await expect(bridge.getDroppedWorkspaceDirectory(value)).rejects.toThrow('请拖入本机文件夹');
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('rejects invalid main responses and preserves a main directory rejection', async () => {
    const bridge = await desktopBridge();
    const file = new File([], 'workspace');
    mocks.pathForFile.mockReturnValue('/tmp/workspace');
    for (const response of [null, '', {}, 'a'.repeat(4097)]) {
      mocks.invoke.mockResolvedValueOnce(response);
      await expect(bridge.getDroppedWorkspaceDirectory(file)).rejects.toThrow('工作区目录响应无效');
    }
    mocks.invoke.mockRejectedValueOnce(new Error('请选择文件夹，不能选择文件'));
    await expect(bridge.getDroppedWorkspaceDirectory(file)).rejects.toThrow(
      '请选择文件夹，不能选择文件',
    );
  });
});
