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
