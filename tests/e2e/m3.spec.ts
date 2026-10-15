import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import {
  AuthStatusSchema,
  AttachmentSchema,
  ProviderConfigSchema,
  SessionSnapshotSchema,
  WorkSnapshotSchema,
  WorkspaceSchema,
  type SessionSnapshot,
  type ProviderConfig,
  type WorkSnapshot,
} from '@my-pi-harness/protocol';
import { Value } from 'typebox/value';
import { test, expect } from './fixture.js';
import { configureTestProvider } from './model-fixtures.js';
import { startM3Model } from './m3-model-server.js';
import { chooseOption } from './ui-controls.js';

const readSession = async (page: Page, origin: string, id: string): Promise<SessionSnapshot> => {
  const response = await page.request.get(`${origin}/api/sessions/${encodeURIComponent(id)}`);
  const value: unknown = await response.json();
  if (!response.ok() || !Value.Check(SessionSnapshotSchema, value))
    throw new Error('Invalid committed M3 session snapshot');
  return value;
};
const readWork = async (page: Page, origin: string, id: string): Promise<WorkSnapshot> => {
  const session = await readSession(page, origin, id);
  const branchId = session.session.activeBranchId;
  const response = await page.request.get(
    `${origin}/api/sessions/${encodeURIComponent(id)}/work?branchId=${encodeURIComponent(branchId)}`,
  );
  const value: unknown = await response.json();
  if (
    !response.ok() ||
    !Value.Check(WorkSnapshotSchema, value) ||
    value.state.branchId !== branchId
  )
    throw new Error('Invalid committed M3 work snapshot');
  return value;
};
const firstSend = async (page: Page, text: string): Promise<string> => {
  const created = page.waitForResponse((response) => {
    return (
      response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/sessions'
    );
  });
  await page.getByLabel('消息', { exact: true }).fill(text);
  await page.getByRole('button', { name: '发送', exact: true }).click();
  const response = await created;
  const snapshot: unknown = await response.json();
  if (!response.ok() || !Value.Check(SessionSnapshotSchema, snapshot))
    throw new Error('M3 conversation creation failed');
  return snapshot.session.id;
};
const setupModel = async (
  page: Page,
  origin: string,
  modelOrigin: string,
  image = false,
): Promise<ProviderConfig> => {
  await page.goto(origin);
  const configured = await configureTestProvider(page, modelOrigin);
  if (image) {
    const status: unknown = await (await page.request.get(`${origin}/api/auth/status`)).json();
    const current: unknown = await (
      await page.request.get(`${origin}/api/providers/${encodeURIComponent(configured.id)}`)
    ).json();
    if (
      !Value.Check(AuthStatusSchema, status) ||
      !status.csrfToken ||
      !Value.Check(ProviderConfigSchema, current)
    )
      throw new Error('Image fixture requires a configured provider');
    const saved = await page.request.put(
      `${origin}/api/providers/${encodeURIComponent(configured.id)}`,
      {
        headers: { Origin: origin, 'X-CSRF-Token': status.csrfToken },
        data: {
          id: current.id,
          name: current.name,
          kind: current.kind,
          builtinId: current.builtinId,
          api: current.api,
          baseUrl: current.baseUrl,
          enabled: current.enabled,
          requiresApiKey: current.requiresApiKey,
          expectedRevision: current.revision,
          models: current.models.map((entry) => {
            return { ...entry, input: ['text', 'image'] };
          }),
        },
      },
    );
    if (!saved.ok()) throw new Error('Enabling fixture image capability failed');
  }
  await page.reload();
  await chooseOption(
    page,
    page.getByRole('combobox', { name: '对话模型', exact: true }),
    'Queue Model · Chat',
  );
  return configured;
};

test('M3 上传文本随首发进入真实模型请求，刷新后可预览历史附件', async ({ page, daemon }) => {
  const model = await startM3Model();
  try {
    await setupModel(page, daemon.origin, model.origin);
    await page.getByRole('button', { name: '添加上下文', exact: true }).click();
    const menu = page.getByRole('dialog', { name: '添加上下文菜单', exact: true });
    await expect(menu.getByRole('button')).toHaveText(['上传文件', 'MCP', 'Skill']);
    await expect(menu.getByRole('button', { name: 'MCP', exact: true })).toBeDisabled();
    await expect(menu.getByRole('button', { name: 'Skill', exact: true })).toBeDisabled();
    await expect(menu).not.toContainText('引用工作区文件');
    await mkdir(join(process.cwd(), 'output', 'playwright'), { recursive: true });
    await page.screenshot({ path: 'output/playwright/m3-attachment-menu.png' });
    const selecting = page.waitForEvent('filechooser');
    await menu.getByRole('button', { name: '上传文件', exact: true }).click();
    await (
      await selecting
    ).setFiles({
      name: 'context.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('ATTACHMENT-CONTENT-M3\n'),
    });
    await page.keyboard.press('Escape');
    const chip = page.getByRole('button', { name: '预览附件 context.txt', exact: true });
    await expect(chip).toBeVisible();
    const id = await firstSend(page, '附件首发，请读取附件');
    await expect(
      page.getByText('已读取附件：ATTACHMENT-CONTENT-M3', { exact: true }),
    ).toBeVisible();
    const snapshot = await readSession(page, daemon.origin, id);
    expect(
      snapshot.messages.find((message) => {
        return message.role === 'user';
      })?.attachmentIds,
    ).toHaveLength(1);
    expect(JSON.stringify(model.requests[0]?.body['messages'])).toContain('ATTACHMENT-CONTENT-M3');
    await page.reload();
    await page.getByRole('button', { name: /^附件首发，请读取附件 / }).click();
    await expect(chip).toBeVisible();
    await chip.click();
    const preview = page.getByRole('dialog', { name: 'context.txt', exact: true });
    await expect(preview).toContainText('ATTACHMENT-CONTENT-M3');
    await preview.getByRole('button', { name: '关闭', exact: true }).click();
    expect(model.requests).toHaveLength(1);
  } finally {
    await daemon.stop();
    await model.close();
  }
});

test('M3 宿主文件引用冻结规则和片段，并在界面显示上下文预算', async ({ page, daemon }) => {
  const directory = await mkdtemp(join(tmpdir(), 'my-pi-m3-rules-'));
  const model = await startM3Model();
  try {
    await mkdir(join(directory, 'src'));
    await writeFile(join(directory, 'AGENTS.md'), 'M3-ROOT-RULE: follow project conventions.\n');
    await writeFile(
      join(directory, 'src', 'AGENTS.md'),
      'M3-NESTED-RULE: use the selected source conventions.\n',
    );
    await writeFile(join(directory, 'src', 'note.txt'), 'M3-EXCLUDED-LINE\nM3-SELECTED-LINE\n');
    const configured = await setupModel(page, daemon.origin, model.origin);
    const authorization = await page.request.get(`${daemon.origin}/api/auth/status`);
    const auth: unknown = await authorization.json();
    if (!Value.Check(AuthStatusSchema, auth) || !auth.csrfToken)
      throw new Error('M3 workspace requires fixture authorization');
    const registered = await page.request.post(`${daemon.origin}/api/workspaces`, {
      headers: { Origin: daemon.origin, 'X-CSRF-Token': auth.csrfToken },
      data: { name: 'M3 规则项目', rootPath: directory },
    });
    const workspace: unknown = await registered.json();
    if (!registered.ok() || !Value.Check(WorkspaceSchema, workspace))
      throw new Error('M3 workspace registration failed');
    const headers = { Origin: daemon.origin, 'X-CSRF-Token': auth.csrfToken };
    const referenced = await page.request.post(`${daemon.origin}/api/attachments/reference`, {
      headers,
      data: { workspaceId: workspace.id, path: 'src/note.txt', startLine: 2, endLine: 2 },
    });
    const attachment: unknown = await referenced.json();
    if (!referenced.ok() || !Value.Check(AttachmentSchema, attachment))
      throw new Error('Freezing the host reference failed');
    const created = await page.request.post(`${daemon.origin}/api/sessions`, {
      headers,
      data: {
        title: '检查规则与引用',
        providerId: configured.id,
        modelId: 'chat-model',
        thinkingLevel: 'off',
        workspaceId: workspace.id,
        approvalMode: 'read-only',
      },
    });
    const snapshot: unknown = await created.json();
    if (!created.ok() || !Value.Check(SessionSnapshotSchema, snapshot))
      throw new Error('Creating the host reference session failed');
    const id = snapshot.session.id;
    const sent = await page.request.post(`${daemon.origin}/api/sessions/${id}/inputs`, {
      headers,
      data: {
        text: '检查规则与引用',
        mode: 'send',
        requestId: 'reference-input',
        attachmentIds: [attachment.id],
      },
    });
    expect(sent.ok()).toBe(true);
    await page.reload();
    await page.getByRole('button', { name: /^检查规则与引用 / }).click();
    await expect(page.getByText('规则和文件片段已进入模型上下文。', { exact: true })).toBeVisible();
    const request = JSON.stringify(model.requests[0]?.body['messages']);
    expect(request).toContain('M3-SELECTED-LINE');
    expect(request).not.toContain('M3-EXCLUDED-LINE');
    const work = await readWork(page, daemon.origin, id);
    expect(
      work.state.rules.map((rule) => {
        return rule.path;
      }),
    ).toEqual(['AGENTS.md', 'src/AGENTS.md']);
    expect(work.state.usage?.estimatedTokens).toBeGreaterThan(0);
    await page.getByRole('button', { name: '上下文与工作状态', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '上下文与工作状态', exact: true });
    await expect(dialog).toContainText('估算输入');
    await expect(dialog).toContainText('输出预留');
    await dialog
      .locator('summary')
      .filter({ hasText: /^src\/AGENTS.md$/ })
      .click();
    await expect(dialog).toContainText('M3-NESTED-RULE');
    await mkdir(join(process.cwd(), 'output', 'playwright'), { recursive: true });
    await page.screenshot({ path: 'output/playwright/m3-context.png' });
  } finally {
    await daemon.stop();
    await model.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('M3 计划批准和任务持久化，检查点比较恢复保留原分支，重置不删历史', async ({
  page,
  daemon,
}) => {
  const model = await startM3Model();
  try {
    await setupModel(page, daemon.origin, model.origin);
    await chooseOption(
      page,
      page.getByRole('combobox', { name: '输入栏工作模式', exact: true }),
      'Plan · 只规划',
    );
    const id = await firstSend(page, '计划与检查点验收');
    await expect(page.getByText('M3 会话已完成。', { exact: true })).toBeVisible();
    const original = await readSession(page, daemon.origin, id);
    expect((await readWork(page, daemon.origin, id)).state.mode).toBe('plan');
    const messages = model.requests[0]?.body['messages'];
    if (!Array.isArray(messages)) throw new Error('The first model request must contain messages');
    const system = messages.find((entry: unknown): entry is { role: 'system'; content: string } => {
      return (
        typeof entry === 'object' &&
        entry !== null &&
        'role' in entry &&
        entry.role === 'system' &&
        'content' in entry &&
        typeof entry.content === 'string'
      );
    });
    expect(system?.content).toContain('"workingData":{"mode":"plan"');
    const openWork = page.getByRole('button', { name: '上下文与工作状态', exact: true });
    await openWork.click();
    let dialog = page.getByRole('dialog', { name: '上下文与工作状态', exact: true });
    await dialog.getByRole('tab', { name: '计划与任务', exact: true }).click();
    await expect(dialog.getByRole('combobox', { name: '工作模式', exact: true })).toContainText(
      'Plan',
    );
    await dialog.getByRole('button', { name: '编辑计划', exact: true }).click();
    await dialog.getByLabel('计划标题', { exact: true }).fill('第一份计划');
    await dialog.getByLabel('计划内容', { exact: true }).fill('先读取资料，再整理结果。');
    await dialog.getByRole('button', { name: '保存计划', exact: true }).click();
    await dialog.getByRole('button', { name: '批准计划并切换执行', exact: true }).click();
    await expect(dialog.getByRole('combobox', { name: '工作模式', exact: true })).toContainText(
      '执行',
    );
    await dialog.getByRole('textbox', { name: '新任务', exact: true }).fill('整理资料');
    await dialog.getByRole('button', { name: '添加', exact: true }).click();
    await chooseOption(
      page,
      dialog.getByRole('combobox', { name: '任务状态 整理资料', exact: true }),
      '已完成',
    );
    await expect(
      dialog.getByRole('combobox', { name: '任务状态 整理资料', exact: true }),
    ).toContainText('已完成');
    await mkdir(join(process.cwd(), 'output', 'playwright'), { recursive: true });
    await page.screenshot({ path: 'output/playwright/m3-plan.png' });
    await dialog.getByRole('tab', { name: '检查点', exact: true }).click();
    await dialog.getByRole('textbox', { name: '检查点名称', exact: true }).fill('计划已批准');
    await dialog.getByRole('button', { name: '创建检查点', exact: true }).click();
    await expect
      .poll(async () => {
        return (await readWork(page, daemon.origin, id)).checkpoints.length;
      })
      .toBe(1);
    await dialog.getByRole('tab', { name: '计划与任务', exact: true }).click();
    await dialog.getByRole('button', { name: '编辑计划', exact: true }).click();
    await dialog.getByLabel('计划内容', { exact: true }).fill('第二份计划内容，需要重新确认。');
    await dialog.getByRole('button', { name: '保存计划', exact: true }).click();
    await dialog.getByRole('tab', { name: '检查点', exact: true }).click();
    await dialog.getByRole('textbox', { name: '检查点名称', exact: true }).fill('计划已修改');
    await dialog.getByRole('button', { name: '创建检查点', exact: true }).click();
    await expect
      .poll(async () => {
        return (await readWork(page, daemon.origin, id)).checkpoints.length;
      })
      .toBe(2);
    await chooseOption(
      page,
      dialog.getByRole('combobox', { name: '比较基准', exact: true }),
      '计划已修改',
    );
    await chooseOption(
      page,
      dialog.getByRole('combobox', { name: '比较目标', exact: true }),
      '计划已批准',
    );
    await expect(dialog.getByText('有变化', { exact: true })).toBeVisible();
    await page.screenshot({ path: 'output/playwright/m3-checkpoints.png' });
    await dialog.getByRole('button', { name: '恢复目标检查点', exact: true }).click();
    await page
      .getByRole('alertdialog', { name: '恢复检查点', exact: true })
      .getByRole('button', { name: '创建分支并恢复', exact: true })
      .click();
    await expect
      .poll(async () => {
        return (await readSession(page, daemon.origin, id)).branches.length;
      })
      .toBe(2);
    const restored = await readSession(page, daemon.origin, id);
    expect(restored.messages).toEqual(original.messages);
    expect(restored.session.activeBranchId).not.toBe(original.session.activeBranchId);
    expect((await readWork(page, daemon.origin, id)).state.plan?.content).toBe(
      '先读取资料，再整理结果。',
    );
    await chooseOption(
      page,
      page.getByRole('combobox', { name: '历史分支', exact: true }),
      '主分支',
    );
    await expect
      .poll(async () => {
        return (await readWork(page, daemon.origin, id)).state.plan?.content;
      })
      .toBe('第二份计划内容，需要重新确认。');
    await chooseOption(
      page,
      page.getByRole('combobox', { name: '历史分支', exact: true }),
      '修订分支 1',
    );
    await openWork.click();
    dialog = page.getByRole('dialog', { name: '上下文与工作状态', exact: true });
    await dialog.getByRole('tab', { name: '检查点', exact: true }).click();
    await dialog.getByRole('button', { name: '重置工作状态', exact: true }).click();
    const confirmation = page.getByRole('alertdialog', { name: '重置工作状态', exact: true });
    await expect(confirmation).toContainText('不会回滚');
    await confirmation.getByRole('button', { name: '确认重置', exact: true }).click();
    await expect
      .poll(async () => {
        return (await readWork(page, daemon.origin, id)).state.todos.length;
      })
      .toBe(0);
    expect((await readWork(page, daemon.origin, id)).state.plan).toBeNull();
    expect((await readSession(page, daemon.origin, id)).messages).toEqual(original.messages);
    expect(model.requests).toHaveLength(1);
  } finally {
    await daemon.stop();
    await model.close();
  }
});

test('M3 无工作区时 Agent 可等待用户回答，并支持取消后继续', async ({ page, daemon }) => {
  const model = await startM3Model();
  try {
    await setupModel(page, daemon.origin, model.origin);
    const id = await firstSend(page, '请询问我 [ask:answer]');
    const question = page.getByLabel('Agent 提问', { exact: true });
    await expect(question).toBeVisible();
    await question.getByRole('button', { name: '方案 A', exact: true }).click();
    await question.getByLabel('回答 Agent', { exact: true }).fill('方案 A，先读资料');
    await question.getByRole('button', { name: '提交回答', exact: true }).click();
    await expect(page.getByText(/Agent 收到回答：.*方案 A，先读资料/)).toBeVisible();
    await page.getByLabel('消息', { exact: true }).fill('请询问我 [ask:cancel]');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(question).toBeVisible();
    await question.getByRole('button', { name: '取消提问', exact: true }).click();
    await expect(page.getByText('取消提问后已继续。', { exact: true })).toBeVisible();
    const work = await readWork(page, daemon.origin, id);
    expect(
      work.state.questions.map((entry) => {
        return entry.status;
      }),
    ).toEqual(['answered', 'cancelled']);
    expect(work.state.questions[0]?.answer).toBe('方案 A，先读资料');
    expect((await readSession(page, daemon.origin, id)).session.workspaceId).toBeNull();
    expect(model.requests).toHaveLength(4);
  } finally {
    await daemon.stop();
    await model.close();
  }
});

test('M3 图片可上传预览，并以真实Pi多模态请求发送给支持图片的模型', async ({ page, daemon }) => {
  const model = await startM3Model();
  try {
    await setupModel(page, daemon.origin, model.origin, true);
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
      'base64',
    );
    await page
      .getByLabel('上传附件', { exact: true })
      .setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: png });
    const chip = page.getByRole('button', { name: '预览附件 pixel.png', exact: true });
    await expect(chip).toBeVisible();
    await chip.click();
    const preview = page.getByRole('dialog', { name: 'pixel.png', exact: true });
    const image = preview.getByRole('img', { name: 'pixel.png', exact: true });
    await expect(image).toBeVisible();
    await expect
      .poll(async () => {
        return image.evaluate((element: HTMLImageElement) => {
          return element.naturalWidth;
        });
      })
      .toBe(1);
    await preview.getByRole('button', { name: '关闭', exact: true }).click();
    const id = await firstSend(page, '图片首发，请检查图片');
    await expect(page.getByText('M3 图片已进入模型请求。', { exact: true })).toBeVisible();
    const request = JSON.stringify(model.requests[0]?.body['messages']);
    expect(request).toContain('image_url');
    expect(request).toContain(`data:image/png;base64,${png.toString('base64')}`);
    expect((await readSession(page, daemon.origin, id)).messages[0]?.attachmentIds).toHaveLength(1);
    await chip.click();
    await expect(preview.getByRole('img', { name: 'pixel.png', exact: true })).toBeVisible();
  } finally {
    await daemon.stop();
    await model.close();
  }
});
