import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AuthStatusSchema,
  SessionSnapshotSchema,
  WorkspaceSchema,
  type SessionSnapshot,
} from '@my-pi-harness/protocol';
import { Value } from 'typebox/value';
import { test, expect } from './fixture.js';
import { configureTestProvider } from './model-fixtures.js';
import { startToolSequenceModel } from './m2-completion-model.js';
import { chooseOption } from './ui-controls.js';

test('完整工具链复用 SDK 调用ID，逐次审批、真实编辑与受限执行后保留历史', async ({
  page,
  daemon,
}, testInfo) => {
  const directory = await mkdtemp(join(tmpdir(), 'my-pi-m2-completion-'));
  const original = 'Old workspace text\n';
  const edited = 'Edited workspace text\n';
  const originalHash = createHash('sha256').update(original).digest('hex');
  const finalText = 'M2 工具链验收完成。';
  const model = await startToolSequenceModel(
    [
      { name: 'list_files', arguments: { path: '.', maxEntries: 20 } },
      { name: 'search_files', arguments: { path: '.', query: 'Old workspace text' } },
      { name: 'read_file', arguments: { path: 'note.txt' } },
      {
        name: 'edit_file',
        arguments: {
          path: 'note.txt',
          oldText: original,
          newText: edited,
          expectedHash: originalHash,
        },
      },
      { name: 'shell', arguments: { command: "printf 'm2-shell-ok\\n'", timeoutMs: 5000 } },
      { name: 'web_fetch', arguments: { url: 'http://127.0.0.1/blocked-private-resource' } },
    ],
    finalText,
  );
  try {
    await writeFile(join(directory, 'note.txt'), original, 'utf8');
    await page.goto(daemon.origin);
    await configureTestProvider(page, model.origin, 32768);
    const authorization = await page.request.get(`${daemon.origin}/api/auth/status`);
    const auth: unknown = await authorization.json();
    if (!Value.Check(AuthStatusSchema, auth) || !auth.csrfToken)
      throw new Error('The tool sequence requires fixture authorization');
    const registered = await page.request.post(`${daemon.origin}/api/workspaces`, {
      headers: { Origin: daemon.origin, 'X-CSRF-Token': auth.csrfToken },
      data: { name: '完整工具链项目', rootPath: directory },
    });
    const workspace: unknown = await registered.json();
    if (!registered.ok() || !Value.Check(WorkspaceSchema, workspace))
      throw new Error('Registering the tool sequence workspace failed');
    await page.reload();
    await chooseOption(
      page,
      page.getByRole('combobox', { name: '选择工作区', exact: true }),
      workspace.name,
    );
    await chooseOption(
      page,
      page.getByRole('combobox', { name: '对话模型', exact: true }),
      'Queue Model · Chat',
    );
    await chooseOption(
      page,
      page.getByRole('combobox', { name: '执行批准方式', exact: true }),
      '请求批准',
    );
    const creation = page.waitForResponse((response) => {
      return (
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/sessions'
      );
    });
    await page.getByLabel('消息', { exact: true }).fill('完整工具链验收');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    const created = await creation;
    const initial: unknown = await created.json();
    if (!created.ok() || !Value.Check(SessionSnapshotSchema, initial))
      throw new Error('The tool sequence conversation was not created');
    const sessionId = initial.session.id;
    const snapshot = async (): Promise<SessionSnapshot> => {
      const response = await page.request.get(
        `${daemon.origin}/api/sessions/${encodeURIComponent(sessionId)}`,
      );
      const body: unknown = await response.json();
      if (!response.ok() || !Value.Check(SessionSnapshotSchema, body))
        throw new Error('The committed tool sequence snapshot is invalid');
      return body;
    };
    const stages = async (): Promise<string[]> => {
      return (await snapshot()).tools.map((tool) => `${tool.name}:${tool.status}`);
    };
    await expect
      .poll(stages)
      .toEqual([
        'list_files:completed',
        'search_files:completed',
        'read_file:completed',
        'edit_file:awaiting_approval',
      ]);
    const beforeEdit = await snapshot();
    expect(beforeEdit.tools[0]?.result?.trim()).toBe('note.txt');
    expect(beforeEdit.tools[1]?.result).toContain('note.txt:1: Old workspace text');
    expect(beforeEdit.tools[2]?.result).toContain(`SHA-256: ${originalHash}`);
    expect(beforeEdit.tools[2]?.result).toContain('1: Old workspace text');
    expect(await readFile(join(directory, 'note.txt'), 'utf8')).toBe(original);
    expect(model.requests).toHaveLength(4);
    const editCard = page.getByLabel('edit_file 工具调用', { exact: true });
    await editCard.getByRole('button', { name: '允许本次操作', exact: true }).click();
    await expect
      .poll(stages)
      .toEqual([
        'list_files:completed',
        'search_files:completed',
        'read_file:completed',
        'edit_file:completed',
        'shell:awaiting_approval',
      ]);
    expect(await readFile(join(directory, 'note.txt'), 'utf8')).toBe(edited);
    expect(model.requests).toHaveLength(5);
    const difference = editCard.getByRole('region', { name: '文件差异', exact: true });
    const result = editCard.getByRole('region', { name: '执行结果', exact: true });
    await expect(difference.locator('pre')).toBeVisible();
    await expect(difference.locator('pre')).toContainText('+Edited workspace text');
    await expect(difference.locator('pre')).toContainText('-Old workspace text');
    await expect(result.locator('pre')).toBeVisible();
    await expect(result.locator('pre')).toContainText('SHA-256:');
    await page
      .getByLabel('shell 工具调用', { exact: true })
      .getByRole('button', { name: '允许本次操作', exact: true })
      .click();
    let shellStatus = 'failed';
    if (process.platform === 'darwin') shellStatus = 'completed';
    await expect
      .poll(stages)
      .toEqual([
        'list_files:completed',
        'search_files:completed',
        'read_file:completed',
        'edit_file:completed',
        `shell:${shellStatus}`,
        'web_fetch:awaiting_approval',
      ]);
    const afterShell = await snapshot();
    const shell = afterShell.tools.find((tool) => tool.name === 'shell');
    if (process.platform === 'darwin') expect(shell?.result?.trim()).toBe('m2-shell-ok');
    else
      expect(shell?.result).toContain('A verified shell sandbox is not available on this platform');
    expect(model.requests).toHaveLength(6);
    await page
      .getByLabel('web_fetch 工具调用', { exact: true })
      .getByRole('button', { name: '允许本次操作', exact: true })
      .click();
    await expect(page.getByText(finalText, { exact: true })).toBeVisible();
    const completed = await snapshot();
    expect(completed.session.activeRunId).toBeNull();
    expect(completed.runs).toHaveLength(1);
    expect(completed.runs[0]?.status).toBe('completed');
    expect(completed.tools).toHaveLength(6);
    expect(new Set(completed.tools.map((tool) => tool.id)).size).toBe(6);
    expect(new Set(completed.tools.map((tool) => tool.runId)).size).toBe(1);
    expect(completed.tools.every((tool) => tool.id !== 'call_0')).toBe(true);
    const edit = completed.tools.find((tool) => tool.name === 'edit_file');
    expect(edit?.diff).toContain('-Old workspace text');
    expect(edit?.diff).toContain('+Edited workspace text');
    const web = completed.tools.find((tool) => tool.name === 'web_fetch');
    expect(web?.status).toBe('failed');
    expect(web?.result).toContain(
      'Web tools cannot access private, local, reserved or metadata addresses',
    );
    expect(model.requests).toHaveLength(7);
    const history = JSON.stringify(model.requests[6]?.body['messages']);
    expect(history.match(/"tool_call_id":"call_0"/g)).toHaveLength(6);
    for (const name of [
      'list_files',
      'search_files',
      'read_file',
      'edit_file',
      'shell',
      'web_fetch',
    ])
      expect(history).toContain(`"name":"${name}"`);
    expect(
      model.requests.every(
        (request) =>
          request.path === '/v1/chat/completions' &&
          request.authorization === 'Bearer synthetic-account-key',
      ),
    ).toBe(true);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('m2-completed-tools.png'), fullPage: true });
    await page.reload();
    await page.getByRole('button', { name: /^完整工具链验收 / }).click();
    await expect(page.getByText(finalText, { exact: true })).toBeVisible();
    const restored = await snapshot();
    expect(restored.tools).toEqual(completed.tools);
    expect(restored.messages).toEqual(completed.messages);
    expect(model.requests).toHaveLength(7);
    expect(await readFile(join(directory, 'note.txt'), 'utf8')).toBe(edited);
  } finally {
    await daemon.stop();
    await model.close();
    await rm(directory, { recursive: true, force: true });
  }
});
