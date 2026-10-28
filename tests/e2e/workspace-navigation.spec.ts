import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AuthStatusSchema,
  SessionSnapshotSchema,
  SessionSummarySchema,
  WorkspaceSchema,
  type SessionSummary,
  type Workspace,
} from '@my-pi-harness/protocol';
import type { Page } from '@playwright/test';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { test, expect } from './fixture.js';
import { configureTestProvider } from './model-fixtures.js';
import { startTestModel } from './model-server.js';
import { chooseConversationModel } from './ui-controls.js';
import { registerTestWorkspace } from './workspace-fixtures.js';

async function readSessions(page: Page, origin: string): Promise<SessionSummary[]> {
  const response = await page.request.get(`${origin}/api/sessions`);
  const value: unknown = await response.json();
  if (!response.ok() || !Value.Check(Type.Array(SessionSummarySchema), value))
    throw new Error('Invalid workspace navigation session list');
  return value;
}

async function readWorkspaces(page: Page, origin: string): Promise<Workspace[]> {
  const response = await page.request.get(`${origin}/api/workspaces`);
  const value: unknown = await response.json();
  if (!response.ok() || !Value.Check(Type.Array(WorkspaceSchema), value))
    throw new Error('Invalid workspace navigation workspace list');
  return value;
}

async function prepareNavigation(
  page: Page,
  origin: string,
  modelOrigin: string,
  directory: string,
) {
  const firstRoot = join(directory, 'first');
  const secondRoot = join(directory, 'second');
  await mkdir(firstRoot);
  await mkdir(secondRoot);
  await writeFile(join(secondRoot, 'keep.txt'), 'Workspace removal keeps this file.');
  await page.goto(origin);
  const provider = await configureTestProvider(page, modelOrigin);
  const first = await registerTestWorkspace(page, '第一项目', firstRoot);
  const second = await registerTestWorkspace(page, '第二项目', secondRoot);
  const status: unknown = await (await page.request.get(`${origin}/api/auth/status`)).json();
  if (!Value.Check(AuthStatusSchema, status) || !status.csrfToken)
    throw new Error('Workspace navigation requires fixture authorization');
  const response = await page.request.post(`${origin}/api/sessions`, {
    headers: { Origin: origin, 'X-CSRF-Token': status.csrfToken },
    data: {
      title: '既有项目会话',
      providerId: provider.id,
      modelId: 'chat-model',
      thinkingLevel: 'off',
      workspaceId: first.id,
      approvalMode: 'ask',
    },
  });
  const session: unknown = await response.json();
  if (!response.ok() || !Value.Check(SessionSnapshotSchema, session))
    throw new Error('Creating the existing workspace conversation failed');
  await page.reload();
  return { first, second, session };
}

test('目录只展开，整行悬浮与键盘菜单可达，更名保留草稿目标且移除保留文件', async ({
  page,
  daemon,
}, testInfo) => {
  const directory = await mkdtemp(join(tmpdir(), 'my-pi-workspace-navigation-'));
  const model = await startTestModel();
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    const { first, second, session } = await prepareNavigation(
      page,
      daemon.origin,
      model.origin,
      directory,
    );
    const current = page.getByRole('button', { name: /^既有项目会话 / });
    await current.click();
    const conversation = page.getByRole('region', { name: '当前会话', exact: true });
    await expect(
      conversation.getByRole('heading', { name: '既有项目会话', exact: true }),
    ).toBeVisible();
    await current.hover();
    await expect(current).toHaveCSS('transition-duration', '0s');
    const group = page.getByRole('group', { name: second.name, exact: true });
    const folder = group.getByRole('button', { name: second.name, exact: true });
    await folder.click();
    await expect(folder).toHaveAttribute('aria-expanded', 'false');
    await expect(current).toHaveAttribute('aria-current', 'page');
    await expect(conversation).toBeVisible();
    await folder.press('Enter');
    await expect(folder).toHaveAttribute('aria-expanded', 'true');
    await folder.hover();
    await expect(folder).toHaveCSS('transition-duration', '0s');
    const row = folder.locator('..');
    const folderBounds = await folder.boundingBox();
    const rowBounds = await row.boundingBox();
    if (!folderBounds || !rowBounds) throw new Error('The hovered workspace row has no bounds');
    expect(Math.abs(folderBounds.x - rowBounds.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(folderBounds.width - rowBounds.width)).toBeLessThanOrEqual(1);
    const more = group.getByRole('button', { name: `更多操作 ${second.name}`, exact: true });
    const actions = more.locator('..');
    await expect(actions).toHaveCSS('position', 'absolute');
    await expect(actions).toHaveCSS('opacity', '1');
    await expect(actions).toHaveCSS('transition-duration', '0s');
    const actionBounds = await actions.boundingBox();
    if (!actionBounds) throw new Error('The hovered workspace actions have no bounds');
    expect(
      Math.abs(rowBounds.x + rowBounds.width - actionBounds.x - actionBounds.width),
    ).toBeLessThanOrEqual(5);
    await page.screenshot({ path: testInfo.outputPath('workspace-row-hover.png'), fullPage: true });
    await folder.focus();
    await page.keyboard.press('Tab');
    await expect(more).toBeFocused();
    await more.press('Enter');
    const menu = page.getByRole('dialog', {
      name: `${second.name} 的工作区操作`,
      exact: true,
    });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('button')).toHaveText(['重命名', '删除']);
    await expect
      .poll(async () => {
        const trigger = await more.boundingBox();
        const panel = await menu.boundingBox();
        return (
          trigger !== null &&
          panel !== null &&
          Math.abs(panel.x - trigger.x) <= 1 &&
          panel.y >= trigger.y + trigger.height
        );
      })
      .toBe(true);
    await page.mouse.move(700, 500);
    await expect(actions).toHaveCSS('opacity', '1');
    await page.screenshot({
      path: testInfo.outputPath('workspace-actions-menu.png'),
      fullPage: true,
    });
    await expect(current).toHaveAttribute('aria-current', 'page');
    await page.keyboard.press('Escape');
    await expect(menu).not.toBeVisible();
    await expect(more).toBeFocused();
    const firstGroup = page.getByRole('group', { name: first.name, exact: true });
    await firstGroup.getByRole('button', { name: first.name, exact: true }).hover();
    await firstGroup
      .getByRole('button', { name: `在 ${first.name} 中新建对话`, exact: true })
      .click();
    const draftWorkspace = page.getByRole('combobox', { name: '选择工作区', exact: true });
    const draft = page.getByLabel('消息', { exact: true });
    await expect(draftWorkspace).toContainText(first.name);
    await draft.fill('更名期间保留的草稿');
    await folder.hover();
    await more.click();
    const rename = menu.getByRole('button', { name: '重命名', exact: true });
    await rename.focus();
    await rename.press('Enter');
    const editor = page.getByRole('dialog', { name: '编辑工作区', exact: true });
    await editor.getByLabel('工作区名称', { exact: true }).fill('第二项目已重命名');
    await editor.getByRole('button', { name: '保存工作区', exact: true }).click();
    await expect(editor).not.toBeVisible();
    await expect(draftWorkspace).toContainText(first.name);
    await expect(draft).toHaveValue('更名期间保留的草稿');
    await expect(page.getByRole('group', { name: '第二项目已重命名', exact: true })).toBeVisible();
    expect(
      (await readWorkspaces(page, daemon.origin)).find(({ id }) => id === second.id),
    ).toMatchObject({
      name: '第二项目已重命名',
      revision: 2,
    });
    await page.reload();
    const renamed = page.getByRole('group', { name: '第二项目已重命名', exact: true });
    await expect(renamed).toBeVisible();
    const renamedMore = renamed.getByRole('button', {
      name: '更多操作 第二项目已重命名',
      exact: true,
    });
    await renamed.getByRole('button', { name: '第二项目已重命名', exact: true }).hover();
    await renamedMore.click();
    await page
      .getByRole('dialog', { name: '第二项目已重命名 的工作区操作', exact: true })
      .getByRole('button', { name: '删除', exact: true })
      .click();
    const confirmation = page.getByRole('alertdialog', { name: '移除工作区', exact: true });
    await expect(confirmation).toContainText('不会删除文件');
    expect((await readWorkspaces(page, daemon.origin)).map(({ id }) => id)).toContain(second.id);
    await page.keyboard.press('Escape');
    await expect(confirmation).not.toBeVisible();
    await expect(renamed).toBeVisible();
    await renamed.getByRole('button', { name: '第二项目已重命名', exact: true }).hover();
    await renamedMore.click();
    await page
      .getByRole('dialog', { name: '第二项目已重命名 的工作区操作', exact: true })
      .getByRole('button', { name: '删除', exact: true })
      .click();
    await confirmation.getByRole('button', { name: '确认移除工作区', exact: true }).click();
    await expect(confirmation).not.toBeVisible();
    await expect(renamed).toHaveCount(0);
    expect((await readWorkspaces(page, daemon.origin)).map(({ id }) => id)).toEqual([first.id]);
    expect(await readFile(join(second.rootPath, 'keep.txt'), 'utf8')).toBe(
      'Workspace removal keeps this file.',
    );
    expect((await readSessions(page, daemon.origin)).map(({ id }) => id)).toEqual([
      session.session.id,
    ]);
    expect(model.requests).toHaveLength(0);
  } finally {
    await daemon.stop();
    await model.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('工作区选项仅展示名称与图标且无路径提示，键盘与边缘菜单保持可用', async ({ page, daemon }) => {
  const directory = await mkdtemp(join(tmpdir(), 'my-pi-workspace-options-'));
  const model = await startTestModel();
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    const { first, second } = await prepareNavigation(page, daemon.origin, model.origin, directory);
    const workspace = page.getByRole('combobox', { name: '选择工作区', exact: true });
    await workspace.hover();
    await expect(workspace).not.toHaveAttribute('title');
    expect(await workspace.evaluate((element) => element.closest('[title]') === null)).toBe(true);
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    const trigger = await workspace.boundingBox();
    if (!trigger) throw new Error('The workspace selector has no visible trigger bounds');
    await workspace.click();
    const listbox = page.getByRole('listbox');
    const firstOption = page.getByRole('option', { name: first.name, exact: true });
    const secondOption = page.getByRole('option', { name: second.name, exact: true });
    await expect(firstOption).toHaveText(first.name);
    await expect(secondOption).toHaveText(second.name);
    await expect(firstOption.locator('[data-workspace-icon="folder"]')).toHaveCount(1);
    await expect(secondOption.locator('[data-workspace-icon="folder"]')).toHaveCount(1);
    await expect(firstOption).not.toContainText(first.rootPath);
    await expect(secondOption).not.toContainText(second.rootPath);
    await expect
      .poll(async () => {
        const panel = await listbox.boundingBox();
        return (
          panel !== null &&
          Math.abs(panel.x - trigger.x) <= 1 &&
          panel.y >= trigger.y + trigger.height
        );
      })
      .toBe(true);
    await firstOption.hover();
    await expect(firstOption).not.toHaveAttribute('title');
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await expect(firstOption).toHaveText(first.name);
    await secondOption.hover();
    await expect(secondOption).not.toHaveAttribute('title');
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await secondOption.click();
    await expect(workspace).toHaveText(second.name);
    await expect(workspace).not.toContainText(second.rootPath);
    await expect(workspace).not.toHaveAttribute('title');
    await workspace.focus();
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await workspace.press('ArrowDown');
    await expect(secondOption).toBeFocused();
    await expect(secondOption).not.toHaveAttribute('title');
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await page.keyboard.press('Home');
    await expect(page.getByRole('option', { name: '不使用工作区', exact: true })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(firstOption).toBeFocused();
    await expect(firstOption).not.toHaveAttribute('title');
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await page.keyboard.press('Enter');
    await expect(workspace).toHaveText(first.name);
    await expect(workspace).not.toHaveAttribute('title');
    await page.setViewportSize({ width: 760, height: 460 });
    await workspace.click();
    await expect(listbox).toBeVisible();
    await expect
      .poll(async () => {
        const panel = await listbox.boundingBox();
        return (
          panel !== null &&
          panel.x >= 0 &&
          panel.y >= 0 &&
          panel.x + panel.width <= 760 &&
          panel.y + panel.height <= 460
        );
      })
      .toBe(true);
    await secondOption.click();
    await expect(workspace).toHaveText(second.name);
    expect(await readSessions(page, daemon.origin)).toHaveLength(1);
    expect(model.requests).toHaveLength(0);
  } finally {
    await daemon.stop();
    await model.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('工作区加号从会话和运行页进入预选的新输入，发送前不创建空会话', async ({ page, daemon }) => {
  const directory = await mkdtemp(join(tmpdir(), 'my-pi-workspace-plus-'));
  const model = await startTestModel();
  let creates = 0;
  try {
    const { first, second, session } = await prepareNavigation(
      page,
      daemon.origin,
      model.origin,
      directory,
    );
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/sessions')
        creates += 1;
    });
    await page.getByRole('button', { name: /^既有项目会话 / }).click();
    await expect(page.getByRole('region', { name: '当前会话', exact: true })).toBeVisible();
    const secondGroup = page.getByRole('group', { name: second.name, exact: true });
    await secondGroup.getByRole('button', { name: second.name, exact: true }).hover();
    await secondGroup
      .getByRole('button', { name: `在 ${second.name} 中新建对话`, exact: true })
      .click();
    const home = page.getByRole('heading', { name: '我们从哪里开始？', exact: true });
    const workspace = page.getByRole('combobox', { name: '选择工作区', exact: true });
    const draft = page.getByLabel('消息', { exact: true });
    await expect(home).toBeVisible();
    await expect(workspace).toContainText(second.name);
    await expect(draft).toHaveValue('');
    await expect(page.getByRole('region', { name: '当前会话', exact: true })).toHaveCount(0);
    expect(creates).toBe(0);
    expect((await readSessions(page, daemon.origin)).map(({ id }) => id)).toEqual([
      session.session.id,
    ]);
    await draft.fill('不应被目录展开操作清除的草稿');
    const firstGroup = page.getByRole('group', { name: first.name, exact: true });
    const firstFolder = firstGroup.getByRole('button', { name: first.name, exact: true });
    await firstFolder.click();
    await expect(home).toBeVisible();
    await expect(workspace).toContainText(second.name);
    await expect(draft).toHaveValue('不应被目录展开操作清除的草稿');
    await page.getByRole('button', { name: '运行状态', exact: true }).click();
    await expect(page.getByTestId('runtime-connection')).toHaveAttribute('data-state', 'ready');
    await firstFolder.click();
    await expect(page.getByTestId('runtime-connection')).toHaveAttribute('data-state', 'ready');
    await expect(home).toHaveCount(0);
    const firstPlus = firstGroup.getByRole('button', {
      name: `在 ${first.name} 中新建对话`,
      exact: true,
    });
    await firstFolder.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(firstPlus).toBeFocused();
    await firstPlus.press('Enter');
    await expect(home).toBeVisible();
    await expect(workspace).toContainText(first.name);
    await expect(draft).toHaveValue('');
    expect(creates).toBe(0);
    expect((await readSessions(page, daemon.origin)).map(({ id }) => id)).toEqual([
      session.session.id,
    ]);
    await chooseConversationModel(page, 'Queue Model', 'Chat');
    const creation = page.waitForResponse((response) => {
      return (
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/sessions'
      );
    });
    await draft.fill('从指定工作区发送');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    const created = await creation;
    const snapshot: unknown = await created.json();
    if (!created.ok() || !Value.Check(SessionSnapshotSchema, snapshot))
      throw new Error('The workspace plus draft was not created after sending');
    expect(snapshot.session.workspaceId).toBe(first.id);
    await expect(page.getByText('响应：从指定工作区发送', { exact: true })).toBeVisible();
    expect(creates).toBe(1);
    expect(await readSessions(page, daemon.origin)).toHaveLength(2);
    expect(model.requests).toHaveLength(1);
  } finally {
    await daemon.stop();
    await model.close();
    await rm(directory, { recursive: true, force: true });
  }
});
