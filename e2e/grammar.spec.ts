import type { Browser } from 'wxt/browser';
import { expect, test, underlines } from './fixtures';

// `extensionWorker.evaluate` callbacks run inside the extension service worker, where `chrome` is the global API.
declare const chrome: typeof Browser;

test('underlines a typo in a textarea and applies the fix', async ({ page, site, extensionWorker }) => {
  await page.goto(site);
  const ta = page.locator('#ta');
  await ta.click();
  await ta.pressSequentially('This is teh test.');

  const line = page.locator(underlines('spelling'));
  await expect(line).toHaveCount(1, { timeout: 10_000 });
  const box = (await line.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y);

  await page.locator('opengrammar-overlay [data-og-card]').getByRole('button', { name: 'the', exact: true }).click();
  await expect(ta).toHaveValue('This is the test.');
  await expect(line).toHaveCount(0);
});

test('underlines grammar in a contenteditable editor', async ({ page, site, extensionWorker }) => {
  await page.goto(site);
  const ce = page.locator('#ce');
  await ce.click();
  await ce.pressSequentially('I has a apple.');
  await expect(page.locator(underlines('grammar')).first()).toBeVisible({ timeout: 10_000 });
});

test('clears underlines when disabled and re-checks the focused field on re-enable', async ({ page, site, extensionWorker }) => {
  await page.goto(site);
  const ta = page.locator('#ta');
  await ta.click();
  await ta.pressSequentially('This is teh test.');
  const line = page.locator(underlines('spelling'));
  await expect(line).toHaveCount(1, { timeout: 10_000 });

  await extensionWorker.evaluate(() => chrome.storage.local.set({ settings: { enabled: false } }));
  await expect(line).toHaveCount(0);

  await expect(ta).toBeFocused();
  await extensionWorker.evaluate(() => chrome.storage.local.set({ settings: { enabled: true } }));
  await expect(line).toHaveCount(1, { timeout: 10_000 });
});
