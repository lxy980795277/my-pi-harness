import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { APP_VERSION, WorkspaceSchema, type Workspace } from '@my-pi-harness/protocol';
import type { Page } from '@playwright/test';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { test, expect } from './fixture.js';

interface WorkspaceCreationControls {
  chooseCalls: number;
  dropCalls: number;
  lastDropName: string | null;
  finishChoose: (directory: string | null) => void;
}

declare global {
  interface Window {
    workspaceCreationTest: WorkspaceCreationControls;
  }
}

/** Boundary mocks replace native dialogs only; workspace HTTP and SQLite remain real. */
async function installDesktopChooser(page: Page, directory: string): Promise<void> {
  await page.addInitScript(
    ({ rootPath, appVersion }) => {
      const controls: WorkspaceCreationControls = {
        chooseCalls: 0,
        dropCalls: 0,
        lastDropName: null,
        finishChoose: () => {
          throw new Error('The directory chooser has not opened');
        },
      };
      window.workspaceCreationTest = controls;
      Object.defineProperty(window, 'desktop', {
        value: {
          getInfo: () => Promise.resolve({ appVersion, platform: 'darwin' }),
          openAuth: () => Promise.resolve(),
          chooseWorkspaceDirectory: async (): Promise<string | null> => {
            controls.chooseCalls += 1;
            return await new Promise<string | null>((resolve) => {
              controls.finishChoose = resolve;
            });
          },
          getDroppedWorkspaceDirectory: (file: File): Promise<string> => {
            controls.dropCalls += 1;
            controls.lastDropName = file.name;
            return Promise.resolve(rootPath);
          },
        },
      });
    },
    { rootPath: directory, appVersion: APP_VERSION },
  );
}

async function readOnlyWorkspace(page: Page, origin: string): Promise<Workspace> {
  const response = await page.request.get(`${origin}/api/workspaces`);
  const workspaces: unknown = await response.json();
  if (!response.ok() || !Value.Check(Type.Array(WorkspaceSchema), workspaces))
    throw new Error('Invalid workspace response');
  expect(workspaces).toHaveLength(1);
  const workspace = workspaces[0];
  if (!workspace) throw new Error('The workspace was not persisted');
  return workspace;
}

async function dropFiles(page: Page, names: string[]): Promise<void> {
  const transfer = await page.evaluateHandle((fileNames) => {
    const data = new DataTransfer();
    for (const name of fileNames) data.items.add(new File([], name));
    return data;
  }, names);
  try {
    const dropzone = page.getByTestId('workspace-directory-dropzone');
    await dropzone.dispatchEvent('dragenter', { dataTransfer: transfer });
    await dropzone.dispatchEvent('dragover', { dataTransfer: transfer });
    await dropzone.dispatchEvent('drop', { dataTransfer: transfer });
  } finally {
    await transfer.dispose();
  }
}

test('工作区选择取消、图标编辑和刷新持久化，保存中禁止重复请求', async ({
  page,
  daemon,
}, testInfo) => {
  const directory = await mkdtemp(join(tmpdir(), 'my-pi-workspace-create-ui-'));
  let releaseSave = (): void => {
    throw new Error('The workspace write gate has not initialized');
  };
  const saveGate = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  let creates = 0;
  try {
    await page.setViewportSize({ width: 900, height: 700 });
    await installDesktopChooser(page, directory);
    await page.goto(daemon.origin);
    await page.getByRole('button', { name: '添加工作区', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '添加工作区', exact: true });
    const chooser = dialog.getByRole('button', { name: '选择工作区文件夹', exact: true });
    const save = dialog.getByRole('button', { name: '保存工作区', exact: true });
    const iconTrigger = dialog.getByRole('button', { name: '选择工作区图标', exact: true });
    const nameInput = dialog.getByLabel('工作区名称', { exact: true });
    const nameGroup = nameInput.locator('..');
    await expect(iconTrigger).toBeFocused();
    await expect(nameGroup).toHaveCSS('box-shadow', 'none');
    await nameInput.focus();
    await expect(nameInput).toBeFocused();
    await expect(nameGroup).not.toHaveCSS('box-shadow', 'none');
    await iconTrigger.focus();
    await expect(nameGroup).toHaveCSS('box-shadow', 'none');
    await expect(dialog.getByRole('textbox')).toHaveCount(1);
    await expect(dialog.getByLabel('文件夹路径', { exact: true })).toHaveCount(0);
    await expect(dialog).not.toContainText('将已有文件夹作为 Agent 的工作范围');
    await expect(save).toBeDisabled();
    const dropzone = page.getByTestId('workspace-directory-dropzone');
    await expect(chooser).toHaveText('添加');
    await expect(dropzone).toHaveCSS('height', '112px');
    await dropzone.click({ position: { x: 8, y: 8 } });
    expect(await page.evaluate(() => window.workspaceCreationTest.chooseCalls)).toBe(0);
    await chooser.click();
    expect(await page.evaluate(() => window.workspaceCreationTest.chooseCalls)).toBe(1);
    await expect(page.getByTestId('workspace-directory-dropzone')).toHaveAttribute(
      'aria-busy',
      'true',
    );
    await expect(chooser).toBeDisabled();
    await expect(save).toBeDisabled();
    await page.evaluate((value) => window.workspaceCreationTest.finishChoose(value), directory);
    await expect(dialog.getByText(directory, { exact: true })).toBeVisible();
    await expect(chooser).toHaveText('更换文件夹');
    await expect(save).toBeEnabled();
    await chooser.click();
    await page.evaluate(() => window.workspaceCreationTest.finishChoose(null));
    await expect(dialog.getByText(directory, { exact: true })).toBeVisible();
    await expect(save).toBeEnabled();
    await dialog.getByLabel('工作区名称', { exact: true }).fill('图标项目');
    await iconTrigger.click();
    const iconPanel = page.getByLabel('工作区图标', { exact: true });
    await expect(iconPanel).toBeVisible();
    const panelBounds = await iconPanel.boundingBox();
    expect(panelBounds).not.toBeNull();
    if (!panelBounds) throw new Error('The workspace icon panel must have visible bounds');
    expect(panelBounds.x).toBeGreaterThanOrEqual(0);
    expect(panelBounds.y).toBeGreaterThanOrEqual(0);
    expect(panelBounds.x + panelBounds.width).toBeLessThanOrEqual(900);
    expect(panelBounds.y + panelBounds.height).toBeLessThanOrEqual(700);
    await page.keyboard.press('Escape');
    await expect(iconPanel).not.toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(iconTrigger).toBeFocused();
    await iconTrigger.press('Enter');
    await page.getByRole('button', { name: '使用代码图标', exact: true }).click();
    await expect(dialog.locator('[data-workspace-icon="code"]')).toHaveCount(1);
    await page.screenshot({ path: testInfo.outputPath('workspace-create.png'), fullPage: true });
    await page.route('**/api/workspaces', async (route) => {
      if (route.request().method() === 'POST') {
        creates += 1;
        await saveGate;
      }
      await route.continue();
    });
    await save.click();
    const saving = dialog.getByRole('button', { name: '保存中…', exact: true });
    await expect(saving).toBeDisabled();
    await expect(chooser).toBeDisabled();
    await expect(
      dialog.getByRole('button', { name: '选择工作区图标', exact: true }),
    ).toBeDisabled();
    await page.keyboard.press('Enter');
    await expect.poll(() => creates).toBe(1);
    releaseSave();
    await expect(dialog).not.toBeVisible();
    const group = page.getByRole('group', { name: '图标项目', exact: true });
    await expect(group.locator('[data-workspace-icon="code"]')).toHaveCount(1);
    await expect(page.locator('[data-workspace-icon="code"]')).toHaveCount(2);
    const created = await readOnlyWorkspace(page, daemon.origin);
    expect(created).toMatchObject({ name: '图标项目', icon: 'code', revision: 1 });
    await page.reload();
    await expect(group.locator('[data-workspace-icon="code"]')).toHaveCount(1);
    await group.getByRole('button', { name: '图标项目', exact: true }).hover();
    await group.getByRole('button', { name: '更多操作 图标项目', exact: true }).click();
    await page
      .getByRole('dialog', { name: '图标项目 的工作区操作', exact: true })
      .getByRole('button', { name: '重命名', exact: true })
      .click();
    const editor = page.getByRole('dialog', { name: '编辑工作区', exact: true });
    await expect(
      editor.getByRole('button', { name: '选择工作区文件夹', exact: true }),
    ).toBeDisabled();
    await editor.getByRole('button', { name: '选择工作区图标', exact: true }).click();
    await page.getByRole('button', { name: '使用探索图标', exact: true }).click();
    await editor.getByRole('button', { name: '保存工作区', exact: true }).click();
    await expect(editor).not.toBeVisible();
    expect(await readOnlyWorkspace(page, daemon.origin)).toMatchObject({
      id: created.id,
      icon: 'rocket',
      revision: 2,
    });
    await group.getByRole('button', { name: '图标项目', exact: true }).hover();
    await group.getByRole('button', { name: '更多操作 图标项目', exact: true }).click();
    await page
      .getByRole('dialog', { name: '图标项目 的工作区操作', exact: true })
      .getByRole('button', { name: '重命名', exact: true })
      .click();
    await editor.getByLabel('工作区名称', { exact: true }).fill('新的项目名');
    await editor.getByRole('button', { name: '保存工作区', exact: true }).click();
    await expect(editor).not.toBeVisible();
    await page.reload();
    await expect(
      page
        .getByRole('group', { name: '新的项目名', exact: true })
        .locator('[data-workspace-icon="rocket"]'),
    ).toHaveCount(1);
    expect(await readOnlyWorkspace(page, daemon.origin)).toMatchObject({
      id: created.id,
      name: '新的项目名',
      icon: 'rocket',
      revision: 3,
    });
    expect(creates).toBe(1);
  } finally {
    releaseSave();
    await page.unrouteAll({ behavior: 'wait' });
    await rm(directory, { recursive: true, force: true });
  }
});

test('目录选择关闭后忽略旧返回，拖入只接收单项并通过桥注册', async ({ page, daemon }) => {
  const directory = await mkdtemp(join(tmpdir(), 'my-pi-workspace-drop-ui-'));
  try {
    await installDesktopChooser(page, directory);
    await page.goto(daemon.origin);
    const add = page.getByRole('button', { name: '添加工作区', exact: true });
    await add.click();
    const dialog = page.getByRole('dialog', { name: '添加工作区', exact: true });
    await dialog.getByRole('button', { name: '选择工作区文件夹', exact: true }).click();
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await add.click();
    await page.evaluate((value) => window.workspaceCreationTest.finishChoose(value), directory);
    await expect(dialog.getByText(directory, { exact: true })).toHaveCount(0);
    const save = dialog.getByRole('button', { name: '保存工作区', exact: true });
    await expect(save).toBeDisabled();
    await dropFiles(page, ['first-directory', 'second-directory']);
    await expect(dialog.getByRole('alert')).toContainText('每次只能添加一个文件夹');
    expect(await page.evaluate(() => window.workspaceCreationTest.dropCalls)).toBe(0);
    await expect(save).toBeDisabled();
    await dropFiles(page, ['native-directory']);
    await expect(dialog.getByText(directory, { exact: true })).toBeVisible();
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    expect(
      await page.evaluate(() => ({
        calls: window.workspaceCreationTest.dropCalls,
        name: window.workspaceCreationTest.lastDropName,
      })),
    ).toEqual({ calls: 1, name: 'native-directory' });
    await dialog.getByLabel('工作区名称', { exact: true }).fill('拖入项目');
    await save.click();
    await expect(dialog).not.toBeVisible();
    expect(await readOnlyWorkspace(page, daemon.origin)).toMatchObject({
      name: '拖入项目',
      icon: 'folder',
      revision: 1,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('浏览器添加入口提示桌面操作并禁用保存，不再要求手工路径', async ({ page, daemon }) => {
  await page.goto(daemon.origin);
  await page.getByRole('button', { name: '添加工作区', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '添加工作区', exact: true });
  await expect(dialog.getByRole('textbox')).toHaveCount(1);
  await expect(dialog.getByLabel('文件夹路径', { exact: true })).toHaveCount(0);
  await expect(dialog.getByText('请在桌面应用中添加文件夹', { exact: true })).toBeVisible();
  const chooser = dialog.getByRole('button', { name: '选择工作区文件夹', exact: true });
  await expect(chooser).toHaveText('添加');
  await expect(chooser).toBeDisabled();
  await expect(dialog.getByRole('button', { name: '保存工作区', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog).not.toBeVisible();
});
