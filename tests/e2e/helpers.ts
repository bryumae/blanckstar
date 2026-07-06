import { expect, type Page } from '@playwright/test';

// Boot into a playable mission: pick a scenario, start, and — critically — wait
// for the picker modal to actually detach before returning. Screen content is
// mounted behind the modal, so a `toBeVisible()` check can pass while the modal
// still overlays and intercepts clicks; interacting before it's gone races on
// slow CI (headless Firefox), which is why callers must wait here, not just
// assume the app is instantly interactive.
export async function startMission(page: Page, name: RegExp): Promise<void> {
  await page.getByRole('button', { name }).click();
  await page.getByRole('button', { name: 'Start mission' }).click();
  await expect(page.getByText('SELECT SCENARIO')).toHaveCount(0);
}
