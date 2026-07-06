import { expect, test, type Page } from '@playwright/test';
import { FORBIDDEN_API_NAMES } from '../../src/sandbox/apiDocs';
import { startMission } from './helpers';

// Script Console regression coverage (issue #30): closable per-sheet output
// and the read-only sandbox API reference drawers. Kept out of smoke.spec.ts
// to keep the smoke suite lean.

async function openScriptConsole(page: Page): Promise<void> {
  await page.goto('/');
  await startMission(page, /Close call/);
  await page.getByRole('button', { name: /Script Console/ }).click();
}

test('a fresh sheet shows the API reference drawers, not the output panel', async ({ page }) => {
  await openScriptConsole(page);

  await expect(page.locator('.script-api-reference')).toBeVisible();
  await expect(page.locator('.script-console-output-view')).toBeHidden();
  // Both drawers must actually be on screen (toBeVisible passes for content
  // scrolled below the fold; toBeInViewport does not) — headers and first
  // rows alike, since the drawers split the pane and scroll independently.
  await expect(page.getByText('Variables & constants')).toBeInViewport();
  await expect(page.getByText('Functions', { exact: true })).toBeInViewport();
  const drawers = page.locator('.api-ref-drawer');
  await expect(drawers.nth(0).locator('.api-ref-row').first()).toBeInViewport();
  await expect(drawers.nth(1).locator('.api-ref-row').first()).toBeInViewport();
  // No output history yet — no "Show last output" affordance.
  await expect(page.getByRole('button', { name: 'Show last output' })).toBeHidden();
});

test('run opens the output; close returns to drawers; Show last output restores history', async ({ page }) => {
  await openScriptConsole(page);

  await page.locator('.script-btn.run').click();
  await expect(page.locator('.script-console-output-view')).toBeVisible();
  await expect(page.getByText('script finished')).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: 'Close console output' }).click();
  await expect(page.locator('.script-console-output-view')).toBeHidden();
  await expect(page.locator('.script-api-reference')).toBeVisible();

  await page.getByRole('button', { name: 'Show last output' }).click();
  await expect(page.locator('.script-console-output-view')).toBeVisible();
  await expect(page.getByText('script finished')).toBeVisible();
});

test('the shared filter narrows both drawers', async ({ page }) => {
  await openScriptConsole(page);

  await page.getByLabel('Filter API by name or description').fill('burn');
  await expect(page.locator('.api-ref-name', { hasText: 'ship.burn(' })).toBeVisible();
  await expect(page.locator('.api-ref-name', { hasText: 'vec(' })).toHaveCount(0);
  await expect(page.getByText('No matching variables.')).toBeVisible();
});

test('forbidden API names are absent and ship.burn is documented as awaited', async ({ page }) => {
  await openScriptConsole(page);

  const reference = page.locator('.script-api-reference');
  for (const forbidden of FORBIDDEN_API_NAMES) {
    await expect(reference.getByText(forbidden.split('.').pop()!)).toHaveCount(0);
  }
  const burnRow = page.locator('.api-ref-row', { hasText: 'ship.burn(' });
  await expect(burnRow).toContainText('await');
});
