import type { Page } from '@playwright/test';

/**
 * Open mounted completed processes through their controls without closing expanded groups.
 * @param page The conversation page after its successful answer has completed.
 */
export async function expandCompletedProcesses(page: Page): Promise<void> {
  const closed = page.getByRole('button', { name: '展开回答过程', exact: true });
  while ((await closed.count()) > 0) await closed.first().click();
}
