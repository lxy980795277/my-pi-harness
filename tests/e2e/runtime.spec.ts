import { test, expect } from './fixture.js';
import { PROTOCOL_VERSION } from '@my-pi-harness/protocol';

test('真实健康与事件连接，主题切换保持一致', async ({ page, daemon }, testInfo) => {
  await page.goto(daemon.origin);
  await page.getByRole('button', { name: '运行状态', exact: true }).click();
  await expect(page.getByTestId('runtime-connection')).toHaveAttribute('data-state', 'ready');
  await expect(page.getByText('健康检查与事件连接正常。')).toBeVisible();
  await expect(page.getByTestId('runtime-ready-payload')).toContainText('runtime.ready');
  await expect(page.getByTestId('service-details')).toContainText('24.');
  expect(
    await page.evaluate(() => ({
      require: 'require' in globalThis,
      process: 'process' in globalThis,
      desktop: 'desktop' in globalThis,
    })),
  ).toEqual({ require: false, process: false, desktop: false });
  const screenshot = testInfo.outputPath('runtime-light.png');
  await page.screenshot({ path: screenshot, fullPage: true, animations: 'disabled' });
  await testInfo.attach('连接页面', { path: screenshot, contentType: 'image/png' });
  await page.getByRole('button', { name: '切换到深色主题' }).click();
  await expect(page.getByRole('button', { name: '切换到浅色主题' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '运行状态', exact: true }).click();
  await expect(page.getByTestId('runtime-connection')).toHaveAttribute('data-state', 'ready');
  await expect(page.getByRole('button', { name: '切换到浅色主题' })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('runtime-dark.png'),
    fullPage: true,
    animations: 'disabled',
  });
});

test('服务退出后显示断开，重新连接不会显示旧成功状态', async ({ page, daemon }) => {
  await page.goto(daemon.origin);
  await page.getByRole('button', { name: '运行状态', exact: true }).click();
  await expect(page.getByTestId('runtime-connection')).toHaveAttribute('data-state', 'ready');
  await daemon.stop();
  await expect(page.getByTestId('runtime-connection')).toHaveAttribute('data-state', 'error');
  await expect(page.getByText('事件连接已断开，请检查本机服务后重试。')).toBeVisible();
  await page.getByRole('button', { name: '重新连接' }).click();
  await expect(page.getByTestId('service-gate')).toBeVisible();
  await expect(page.getByTestId('runtime-connection')).toHaveAttribute('data-state', 'error');
  await expect(page.getByText('无法连接本机服务，请确认 daemon 已启动后重试。')).toBeVisible();
});

test('主页在协议不兼容时阻止进入工作台，服务更新后可重连', async ({ page, daemon }) => {
  await page.route('**/api/health', async (route) => {
    const original = await route.fetch();
    const data: unknown = await original.json();
    await route.fulfill({ json: { ...(data as Record<string, unknown>), protocolVersion: 999 } });
  });
  await page.goto(daemon.origin);
  await expect(page.getByTestId('service-gate')).toBeVisible();
  await expect(page.getByTestId('runtime-connection')).toHaveAttribute('data-state', 'error');
  await expect(
    page.getByText('本机服务与当前界面版本不兼容，请重启本机服务后重新连接。'),
  ).toBeVisible();
  await expect(page.getByTestId('workspace-shell')).not.toBeVisible();
  await expect(page.getByPlaceholder('输入任何问题')).not.toBeVisible();
  await expect(page.getByTestId('runtime-ready-payload')).not.toBeVisible();
  await page.unroute('**/api/health');
  await page.getByRole('button', { name: '重新连接' }).click();
  await expect(page.getByTestId('workspace-shell')).toBeVisible();
  await expect(page.getByPlaceholder('输入任何问题')).toBeVisible();
});

test('SSE实例身份不一致会被拒绝', async ({ page, daemon }) => {
  await page.route('**/api/runtime/events', async (route) => {
    await route.fulfill({
      contentType: 'text/event-stream',
      body: `event: runtime.ready\ndata: ${JSON.stringify({ type: 'runtime.ready', protocolVersion: PROTOCOL_VERSION, instanceId: 'stale-instance', startedAt: 0 })}\n\n`,
    });
  });
  await page.goto(daemon.origin);
  await page.getByRole('button', { name: '运行状态', exact: true }).click();
  await expect(page.getByText('本机服务已重启，请重新连接以读取当前状态。')).toBeVisible();
  await expect(page.getByTestId('runtime-connection')).toHaveAttribute('data-state', 'error');
});

test('服务恢复后可手动重新连接', async ({ page, daemon }) => {
  await page.route('**/api/health', (route) =>
    route.fulfill({ status: 503, json: { error: 'Unavailable' } }),
  );
  await page.goto(daemon.origin);
  await expect(page.getByTestId('service-gate')).toBeVisible();
  await expect(page.getByTestId('runtime-connection')).toHaveAttribute('data-state', 'error');
  await expect(page.getByTestId('workspace-shell')).not.toBeVisible();
  await page.unroute('**/api/health');
  await page.getByRole('button', { name: '重新连接' }).click();
  await expect(page.getByTestId('workspace-shell')).toBeVisible();
  await page.getByRole('button', { name: '运行状态', exact: true }).click();
  await expect(page.getByTestId('runtime-connection')).toHaveAttribute('data-state', 'ready');
});
