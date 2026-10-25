import { test, expect } from './fixture.js';
import { openUserSettings, openMcpAdvancedSettings } from './ui-controls.js';

test('远程 MCP JSON、秘密、授权与脱敏配置交换', async ({ page, daemon }, testInfo) => {
  await page.goto(daemon.origin);
  await openUserSettings(page);
  await page.getByRole('tab', { name: 'MCP', exact: true }).click();
  await page.getByRole('button', { name: '添加 MCP 服务器', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '添加 MCP 服务器', exact: true });
  await editor.getByRole('tab', { name: 'JSON 配置', exact: true }).click();
  await editor.getByLabel('远程 MCP JSON', { exact: true }).fill(
    JSON.stringify({
      mcpServers: {
        'Browser remote': {
          url: 'https://example.com/mcp',
          type: 'streamable-http',
          headers: { Authorization: 'synthetic-initial-authorization' },
          oauth: false,
        },
      },
    }),
  );
  await editor.getByRole('button', { name: '保存配置', exact: true }).click();
  await expect(editor).toBeHidden();
  const row = page.getByRole('region', { name: 'Browser remote 远程 MCP', exact: true });
  await expect(row).toContainText('已停用');
  await row.getByRole('button', { name: '秘密请求头', exact: true }).click();
  const secret = page.getByRole('dialog', { name: '秘密请求头', exact: true });
  await secret.getByLabel('秘密请求头值', { exact: true }).fill('synthetic-remote-authorization');
  await secret.getByRole('button', { name: '保存秘密', exact: true }).click();
  await expect(secret).toBeHidden();
  await row.getByRole('button', { name: '远端授权', exact: true }).click();
  const trust = page.getByRole('alertdialog', { name: '确认远端 MCP 授权？', exact: true });
  await expect(trust).toContainText('https://example.com/mcp');
  await expect(trust).not.toContainText('synthetic-remote-authorization');
  await trust.getByRole('button', { name: '确认远端范围', exact: true }).click();
  await expect(trust).toBeHidden();
  await expect(row).toContainText('已启用');
  await openMcpAdvancedSettings(page);
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出脱敏配置', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('mcp-configuration.json');
  const exported = await page.request.get(`${daemon.origin}/api/mcp/configuration/export`);
  expect(exported.ok()).toBe(true);
  const content = await exported.text();
  expect(content).not.toContain('synthetic-remote-authorization');
  expect(content).not.toContain('synthetic-initial-authorization');
  expect(content).not.toContain('credentialRef');
  await openMcpAdvancedSettings(page);
  await page.getByRole('button', { name: '导入JSON配置', exact: true }).click();
  const importing = page.getByRole('dialog', { name: '导入 MCP 配置', exact: true });
  await importing.getByLabel('导入MCP配置JSON', { exact: true }).fill(
    JSON.stringify({
      version: 1,
      local: [],
      remote: [
        {
          name: 'Imported remote',
          transport: 'sse',
          endpoint: 'https://example.org/sse',
          publicHeaders: {},
          secretHeaders: [],
          oauth: false,
        },
      ],
    }),
  );
  await importing.getByRole('button', { name: '预览导入', exact: true }).click();
  await expect(importing).toContainText('Imported remote');
  await importing.getByRole('button', { name: '确认批量导入', exact: true }).click();
  await expect(importing).toBeHidden();
  await expect(
    page.getByRole('region', { name: 'Imported remote 远程 MCP', exact: true }),
  ).toContainText('已停用');
  await row.getByRole('button', { name: '停用/撤销', exact: true }).click();
  await expect(row).toContainText('已停用');
  await page.screenshot({ path: testInfo.outputPath('remote-mcp-settings.png'), fullPage: true });
});
