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

async function setEditorSource(page: Page, source: string): Promise<void> {
  const editor = page.locator('.cm-content');
  await editor.click();
  await editor.fill(source);
}

async function openCompletion(page: Page, source: string): Promise<void> {
  await setEditorSource(page, source);
  await page.locator('.cm-content').press('ControlOrMeta+Space');
}

test('CodeMirror editor renders with line numbers, JS highlighting, and persisted typing', async ({ page }) => {
  await openScriptConsole(page);

  await expect(page.locator('.cm-editor')).toBeVisible();
  await expect(page.locator('.cm-lineNumbers')).toBeVisible();
  await setEditorSource(page, 'await ship.status();\nlog("ready");');
  await expect(page.locator('.cm-line span').first()).toBeVisible();

  await page.getByRole('button', { name: /Data/ }).click();
  await page.getByRole('button', { name: /Script Console/ }).click();
  await expect(page.locator('.cm-content')).toContainText('await ship.status();');
});

test('a fresh sheet shows the API reference drawers, not the output panel', async ({ page }) => {
  await openScriptConsole(page);

  await expect(page.locator('.script-api-reference')).toBeVisible();
  await expect(page.locator('.script-console-output-view')).toBeHidden();
  // Both drawers must actually be on screen (toBeVisible passes for content
  // scrolled below the fold; toBeInViewport does not) — filter headers and
  // first rows alike, since the drawers sit side by side and scroll
  // independently.
  await expect(page.getByPlaceholder('Variables & constants')).toBeInViewport();
  await expect(page.getByPlaceholder('Functions')).toBeInViewport();
  const drawers = page.locator('.api-ref-drawer');
  await expect(drawers.nth(0).locator('.api-ref-row').first()).toBeInViewport();
  await expect(drawers.nth(1).locator('.api-ref-row').first()).toBeInViewport();
  // Drawers showing → the header Output button is available.
  await expect(page.getByRole('button', { name: 'Output', exact: true })).toBeEnabled();
});

test('run opens the output; close returns to drawers; Output restores history', async ({ page }) => {
  await openScriptConsole(page);

  const outputBtn = page.getByRole('button', { name: 'Output', exact: true });
  await page.locator('.script-btn.run').click();
  await expect(page.locator('.script-console-output-view')).toBeVisible();
  await expect(outputBtn).toBeDisabled();
  await expect(page.getByText('script finished')).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: 'Close console output' }).click();
  await expect(page.locator('.script-console-output-view')).toBeHidden();
  await expect(page.locator('.script-api-reference')).toBeVisible();
  await expect(outputBtn).toBeEnabled();

  await outputBtn.click();
  await expect(page.locator('.script-console-output-view')).toBeVisible();
  await expect(page.getByText('script finished')).toBeVisible();
});

test('each drawer filters independently', async ({ page }) => {
  await openScriptConsole(page);

  await page.getByLabel('Filter functions').fill('burn');
  await expect(page.locator('.api-ref-name', { hasText: 'ship.burn(' })).toBeVisible();
  await expect(page.locator('.api-ref-name', { hasText: 'vec(' })).toHaveCount(0);
  // The variables drawer keeps its rows — the filter is per drawer.
  await expect(page.locator('.api-ref-name', { hasText: 'AU' }).first()).toBeVisible();

  await page.getByLabel('Filter variables & constants').fill('zz-no-match');
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

test('vars persist for the current game run and can be described and deleted in the drawer', async ({ page }) => {
  await openScriptConsole(page);

  await setEditorSource(page, 'vars.burnTime = 123;\nlog("stored", vars.burnTime);');
  await page.locator('.script-btn.run').click();
  await expect(page.getByText('script finished')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Close console output' }).click();
  const row = page.locator('.api-ref-row.player', { hasText: 'burnTime' });
  await expect(row).toContainText('123');
  await row.getByLabel('Description for burnTime').fill('main burn');
  await row.getByLabel('Description for burnTime').blur();

  await page.reload();
  await startMission(page, /Close call/);
  await page.getByRole('button', { name: /Script Console/ }).click();
  await expect(page.locator('.api-ref-row.player', { hasText: 'burnTime' }).getByLabel('Description for burnTime')).toHaveValue('main burn');

  await openCompletion(page, 'vars.');
  await expect(page.locator('.cm-tooltip-autocomplete')).toContainText('vars.burnTime');

  await setEditorSource(page, 'log("saved", vars.burnTime);');
  await page.locator('.script-btn.run').click();
  await expect(page.getByText('saved 123')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Close console output' }).click();

  page.on('dialog', (dialog) => dialog.accept());
  await page.getByLabel('Delete burnTime').click();
  await expect(page.locator('.api-ref-row.player', { hasText: 'burnTime' })).toHaveCount(0);
});

test('autocomplete is registry-driven with async hints and forbidden names absent', async ({ page }) => {
  await openScriptConsole(page);

  await openCompletion(page, 'ship.bu');
  const popup = page.locator('.cm-tooltip-autocomplete');
  await expect(popup).toContainText('ship.burn');
  await expect(popup).toContainText('async - use await');
  await expect(popup.locator('[aria-selected]')).toHaveCSS('background-color', 'rgb(76, 201, 224)');
  for (const forbidden of ['solveTransfer', 'autopilot', 'debug']) {
    await expect(popup).not.toContainText(forbidden);
  }
  await page.locator('.cm-content').press('Tab');
  await expect(page.locator('.cm-content')).toContainText('ship.burn(');

  await openCompletion(page, 'aw');
  await expect(popup).toContainText('await');
  await openCompletion(page, 'del');
  await expect(popup).toContainText('delete');
});

test('script errors highlight the offending CodeMirror line', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'WebKit omits source lines for AsyncFunction stacks; unit coverage verifies line forwarding.');
  await openScriptConsole(page);

  await setEditorSource(page, 'log("before");\nthrow new Error("bad");');
  await page.locator('.script-btn.run').click();
  await expect(page.locator('.script-console-line.error')).toContainText('line 2', { timeout: 20_000 });
  await expect(page.locator('.cm-script-error-line')).toBeVisible();
});
