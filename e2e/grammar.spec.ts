import { expect, test, underlines } from './fixtures';

test('underlines a typo in a textarea and applies the fix', async ({ page, site }) => {
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

test('underlines grammar in a contenteditable editor', async ({ page, site }) => {
  await page.goto(site);
  const ce = page.locator('#ce');
  await ce.click();
  await ce.pressSequentially('I has a apple.');
  await expect(page.locator(underlines('grammar')).first()).toBeVisible({ timeout: 10_000 });
});
