import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from './fixture.js';
import { chooseOption } from './ui-controls.js';
import { configureTestProvider } from './model-fixtures.js';
import { registerTestWorkspace } from './workspace-fixtures.js';
import { startToolSequenceModel } from './m2-completion-model.js';

test.skip(
  process.platform !== 'darwin' || process.env['MY_PI_HARNESS_OFFICE_PYTHON'] === undefined,
  'Office browser verification requires the explicitly configured test Python environment on macOS.',
);
/** Real Office worker publishes a file; the browser downloads the exact recorded result after approval. */
test('按需加载办公工具、审批创建 DOCX 并从详情下载原始产物', async ({ page, daemon }, testInfo) => {
  const directory = await mkdtemp(join(tmpdir(), 'my-pi-office-browser-'));
  const model = await startToolSequenceModel(
    [
      { name: 'load_tools', arguments: { names: ['office_docx'] } },
      {
        name: 'office_docx',
        arguments: {
          output: 'browser-created.docx',
          paragraphs: [
            { text: 'Browser office fixture', heading: 1 },
            { text: 'Created through the real office worker' },
          ],
        },
      },
    ],
    '文档已创建。',
  );
  try {
    await page.goto(daemon.origin);
    await registerTestWorkspace(page, '文档工作区', directory);
    await configureTestProvider(page, model.origin, 32768);
    await page.reload();
    await chooseOption(
      page,
      page.getByRole('combobox', { name: '对话模型', exact: true }),
      'Queue Model · Chat',
    );
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
    await page.getByLabel('消息', { exact: true }).fill('创建一份 Word 文档');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    const row = page.getByLabel('office_docx 工具调用', { exact: true });
    await row.getByRole('button', { name: '允许本次操作', exact: true }).click();
    await expect(page.getByText('文档已创建。', { exact: true })).toBeVisible();
    const button = row.getByRole('button', { name: '下载 browser-created.docx', exact: true });
    if (!(await button.isVisible()))
      await row.getByRole('button', { name: '展开 office_docx 工具详情', exact: true }).click();
    const downloading = page.waitForEvent('download');
    await button.click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe('browser-created.docx');
    const downloadedPath = await download.path();
    if (downloadedPath === null) throw new Error('Missing downloaded Office bytes');
    const actual = await readFile(downloadedPath);
    expect(actual.subarray(0, 2).toString()).toBe('PK');
    expect(actual).toEqual(await readFile(join(directory, 'browser-created.docx')));
    expect(model.requests).toHaveLength(3);
    await page.screenshot({ path: testInfo.outputPath('office-artifact.png'), fullPage: true });
  } finally {
    await model.close();
    await rm(directory, { recursive: true, force: true });
  }
});
