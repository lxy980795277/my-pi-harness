import { test, expect } from './fixture.js';
import { openUserSettings, chooseOption } from './ui-controls.js';
import { configureTestProvider } from './model-fixtures.js';
import { startToolSequenceModel } from './m2-completion-model.js';
import { SessionSnapshotSchema } from '@my-pi-harness/protocol';
import { Value } from 'typebox/value';

/** Real built daemon, browser controls, Pi model requests and JSONL exercise the same selected version. */
test('创建 Skill 后显式选择，指令进入模型和会话日志', async ({ page, daemon }, testInfo) => {
  const model = await startToolSequenceModel([], 'Skill 已完成。');
  try {
    await page.goto(daemon.origin);
    await openUserSettings(page);
    await page.getByRole('tab', { name: 'Skills', exact: true }).click();
    await page.getByRole('button', { name: '创建 Skill', exact: true }).click();
    await page.getByLabel('名称', { exact: true }).fill('browser-skill');
    await page.getByLabel('描述', { exact: true }).fill('Browser task instructions');
    await page
      .getByLabel('指令', { exact: true })
      .fill('Use the frozen browser instruction marker: SKILL_BROWSER_1429.');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(
      page.getByRole('button', { name: /browser-skill Browser task instructions/u }),
    ).toBeVisible();
    await page.getByRole('button', { name: '关闭设置', exact: true }).click();
    await configureTestProvider(page, model.origin);
    await page.reload();
    await chooseOption(
      page,
      page.getByRole('combobox', { name: '对话模型', exact: true }),
      'Queue Model · Chat',
    );
    await page.getByRole('button', { name: '添加上下文', exact: true }).click();
    await page.getByRole('button', { name: 'Skill', exact: true }).click();
    const picker = page.getByRole('dialog', { name: /Skills · 已选/u });
    await picker.getByRole('button', { name: /browser-skill Browser task instructions/u }).click();
    await expect(picker).toContainText('已选 1/16');
    await picker.getByRole('button', { name: '关闭 Skill 选择', exact: true }).click();
    await page.getByLabel('消息', { exact: true }).fill('使用这个 Skill');
    const accepted = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname.endsWith('/inputs'),
    );
    await page.getByRole('button', { name: '发送', exact: true }).click();
    const response = await accepted;
    expect(response.ok()).toBe(true);
    const snapshot: unknown = await response.json();
    if (!Value.Check(SessionSnapshotSchema, snapshot)) throw new Error('Invalid Skill snapshot');
    expect(snapshot.runs[0]?.skills).toHaveLength(1);
    await expect(page.getByText('Skill 已完成。', { exact: true })).toBeVisible();
    expect(JSON.stringify(model.requests[0]?.body)).toContain('SKILL_BROWSER_1429');
    const log = await page.request.get(`${daemon.origin}/api/sessions/${snapshot.session.id}/log`);
    expect(log.ok()).toBe(true);
    expect(await log.text()).toContain('SKILL_BROWSER_1429');
    await page.screenshot({ path: testInfo.outputPath('skill-selected.png'), fullPage: true });
    await page.reload();
    await page.getByRole('button', { name: /使用这个 Skill/u }).click();
    await expect(page.getByText('Skill 已完成。', { exact: true })).toBeVisible();
    expect(model.requests).toHaveLength(1);
  } finally {
    await model.close();
  }
});

test('办公插件安装、逐项停用和卸载反映到 Skills 目录', async ({ page, daemon }, testInfo) => {
  await page.goto(daemon.origin);
  await openUserSettings(page);
  await page.getByRole('tab', { name: '插件', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Documents', exact: true })).toBeVisible();
  const card = page
    .getByRole('heading', { name: 'Documents', exact: true })
    .locator('..')
    .locator('..')
    .locator('..');
  await card.getByRole('button', { name: '安装', exact: true }).click();
  await expect(card).toContainText('Skill · documents');
  await page.getByRole('tab', { name: 'Skills', exact: true }).click();
  await expect(page.getByRole('button', { name: /documents 在工作区创建/u })).toBeVisible();
  await page.getByRole('tab', { name: '插件', exact: true }).click();
  await card.getByRole('button', { name: '停用', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Skills', exact: true }).click();
  await expect(page.getByRole('button', { name: /documents 在工作区创建/u })).toBeHidden();
  await page.getByRole('tab', { name: '插件', exact: true }).click();
  await card.getByRole('button', { name: '卸载', exact: true }).click();
  await expect(card.getByRole('button', { name: '安装', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('plugin-management.png'), fullPage: true });
});
