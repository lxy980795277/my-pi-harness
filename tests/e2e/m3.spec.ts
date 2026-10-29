import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page, Route } from '@playwright/test';
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
import { chooseConversationModel, chooseOption } from './ui-controls.js';
import { selectTestSessionBranch } from './session-fixtures.js';
import { expandCompletedProcesses } from './process-controls.js';

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
  const contextWindow = image ? 32768 : 8192;
  const configured = await configureTestProvider(page, modelOrigin, contextWindow);
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
  await chooseConversationModel(page, 'Queue Model', 'Chat');
  return configured;
};

test('M3 上传文本随首发进入真实模型请求，刷新后可预览历史附件', async ({ page, daemon }) => {
  const model = await startM3Model();
  try {
    await setupModel(page, daemon.origin, model.origin);
    await page.getByRole('button', { name: '添加上下文', exact: true }).click();
    const menu = page.getByRole('dialog', { name: '添加上下文菜单', exact: true });
    await expect(menu.getByRole('button')).toHaveText(['上传文件', 'MCP', 'Skill']);
    await expect(menu.getByRole('button', { name: 'MCP', exact: true })).toBeEnabled();
    await expect(menu.getByRole('button', { name: 'Skill', exact: true })).toBeEnabled();
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
    const id = await firstSend(page, '');
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
    await page.getByRole('button', { name: /^context.txt / }).click();
    await expect(chip).toBeVisible();
    await chip.click();
    const preview = page.getByRole('dialog', { name: 'context.txt', exact: true });
    await expect(preview).toContainText('ATTACHMENT-CONTENT-M3');
    await preview.getByRole('button', { name: '关闭', exact: true }).click();
    let releaseContent = (): void => {
      throw new Error('The attachment content gate has not initialized');
    };
    const contentGate = new Promise<void>((resolve) => {
      releaseContent = resolve;
    });
    const contentPattern = '**/api/attachments/*/content';
    const holdContent = async (route: Route): Promise<void> => {
      await contentGate;
      if (route.request().failure() === null) {
        await route.continue();
      }
    };
    await page.route(contentPattern, holdContent);
    try {
      const contentRequested = page.waitForRequest((request) => {
        return /\/api\/attachments\/[^/]+\/content$/.test(new URL(request.url()).pathname);
      });
      await chip.click();
      await contentRequested;
      await expect(preview).toContainText('正在加载附件…');
      await expect(preview).not.toContainText('ATTACHMENT-CONTENT-M3');
      const cancelled = page.waitForEvent('requestfailed', {
        predicate: (request) => {
          return /\/api\/attachments\/[^/]+\/content$/.test(new URL(request.url()).pathname);
        },
      });
      await preview.getByRole('button', { name: '关闭', exact: true }).click();
      const request = await cancelled;
      expect(request.failure()?.errorText).toContain('ERR_ABORTED');
      await expect(preview).not.toBeVisible();
    } finally {
      releaseContent();
      await page.unroute(contentPattern, holdContent);
    }
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
        approvalMode: 'ask',
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

test('M3 计划反馈与批准保持同一次运行，快照恢复和两类重置保留历史', async ({ page, daemon }) => {
  const model = await startM3Model();
  try {
    await setupModel(page, daemon.origin, model.origin);
    await expect(page.getByRole('combobox', { name: '输入栏工作模式', exact: true })).toHaveCount(
      0,
    );
    const id = await firstSend(page, '计划与检查点验收 [plan:review]');
    const review = page.getByLabel('计划审核', { exact: true });
    await expect(review).toContainText('第一份计划');
    await mkdir(join(process.cwd(), 'output', 'playwright'), { recursive: true });
    await page.screenshot({ path: 'output/playwright/m3-plan-review.png' });
    const pending = await readSession(page, daemon.origin, id);
    const runId = pending.session.activeRunId;
    expect(runId).not.toBeNull();
    await review.getByLabel('计划修改意见', { exact: true }).fill('请先核对来源，并记录依据');
    await review.getByRole('button', { name: '提交修改意见', exact: true }).click();
    await expect(review).toContainText('修订后的计划');
    expect((await readSession(page, daemon.origin, id)).session.activeRunId).toBe(runId);
    await review.getByRole('button', { name: '批准并执行', exact: true }).click();
    await expect(page.getByText('M3 计划已在同一次运行中完成。', { exact: true })).toBeVisible();
    const original = await readSession(page, daemon.origin, id);
    expect(original.runs).toHaveLength(1);
    expect(original.runs[0]?.id).toBe(runId);
    const completed = await readWork(page, daemon.origin, id);
    expect(completed.state).not.toHaveProperty('mode');
    expect(completed.state.plan?.status).toBe('completed');
    expect(completed.state.plan?.review).toBe('approved');
    expect(completed.state.plan?.content).toContain('核对来源');
    expect(completed.state.todos[0]?.completionNote).toContain('纯文本资料整理');
    expect(JSON.stringify(model.requests[1]?.body['messages'])).toContain(
      '请先核对来源，并记录依据',
    );
    const openWork = page.getByRole('button', { name: '上下文与工作状态', exact: true });
    await openWork.click();
    let dialog = page.getByRole('dialog', { name: '上下文与工作状态', exact: true });
    await dialog.getByRole('tab', { name: '计划与任务', exact: true }).click();
    await expect(dialog).toContainText('修订后的计划');
    await expect(dialog).toContainText('纯文本资料整理');
    await mkdir(join(process.cwd(), 'output', 'playwright'), { recursive: true });
    await page.screenshot({ path: 'output/playwright/m3-plan.png' });
    await dialog.getByRole('tab', { name: '会话快照', exact: true }).click();
    await dialog.getByRole('textbox', { name: '快照名称', exact: true }).fill('计划已批准');
    await dialog.getByRole('button', { name: '创建会话快照', exact: true }).click();
    await expect
      .poll(async () => {
        return (await readWork(page, daemon.origin, id)).checkpoints.length;
      })
      .toBe(1);
    await dialog.getByRole('tab', { name: '计划与任务', exact: true }).click();
    await dialog.getByRole('textbox', { name: '新任务', exact: true }).fill('补充核验');
    await dialog.getByRole('button', { name: '添加', exact: true }).click();
    await chooseOption(
      page,
      dialog.getByRole('combobox', { name: '任务状态 补充核验', exact: true }),
      '受阻',
    );
    await expect(
      dialog.getByRole('combobox', { name: '任务状态 补充核验', exact: true }),
    ).toContainText('受阻');
    await dialog.getByRole('tab', { name: '会话快照', exact: true }).click();
    await dialog.getByRole('textbox', { name: '快照名称', exact: true }).fill('任务已补充');
    await dialog.getByRole('button', { name: '创建会话快照', exact: true }).click();
    await expect
      .poll(async () => {
        return (await readWork(page, daemon.origin, id)).checkpoints.length;
      })
      .toBe(2);
    await chooseOption(
      page,
      dialog.getByRole('combobox', { name: '比较基准', exact: true }),
      '任务已补充',
    );
    await chooseOption(
      page,
      dialog.getByRole('combobox', { name: '比较目标', exact: true }),
      '计划已批准',
    );
    await expect(dialog.getByText('有变化', { exact: true }).first()).toBeVisible();
    await page.screenshot({ path: 'output/playwright/m3-checkpoints.png' });
    await dialog.getByRole('button', { name: '恢复目标快照', exact: true }).click();
    await page
      .getByRole('alertdialog', { name: '恢复会话快照', exact: true })
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
    expect((await readWork(page, daemon.origin, id)).state.todos).toHaveLength(1);
    await expect(page.getByRole('combobox', { name: '历史分支', exact: true })).toHaveCount(0);
    await selectTestSessionBranch(page, id, original.session.activeBranchId);
    await page.reload();
    await page.getByRole('button', { name: /^计划与检查点验收 /u }).click();
    await expect
      .poll(async () => {
        return (await readWork(page, daemon.origin, id)).state.todos.length;
      })
      .toBe(2);
    await openWork.click();
    dialog = page.getByRole('dialog', { name: '上下文与工作状态', exact: true });
    await dialog.getByRole('tab', { name: '计划与任务', exact: true }).click();
    await expect(dialog.getByRole('combobox', { name: /^任务状态 /u })).toHaveCount(2);
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await selectTestSessionBranch(page, id, restored.session.activeBranchId);
    await page.reload();
    await page.getByRole('button', { name: /^计划与检查点验收 /u }).click();
    await openWork.click();
    dialog = page.getByRole('dialog', { name: '上下文与工作状态', exact: true });
    await dialog.getByRole('tab', { name: '计划与任务', exact: true }).click();
    await expect(dialog.getByRole('combobox', { name: /^任务状态 /u })).toHaveCount(1);
    await dialog.getByRole('tab', { name: '会话快照', exact: true }).click();
    await dialog.getByRole('button', { name: '重新开始上下文', exact: true }).click();
    await page
      .getByRole('alertdialog', { name: '重新开始上下文', exact: true })
      .getByRole('button', { name: '确认重置', exact: true })
      .click();
    await expect
      .poll(async () => {
        return (await readWork(page, daemon.origin, id)).state.contextStartAfterMessageId;
      })
      .not.toBeNull();
    expect((await readWork(page, daemon.origin, id)).state.todos).toHaveLength(1);
    await dialog.getByRole('button', { name: '重置任务状态', exact: true }).click();
    await page
      .getByRole('alertdialog', { name: '重置任务状态', exact: true })
      .getByRole('button', { name: '确认重置', exact: true })
      .click();
    await expect
      .poll(async () => {
        return (await readWork(page, daemon.origin, id)).state.todos.length;
      })
      .toBe(0);
    expect((await readWork(page, daemon.origin, id)).state.plan).toBeNull();
    expect((await readSession(page, daemon.origin, id)).messages).toEqual(original.messages);
    const mainRequests = model.requests.filter((request) => {
      return Array.isArray(request.body['tools']);
    });
    const summaryRequests = model.requests.filter((request) => {
      return !Array.isArray(request.body['tools']);
    });
    expect(mainRequests).toHaveLength(5);
    expect(summaryRequests).toHaveLength(completed.compactions.length);
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
    const toolRow = page.getByLabel('ask_user 工具调用', { exact: true }).first();
    await expect(toolRow).toHaveAttribute('aria-busy', 'true');
    await expect(toolRow.locator('[data-slot="tool-loading"]')).toBeVisible();
    await expect(toolRow.locator('[data-slot="tool-icon"]')).toHaveCount(0);
    await expect(toolRow.getByRole('status')).toHaveClass('sr-only');
    const toggle = toolRow.getByRole('button', { name: '展开 ask_user 工具详情', exact: true });
    await toggle.hover();
    await expect(toggle.locator('[data-slot="tool-chevron"]')).toBeVisible();
    await expect(toggle.locator('[data-slot="tool-loading"]')).toBeHidden();
    await toggle.click();
    await expect(toolRow.getByRole('region', { name: '调用参数', exact: true })).toBeVisible();
    await toolRow.getByRole('button', { name: '收起 ask_user 工具详情', exact: true }).click();
    await question.getByRole('button', { name: /^方案 A/ }).click();
    await question.getByLabel('回答 Agent', { exact: true }).fill('方案 A，先读资料');
    await question.getByRole('button', { name: '下一题', exact: true }).click();
    await question.getByRole('button', { name: '速度', exact: true }).click();
    await question.getByRole('button', { name: '质量', exact: true }).click();
    await mkdir(join(process.cwd(), 'output', 'playwright'), { recursive: true });
    await page.screenshot({ path: 'output/playwright/m3-question.png' });
    await question.getByRole('button', { name: '上一题', exact: true }).click();
    await expect(question.getByRole('button', { name: /^方案 A/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await question.getByRole('button', { name: '下一题', exact: true }).click();
    await question.getByRole('button', { name: '提交回答', exact: true }).click();
    await expect(page.getByText(/Agent 收到回答：.*方案 A，先读资料/)).toBeVisible();
    await expect(page.getByRole('button', { name: '停止', exact: true })).toBeHidden();
    await expandCompletedProcesses(page);
    await expect(toolRow).toHaveAttribute('aria-busy', 'false');
    await expect(toolRow.locator('[data-slot="tool-loading"]')).toHaveCount(0);
    await expect(toolRow.locator('[data-slot="tool-icon"]')).toBeVisible();
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
    expect(work.state.questions[0]?.answers).toEqual([
      { questionId: 'approach', optionIds: ['a'], text: '方案 A，先读资料' },
      { questionId: 'priorities', optionIds: ['speed', 'quality'], text: '' },
    ]);
    expect((await readSession(page, daemon.origin, id)).session.workspaceId).toBeNull();
    const mainRequests = model.requests.filter((request) => {
      return Array.isArray(request.body['tools']);
    });
    const summaryRequests = model.requests.filter((request) => {
      return !Array.isArray(request.body['tools']);
    });
    expect(mainRequests).toHaveLength(4);
    expect(summaryRequests).toHaveLength(work.compactions.length);
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
    await preview.getByRole('button', { name: '关闭', exact: true }).click();
    await page
      .getByLabel('消息', { exact: true })
      .evaluate((element: HTMLTextAreaElement, encoded: string) => {
        const bytes = Uint8Array.from(atob(encoded), (character) => {
          return character.charCodeAt(0);
        });
        const data = new DataTransfer();
        data.items.add(new File([bytes], 'clipboard.png', { type: 'image/png' }));
        element.dispatchEvent(
          new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }),
        );
      }, png.toString('base64'));
    await expect(
      page.getByRole('button', { name: '预览附件 clipboard.png', exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel('消息', { exact: true })).toHaveValue('');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect
      .poll(async () => {
        return (await readSession(page, daemon.origin, id)).runs.length;
      })
      .toBe(2);
    await expect
      .poll(async () => {
        return (await readSession(page, daemon.origin, id)).session.activeRunId;
      })
      .toBeNull();
    const pasted = await readSession(page, daemon.origin, id);
    expect(
      pasted.messages.filter((message) => {
        return message.role === 'user';
      })[1]?.attachmentIds,
    ).toHaveLength(1);
    const mainRequests = model.requests.filter((request) => {
      return Array.isArray(request.body['tools']);
    });
    expect(mainRequests).toHaveLength(2);
    expect(JSON.stringify(mainRequests[1]?.body['messages'])).toContain('image_url');
    const imageWork = await readWork(page, daemon.origin, id);
    const summaryRequests = model.requests.filter((request) => {
      return !Array.isArray(request.body['tools']);
    });
    expect(summaryRequests).toHaveLength(imageWork.compactions.length);
  } finally {
    await daemon.stop();
    await model.close();
  }
});

test('M3 上下文摘要版本可比较与选择，历史快照独立保留', async ({ page, daemon }) => {
  const model = await startM3Model();
  try {
    await setupModel(page, daemon.origin, model.origin);
    const id = await firstSend(page, '上下文版本验收第1轮');
    const sendRound = async (round: number): Promise<void> => {
      await expect
        .poll(async () => {
          return (await readSession(page, daemon.origin, id)).session.activeRunId;
        })
        .toBeNull();
      await page.getByLabel('消息', { exact: true }).fill(`上下文版本验收第${round}轮`);
      await page.getByRole('button', { name: '发送', exact: true }).click();
      await expect
        .poll(async () => {
          return (await readSession(page, daemon.origin, id)).runs.length;
        })
        .toBe(round);
      await expect
        .poll(async () => {
          return (await readSession(page, daemon.origin, id)).session.activeRunId;
        })
        .toBeNull();
    };
    await expect(page.getByText('M3 会话已完成。', { exact: true })).toBeVisible();
    await sendRound(2);
    await sendRound(3);
    const openWork = page.getByRole('button', { name: '上下文与工作状态', exact: true });
    await openWork.click();
    let dialog = page.getByRole('dialog', { name: '上下文与工作状态', exact: true });
    await dialog.getByRole('button', { name: '压缩上下文', exact: true }).click();
    await expect
      .poll(async () => {
        return (await readWork(page, daemon.origin, id)).compactions.length;
      })
      .toBe(1);
    await expect(dialog).toContainText('M3 摘要目标');
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await sendRound(4);
    await sendRound(5);
    const before = await readSession(page, daemon.origin, id);
    await openWork.click();
    dialog = page.getByRole('dialog', { name: '上下文与工作状态', exact: true });
    await dialog.getByRole('button', { name: '压缩上下文', exact: true }).click();
    await expect
      .poll(async () => {
        return (await readWork(page, daemon.origin, id)).compactions.length;
      })
      .toBe(2);
    const versions = await readWork(page, daemon.origin, id);
    expect(versions.compactions[1]?.parentId).toBe(versions.compactions[0]?.id);
    const firstOption = dialog.getByRole('combobox', { name: '上下文查看版本', exact: true });
    await firstOption.click();
    await page.getByRole('option', { name: /^版本 1 ·/ }).click();
    await expect(dialog.getByText('有变化', { exact: true }).first()).toBeVisible();
    await mkdir(join(process.cwd(), 'output', 'playwright'), { recursive: true });
    await page.screenshot({ path: 'output/playwright/m3-context-versions.png' });
    await dialog.getByRole('button', { name: '使用所选版本', exact: true }).click();
    await page
      .getByRole('alertdialog', { name: '使用上下文检查点', exact: true })
      .getByRole('button', { name: '使用此版本', exact: true })
      .click();
    await expect
      .poll(async () => {
        return (await readWork(page, daemon.origin, id)).state.compaction?.id;
      })
      .toBe(versions.compactions[0]?.id);
    const selected = await readSession(page, daemon.origin, id);
    expect(selected.messages).toEqual(before.messages);
    expect(selected.branches).toHaveLength(1);
    expect((await readWork(page, daemon.origin, id)).checkpoints).toHaveLength(0);
    expect(
      model.requests.filter((request) => {
        return Array.isArray(request.body['tools']);
      }),
    ).toHaveLength(5);
    expect(
      model.requests.filter((request) => {
        return !Array.isArray(request.body['tools']);
      }),
    ).toHaveLength(2);
  } finally {
    await daemon.stop();
    await model.close();
  }
});
