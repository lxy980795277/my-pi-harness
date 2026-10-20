import { readFile } from 'node:fs/promises';
import type { Page, Route } from '@playwright/test';
import { SessionSnapshotSchema, type SessionSnapshot } from '@my-pi-harness/protocol';
import { Value } from 'typebox/value';
import { test, expect } from './fixture.js';
import { configureTestProvider } from './model-fixtures.js';
import { startMarkdownModel } from './markdown-model.js';
import { startTestModel } from './model-server.js';
import { chooseOption } from './ui-controls.js';

declare global {
  interface Window {
    sessionLogUrls?: { created: string[]; revoked: string[] };
  }
}

const startSession = async (page: Page, text: string): Promise<SessionSnapshot> => {
  const created = page.waitForResponse((response) => {
    return (
      response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/sessions'
    );
  });
  await page.getByLabel('消息', { exact: true }).fill(text);
  await page.getByRole('button', { name: '发送', exact: true }).click();
  const response = await created;
  const snapshot: unknown = await response.json();
  if (!response.ok() || !Value.Check(SessionSnapshotSchema, snapshot)) {
    throw new Error('Creating the log download session failed');
  }
  return snapshot;
};

const sendFirstMessage = async (page: Page, text: string): Promise<SessionSnapshot> => {
  const snapshot = await startSession(page, text);
  await expect(page.getByText(`响应：${text}`, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '停止', exact: true })).toHaveCount(0);
  return snapshot;
};

test('会话标题栏全宽展示，下载完整 JSONL 并在失败后重试', async ({ page, daemon }, testInfo) => {
  const model = await startTestModel();
  try {
    await page.addInitScript(() => {
      const created: string[] = [];
      const revoked: string[] = [];
      const create = URL.createObjectURL.bind(URL);
      const revoke = URL.revokeObjectURL.bind(URL);
      window.sessionLogUrls = { created, revoked };
      URL.createObjectURL = (blob): string => {
        const url = create(blob);
        created.push(url);
        return url;
      };
      URL.revokeObjectURL = (url): void => {
        revoked.push(url);
        revoke(url);
      };
    });
    await page.goto(daemon.origin);
    await configureTestProvider(page, model.origin);
    await page.reload();
    await chooseOption(
      page,
      page.getByRole('combobox', { name: '对话模型', exact: true }),
      'Queue Model · Chat',
    );
    const original = await sendFirstMessage(page, '对话日志下载验收');
    const header = page.getByLabel('会话标题栏', { exact: true });
    const panel = page.getByRole('region', { name: '当前会话', exact: true });
    await expect(
      header.getByRole('heading', { name: '对话日志下载验收', exact: true }),
    ).toBeVisible();
    await expect(header.getByRole('button')).toHaveCount(1);
    await expect(page.getByRole('combobox', { name: '历史分支', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '删除会话', exact: true })).toHaveCount(0);
    await expect(page.getByText(/会话与模型设置/u)).toHaveCount(0);
    const headerBox = await header.boundingBox();
    const panelBox = await panel.boundingBox();
    if (headerBox === null || panelBox === null)
      throw new Error('Conversation header is not laid out');
    expect(headerBox.x).toBeCloseTo(panelBox.x, 1);
    expect(headerBox.width).toBeCloseTo(panelBox.width, 1);

    await page.getByRole('article', { name: '你的消息', exact: true }).hover();
    await page.getByRole('button', { name: '编辑并在新分支重发', exact: true }).click();
    await page.getByLabel('编辑消息', { exact: true }).fill('分支里的新回复');
    await page.getByRole('button', { name: '创建分支并重发', exact: true }).click();
    await expect(page.getByText('响应：分支里的新回复', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '停止', exact: true })).toHaveCount(0);
    const logPath = `${daemon.origin}/api/sessions/${original.session.id}/log`;
    const committed = await page.request.get(logPath);
    expect(committed.ok()).toBe(true);
    const expectedBytes = await committed.body();

    const logPattern = '**/api/sessions/*/log';
    await page.route(logPattern, async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: '会话日志暂不可用，请重试。' }),
      });
    });
    const download = header.getByRole('button', { name: '下载对话日志', exact: true });
    await download.click();
    await expect(page.getByRole('alert')).toContainText('会话日志暂不可用，请重试。');
    await expect(download).toBeEnabled();
    await page.unroute(logPattern);
    const downloading = page.waitForEvent('download');
    await download.click();
    const file = await downloading;
    expect(file.suggestedFilename()).toBe(`${original.session.id}.jsonl`);
    const saved = testInfo.outputPath(file.suggestedFilename());
    await file.saveAs(saved);
    const bytes = await readFile(saved);
    expect(bytes.equals(expectedBytes)).toBe(true);
    const text = bytes.toString('utf8');
    expect(text.endsWith('\n')).toBe(true);
    for (const line of text.trimEnd().split('\n')) {
      const entry: unknown = JSON.parse(line);
      expect(typeof entry).toBe('object');
      expect(entry).not.toBeNull();
    }
    expect(text).toContain('对话日志下载验收');
    expect(text).toContain('分支里的新回复');
    expect(text).not.toContain('synthetic-account-key');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect
      .poll(async () => {
        return page.evaluate(() => window.sessionLogUrls?.revoked.length);
      })
      .toBe(1);
    const urls = await page.evaluate(() => window.sessionLogUrls);
    expect(urls?.revoked).toEqual(urls?.created);
    await page.screenshot({ path: testInfo.outputPath('conversation-header.png'), fullPage: true });
  } finally {
    await model.close();
  }
});

test('运行中下载固定已提交 JSONL 前缀，完成后再次下载包含后续内容', async ({
  page,
  daemon,
}, testInfo) => {
  const prefix = '这是下载时已经提交的首段正文。';
  const suffix = '这是首次下载后才会生成的最终内容。';
  const model = await startMarkdownModel(prefix, `\n\n${suffix}`);
  try {
    await page.goto(daemon.origin);
    await configureTestProvider(page, model.origin);
    await page.reload();
    await chooseOption(
      page,
      page.getByRole('combobox', { name: '对话模型', exact: true }),
      'Queue Model · Chat',
    );
    const original = await startSession(page, '运行中的日志快照');
    await expect(page.getByText(prefix, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '停止', exact: true })).toBeVisible();
    const download = page.getByRole('button', { name: '下载对话日志', exact: true });
    await expect(download).toBeEnabled();
    const activeResponse = await page.request.get(
      `${daemon.origin}/api/sessions/${original.session.id}`,
    );
    const active: unknown = await activeResponse.json();
    if (!activeResponse.ok() || !Value.Check(SessionSnapshotSchema, active)) {
      throw new Error('Cannot read the running session before log download');
    }
    expect(active.session.activeRunId).not.toBeNull();
    const firstDownloading = page.waitForEvent('download');
    await download.click();
    const firstFile = await firstDownloading;
    expect(firstFile.suggestedFilename()).toBe(`${original.session.id}.jsonl`);
    const firstPath = testInfo.outputPath('running-prefix.jsonl');
    await firstFile.saveAs(firstPath);
    const firstBytes = await readFile(firstPath);
    const firstText = firstBytes.toString('utf8');
    expect(firstText.endsWith('\n')).toBe(true);
    expect(firstText).toContain(prefix);
    expect(firstText).not.toContain(suffix);
    for (const line of firstText.trimEnd().split('\n')) {
      const entry: unknown = JSON.parse(line);
      expect(typeof entry).toBe('object');
      expect(entry).not.toBeNull();
    }
    await expect(page.getByRole('button', { name: '停止', exact: true })).toBeVisible();

    model.finish();
    await expect(page.getByText(suffix, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '停止', exact: true })).toHaveCount(0);
    expect((await readFile(firstPath)).equals(firstBytes)).toBe(true);
    const finalDownloading = page.waitForEvent('download');
    await download.click();
    const finalFile = await finalDownloading;
    const finalPath = testInfo.outputPath('completed-log.jsonl');
    await finalFile.saveAs(finalPath);
    const finalBytes = await readFile(finalPath);
    expect(finalBytes.subarray(0, firstBytes.length).equals(firstBytes)).toBe(true);
    const finalText = finalBytes.toString('utf8');
    expect(finalText).toContain(suffix);
    expect(finalText.endsWith('\n')).toBe(true);
    for (const line of finalText.trimEnd().split('\n')) {
      const entry: unknown = JSON.parse(line);
      expect(typeof entry).toBe('object');
      expect(entry).not.toBeNull();
    }
    expect(model.requests).toBe(1);
  } finally {
    await model.close();
  }
});

test('离开会话取消在途日志下载，不触发旧会话文件保存', async ({ page, daemon }) => {
  const model = await startTestModel();
  let release = (): void => {
    throw new Error('Download gate not initialized');
  };
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const downloads: string[] = [];
  page.on('download', (file) => {
    downloads.push(file.suggestedFilename());
  });
  try {
    await page.goto(daemon.origin);
    await configureTestProvider(page, model.origin);
    await page.reload();
    await chooseOption(
      page,
      page.getByRole('combobox', { name: '对话模型', exact: true }),
      'Queue Model · Chat',
    );
    await sendFirstMessage(page, '取消日志下载验收');
    let requested: Route | undefined;
    await page.route('**/api/sessions/*/log', async (route) => {
      requested = route;
      await gate;
      if (route.request().failure() === null) await route.continue();
    });
    const download = page.getByRole('button', { name: '下载对话日志', exact: true });
    await download.click();
    await expect(download).toHaveAttribute('aria-busy', 'true');
    await expect(download).toBeDisabled();
    await page.getByRole('button', { name: '新对话', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: '我们从哪里开始？', exact: true }),
    ).toBeVisible();
    await expect
      .poll(() => requested !== undefined && requested.request().failure() !== null)
      .toBe(true);
    release();
    await page.unroute('**/api/sessions/*/log');
    expect(downloads).toEqual([]);
    await expect(page.getByRole('alert')).toHaveCount(0);
  } finally {
    release();
    await page.unroute('**/api/sessions/*/log');
    await model.close();
  }
});
