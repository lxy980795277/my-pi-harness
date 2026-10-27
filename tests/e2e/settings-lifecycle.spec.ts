import {
  AuthStatusSchema,
  ConnectionViewSchema,
  SkillDetailSchema,
  SkillViewSchema,
} from '@my-pi-harness/protocol';
import type { APIRequestContext } from '@playwright/test';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { test, expect } from './fixture.js';
import { openUserSettings } from './ui-controls.js';

interface Gate {
  promise: Promise<void>;
  release(): void;
}

function gate(): Gate {
  let release = (): void => {
    throw new Error('Browser gate was not initialized');
  };
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function writeHeaders(
  request: APIRequestContext,
  origin: string,
): Promise<Record<string, string>> {
  const response = await request.get(`${origin}/api/auth/status`);
  const status: unknown = await response.json();
  if (!Value.Check(AuthStatusSchema, status) || status.csrfToken === null)
    throw new Error('Missing browser fixture CSRF');
  return { Origin: origin, 'X-CSRF-Token': status.csrfToken };
}

test('关闭在途账户编辑后，新目标可以保存且旧响应不改写页面', async ({ page, daemon }) => {
  await page.goto(daemon.origin);
  const headers = await writeHeaders(page.request, daemon.origin);
  const connections = [];
  for (const name of ['Governance Account A', 'Governance Account B']) {
    const response = await page.request.post(`${daemon.origin}/api/connections`, {
      headers,
      data: { serviceId: 'github', name, authMode: 'token', clientId: '', scopes: [] },
    });
    expect(response.ok()).toBe(true);
    const connection: unknown = await response.json();
    if (!Value.Check(ConnectionViewSchema, connection)) throw new Error('Invalid account fixture');
    connections.push(connection);
  }
  const first = connections[0];
  if (first === undefined) throw new Error('Missing first account');
  const started = gate();
  const release = gate();
  await page.route(`**/api/connections/${first.id}`, async (route) => {
    if (route.request().method() !== 'PUT') {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    started.release();
    await release.promise;
    await route.fulfill({ response });
  });
  try {
    await openUserSettings(page);
    await page.getByRole('tab', { name: '连接', exact: true }).click();
    const firstRow = page.getByRole('article').filter({
      has: page.getByRole('heading', { name: first.name, exact: true }),
    });
    const secondRow = page.getByRole('article').filter({
      has: page.getByRole('heading', { name: 'Governance Account B', exact: true }),
    });
    const editor = page.getByRole('dialog', { name: '外部连接配置', exact: true });
    await firstRow.getByRole('button', { name: '编辑', exact: true }).click();
    await editor.getByLabel('名称', { exact: true }).fill('Governance Account A updated');
    await editor.getByRole('button', { name: '保存配置', exact: true }).click();
    await started.promise;
    const cancelled = page.waitForEvent('requestfailed', {
      predicate: (request) => request.method() === 'PUT' && request.url().endsWith(first.id),
    });
    await page.keyboard.press('Escape');
    await cancelled;
    await secondRow.getByRole('button', { name: '编辑', exact: true }).click();
    await expect(editor.getByLabel('名称', { exact: true })).toHaveValue('Governance Account B');
    await expect(editor.getByRole('button', { name: '保存配置', exact: true })).toBeEnabled();
    release.release();
    await expect(
      page.getByRole('heading', {
        name: 'Governance Account A updated',
        exact: true,
        includeHidden: true,
      }),
    ).toBeVisible();
    await expect(editor).toBeVisible();
    await editor.getByLabel('名称', { exact: true }).fill('Governance Account B updated');
    await editor.getByRole('button', { name: '保存配置', exact: true }).click();
    await expect(editor).toBeHidden();
    await expect(
      page.getByRole('heading', { name: 'Governance Account B updated', exact: true }),
    ).toBeVisible();
  } finally {
    release.release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('切换Skill清除旧资源，并取消旧预览的迟到失败', async ({ page, daemon }) => {
  await page.goto(daemon.origin);
  const headers = await writeHeaders(page.request, daemon.origin);
  for (const id of ['documents', 'pdf']) {
    const response = await page.request.post(`${daemon.origin}/api/plugins/${id}/install`, {
      headers,
    });
    expect(response.ok()).toBe(true);
  }
  const response = await page.request.get(`${daemon.origin}/api/skills`);
  const catalog: unknown = await response.json();
  if (!Value.Check(Type.Array(SkillViewSchema), catalog)) throw new Error('Invalid Skill catalog');
  const skill = catalog.find((entry) => entry.name === 'documents');
  if (skill === undefined) throw new Error('Documents Skill is missing');
  const detailResponse = await page.request.get(`${daemon.origin}/api/skills/${skill.id}`);
  const detail: unknown = await detailResponse.json();
  if (!Value.Check(SkillDetailSchema, detail)) throw new Error('Invalid Skill detail');
  const resource = detail.resources.find((entry) => entry.mediaType.startsWith('text/'));
  if (resource === undefined) throw new Error('Documents Skill has no text resource');
  const started = gate();
  const release = gate();
  try {
    await openUserSettings(page);
    await page.getByRole('tab', { name: 'Skills', exact: true }).click();
    const documents = page.getByRole('button', { name: /^documents /u });
    const pdf = page.getByRole('button', { name: /^pdf /u });
    const resourceButton = page.getByRole('button', {
      name: `${resource.path} · ${resource.size} bytes`,
      exact: true,
    });
    await documents.click();
    await resourceButton.click();
    await expect(page.locator('pre')).toHaveCount(2);
    await pdf.click();
    await expect(page.getByRole('heading', { name: 'pdf', exact: true })).toBeVisible();
    await expect(page.locator('pre')).toHaveCount(1);
    await documents.click();
    await page.route(`**/api/skills/${skill.id}/resources/read`, async (route) => {
      started.release();
      await release.promise;
      await route.fulfill({
        status: 503,
        json: { code: 'RESOURCE_UNAVAILABLE', message: 'OLD_RESOURCE_FAILURE' },
      });
    });
    await resourceButton.click();
    await started.promise;
    const cancelled = page.waitForEvent('requestfailed', {
      predicate: (request) => request.url().endsWith(`/skills/${skill.id}/resources/read`),
    });
    await pdf.click();
    await cancelled;
    release.release();
    await expect(page.getByRole('heading', { name: 'pdf', exact: true })).toBeVisible();
    await expect(page.locator('pre')).toHaveCount(1);
    await expect(page.getByText('OLD_RESOURCE_FAILURE', { exact: true })).toBeHidden();
  } finally {
    release.release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});
