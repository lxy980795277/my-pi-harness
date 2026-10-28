import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import {
  McpServerViewSchema,
  McpToolCatalogSchema,
  SessionSnapshotSchema,
  type McpToolCatalog,
  type SessionSnapshot,
} from '@my-pi-harness/protocol';
import { Value } from 'typebox/value';
import { test, expect } from './fixture.js';
import { openUserSettings, openMcpAdvancedSettings, chooseOption } from './ui-controls.js';
import { registerTestWorkspace } from './workspace-fixtures.js';
import { configureTestProvider } from './model-fixtures.js';
import { startToolSequenceModel } from './m2-completion-model.js';
import { expandCompletedProcesses } from './process-controls.js';

test.skip(process.platform !== 'darwin', '当前本地 MCP stdio 仅提供 macOS 受监管进程实现。');

const fixture = fileURLToPath(
  new URL('../../packages/integrations/test/fixture.mjs', import.meta.url),
);

const configureServer = async (
  page: Page,
  directory: string,
  mode = 'normal',
): Promise<McpToolCatalog> => {
  const origin = new URL(page.url()).origin;
  await registerTestWorkspace(page, 'MCP 工作区', directory);
  await page.reload();
  await openUserSettings(page);
  await page.getByRole('tab', { name: 'MCP', exact: true }).click();
  await openMcpAdvancedSettings(page);
  await page.getByRole('button', { name: '添加本地 MCP', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'MCP Server', exact: true });
  await form.getByLabel('名称', { exact: true }).fill('Fixture tools');
  await chooseOption(
    page,
    form.getByRole('combobox', { name: 'MCP 工作区', exact: true }),
    'MCP 工作区',
  );
  await form.getByLabel('启动程序', { exact: true }).fill(process.execPath);
  await form.getByLabel('启动参数', { exact: true }).fill(JSON.stringify([fixture]));
  await form
    .getByLabel('公开环境变量', { exact: true })
    .fill(JSON.stringify({ FIXTURE_DIRECTORY: directory, FIXTURE_MODE: mode }));
  await form
    .getByLabel('秘密槽', { exact: true })
    .fill(JSON.stringify([{ slotId: 'fixture', environmentName: 'FAKE_SECRET' }]));
  await form.getByRole('button', { name: '保存配置', exact: true }).click();
  await expect(form).toBeHidden();
  const row = page.getByRole('region', { name: 'Fixture tools MCP Server', exact: true });
  await expect(row).toContainText('当前范围未授权');
  await expect(readFile(join(directory, 'started'))).rejects.toMatchObject({ code: 'ENOENT' });
  await row.getByRole('button', { name: '秘密', exact: true }).click();
  const secret = page.getByRole('dialog', { name: 'Fixture tools · 秘密', exact: true });
  await secret.getByLabel('秘密值', { exact: true }).fill('synthetic-browser-mcp-secret');
  await secret.getByRole('button', { name: '保存秘密', exact: true }).click();
  await expect(secret.getByLabel('秘密值', { exact: true })).toHaveValue('');
  await expect(secret).toContainText('秘密已保存。');
  await secret.getByRole('button', { name: '关闭秘密设置', exact: true }).click();
  await chooseOption(
    page,
    row.getByRole('combobox', { name: 'Fixture tools 启动范围', exact: true }),
    '完全访问权限',
  );
  await row.getByRole('button', { name: '启动授权', exact: true }).click();
  const trust = page.getByRole('dialog', { name: '允许运行本机 MCP 程序？', exact: true });
  await expect(trust).toContainText('FAKE_SECRET');
  await expect(trust).toContainText('完全访问权限 · 网络不受限');
  await expect(trust).not.toContainText('synthetic-browser-mcp-secret');
  await expect(readFile(join(directory, 'started'))).rejects.toMatchObject({ code: 'ENOENT' });
  await trust.getByRole('button', { name: '确认授权并启用', exact: true }).click();
  await expect(trust).toBeHidden();
  await row.getByRole('button', { name: '发现工具', exact: true }).click();
  await expect(row).toContainText('已发现 2 个工具');
  const servers: unknown = await (await page.request.get(`${origin}/api/mcp/servers`)).json();
  if (!Array.isArray(servers) || !Value.Check(McpServerViewSchema, servers[0]))
    throw new Error('Missing safe MCP configuration');
  const catalog: unknown = await (
    await page.request.get(`${origin}/api/mcp/servers/${servers[0].id}/tools?scope=full-access`)
  ).json();
  if (!Value.Check(McpToolCatalogSchema, catalog)) throw new Error('Missing discovered catalog');
  expect(JSON.stringify(servers)).not.toContain('synthetic-browser-mcp-secret');
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  return catalog;
};

const selectTool = async (page: Page, name: string): Promise<void> => {
  await chooseOption(
    page,
    page.getByRole('combobox', { name: '对话模型', exact: true }),
    'Queue Model · Chat',
  );
  await chooseOption(
    page,
    page.getByRole('combobox', { name: '选择工作区', exact: true }),
    'MCP 工作区',
  );
  await chooseOption(
    page,
    page.getByRole('combobox', { name: '执行批准方式', exact: true }),
    '完全访问权限',
  );
  await page.getByRole('button', { name: '添加上下文', exact: true }).click();
  await page.getByRole('button', { name: 'MCP', exact: true }).click();
  const picker = page.getByRole('dialog', { name: /MCP 工具 · 已选/u });
  await picker.getByRole('button', { name: new RegExp(`Fixture tools · ${name}`) }).click();
  await expect(picker).toContainText('已选 1/16');
  await picker.getByRole('button', { name: '关闭 MCP 工具选择', exact: true }).click();
};

const readSession = async (page: Page, origin: string, id: string): Promise<SessionSnapshot> => {
  const value: unknown = await (await page.request.get(`${origin}/api/sessions/${id}`)).json();
  if (!Value.Check(SessionSnapshotSchema, value)) throw new Error('Invalid MCP session snapshot');
  return value;
};

for (const remoteName of ['echo', 'disconnect'] as const) {
  test(`MCP 配置授权发现、输入冻结及真实 stdio 调用：${remoteName}`, async ({
    page,
    daemon,
  }, testInfo) => {
    const directory = await mkdtemp(join(tmpdir(), 'my-pi-mcp-browser-'));
    let model: Awaited<ReturnType<typeof startToolSequenceModel>> | undefined;
    try {
      await page.goto(daemon.origin);
      const catalog = await configureServer(page, directory);
      const tool = catalog.tools.find((entry) => {
        return entry.remoteToolName === remoteName;
      });
      if (!tool) throw new Error('The fixture did not discover its tool');
      model = await startToolSequenceModel(
        [{ name: tool.name, arguments: { value: 'browser MCP once' } }],
        'MCP 已完成。',
      );
      await configureTestProvider(page, model.origin);
      await page.reload();
      await selectTool(page, remoteName);
      const submitted: unknown[] = [];
      let loseFirstReply = remoteName === 'echo';
      await page.route('**/api/sessions/*/inputs', async (route) => {
        submitted.push(route.request().postDataJSON());
        if (loseFirstReply) {
          loseFirstReply = false;
          const result = await route.fetch();
          if (!result.ok()) {
            throw new Error('The original MCP input was not accepted');
          }
          await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'Synthetic lost MCP acceptance response' }),
          });
          return;
        }
        await route.continue();
      });
      if (remoteName === 'echo') {
        await page.getByLabel('消息', { exact: true }).fill(`调用 ${remoteName}`);
        await page.getByRole('button', { name: '发送', exact: true }).click();
        await expect(
          page.getByText('Synthetic lost MCP acceptance response', { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByText('上次提交结果尚未确认。再次发送会按原消息和请求重试，请先检查对话记录。', {
            exact: true,
          }),
        ).toBeVisible();
      }
      const accepted = page.waitForResponse((response) => {
        return (
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname.endsWith('/inputs')
        );
      });
      if (remoteName !== 'echo') {
        await page.getByLabel('消息', { exact: true }).fill(`调用 ${remoteName}`);
      }
      await page.getByRole('button', { name: '发送', exact: true }).click();
      const response = await accepted;
      const snapshot: unknown = await response.json();
      if (!response.ok() || !Value.Check(SessionSnapshotSchema, snapshot))
        throw new Error('Input was not accepted');
      if (remoteName === 'echo') {
        expect(submitted).toHaveLength(2);
        expect(submitted[1]).toEqual(submitted[0]);
      }
      expect(snapshot.runs[0]?.mcpTools).toEqual([
        {
          serverId: tool.serverId,
          serverRevision: tool.serverRevision,
          remoteToolName: tool.remoteToolName,
          definitionFingerprint: tool.definitionFingerprint,
        },
      ]);
      const row = page.getByLabel(`${tool.name} 工具调用`, { exact: true });
      if (remoteName === 'echo') {
        await expect(page.getByText('MCP 已完成。', { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: '停止', exact: true })).toBeHidden();
        await expandCompletedProcesses(page);
        expect(model.requests).toHaveLength(2);
      } else {
        await expect(row.getByText('结果未知', { exact: true })).toBeVisible();
        await expect(row.locator('[data-slot="tool-loading"]')).toHaveCount(0);
        await expect(page.getByRole('button', { name: '停止', exact: true })).toBeHidden();
        expect(model.requests).toHaveLength(1);
      }
      await row.getByRole('button', { name: `展开 ${tool.name} 工具详情`, exact: true }).click();
      await expect(row.getByRole('region', { name: '工具来源', exact: true })).toContainText('MCP');
      await expect(row.getByRole('region', { name: '工具来源', exact: true })).toContainText(
        tool.definitionFingerprint,
      );
      if (remoteName === 'disconnect') {
        await expect(row).toContainText('操作可能已生效，需要核验');
      } else {
        await expect(row.getByRole('region', { name: '执行结果', exact: true })).toContainText(
          'browser MCP once',
        );
      }
      const calls = (await readFile(join(directory, 'calls'), 'utf8')).trim().split('\n');
      expect(calls).toHaveLength(1);
      const committed = await readSession(page, daemon.origin, snapshot.session.id);
      expect(committed.tools[0]?.status).toBe(remoteName === 'echo' ? 'completed' : 'unknown');
      await page.screenshot({ path: testInfo.outputPath(`mcp-${remoteName}.png`), fullPage: true });
      await page.reload();
      await page.getByRole('button', { name: new RegExp(`^调用 ${remoteName} `) }).click();
      if (remoteName === 'echo') {
        await expect(page.getByText('MCP 已完成。', { exact: true })).toBeVisible();
        await expandCompletedProcesses(page);
      }
      await expect(page.getByLabel(`${tool.name} 工具调用`, { exact: true })).toContainText(
        remoteName,
      );
      expect((await readFile(join(directory, 'calls'), 'utf8')).trim().split('\n')).toHaveLength(1);
      expect(model.requests).toHaveLength(remoteName === 'echo' ? 2 : 1);
      if (remoteName === 'echo') {
        const userMessage = page.getByRole('article', { name: '你的消息', exact: true }).first();
        await userMessage.hover();
        await userMessage.getByRole('button', { name: '编辑并在新分支重发', exact: true }).click();
        await userMessage.getByRole('button', { name: 'MCP 工具 · 1', exact: true }).click();
        const editorPicker = page.getByRole('dialog', {
          name: 'MCP 工具 · 已选 1/16',
          exact: true,
        });
        await expect(
          editorPicker.getByRole('button', { name: /Fixture tools · echo/u }),
        ).toHaveAttribute('aria-pressed', 'true');
        await editorPicker.getByRole('button', { name: '关闭 MCP 工具选择', exact: true }).click();
        await userMessage.getByLabel('编辑消息', { exact: true }).fill('编辑后保留 MCP 选择');
        const edited = page.waitForResponse((reply) => {
          return (
            reply.request().method() === 'POST' && new URL(reply.url()).pathname.endsWith('/edit')
          );
        });
        await userMessage.getByRole('button', { name: '创建分支并重发', exact: true }).click();
        const editedReply = await edited;
        const editBody: unknown = editedReply.request().postDataJSON();
        expect(editBody).toMatchObject({ mcpTools: snapshot.runs[0]?.mcpTools });
        const activeModel = model;
        await expect
          .poll(() => {
            return activeModel.requests.length;
          })
          .toBe(3);
        await expect(page.getByRole('button', { name: '停止', exact: true })).toBeHidden();
        expect(JSON.stringify(model.requests[2]?.body['tools'])).toContain(tool.name);
        expect((await readFile(join(directory, 'calls'), 'utf8')).trim().split('\n')).toHaveLength(
          1,
        );
        await page.getByRole('button', { name: '添加上下文', exact: true }).click();
        await page.getByRole('button', { name: 'MCP', exact: true }).click();
        const picker = page.getByRole('dialog', { name: /MCP 工具 · 已选/u });
        await picker.getByRole('button', { name: /Fixture tools · echo/u }).click();
        await picker.getByRole('button', { name: '关闭 MCP 工具选择', exact: true }).click();
        await openUserSettings(page);
        await page.getByRole('tab', { name: 'MCP', exact: true }).click();
        await openMcpAdvancedSettings(page);
        await page
          .getByRole('region', { name: 'Fixture tools MCP Server', exact: true })
          .getByRole('button', { name: '撤销授权', exact: true })
          .click();
        await expect(
          page.getByRole('region', { name: 'Fixture tools MCP Server', exact: true }),
        ).toContainText('已停用');
        await page.getByRole('button', { name: '关闭设置', exact: true }).click();
        await page.getByLabel('消息', { exact: true }).fill('撤销后的新操作');
        await expect(
          page.getByText('MCP 选择不可用，请打开 MCP 工具选择并重新选择。', { exact: true }),
        ).toBeVisible();
        await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled();
        expect(model.requests).toHaveLength(3);
      }
    } finally {
      await model?.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test('MCP 运行集合锁定、unknown保留队列、明确编辑重选后仅执行新的队列调用', async ({
  page,
  daemon,
}, testInfo) => {
  const directory = await mkdtemp(join(tmpdir(), 'my-pi-mcp-queue-browser-'));
  let model: Awaited<ReturnType<typeof startToolSequenceModel>> | undefined;
  try {
    await page.goto(daemon.origin);
    const catalog = await configureServer(page, directory, 'hang');
    const echo = catalog.tools.find((tool) => {
      return tool.remoteToolName === 'echo';
    });
    const disconnect = catalog.tools.find((tool) => {
      return tool.remoteToolName === 'disconnect';
    });
    if (!echo || !disconnect) {
      throw new Error('The queue fixture requires both remote tools');
    }
    model = await startToolSequenceModel(
      [
        { name: echo.name, arguments: { value: 'first call must not be replayed' } },
        { name: disconnect.name, arguments: { value: 'explicitly edited queued operation' } },
      ],
      '不应自动继续的回答',
    );
    await configureTestProvider(page, model.origin);
    await page.reload();
    await selectTool(page, 'echo');
    const accepted = page.waitForResponse((reply) => {
      return (
        reply.request().method() === 'POST' && new URL(reply.url()).pathname.endsWith('/inputs')
      );
    });
    await page.getByLabel('消息', { exact: true }).fill('运行 MCP 并验证队列');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    const first: unknown = await (await accepted).json();
    if (!Value.Check(SessionSnapshotSchema, first)) {
      throw new Error('The MCP run was not accepted');
    }
    const firstTool = page.getByLabel(`${echo.name} 工具调用`, { exact: true });
    await expect(firstTool.locator('[data-slot="tool-loading"]')).toBeVisible();
    await page.getByRole('button', { name: 'MCP · 1', exact: true }).click();
    const frozen = page.getByRole('dialog', { name: 'MCP 工具 · 已选 1/16', exact: true });
    await expect(frozen).toContainText('当前选择已冻结');
    await expect(frozen.getByRole('button', { name: /Fixture tools · echo/u })).toBeDisabled();
    await expect(
      frozen.getByRole('button', { name: /Fixture tools · disconnect/u }),
    ).toBeDisabled();
    await frozen.getByRole('button', { name: '关闭 MCP 工具选择', exact: true }).click();
    await page.getByLabel('消息', { exact: true }).fill('等待中的 MCP 输入');
    const queued = page.waitForResponse((reply) => {
      return (
        reply.request().method() === 'POST' && new URL(reply.url()).pathname.endsWith('/inputs')
      );
    });
    await page.getByLabel('消息', { exact: true }).press('Enter');
    const pending: unknown = await (await queued).json();
    if (!Value.Check(SessionSnapshotSchema, pending)) {
      throw new Error('The MCP input was not queued');
    }
    expect(pending.queue[0]?.mcpTools).toEqual(first.runs[0]?.mcpTools);
    await page.getByRole('button', { name: '停止', exact: true }).click();
    await expect(page.getByRole('button', { name: '停止', exact: true })).toBeHidden();
    await expect(firstTool).toContainText('结果未知');
    const stopped = await readSession(page, daemon.origin, first.session.id);
    expect(stopped.queue).toHaveLength(1);
    expect(model.requests).toHaveLength(1);
    await page.getByText('待执行输入 · 1', { exact: true }).click();
    await page
      .getByRole('listitem')
      .filter({ hasText: '等待中的 MCP 输入' })
      .getByRole('button', { name: '编辑', exact: true })
      .click();
    const queueRow = page
      .getByRole('listitem')
      .filter({ has: page.getByLabel('排队消息内容', { exact: true }) });
    await queueRow.getByLabel('排队消息内容', { exact: true }).fill('队列显式重选 disconnect');
    await queueRow.getByRole('button', { name: 'MCP 工具 · 1', exact: true }).click();
    const picker = page.getByRole('dialog', { name: /MCP 工具 · 已选/u });
    await expect(picker.getByRole('button', { name: /Fixture tools · echo/u })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await picker.getByRole('button', { name: /Fixture tools · echo/u }).click();
    await picker.getByRole('button', { name: /Fixture tools · disconnect/u }).click();
    await picker.getByRole('button', { name: '关闭 MCP 工具选择', exact: true }).click();
    const patched = page.waitForResponse((reply) => {
      return (
        reply.request().method() === 'PUT' && new URL(reply.url()).pathname.includes('/queue/')
      );
    });
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    const patchedReply = await patched;
    expect(patchedReply.ok()).toBe(true);
    const updated = await readSession(page, daemon.origin, first.session.id);
    expect(updated.queue[0]?.mcpTools?.[0]?.remoteToolName).toBe('disconnect');
    expect(model.requests).toHaveLength(1);
    await page.getByRole('button', { name: '继续执行队列', exact: true }).click();
    const secondTool = page.getByLabel(`${disconnect.name} 工具调用`, { exact: true });
    await expect(secondTool).toContainText('结果未知');
    await expect(page.getByRole('button', { name: '停止', exact: true })).toBeHidden();
    expect(model.requests).toHaveLength(2);
    const result = await readSession(page, daemon.origin, first.session.id);
    expect(result.queue).toHaveLength(0);
    expect(
      result.tools.map((tool) => {
        return tool.status;
      }),
    ).toEqual(['unknown', 'unknown']);
    const calls = (await readFile(join(directory, 'calls'), 'utf8')).trim().split('\n');
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('"name":"echo"');
    expect(calls[1]).toContain('"name":"disconnect"');
    await page.screenshot({ path: testInfo.outputPath('mcp-queue.png'), fullPage: true });
  } finally {
    await model?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
