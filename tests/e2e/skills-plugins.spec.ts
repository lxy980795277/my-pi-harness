import { test, expect } from './fixture.js';
import { openUserSettings, chooseOption } from './ui-controls.js';
import { configureTestProvider } from './model-fixtures.js';
import { startToolSequenceModel } from './m2-completion-model.js';
import {
  PluginDetailSchema,
  SessionSnapshotSchema,
  SkillViewSchema,
  type PluginDetail,
  type SkillView,
} from '@my-pi-harness/protocol';
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { Type } from 'typebox';
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

test('插件预览、独立 Skill 开关和整体停用持久反映到目录', async ({ page, daemon }, testInfo) => {
  await page.goto(daemon.origin);
  const preview = await readPluginDetail(page.request, daemon.origin, 'documents');
  expect(preview.plugin.installed).toBe(false);
  const skill = preview.skills.find((entry) => entry.name === 'documents');
  if (skill === undefined) throw new Error('Documents plugin must provide its bundled Skill');

  await openUserSettings(page);
  await page.getByRole('tab', { name: '插件', exact: true }).click();
  const card = page.getByRole('region', { name: 'Documents 插件', exact: true });
  const detail = page.getByRole('region', { name: '插件详情', exact: true });
  const skillDetail = page.getByRole('region', { name: 'Skill 详情', exact: true });
  const skillToggle = detail.getByRole('switch', { name: '启用 documents 技能', exact: true });
  const skillBodyToggle = skillDetail.getByRole('switch', {
    name: '启用 documents 技能',
    exact: true,
  });

  await card.getByRole('button', { name: '查看 Documents 插件详情', exact: true }).click();
  await expect(detail).toBeVisible();
  await expect(skillToggle).toBeDisabled();
  await expect(skillToggle).not.toBeChecked();
  await detail.getByRole('button', { name: '查看 documents 技能详情', exact: true }).click();
  await expectRenderedInstructions(skillDetail, skill.content);
  await expect(skillBodyToggle).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('plugin-skill-preview.png'), fullPage: true });
  await skillDetail.getByRole('button', { name: '返回 Documents', exact: true }).click();
  await detail.getByRole('button', { name: '返回插件市场', exact: true }).click();

  await card.getByRole('button', { name: '安装', exact: true }).click();
  await expect(card.getByRole('button', { name: '卸载', exact: true })).toBeVisible();
  await expect(detail).toBeHidden();
  await expect(
    card.getByRole('button', { name: '查看 documents 技能详情', exact: true }),
  ).toBeHidden();
  await expect(
    card.getByRole('switch', { name: '启用 Documents 插件', exact: true }),
  ).toBeChecked();
  expect((await openSkillCatalog(page)).find((entry) => entry.name === 'documents')).toMatchObject({
    pluginId: 'documents',
    enabled: true,
  });
  await expect(page.getByRole('button', { name: /documents 创建有样式/u })).toBeVisible();

  await page.getByRole('tab', { name: '插件', exact: true }).click();
  await card.getByRole('button', { name: '查看 Documents 插件详情', exact: true }).click();
  await skillToggle.click();
  await expect(skillToggle).not.toBeChecked();
  await expect(detail).toBeVisible();
  await expect(skillDetail).toBeHidden();
  await detail.getByRole('button', { name: '查看 documents 技能详情', exact: true }).click();
  await expectRenderedInstructions(skillDetail, skill.content);
  await expect(skillBodyToggle).not.toBeChecked();
  await expect(skillBodyToggle).toBeEnabled();
  await skillDetail.getByRole('button', { name: '返回 Documents', exact: true }).click();
  await expect(skillToggle).not.toBeChecked();

  await page.reload();
  await openUserSettings(page);
  const disabledSkills = await openSkillCatalog(page);
  expect(disabledSkills.find((entry) => entry.name === 'documents')).toMatchObject({
    pluginId: 'documents',
    enabled: false,
  });
  await expect(page.getByRole('button', { name: /documents 创建有样式/u })).toBeVisible();
  await page.getByRole('tab', { name: '插件', exact: true }).click();
  await card.getByRole('button', { name: '查看 Documents 插件详情', exact: true }).click();
  await expect(skillToggle).not.toBeChecked();
  await detail.getByRole('button', { name: '查看 documents 技能详情', exact: true }).click();
  await skillBodyToggle.click();
  await expect(skillBodyToggle).toBeChecked();
  await expect(skillDetail).toBeVisible();
  await expect(detail).toBeHidden();
  await skillDetail.getByRole('button', { name: '返回 Documents', exact: true }).click();
  await expect(skillToggle).toBeChecked();
  await expect(detail.getByRole('button', { name: '卸载', exact: true })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('plugin-details.png'), fullPage: true });
  await detail.getByRole('button', { name: '返回插件市场', exact: true }).click();
  expect((await openSkillCatalog(page)).find((entry) => entry.name === 'documents')).toMatchObject({
    pluginId: 'documents',
    enabled: true,
  });
  await expect(page.getByRole('button', { name: /documents 创建有样式/u })).toBeVisible();
  await page.getByRole('tab', { name: '插件', exact: true }).click();

  const pluginToggle = card.getByRole('switch', { name: '启用 Documents 插件', exact: true });
  await pluginToggle.click();
  await expect(pluginToggle).not.toBeChecked();
  await expect(detail).toBeHidden();
  const inactivePluginSkills = await openSkillCatalog(page);
  expect(inactivePluginSkills.find((entry) => entry.name === 'documents')).toMatchObject({
    enabled: false,
  });
  await expect(page.getByRole('button', { name: /documents 创建有样式/u })).toBeVisible();
  await page.getByRole('tab', { name: '插件', exact: true }).click();
  await card.getByRole('button', { name: '查看 Documents 插件详情', exact: true }).click();
  await expect(skillToggle).not.toBeChecked();
  await expect(skillToggle).toBeEnabled();
  await detail.getByRole('button', { name: '查看 documents 技能详情', exact: true }).click();
  await expectRenderedInstructions(skillDetail, skill.content);
  await expect(skillBodyToggle).toBeEnabled();
  await skillDetail.getByRole('button', { name: '返回 Documents', exact: true }).click();
  await detail.getByRole('button', { name: '返回插件市场', exact: true }).click();
  await card.getByRole('button', { name: '卸载', exact: true }).click();
  await expect(card.getByRole('button', { name: '安装', exact: true })).toBeVisible();
  const removed = await readPluginDetail(page.request, daemon.origin, 'documents');
  expect(removed.plugin.installed).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('plugin-market.png'), fullPage: true });
});

test('Google 详情失败重试、逐级导航和深色展示保留真实 App', async ({ page, daemon }, testInfo) => {
  await page.goto(daemon.origin);
  const preview = await readPluginDetail(page.request, daemon.origin, 'google');
  expect(preview.plugin.installed).toBe(false);
  expect(preview.plugin.manifest.apps.length).toBeGreaterThan(1);
  const skill = preview.skills[0];
  if (skill === undefined) throw new Error('Google plugin must provide a bundled Skill');
  await page.route(
    '**/api/plugins/google',
    async (route) => {
      await route.fulfill({
        status: 503,
        json: { code: 'PLUGIN_UNAVAILABLE', message: '插件预览暂时不可用' },
      });
    },
    { times: 1 },
  );
  await openUserSettings(page);
  await page.getByRole('tab', { name: '插件', exact: true }).click();
  const category = page.getByRole('combobox', { name: '插件分类', exact: true });
  await chooseOption(page, category, '在线服务');
  const card = page.getByRole('region', { name: 'Google 插件', exact: true });
  await card.getByRole('button', { name: '查看 Google 插件详情', exact: true }).click();
  const detail = page.getByRole('region', { name: '插件详情', exact: true });
  await expect(detail).toBeFocused();
  await expect(detail.getByRole('alert')).toContainText('插件预览暂时不可用');
  const recovered = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/plugins/google' && response.ok(),
  );
  await detail.getByRole('button', { name: '重试', exact: true }).click();
  await recovered;
  await expect(detail.getByRole('alert')).toBeHidden();
  for (const app of preview.plugin.manifest.apps) {
    await expect(detail.getByText(app.name, { exact: true })).toBeVisible();
  }
  await expect(detail.getByRole('button', { name: '安装', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('plugin-google-apps.png'), fullPage: true });

  await page.setViewportSize({ width: 1000, height: 520 });
  const viewport = page
    .getByRole('dialog', { name: '设置', exact: true })
    .locator('[data-radix-scroll-area-viewport]');
  await viewport.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect
    .poll(async () => viewport.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await detail.getByRole('button', { name: `查看 ${skill.name} 技能详情`, exact: true }).click();
  const skillDetail = page.getByRole('region', { name: 'Skill 详情', exact: true });
  await expectPageAtStart(skillDetail, viewport);
  await expectRenderedInstructions(skillDetail, skill.content);
  await skillDetail.getByRole('button', { name: '返回 Google', exact: true }).click();
  await expectPageAtStart(detail, viewport);
  await detail.getByRole('button', { name: '返回插件市场', exact: true }).click();
  await expectPageAtStart(page.getByRole('region', { name: '插件市场', exact: true }), viewport);
  await expect(category).toHaveText('在线服务');
  await expect(page.getByRole('region', { name: 'Documents 插件', exact: true })).toBeHidden();
  await expect(card.getByRole('button', { name: '安装', exact: true })).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('tab', { name: '通用设置', exact: true }).click();
  await page.getByRole('switch', { name: '深色模式', exact: true }).click();
  await expect(page.locator('html')).toHaveClass(/dark/u);
  await page.getByRole('tab', { name: '插件', exact: true }).click();
  await card.getByRole('button', { name: '查看 Google 插件详情', exact: true }).click();
  for (const app of preview.plugin.manifest.apps) {
    await expect(detail.getByText(app.name, { exact: true })).toBeVisible();
  }
  await page.screenshot({ path: testInfo.outputPath('plugin-google-dark.png'), fullPage: true });
});

async function readPluginDetail(
  request: APIRequestContext,
  origin: string,
  id: string,
): Promise<PluginDetail> {
  const response = await request.get(`${origin}/api/plugins/${id}`);
  expect(response.ok()).toBe(true);
  const detail: unknown = await response.json();
  if (!Value.Check(PluginDetailSchema, detail)) throw new Error('Invalid plugin detail response');
  return detail;
}

async function expectRenderedInstructions(detail: Locator, content: string): Promise<void> {
  const paragraph = content.split(/\n\s*\n/u).find((entry) => entry.trim().length > 0);
  if (paragraph === undefined) throw new Error('Bundled Skill instructions must not be empty');
  await expect(detail).toBeVisible();
  const heading = /^(#{1,6})\s+(.+)$/u.exec(paragraph.trim());
  if (heading?.[1] !== undefined && heading[2] !== undefined)
    await expect(
      detail.getByRole('heading', { level: heading[1].length, name: heading[2], exact: true }),
    ).toBeVisible();
  else await expect(detail.locator('p').filter({ hasText: paragraph.trim() })).toBeVisible();
  await expect(detail.locator('textarea')).toHaveCount(0);
}

async function expectPageAtStart(region: Locator, viewport: Locator): Promise<void> {
  await expect(region).toBeFocused();
  await expect.poll(async () => viewport.evaluate((element) => element.scrollTop)).toBe(0);
}

async function openSkillCatalog(page: Page): Promise<SkillView[]> {
  const requested = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/skills',
  );
  await page.getByRole('tab', { name: 'Skills', exact: true }).click();
  const response = await requested;
  expect(response.ok()).toBe(true);
  const skills: unknown = await response.json();
  if (!Value.Check(Type.Array(SkillViewSchema), skills)) throw new Error('Invalid Skill catalog');
  return skills;
}
