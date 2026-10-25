import type { Locator, Page } from '@playwright/test';

/**
 * Select a portaled shadcn option through the same controls a keyboard or pointer user operates.
 * @param page The page containing the portaled listbox.
 * @param control The labeled combobox trigger, optionally scoped to its dialog.
 * @param option The visible option name.
 */
export async function chooseOption(
  page: Page,
  control: Locator,
  option: string | RegExp,
): Promise<void> {
  await control.click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

/**
 * Reach settings through the sidebar account card and its portaled actions.
 * @param page The authenticated application page.
 */
export async function openUserSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: '用户信息，打开菜单', exact: true }).click();
  await page
    .getByRole('dialog', { name: '用户菜单', exact: true })
    .getByRole('button', { name: '设置', exact: true })
    .click();
}

/** Reveal local process controls and configuration exchange without closing an already open section. */
export async function openMcpAdvancedSettings(page: Page): Promise<void> {
  const advanced = page.locator('details').filter({
    has: page.getByText('高级配置', { exact: true }),
  });
  if ((await advanced.getAttribute('open')) === null) {
    await advanced.locator('summary').click();
  }
}

/**
 * Open the sign-out confirmation without accepting it or revoking the current session.
 * @param page The authenticated application page.
 */
export async function openLogoutConfirmation(page: Page): Promise<void> {
  await page.getByRole('button', { name: '用户信息，打开菜单', exact: true }).click();
  await page
    .getByRole('dialog', { name: '用户菜单', exact: true })
    .getByRole('button', { name: '退出登录', exact: true })
    .click();
}
