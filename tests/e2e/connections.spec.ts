import { test, expect } from './fixture.js';
import { chooseOption, openUserSettings } from './ui-controls.js';

test('设置中创建 Token 连接、核实账户并断开', async ({ page, daemon }, testInfo) => {
  await page.goto(daemon.origin);
  await openUserSettings(page);
  await page.getByRole('tab', { name: '连接', exact: true }).click();
  await page.getByRole('button', { name: '添加连接', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '外部连接配置', exact: true });
  await editor.getByLabel('名称', { exact: true }).fill('Browser GitHub');
  await chooseOption(
    page,
    editor.getByRole('combobox', { name: '连接授权方式', exact: true }),
    '访问 Token',
  );
  await editor.getByRole('button', { name: '保存配置', exact: true }).click();
  await expect(editor).toBeHidden();
  const row = page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: 'Browser GitHub', exact: true }) });
  await expect(row).toContainText('尚未连接');
  const secret = row.getByLabel('访问 Token · Browser GitHub', { exact: true });
  await secret.fill('synthetic-browser-connection-token');
  await row.getByRole('button', { name: '保存并连接', exact: true }).click();
  await expect(row).toContainText('已连接 · Browser connection account');
  await expect(secret).toHaveValue('');
  const publicState = await page.request.get(`${daemon.origin}/api/connections`);
  expect(publicState.ok()).toBe(true);
  expect(await publicState.text()).not.toContain('synthetic-browser-connection-token');
  await page.screenshot({ path: testInfo.outputPath('connection-connected.png'), fullPage: true });
  await row.getByRole('button', { name: '断开', exact: true }).click();
  await expect(row).toContainText('尚未连接');
  await expect(row.getByRole('button', { name: '断开', exact: true })).toBeHidden();
  await page.reload();
  await openUserSettings(page);
  await page.getByRole('tab', { name: '连接', exact: true }).click();
  await expect(row).toContainText('尚未连接');
  await page.screenshot({
    path: testInfo.outputPath('connection-disconnected.png'),
    fullPage: true,
  });
});
