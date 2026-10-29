import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AuthStatusSchema,
  SessionSnapshotSchema,
  WorkSnapshotSchema,
} from '@my-pi-harness/protocol';
import { Value } from 'typebox/value';
import { startApprovalModel } from './approval-model.js';
import { registerTestWorkspace } from './workspace-fixtures.js';
import { test, expect } from './fixture.js';
import { configureTestProvider } from './model-fixtures.js';
import { startToolModel } from './tool-model-server.js';
import { chooseConversationModel, chooseOption } from './ui-controls.js';
import { expandCompletedProcesses } from './process-controls.js';

test('权限菜单展示三种策略、说明、统一图标和当前选项，完整访问使用警示样式', async ({
  page,
  daemon,
}) => {
  await page.goto(daemon.origin);
  const trigger = page.getByRole('combobox', { name: '执行批准方式', exact: true });
  await expect(trigger).toContainText('完全访问权限');
  await chooseOption(page, trigger, '请求批准');
  await expect(trigger).toContainText('请求批准');
  const message = page.getByLabel('消息', { exact: true });
  const surface = message.locator('..');
  const surfaceBorder = await surface.evaluate((element) => {
    return getComputedStyle(element).borderColor;
  });
  await message.focus();
  const triggerStyle = await trigger.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      border: style.borderColor,
      shadow: style.boxShadow,
      background: style.backgroundColor,
    };
  });
  await trigger.click();
  await expect(page.getByRole('option')).toHaveCount(3);
  const request = page.getByRole('option', { name: '请求批准', exact: true });
  const automatic = page.getByRole('option', { name: '帮我批准', exact: true });
  const fullAccess = page.getByRole('option', { name: '完全访问权限', exact: true });
  await expect(request).toHaveAttribute('aria-selected', 'true');
  await expect(request).toContainText('修改工作区文件、执行命令和工具调用前询问');
  await expect(automatic).toContainText('由独立 AI 复核文件修改、命令和工具调用');
  await expect(fullAccess).toContainText('自动批准工具调用；命令不受沙箱限制');
  for (const item of [request, automatic, fullAccess]) {
    await expect(item.locator('svg').first()).toHaveAttribute('width', '16');
    await expect(item.locator('svg').first()).toHaveAttribute('height', '16');
  }
  await mkdir('output/playwright', { recursive: true });
  await page.screenshot({ path: 'output/playwright/approval-menu.png' });
  await fullAccess.click();
  await expect(trigger).toContainText('完全访问权限');
  await expect(trigger).toHaveClass(/text-warning-solid/);
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveCSS('border-color', triggerStyle.border);
  await expect(trigger).toHaveCSS('box-shadow', triggerStyle.shadow);
  await expect(surface).toHaveCSS('border-color', surfaceBorder);
  await page.screenshot({ path: 'output/playwright/approval-focus.png' });
  await message.focus();
  await expect(surface).not.toHaveCSS('border-color', surfaceBorder);
  await trigger.focus();
  await expect(surface).toHaveCSS('border-color', surfaceBorder);
  await trigger.press('Enter');
  await expect(fullAccess).toHaveAttribute('aria-selected', 'true');
  await expect(fullAccess).toBeFocused();
  await page.keyboard.press('Home');
  await expect(request).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(automatic).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(trigger).toContainText('帮我批准');
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveCSS('border-color', triggerStyle.border);
  await expect(trigger).toHaveCSS('box-shadow', triggerStyle.shadow);
  await expect(trigger).not.toHaveCSS('background-color', triggerStyle.background);
  await expect(surface).toHaveCSS('border-color', surfaceBorder);
  await chooseOption(page, trigger, '请求批准');
  await expect(trigger).toContainText('请求批准');
});

test('旧只读会话保持原策略，打开新菜单不提权，用户明确选择后才更新', async ({ page, daemon }) => {
  const model = await startToolModel();
  try {
    await page.goto(daemon.origin);
    const provider = await configureTestProvider(page, model.origin);
    const status: unknown = await (
      await page.request.get(`${daemon.origin}/api/auth/status`)
    ).json();
    if (!Value.Check(AuthStatusSchema, status) || !status.csrfToken)
      throw new Error('Legacy policy fixture requires authorization');
    const response = await page.request.post(`${daemon.origin}/api/sessions`, {
      headers: { Origin: daemon.origin, 'X-CSRF-Token': status.csrfToken },
      data: {
        title: '旧只读会话',
        providerId: provider.id,
        modelId: 'chat-model',
        thinkingLevel: 'off',
        approvalMode: 'read-only',
      },
    });
    const created: unknown = await response.json();
    if (!response.ok() || !Value.Check(SessionSnapshotSchema, created))
      throw new Error('Legacy policy fixture creation failed');
    const policy = async (): Promise<string> => {
      const result: unknown = await (
        await page.request.get(
          `${daemon.origin}/api/sessions/${encodeURIComponent(created.session.id)}`,
        )
      ).json();
      if (!Value.Check(SessionSnapshotSchema, result)) throw new Error('Invalid legacy session');
      return result.session.approvalMode;
    };
    await page.reload();
    await page.getByRole('button', { name: /^旧只读会话 / }).click();
    const trigger = page.getByRole('combobox', { name: '执行批准方式', exact: true });
    await expect(trigger).toContainText('只读');
    await trigger.click();
    await expect(page.getByRole('option')).toHaveCount(3);
    await expect(page.getByRole('option', { name: '只读', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    expect(await policy()).toBe('read-only');
    await chooseOption(page, trigger, '帮我批准');
    await expect(trigger).toContainText('帮我批准');
    await expect.poll(policy).toBe('auto');
    expect(model.requests).toHaveLength(0);
  } finally {
    await daemon.stop();
    await model.close();
  }
});

for (const scenario of ['auto-allow', 'full-access', 'auto-fallback'] as const) {
  test(`真实工具执行和审批来源：${scenario}`, async ({ page, daemon }) => {
    const directory = await mkdtemp(join(tmpdir(), 'my-pi-approval-browser-'));
    let review: 'allow' | 'invalid' = 'allow';
    if (scenario === 'auto-fallback') review = 'invalid';
    const model = await startApprovalModel(review);
    try {
      await page.goto(daemon.origin);
      await configureTestProvider(page, model.origin);
      await registerTestWorkspace(page, '审批验证项目', directory);
      await page.reload();
      await chooseOption(
        page,
        page.getByRole('combobox', { name: '选择工作区', exact: true }),
        '审批验证项目',
      );
      await chooseConversationModel(page, 'Queue Model', 'Chat');
      let label = '帮我批准';
      if (scenario === 'full-access') label = '完全访问权限';
      await chooseOption(
        page,
        page.getByRole('combobox', { name: '执行批准方式', exact: true }),
        label,
      );
      const creation = page.waitForResponse((response) => {
        return (
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname === '/api/sessions'
        );
      });
      await page.getByLabel('消息', { exact: true }).fill('请创建 approved.txt 测试文件');
      await page.getByRole('button', { name: '发送', exact: true }).click();
      const createdResponse = await creation;
      const created: unknown = await createdResponse.json();
      if (!createdResponse.ok() || !Value.Check(SessionSnapshotSchema, created))
        throw new Error('Approval fixture session creation failed');
      const card = page.getByLabel('write_file 工具调用', { exact: true });
      if (scenario === 'auto-fallback') {
        await expect(card.getByRole('button', { name: '允许本次操作', exact: true })).toBeVisible();
        await expect(readFile(join(directory, 'approved.txt'))).rejects.toMatchObject({
          code: 'ENOENT',
        });
        await expect(card.getByLabel('审批记录', { exact: true })).toContainText(
          'AI 复核 · 转人工确认',
        );
        await card.getByRole('button', { name: '允许本次操作', exact: true }).click();
      }
      await expect(page.getByText('审批执行已完成。', { exact: true })).toBeVisible();
      expect(await readFile(join(directory, 'approved.txt'), 'utf8')).toBe(
        'Approval fixture content\n',
      );
      await expect(page.getByRole('button', { name: '停止', exact: true })).toBeHidden();
      await expandCompletedProcesses(page);
      await expect(card.getByRole('button', { name: '允许本次操作', exact: true })).toHaveCount(0);
      if (scenario !== 'auto-fallback')
        await card.getByRole('button', { name: '展开 write_file 工具详情', exact: true }).click();
      const audit = card.getByLabel('审批记录', { exact: true });
      if (scenario === 'auto-allow') {
        await expect(audit).toContainText('AI 复核 · 已批准');
        await expect(audit).toContainText('本次修改只创建用户要求的工作区测试文件。');
      }
      if (scenario === 'auto-fallback') await expect(audit).toContainText('用户决定 · 已批准');
      if (scenario === 'full-access') {
        await expect(audit).toContainText('完全访问权限 · 已批准');
        expect(model.reviews).toHaveLength(0);
      } else {
        expect(model.reviews).toHaveLength(1);
        expect(model.reviews[0]?.body['tools'] ?? []).toEqual([]);
      }
      const mainRequests = model.requests.filter((request) => {
        return Array.isArray(request.body['tools']) && !model.reviews.includes(request);
      });
      expect(mainRequests).toHaveLength(2);
      expect(model.requests).toHaveLength(
        mainRequests.length + model.reviews.length + model.summaries.length,
      );
      const workResponse = await page.request.get(
        `${daemon.origin}/api/sessions/${encodeURIComponent(created.session.id)}/work?branchId=${encodeURIComponent(created.session.activeBranchId)}`,
      );
      const work: unknown = await workResponse.json();
      if (
        !workResponse.ok() ||
        !Value.Check(WorkSnapshotSchema, work) ||
        work.state.branchId !== created.session.activeBranchId
      )
        throw new Error('Invalid completed approval work snapshot');
      expect(model.summaries).toHaveLength(work.compactions.length);
      for (const compaction of work.compactions) {
        expect(compaction.strategy).toBe('model');
        expect(compaction.reason).toBe('automatic');
      }
      await page.reload();
      await page.getByRole('button', { name: /^请创建 approved.txt 测试文件 / }).click();
      await expect(page.getByText('审批执行已完成。', { exact: true })).toBeVisible();
      await expandCompletedProcesses(page);
      await card.getByRole('button', { name: '展开 write_file 工具详情', exact: true }).click();
      await expect(card.getByLabel('审批记录', { exact: true })).toBeVisible();
      expect(await readFile(join(directory, 'approved.txt'), 'utf8')).toBe(
        'Approval fixture content\n',
      );
    } finally {
      await daemon.stop();
      await model.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
}
