import { expect, test, type Page } from '@playwright/test';

// End-to-end regression coverage for the app shell + three primary screens
// (mvp0_spec.md §7, §12 AC1). Selectors favor role/text over CSS classes per
// the phase-9 boundary note so screen-internal restyling doesn't break these.

// Boot into a playable mission: pick a scenario, start, and — critically — wait
// for the picker modal to actually detach before returning. Screen content is
// mounted behind the modal, so a `toBeVisible()` check can pass while the modal
// still overlays and intercepts clicks; interacting before it's gone races on
// slow CI (headless Firefox), which is why callers must wait here, not just
// assume the app is instantly interactive.
async function startMission(page: Page, name: RegExp): Promise<void> {
  await page.getByRole('button', { name }).click();
  await page.getByRole('button', { name: 'Start mission' }).click();
  await expect(page.getByText('SELECT SCENARIO')).toHaveCount(0);
}

test('boots to the scenario picker and starts a mission', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Blanckstar');
  await expect(page.getByText('SELECT SCENARIO')).toBeVisible();
  await expect(page.getByRole('button', { name: /Close call/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Long way home/ })).toBeVisible();

  await startMission(page, /Close call/);

  await expect(page.getByText('SCENARIO', { exact: true })).toBeVisible();
  await expect(page.getByText('CLOSE CALL', { exact: true })).toBeVisible();

  // UTC clock reads a real date once the sim has emitted its first frame.
  await expect(page.locator('.shell-clock-value').first()).toContainText('2026-09-01');
});

test('nav rail switches between all three primary screens', async ({ page }) => {
  await page.goto('/');
  await startMission(page, /Close call/);

  // Telescope is the default screen.
  await expect(page.getByText('IDENTIFIED OBJECTS')).toBeVisible();

  await page.getByRole('button', { name: /Script Console/ }).click();
  await expect(page.getByText('Script Console')).toBeVisible();
  await expect(page.locator('.script-btn.run')).toBeVisible();
  await expect(page.getByText('IDENTIFIED OBJECTS')).toBeHidden();

  await page.getByRole('button', { name: /^▤ Data/ }).click();
  await expect(page.getByText('RADIO · EARTH BEACON')).toBeVisible();
  await expect(page.getByText('Script Console')).toBeHidden();

  await page.getByRole('button', { name: /◎ Telescope/ }).click();
  await expect(page.getByText('IDENTIFIED OBJECTS')).toBeVisible();
  await expect(page.getByText('RADIO · EARTH BEACON')).toBeHidden();
});

test('running the default script prints console output', async ({ page }) => {
  await page.goto('/');
  await startMission(page, /Close call/);
  await page.getByRole('button', { name: /Script Console/ }).click();

  await page.locator('.script-btn.run').click();
  await expect(page.getByText(/range \(km\):/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('script finished')).toBeVisible({ timeout: 20_000 });
});

test('opening a seeded script sheet does not lose default sheet output', async ({ page }) => {
  await page.goto('/');
  await startMission(page, /Close call/);
  await page.getByRole('button', { name: /Script Console/ }).click();

  await page.locator('.script-btn.run').click();
  await expect(page.getByText('script finished')).toBeVisible({ timeout: 20_000 });
  await page.locator('.script-list-item.seeded', { hasText: 'Calculator' }).click();
  await expect(page.getByRole('button', { name: /calculator\.js/ })).toBeVisible();
  await page.getByRole('button', { name: /sequence\.js/ }).click();
  await expect(page.getByText('script finished')).toBeVisible();
});

test('Data screen radio lock button fills in the lock card', async ({ page }) => {
  await page.goto('/');
  await startMission(page, /Close call/);
  await page.getByRole('button', { name: /^▤ Data/ }).click();

  await expect(page.getByText('NO LOCK YET')).toBeVisible();
  await page.getByRole('button', { name: /radio\.lockEarth\(\)/ }).click();
  await expect(page.getByText('LEVEL 1 LOCK')).toBeVisible();
  await expect(page.getByText(/km$/).first()).toBeVisible();

  // The header beacon indicator mirrors the lock (shell owns this, §2/design ref).
  await expect(page.locator('.shell-beacon-state')).toHaveText('LOCKED');
});

test('debug mode is absent without ?debug=1 and present with it', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('DEBUG', { exact: true })).toHaveCount(0);

  await page.goto('/?debug=1');
  await expect(page.getByText('DEBUG', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('DEBUG MODE')).toBeVisible();
});
