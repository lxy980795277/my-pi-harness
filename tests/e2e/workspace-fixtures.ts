import { AuthStatusSchema, WorkspaceSchema, type Workspace } from '@my-pi-harness/protocol';
import type { Page } from '@playwright/test';
import { Value } from 'typebox/value';

/** Register a real directory for tool tests that do not exercise the desktop chooser UI. */
export async function registerTestWorkspace(
  page: Page,
  name: string,
  rootPath: string,
): Promise<Workspace> {
  const origin = new URL(page.url()).origin;
  const authorization = await page.request.get(`${origin}/api/auth/status`);
  const status: unknown = await authorization.json();
  if (!Value.Check(AuthStatusSchema, status) || !status.csrfToken)
    throw new Error('The workspace fixture requires authenticated local access');
  const response = await page.request.post(`${origin}/api/workspaces`, {
    headers: { Origin: origin, 'X-CSRF-Token': status.csrfToken },
    data: { name, rootPath },
  });
  const workspace: unknown = await response.json();
  if (!response.ok() || !Value.Check(WorkspaceSchema, workspace))
    throw new Error(`Registering the fixture workspace failed (${response.status()})`);
  return workspace;
}
