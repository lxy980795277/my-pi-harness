import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import {
  AuthStatusSchema,
  AgentTaskListSchema,
  AgentTaskDetailSchema,
  FrozenSkillSchema,
  SkillViewSchema,
  SessionSnapshotSchema,
  SessionSummarySchema,
} from '@my-pi-harness/protocol';
import { test, expect } from './fixture.js';
import { chooseConversationModel, chooseOption } from './ui-controls.js';
import { configureTestProvider } from './model-fixtures.js';
import { registerTestWorkspace } from './workspace-fixtures.js';
import { startToolSequenceModel, type ToolSequenceEntry } from './m2-completion-model.js';
import { expandCompletedProcesses } from './process-controls.js';
import type { ModelRequest } from './model-server.js';

const python = process.env['MY_PI_HARNESS_PYTHON'];
const loadedSkill = Type.Object({ resourceDirectory: Type.String({ minLength: 1 }) });
const commandResult = Type.Object({
  commandId: Type.String({ minLength: 1 }),
  status: Type.String(),
  exitCode: Type.Union([Type.Integer(), Type.Null()]),
});

test.skip(
  process.platform !== 'darwin' || python === undefined,
  'The Office browser workflow requires an explicitly prepared MY_PI_HARNESS_PYTHON environment on macOS.',
);

function lastToolJson(request: ModelRequest): unknown {
  const messages = request.body['messages'];
  if (!Array.isArray(messages)) throw new Error('Missing model history');
  const history: unknown[] = messages;
  for (const message of [...history].reverse()) {
    if (
      typeof message !== 'object' ||
      message === null ||
      !('role' in message) ||
      message.role !== 'tool' ||
      !('content' in message)
    )
      continue;
    if (typeof message.content !== 'string')
      throw new Error('Fixture expects text-only tool output');
    return JSON.parse(message.content) as unknown;
  }
  throw new Error('Missing prior tool result');
}

function quote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

/** A real loaded Skill creates and inspects DOCX through managed commands, then publishes immutable bytes. */
test('加载文档 Skill、审批运行脚本、等待完成并下载注册产物', async ({ page, daemon }, testInfo) => {
  if (python === undefined) throw new Error('Missing configured Python');
  const directory = await mkdtemp(join(tmpdir(), 'my-pi-office-browser-'));
  let resourceDirectory = '';
  let producerCommandId = '';
  const finalText = '文档已创建并完成结构检查，尚未验证页面版式。';
  try {
    await page.goto(daemon.origin);
    const authResponse = await page.request.get(`${daemon.origin}/api/auth/status`);
    const auth: unknown = await authResponse.json();
    if (!Value.Check(AuthStatusSchema, auth) || auth.csrfToken === null)
      throw new Error('Missing fixture authorization');
    const installed = await page.request.post(`${daemon.origin}/api/plugins/documents/install`, {
      headers: { Origin: daemon.origin, 'X-CSRF-Token': auth.csrfToken },
    });
    expect(installed.ok()).toBe(true);
    const catalogResponse = await page.request.get(`${daemon.origin}/api/skills`);
    const catalog: unknown = await catalogResponse.json();
    if (!Value.Check(Type.Array(SkillViewSchema), catalog))
      throw new Error('Invalid Skill catalog');
    const skill = catalog.find((entry) => entry.name === 'documents' && entry.enabled);
    if (!skill) throw new Error('The installed Documents Skill is unavailable');

    const model = await startToolSequenceModel(
      [
        { name: 'load_skill', arguments: { id: skill.id } },
        (request) => {
          const loaded = lastToolJson(request);
          if (!Value.Check(loadedSkill, loaded))
            throw new Error('Missing exact loaded Skill resource directory');
          resourceDirectory = loaded.resourceDirectory;
          return {
            name: 'run_command',
            arguments: {
              command: `"$MY_PI_HARNESS_PYTHON" -B -s ${quote(join(resourceDirectory, 'scripts/docx_edit.py'))} dependencies`,
              yieldTimeMs: 0,
              lifetimeMs: 20_000,
            },
          };
        },
        (request) => {
          const command = lastToolJson(request);
          if (!Value.Check(commandResult, command))
            throw new Error('Missing dependency command identity');
          return {
            name: 'wait_command',
            arguments: { commandId: command.commandId, timeoutMs: 30_000 },
          };
        },
        (request) => {
          const command = lastToolJson(request);
          if (
            !Value.Check(commandResult, command) ||
            command.status !== 'completed' ||
            command.exitCode !== 0
          )
            throw new Error('Dependency check did not complete successfully');
          const script = [
            'import sys',
            `sys.path.insert(0, ${JSON.stringify(join(resourceDirectory, 'scripts'))})`,
            'from cli_support import new_output',
            'from documents import docx',
            "settings = {'paragraphs': [{'text': 'Browser Skill fixture', 'heading': 1}, {'text': 'Created through a managed Python command'}]}",
            "print(new_output('browser-created.docx', '.docx', lambda output: docx(settings, output)))",
            '',
          ].join('\n');
          return {
            name: 'write_file',
            arguments: { path: 'create-report.py', content: script, expectedHash: null },
          };
        },
        {
          name: 'run_command',
          arguments: {
            command: `"$MY_PI_HARNESS_PYTHON" -B -s create-report.py`,
            yieldTimeMs: 0,
            lifetimeMs: 20_000,
          },
        },
        (request) => {
          const command = lastToolJson(request);
          if (!Value.Check(commandResult, command))
            throw new Error('Missing producer command identity');
          producerCommandId = command.commandId;
          return {
            name: 'wait_command',
            arguments: { commandId: producerCommandId, timeoutMs: 30_000 },
          };
        },
        (request) => {
          const command = lastToolJson(request);
          if (
            !Value.Check(commandResult, command) ||
            command.status !== 'completed' ||
            command.exitCode !== 0
          )
            throw new Error('Producer command did not finish successfully');
          return { name: 'read_document', arguments: { path: 'browser-created.docx' } };
        },
        () => ({
          name: 'run_command',
          arguments: {
            command: `"$MY_PI_HARNESS_PYTHON" -B -s ${quote(join(resourceDirectory, 'scripts/docx_edit.py'))} inspect browser-created.docx`,
            yieldTimeMs: 0,
            lifetimeMs: 20_000,
          },
        }),
        (request) => {
          const command = lastToolJson(request);
          if (!Value.Check(commandResult, command))
            throw new Error('Missing inspection command identity');
          return {
            name: 'wait_command',
            arguments: { commandId: command.commandId, timeoutMs: 30_000 },
          };
        },
        (request) => {
          const command = lastToolJson(request);
          if (
            !Value.Check(commandResult, command) ||
            command.status !== 'completed' ||
            command.exitCode !== 0
          )
            throw new Error('Final inspection did not complete successfully');
          return {
            name: 'publish_artifact',
            arguments: { path: 'browser-created.docx', producerCommandId },
          };
        },
      ],
      finalText,
    );
    try {
      await registerTestWorkspace(page, '文档工作区', directory);
      await configureTestProvider(page, model.origin, 32768);
      await page.reload();
      await chooseConversationModel(page, 'Queue Model', 'Chat');
      await chooseOption(
        page,
        page.getByRole('combobox', { name: '选择工作区', exact: true }),
        '文档工作区',
      );
      await chooseOption(
        page,
        page.getByRole('combobox', { name: '执行批准方式', exact: true }),
        '请求批准',
      );
      await page
        .getByLabel('消息', { exact: true })
        .fill('按文档 Skill 创建 Word 文件，检查后发布下载。');
      await page.getByRole('button', { name: '发送', exact: true }).click();
      for (let index = 0; index < 4; index += 1) {
        const approval = page.getByRole('button', { name: '允许本次操作', exact: true });
        await expect(approval).toBeVisible();
        await approval.click();
      }
      await expect(page.getByText(finalText, { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '停止', exact: true })).toBeHidden();
      await expandCompletedProcesses(page);
      const row = page.getByLabel('publish_artifact 工具调用', { exact: true });
      const button = row.getByRole('button', { name: '下载 browser-created.docx', exact: true });
      if (!(await button.isVisible()))
        await row
          .getByRole('button', { name: '展开 publish_artifact 工具详情', exact: true })
          .click();
      const downloading = page.waitForEvent('download');
      await button.click();
      const download = await downloading;
      expect(download.suggestedFilename()).toBe('browser-created.docx');
      const downloadedPath = await download.path();
      if (downloadedPath === null) throw new Error('Missing downloaded artifact bytes');
      const actual = await readFile(downloadedPath);
      expect(actual.subarray(0, 2).toString()).toBe('PK');
      expect(actual).toEqual(await readFile(join(directory, 'browser-created.docx')));
      await writeFile(join(directory, 'browser-created.docx'), 'changed source after publication');
      const redownloading = page.waitForEvent('download');
      await button.click();
      const secondDownload = await redownloading;
      const secondPath = await secondDownload.path();
      if (secondPath === null) throw new Error('Missing immutable artifact download');
      expect(await readFile(secondPath)).toEqual(actual);
      expect(model.requests).toHaveLength(11);
      const sessions = await page.request.get(`${daemon.origin}/api/sessions`);
      const sessionList: unknown = await sessions.json();
      if (!Value.Check(Type.Array(SessionSummarySchema), sessionList) || sessionList.length !== 1)
        throw new Error('Missing fixture session');
      const session = sessionList[0];
      if (!session) throw new Error('Missing fixture session record');
      const snapshotResponse = await page.request.get(
        `${daemon.origin}/api/sessions/${session.id}`,
      );
      const snapshot: unknown = await snapshotResponse.json();
      if (!Value.Check(SessionSnapshotSchema, snapshot))
        throw new Error('Invalid final session snapshot');
      expect(snapshot.tools.every((tool) => tool.status === 'completed')).toBe(true);
      expect(
        snapshot.tools
          .filter((tool) => ['run_command', 'write_file'].includes(tool.name))
          .every((tool) => tool.approval?.source === 'user' && tool.approval.decision === 'allow'),
      ).toBe(true);
      expect(snapshot.tools.find((tool) => tool.name === 'read_document')?.result).toContain(
        'Browser Skill fixture',
      );
      expect(
        snapshot.tools.find((tool) => tool.name === 'publish_artifact')?.artifacts,
      ).toMatchObject([{ producerCommandId, name: 'browser-created.docx' }]);
      await page.screenshot({ path: testInfo.outputPath('skill-artifact.png'), fullPage: true });
    } finally {
      await model.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function inheritedSkillDirectory(request: ModelRequest): string {
  const messages = request.body['messages'];
  if (!Array.isArray(messages)) throw new Error('Missing child model history');
  const history: unknown[] = messages;
  for (const message of history) {
    if (
      typeof message !== 'object' ||
      message === null ||
      !('role' in message) ||
      message.role !== 'system' ||
      !('content' in message) ||
      typeof message.content !== 'string'
    )
      continue;
    for (const line of message.content.split('\n')) {
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        continue;
      }
      if (Value.Check(loadedSkill, value)) return value.resourceDirectory;
    }
  }
  throw new Error('Child did not inherit an executable Skill resource directory');
}

function childOfficeRequest(request: ModelRequest): boolean {
  const messages = request.body['messages'];
  if (!Array.isArray(messages)) return false;
  const history: unknown[] = messages;
  return history.some(
    (message) =>
      typeof message === 'object' &&
      message !== null &&
      'role' in message &&
      message.role === 'user' &&
      'content' in message &&
      typeof message.content === 'string' &&
      message.content.includes('CHILD_OFFICE_TASK'),
  );
}

/** A delegated writer uses its inherited Skill and publishes an artifact owned by its own task. */
test('子任务继承文档 Skill、运行并发布产物，主会话和任务详情均可下载', async ({
  page,
  daemon,
}, testInfo) => {
  if (python === undefined) throw new Error('Missing configured Python');
  const directory = await mkdtemp(join(tmpdir(), 'my-pi-child-office-browser-'));
  let resourceDirectory = '';
  let producerCommandId = '';
  let taskId = '';
  const filename = 'child-created.docx';
  const finalText = '子任务文档已核对并发布，可从主会话与任务详情下载。';
  try {
    await page.goto(daemon.origin);
    const authResponse = await page.request.get(`${daemon.origin}/api/auth/status`);
    const auth: unknown = await authResponse.json();
    if (!Value.Check(AuthStatusSchema, auth) || auth.csrfToken === null)
      throw new Error('Missing fixture authorization');
    const installed = await page.request.post(`${daemon.origin}/api/plugins/documents/install`, {
      headers: { Origin: daemon.origin, 'X-CSRF-Token': auth.csrfToken },
    });
    expect(installed.ok()).toBe(true);
    const catalogResponse = await page.request.get(`${daemon.origin}/api/skills`);
    const catalog: unknown = await catalogResponse.json();
    if (!Value.Check(Type.Array(SkillViewSchema), catalog))
      throw new Error('Invalid Skill catalog');
    const skill = catalog.find((entry) => entry.name === 'documents' && entry.enabled);
    if (!skill) throw new Error('Missing installed Documents Skill');
    const rootSteps: ToolSequenceEntry[] = [
      { name: 'load_skill', arguments: { id: skill.id } },
      {
        name: 'spawn_agent',
        arguments: {
          title: '创建子任务文档',
          task: 'CHILD_OFFICE_TASK：使用继承的文档 Skill 创建 child-created.docx，检查正文和结构并发布。页面视觉尚未验证。',
          roleId: 'worker',
        },
      },
      (request) => {
        const spawned = lastToolJson(request);
        if (!Value.Check(Type.Object({ id: Type.String({ minLength: 1 }) }), spawned))
          throw new Error('Missing child task identity');
        taskId = spawned.id;
        return { name: 'wait_agents', arguments: { taskIds: [taskId], timeoutMs: 30_000 } };
      },
      (request) => {
        const waited = lastToolJson(request);
        if (
          !Value.Check(
            Type.Array(Type.Object({ status: Type.Literal('completed') }), {
              minItems: 1,
              maxItems: 1,
            }),
            waited,
          )
        )
          throw new Error('Child did not complete successfully');
        return { name: 'publish_artifact', arguments: { path: filename } };
      },
    ];
    const childSteps: ToolSequenceEntry[] = [
      (request) => {
        resourceDirectory = inheritedSkillDirectory(request);
        const script = [
          'import sys',
          `sys.path.insert(0, ${JSON.stringify(join(resourceDirectory, 'scripts'))})`,
          'from cli_support import new_output',
          'from documents import docx',
          "settings = {'paragraphs': [{'text': 'Child Skill fixture', 'heading': 1}, {'text': 'Created by the delegated writer using inherited resources'}]}",
          `print(new_output('${filename}', '.docx', lambda output: docx(settings, output)))`,
          '',
        ].join('\n');
        return {
          name: 'write_file',
          arguments: { path: 'create-child-report.py', content: script, expectedHash: null },
        };
      },
      () => ({
        name: 'run_command',
        arguments: {
          command: `"$MY_PI_HARNESS_PYTHON" -B -s ${quote(join(resourceDirectory, 'scripts/docx_edit.py'))} dependencies && "$MY_PI_HARNESS_PYTHON" -B -s create-child-report.py`,
          yieldTimeMs: 0,
          lifetimeMs: 20_000,
        },
      }),
      (request) => {
        const command = lastToolJson(request);
        if (!Value.Check(commandResult, command)) throw new Error('Missing child producer command');
        producerCommandId = command.commandId;
        return {
          name: 'wait_command',
          arguments: { commandId: producerCommandId, timeoutMs: 30_000 },
        };
      },
      (request) => {
        const command = lastToolJson(request);
        if (
          !Value.Check(commandResult, command) ||
          command.status !== 'completed' ||
          command.exitCode !== 0
        )
          throw new Error('Child producer failed');
        return { name: 'read_document', arguments: { path: filename } };
      },
      () => ({
        name: 'run_command',
        arguments: {
          command: `"$MY_PI_HARNESS_PYTHON" -B -s ${quote(join(resourceDirectory, 'scripts/docx_edit.py'))} inspect ${filename}`,
          yieldTimeMs: 0,
          lifetimeMs: 20_000,
        },
      }),
      (request) => {
        const command = lastToolJson(request);
        if (!Value.Check(commandResult, command))
          throw new Error('Missing child inspection command');
        return {
          name: 'wait_command',
          arguments: { commandId: command.commandId, timeoutMs: 30_000 },
        };
      },
      (request) => {
        const command = lastToolJson(request);
        if (
          !Value.Check(commandResult, command) ||
          command.status !== 'completed' ||
          command.exitCode !== 0
        )
          throw new Error('Child inspection failed');
        return { name: 'publish_artifact', arguments: { path: filename, producerCommandId } };
      },
    ];
    const model = await startToolSequenceModel([], finalText, {
      route: (request) =>
        childOfficeRequest(request)
          ? {
              key: 'child',
              steps: childSteps,
              finalText: '子任务文档已发布，正文和结构已检查，页面视觉尚未验证。',
            }
          : { key: 'root', steps: rootSteps, finalText },
    });
    try {
      await registerTestWorkspace(page, '子任务文档工作区', directory);
      await configureTestProvider(page, model.origin, 32768);
      await page.reload();
      await chooseConversationModel(page, 'Queue Model', 'Chat');
      await chooseOption(
        page,
        page.getByRole('combobox', { name: '选择工作区', exact: true }),
        '子任务文档工作区',
      );
      await chooseOption(
        page,
        page.getByRole('combobox', { name: '执行批准方式', exact: true }),
        '完全访问权限',
      );
      await page
        .getByLabel('消息', { exact: true })
        .fill('ROOT_OFFICE_REQUEST：请委派执行角色制作 Word 文档并核对结果。');
      await page.getByRole('button', { name: '发送', exact: true }).click();
      await expect(page.getByText(finalText, { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '停止', exact: true })).toBeHidden();
      const sessions = await page.request.get(`${daemon.origin}/api/sessions`);
      const sessionList: unknown = await sessions.json();
      if (
        !Value.Check(Type.Array(SessionSummarySchema), sessionList) ||
        sessionList.length !== 1 ||
        !sessionList[0]
      )
        throw new Error('Missing parent session');
      const sessionId = sessionList[0].id;
      const snapshotResponse = await page.request.get(`${daemon.origin}/api/sessions/${sessionId}`);
      const snapshot: unknown = await snapshotResponse.json();
      if (!Value.Check(SessionSnapshotSchema, snapshot)) throw new Error('Invalid parent snapshot');
      const tasksResponse = await page.request.get(
        `${daemon.origin}/api/sessions/${sessionId}/agents`,
      );
      const tasks: unknown = await tasksResponse.json();
      if (!Value.Check(AgentTaskListSchema, tasks) || tasks.tasks.length !== 1)
        throw new Error('Missing child task');
      const childResponse = await page.request.get(
        `${daemon.origin}/api/sessions/${sessionId}/agents/${taskId}`,
      );
      const child: unknown = await childResponse.json();
      if (!Value.Check(AgentTaskDetailSchema, child)) throw new Error('Invalid child detail');
      expect(child.task).toMatchObject({
        id: taskId,
        status: 'completed',
        role: { id: 'worker', access: 'write' },
      });
      const childRun = child.runs[0];
      if (!childRun) throw new Error('Missing child Run');
      const logResponse = await page.request.get(`${daemon.origin}/api/sessions/${sessionId}/log`);
      expect(logResponse.ok()).toBe(true);
      const batches = (await logResponse.text())
        .trimEnd()
        .split('\n')
        .map((line): unknown => JSON.parse(line));
      const batchSchema = Type.Object({ records: Type.Array(Type.Unknown()) });
      const records = batches.flatMap((batch) => {
        if (!Value.Check(batchSchema, batch)) throw new Error('Invalid log batch');
        return batch.records;
      });
      const acceptedSchema = Type.Object({
        event: Type.Object({
          type: Type.Literal('run.accepted'),
          runId: Type.Literal(childRun.id),
        }),
        privateData: Type.Object({ skills: Type.Array(FrozenSkillSchema) }),
      });
      const accepted = records.find((record) => Value.Check(acceptedSchema, record));
      if (!Value.Check(acceptedSchema, accepted)) throw new Error('Missing child Skill acceptance');
      expect(accepted.privateData.skills).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ selection: { id: skill.id, contentHash: skill.contentHash } }),
        ]),
      );
      expect(child.tools.map((tool) => tool.name)).toEqual([
        'write_file',
        'run_command',
        'wait_command',
        'read_document',
        'run_command',
        'wait_command',
        'publish_artifact',
      ]);
      expect(child.tools.every((tool) => tool.status === 'completed')).toBe(true);
      expect(child.tools.find((tool) => tool.name === 'read_document')?.result).toContain(
        'Child Skill fixture',
      );
      const childArtifact = child.tools.find((tool) => tool.name === 'publish_artifact')
        ?.artifacts?.[0];
      const parentArtifact = snapshot.tools.find((tool) => tool.name === 'publish_artifact')
        ?.artifacts?.[0];
      expect(childArtifact).toMatchObject({
        taskId,
        runId: child.runs[0]?.id,
        producerCommandId,
        name: filename,
      });
      expect(parentArtifact).toMatchObject({
        taskId: null,
        runId: snapshot.runs[0]?.id,
        name: filename,
      });
      expect(childArtifact?.sha256).toBe(parentArtifact?.sha256);
      const expected = await readFile(join(directory, filename));
      await rm(join(directory, filename));
      await expandCompletedProcesses(page);
      const parentRow = page.getByLabel('publish_artifact 工具调用', { exact: true });
      await parentRow
        .getByRole('button', { name: '展开 publish_artifact 工具详情', exact: true })
        .click();
      const parentDownloading = page.waitForEvent('download');
      await parentRow.getByRole('button', { name: `下载 ${filename}`, exact: true }).click();
      const parentDownload = await parentDownloading;
      const parentPath = await parentDownload.path();
      if (parentPath === null) throw new Error('Missing parent artifact download');
      expect(await readFile(parentPath)).toEqual(expected);
      await page.screenshot({
        path: testInfo.outputPath('parent-delegated-skill-artifact.png'),
        fullPage: true,
      });
      await page.getByRole('button', { name: '打开会话任务', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '会话任务', exact: true });
      const childRow = dialog.getByLabel('publish_artifact 工具调用', { exact: true });
      await childRow
        .getByRole('button', { name: '展开 publish_artifact 工具详情', exact: true })
        .click();
      const childDownloading = page.waitForEvent('download');
      await childRow.getByRole('button', { name: `下载 ${filename}`, exact: true }).click();
      const childDownload = await childDownloading;
      const childPath = await childDownload.path();
      if (childPath === null) throw new Error('Missing child artifact download');
      expect(await readFile(childPath)).toEqual(expected);
      expect(model.requests.filter(childOfficeRequest)).toHaveLength(8);
      expect(model.requests.filter((request) => !childOfficeRequest(request))).toHaveLength(5);
      await page.screenshot({
        path: testInfo.outputPath('child-skill-artifact.png'),
        fullPage: true,
      });
    } finally {
      await model.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
