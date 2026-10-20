import { createServer } from 'node:http';
import type { ServerResponse } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { AuthStatusSchema, ProviderConfigSchema } from '@my-pi-harness/protocol';
import { Value } from 'typebox/value';
import { test, expect } from './fixture.js';
import type { Page } from '@playwright/test';
import { configureTestProvider } from './model-fixtures.js';
import { chooseOption } from './ui-controls.js';

interface ControlledModel {
  origin: string;
  append: (text: string) => void;
  finish: () => void;
  close: () => Promise<void>;
}

interface TimelineFrame {
  frame: number;
  at: number;
  phase: string;
  articleHeight: number;
  footerBottom: number;
  bottomGap: number;
  scrollTop: number;
  scrollHeight: number;
  viewportHeight: number;
}

interface TimelineRecorder {
  phase: string;
  active: boolean;
  frame: number;
  raf: TimelineFrame[];
  postTask: TimelineFrame[];
  settled: TimelineFrame[];
  captureSettled: () => void;
  stop: () => void;
}

interface SamplingWindow extends Window {
  conversationFrames?: TimelineRecorder;
}

/** Keep each provider response open until its test releases the next real SSE fragment. */
async function startControlledModel(
  answer: (requestNumber: number) => string,
  controlled: boolean,
): Promise<ControlledModel> {
  let response: ServerResponse | undefined;
  let requests = 0;
  const send = (delta: Record<string, string>, finishReason: string | null = null): void => {
    if (!response || response.destroyed || response.writableEnded) {
      throw new Error('The controlled response is not open');
    }
    response.write(
      `data: ${JSON.stringify({
        id: `plain-timeline-${requests}`,
        object: 'chat.completion.chunk',
        created: 1,
        model: 'chat-model',
        choices: [{ index: 0, delta, finish_reason: finishReason }],
      })}\n\n`,
    );
  };
  const finish = (): void => {
    send({}, 'stop');
    response?.end('data: [DONE]\n\n');
  };
  const server = createServer((request, incomingResponse) => {
    const reply = async (): Promise<void> => {
      for await (const _chunk of request) {
        // Geometry tests observe streamed output, so consume rather than retain model inputs.
      }
      response = incomingResponse;
      requests += 1;
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
      });
      send({ role: 'assistant', content: answer(requests) });
      if (!controlled) finish();
    };
    reply().catch(() => incomingResponse.destroy());
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No controlled model listener');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    append: (text) => send({ content: text }),
    finish,
    close: async (): Promise<void> => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}

async function openModel(
  page: Page,
  origin: string,
  modelOrigin: string,
  contextWindow = 8192,
): Promise<void> {
  await page.goto(origin);
  const created = await configureTestProvider(page, modelOrigin);
  if (contextWindow !== 8192) {
    const status: unknown = await (await page.request.get(`${origin}/api/auth/status`)).json();
    const provider: unknown = await (
      await page.request.get(`${origin}/api/providers/${encodeURIComponent(created.id)}`)
    ).json();
    if (!Value.Check(AuthStatusSchema, status) || !status.csrfToken) {
      throw new Error('Updating the fixture provider requires authenticated local access');
    }
    if (!Value.Check(ProviderConfigSchema, provider)) {
      throw new Error('The fixture provider could not be read');
    }
    const response = await page.request.put(
      `${origin}/api/providers/${encodeURIComponent(provider.id)}`,
      {
        headers: { Origin: origin, 'X-CSRF-Token': status.csrfToken },
        data: {
          id: provider.id,
          expectedRevision: provider.revision,
          name: provider.name,
          kind: provider.kind,
          builtinId: provider.builtinId,
          api: provider.api,
          baseUrl: provider.baseUrl,
          enabled: provider.enabled,
          requiresApiKey: provider.requiresApiKey,
          models: provider.models.map((model) => ({ ...model, contextWindow })),
        },
      },
    );
    if (!response.ok()) throw new Error('Updating the fixture context window failed');
  }
  await page.reload();
  await chooseOption(
    page,
    page.getByRole('combobox', { name: '对话模型', exact: true }),
    'Queue Model · Chat',
  );
}

async function renderFrames(page: Page, count = 5): Promise<void> {
  await page.evaluate(async (frames) => {
    for (let index = 0; index < frames; index += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  }, count);
}

async function setPhase(page: Page, phase: string): Promise<void> {
  await page.evaluate((nextPhase) => {
    const recorder = (window as SamplingWindow).conversationFrames;
    if (!recorder) throw new Error('The timeline recorder is not installed');
    recorder.phase = nextPhase;
  }, phase);
}

async function startRecording(page: Page): Promise<void> {
  await page.evaluate(() => {
    const timeline = document.querySelector<HTMLElement>('[aria-label="对话记录"]');
    const article = document.querySelector<HTMLElement>('article[aria-label="Agent的消息"]');
    const footer = article?.querySelector<HTMLElement>('[role="status"]')?.parentElement;
    if (!timeline || !article || !footer) throw new Error('The streaming answer is not visible');
    const afterFrame = new MessageChannel();
    const recorder: TimelineRecorder = {
      phase: 'baseline',
      active: true,
      frame: 0,
      raf: [],
      postTask: [],
      settled: [],
      captureSettled: (): void => {
        recorder.settled.push(sample());
      },
      stop: (): void => {
        recorder.active = false;
        cancelAnimationFrame(frameId);
        afterFrame.port1.close();
        afterFrame.port2.close();
      },
    };
    (window as SamplingWindow).conversationFrames = recorder;
    const sample = (): TimelineFrame => {
      const viewport = timeline.getBoundingClientRect();
      const footerBounds = footer.getBoundingClientRect();
      return {
        frame: recorder.frame,
        at: performance.now(),
        phase: recorder.phase,
        articleHeight: article.getBoundingClientRect().height,
        footerBottom: footerBounds.bottom,
        bottomGap: viewport.bottom - footerBounds.bottom,
        scrollTop: timeline.scrollTop,
        scrollHeight: timeline.scrollHeight,
        viewportHeight: viewport.height,
      };
    };
    afterFrame.port1.onmessage = (): void => {
      if (recorder.active) recorder.postTask.push(sample());
    };
    const tick = (): void => {
      if (!recorder.active) return;
      recorder.frame += 1;
      recorder.raf.push(sample());
      // Record a later task separately; neither geometry sample measures screen paint.
      afterFrame.port2.postMessage(null);
      frameId = requestAnimationFrame(tick);
    };
    let frameId = requestAnimationFrame(tick);
  });
}

async function readFrames(
  page: Page,
): Promise<{ raf: TimelineFrame[]; postTask: TimelineFrame[]; settled: TimelineFrame[] }> {
  return await page.evaluate(() => {
    const recorder = (window as SamplingWindow).conversationFrames;
    if (!recorder) throw new Error('The timeline recorder is not installed');
    return { raf: recorder.raf, postTask: recorder.postTask, settled: recorder.settled };
  });
}

/** Record an endpoint only after the caller waits for the streamed text and render frames. */
async function captureSettledFrame(page: Page): Promise<void> {
  await page.evaluate(() => {
    const recorder = (window as SamplingWindow).conversationFrames;
    if (!recorder) throw new Error('The timeline recorder is not installed');
    recorder.captureSettled();
  });
}

async function expectAtEnd(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      return await page.getByLabel('对话记录', { exact: true }).evaluate((element) => {
        return element.scrollHeight - element.scrollTop - element.clientHeight;
      });
    })
    .toBeLessThan(2);
}

function expectSettledFooter(frames: TimelineFrame[], prefix: string): void {
  const baseline = frames.find((frame) => frame.phase === 'baseline');
  if (!baseline) throw new Error('The settled baseline was not recorded');
  const matching = frames.filter((frame) => frame.phase.startsWith(prefix));
  expect(matching.length).toBeGreaterThan(0);
  for (const frame of matching) {
    expect(Math.abs(frame.bottomGap - baseline.bottomGap)).toBeLessThanOrEqual(0.1);
  }
}

test('逐行流在测量完成后按整数排版贴底，上滑阅读与回到最新均可用', async ({ page, daemon }) => {
  test.setTimeout(45_000);
  const prefix =
    Array.from({ length: 9 }, (_, index) => {
      return `第${index + 1}段既有内容。${'用于确保时间线已经超出视口。'.repeat(9)}\n\n`;
    }).join('') + '下面的普通段落会逐字增高。';
  const model = await startControlledModel(() => prefix, true);
  let recording = false;
  try {
    await openModel(page, daemon.origin, model.origin);
    await page.getByLabel('消息', { exact: true }).fill('普通逐行滚动回归');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    const answer = page.getByRole('article', { name: 'Agent的消息', exact: true });
    const markdown = answer.locator('.markdown');
    await expect(markdown).toContainText('下面的普通段落会逐字增高。');
    await expectAtEnd(page);
    await renderFrames(page);
    await startRecording(page);
    recording = true;
    await renderFrames(page);
    await captureSettledFrame(page);
    const initial = await answer.boundingBox();
    if (!initial) throw new Error('The streaming article is not mounted');
    for (let index = 0; index < 30; index += 1) {
      const text = `续写${index}普通文字继续增长。`;
      await setPhase(page, `following-soft-${index}`);
      model.append(text);
      await expect(markdown).toContainText(text);
      await renderFrames(page);
      await captureSettledFrame(page);
    }
    for (let index = 0; index < 5; index += 1) {
      const text = `列表新增${index}，正常的一行内容。`;
      await setPhase(page, `following-list-${index}`);
      model.append(`\n- ${text}`);
      await expect(markdown).toContainText(text);
      await renderFrames(page);
      await captureSettledFrame(page);
    }
    const tableChunks = [
      { text: '\n\n| 项目 | 表格内容 |\n', marker: '表格内容' },
      { text: '| --- | --- |\n| 表格新增0 | 第一行内容 |\n', marker: '表格新增0' },
      { text: '| 表格新增1 | 第二行内容 |\n', marker: '表格新增1' },
      { text: '| 表格新增2 | 第三行内容 |\n', marker: '表格新增2' },
    ];
    for (const chunk of tableChunks) {
      await setPhase(page, `following-table-${chunk.marker}`);
      model.append(chunk.text);
      await expect(markdown).toContainText(chunk.marker);
      await renderFrames(page);
      await captureSettledFrame(page);
    }
    await expect(markdown.getByRole('table')).toBeVisible();
    await expect(markdown.getByRole('row')).toHaveCount(4);
    const following = await readFrames(page);
    expect(following.settled.filter((frame) => frame.phase.startsWith('following-'))).toHaveLength(
      39,
    );
    expectSettledFooter(following.settled, 'following-');
    const heights = following.postTask.map((frame) => frame.articleHeight);
    expect(Math.max(...heights) - initial.height).toBeGreaterThan(200);

    const timeline = page.getByLabel('对话记录', { exact: true });
    await setPhase(page, 'scrolling-up');
    await timeline.hover();
    await page.mouse.wheel(0, -320);
    await expect(page.getByRole('button', { name: '回到最新消息', exact: true })).toBeVisible();
    await expect
      .poll(async () => {
        const before = await timeline.evaluate((element) => element.scrollTop);
        await renderFrames(page, 3);
        return Math.abs((await timeline.evaluate((element) => element.scrollTop)) - before);
      })
      .toBeLessThan(1);
    await setPhase(page, 'reading');
    const readingTop = await timeline.evaluate((element) => element.scrollTop);
    for (let index = 0; index < 3; index += 1) {
      const text = `阅读期间新增${index}，保持原位置。`;
      model.append(`\n- ${text}`);
      await expect(markdown).toContainText(text);
      await renderFrames(page);
      await captureSettledFrame(page);
    }
    const reading = (await readFrames(page)).postTask.filter((frame) => frame.phase === 'reading');
    expect(reading.length).toBeGreaterThan(5);
    expect(
      Math.max(...reading.map((frame) => Math.abs(frame.scrollTop - readingTop))),
    ).toBeLessThanOrEqual(1);

    await setPhase(page, 'jumping');
    await page.getByRole('button', { name: '回到最新消息', exact: true }).click();
    await expectAtEnd(page);
    await renderFrames(page);
    await setPhase(page, 'resumed');
    model.append('\n- 手动回到最新后继续跟随。');
    await expect(markdown).toContainText('手动回到最新后继续跟随。');
    await renderFrames(page, 10);
    await captureSettledFrame(page);
    expectSettledFooter((await readFrames(page)).settled, 'resumed');

    await setPhase(page, 'resizing');
    await page.setViewportSize({ width: 1000, height: 800 });
    await expectAtEnd(page);
    await renderFrames(page);
    await setPhase(page, 'resized-following');
    model.append('\n- 调整窗口后继续跟随新增的一行。');
    await expect(markdown).toContainText('调整窗口后继续跟随新增的一行。');
    await renderFrames(page, 10);
    await captureSettledFrame(page);
    expectSettledFooter((await readFrames(page)).settled, 'resized-following');
    await setPhase(page, 'completed');
    model.finish();
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeVisible();
    await expectAtEnd(page);
  } finally {
    try {
      if (recording) {
        const frames = await readFrames(page);
        await page.evaluate(() => (window as SamplingWindow).conversationFrames?.stop());
        await mkdir('output/diagnostics/integer-markdown-timeline', { recursive: true });
        await writeFile(
          'output/diagnostics/integer-markdown-timeline/stream-frames.json',
          JSON.stringify(frames, null, 2),
        );
      }
    } finally {
      await model.close();
    }
  }
});

test('长历史只渲染有界消息，顶部与最新回答均可滚动阅读', async ({ page, daemon }) => {
  test.setTimeout(45_000);
  const turns = 24;
  const model = await startControlledModel((requestNumber) => {
    return Array.from({ length: 6 }, (_, index) => {
      return `Answer ${requestNumber}, paragraph ${index + 1}. ${'History remains available in the conversation. '.repeat(4)}`;
    }).join('\n\n');
  }, false);
  try {
    // This case owns long-history rendering; compaction has separate lifecycle tests.
    await openModel(page, daemon.origin, model.origin, 65_536);
    const timeline = page.getByLabel('对话记录', { exact: true });
    let earlyArticleCount = 0;
    for (let index = 1; index <= turns; index += 1) {
      await page.getByLabel('消息', { exact: true }).fill(`历史消息${index}`);
      await page.getByRole('button', { name: '发送', exact: true }).click();
      await expect(
        page.getByRole('article', { name: 'Agent的消息', exact: true }).last(),
      ).toContainText(`Answer ${index}, paragraph 6.`);
      await expect(page.getByRole('button', { name: '停止', exact: true })).toBeHidden();
      if (index === 8) {
        await expectAtEnd(page);
        await renderFrames(page);
        earlyArticleCount = await timeline.getByRole('article').count();
      }
    }
    await expectAtEnd(page);
    await expect.poll(async () => await timeline.getByRole('article').count()).toBeLessThan(turns);
    await expect
      .poll(async () => await timeline.getByRole('article').count())
      .toBeLessThanOrEqual(earlyArticleCount + 8);
    await expect
      .poll(async () => {
        return await timeline.evaluate((element) => element.scrollHeight / element.clientHeight);
      })
      .toBeGreaterThan(10);
    await expect(
      timeline
        .getByRole('article', { name: 'Agent的消息', exact: true })
        .last()
        .getByText(/^Answer 24, paragraph 6\./u),
    ).toBeInViewport();

    await timeline.evaluate((element) => {
      element.scrollTop = 0;
    });
    await expect(timeline.getByText('历史消息1', { exact: true })).toBeInViewport();
    await expect(timeline.getByText(/^Answer 1, paragraph 1\./u)).toBeInViewport();
    await expect.poll(async () => await timeline.getByRole('article').count()).toBeLessThan(turns);
    await page.getByRole('button', { name: '回到最新消息', exact: true }).click();
    await expectAtEnd(page);
    await expect(
      timeline
        .getByRole('article', { name: 'Agent的消息', exact: true })
        .last()
        .getByText(/^Answer 24, paragraph 6\./u),
    ).toBeInViewport();
    await expect.poll(async () => await timeline.getByRole('article').count()).toBeLessThan(turns);
  } finally {
    await model.close();
  }
});
