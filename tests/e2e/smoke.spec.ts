import { expect, test } from '@playwright/test';

test('page loads and the render canvas exists', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Blanckstar');
  await expect(page.locator('#viewport')).toBeAttached();
});
