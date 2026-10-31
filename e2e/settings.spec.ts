import type { Browser } from 'wxt/browser';
import { expect, test, underlines } from './fixtures';

// `extensionWorker.evaluate` callbacks run inside the extension service worker, where `chrome` is the global API.
declare const chrome: typeof Browser;

test('adding a word to the dictionary removes its underline and persists', async ({ page, site }) => {
  await page.goto(site);
  const ta = page.locator('#ta');
  await ta.click();
  await ta.pressSequentially('Zorblax is here.');

  const line = page.locator(underlines('spelling'));
  await expect(line).toHaveCount(1, { timeout: 10_000 });
  const box = (await line.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y);
  await page.locator('opengrammar-overlay [data-og-card]').getByRole('button', { name: 'Add to dictionary' }).click();
  await expect(line).toHaveCount(0);

  await page.reload();
  await page.locator('#ta').click();
  await page.locator('#ta').pressSequentially('Zorblax is here.');
  await page.waitForTimeout(1500);
  await expect(line).toHaveCount(0);
});

test('ignored sites get no underlines', async ({ page, site, extensionWorker }) => {
  await extensionWorker.evaluate(() => chrome.storage.local.set({ settings: { ignoredSites: ['127.0.0.1'] } }));
  await page.goto(site);
  await page.locator('#ta').click();
  await page.locator('#ta').pressSequentially('This is teh test.');
  await page.waitForTimeout(1500);
  await expect(page.locator(underlines('spelling'))).toHaveCount(0);
});

test('options page lists and removes dictionary words', async ({ page, extensionWorker }) => {
  await extensionWorker.evaluate(() => chrome.storage.local.set({ settings: { dictionary: ['Zorblax'] } }));
  const id = new URL(extensionWorker.url()).host;
  await page.goto(`chrome-extension://${id}/options.html`);
  const list = page.locator('[data-list="dictionary"] ul');
  await expect(list).toContainText('Zorblax');
  await list.getByRole('button', { name: 'Remove' }).click();
  await expect(list).not.toContainText('Zorblax');

  const dict = page.locator('[data-list="dictionary"]');
  const dictInput = dict.locator('input[name="value"]');
  await dictInput.fill('Zorblax');
  await dict.getByRole('button', { name: 'Add' }).click();
  await expect(list).toContainText('Zorblax');
  await dictInput.fill('zorblax');
  await dict.getByRole('button', { name: 'Add' }).click();
  await expect(dictInput).toHaveValue('');
  await expect(list.locator('li')).toHaveCount(1);

  const sites =page.locator('[data-list="ignoredSites"]');
  await sites.locator('input[name="value"]').fill('https://Reddit.com/r/x');
  await sites.getByRole('button', { name: 'Add' }).click();
  await expect(sites.locator('ul')).toContainText('reddit.com');
});
