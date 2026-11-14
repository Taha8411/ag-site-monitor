// E2E: real customer journeys. Runs on desktop AND mobile.
import { test, expect } from '@playwright/test';
import { config } from '../config.js';

const PRICE = /৳\s?[\d,]+|Tk\.?\s?[\d,]+|BDT\s?[\d,]+/i;
const CTA = /add to cart|buy now|pre-?order|out of stock|stock out|notify me|up ?coming/i;

test('[e2e] Browse: category → product page', async ({ page }) => {
  await page.goto(config.journeyCategory);
  const productLinks = page.locator('a[href*="/product/"]');
  await expect(productLinks.first()).toBeAttached();
  const count = await productLinks.count();
  test.info().annotations.push({ type: 'info', description: `${count} product links on category` });
  expect(count, 'category shows products').toBeGreaterThan(3);

  const href = await productLinks.first().getAttribute('href');
  await page.goto(href);
  await expect(page.locator('h1').first()).toBeVisible();
  await expect(page.locator('body')).toContainText(PRICE);
  await expect(page.getByRole('button', { name: CTA }).first()).toBeAttached();
});

test('[e2e] Product page: title, price, buy button, images', async ({ page }) => {
  const product = config.keyPages.find((p) => p.type === 'product');
  await page.goto(product.path);
  await expect(page.locator('h1').first()).toBeVisible();
  await expect(page.locator('body')).toContainText(PRICE);
  await expect(page.getByRole('button', { name: CTA }).first()).toBeAttached();
  const broken = await page.$$eval('main img, img', (imgs) =>
    imgs.filter((i) => i.complete && i.naturalWidth === 0 && i.loading !== 'lazy').map((i) => i.src).slice(0, 10));
  if (broken.length) test.info().annotations.push({ type: 'warn', description: `Broken images: ${broken.join(', ')}` });
  expect(broken.length, 'broken images on product page').toBeLessThan(3);
});

test('[e2e] Search returns products', async ({ page, isMobile }) => {
  await page.goto('/');
  let input = page.locator('input#search, input[name="search"], input[type="search"]').locator('visible=true').first();
  if (isMobile && !(await input.count())) {
    // mobile: open search via icon if the field is hidden
    await page.getByRole('button', { name: /search/i }).first().click({ timeout: 5000 }).catch(() => {});
    input = page.locator('input#search, input[name="search"], input[type="search"]').locator('visible=true').first();
  }
  await expect(input, 'search box visible').toBeVisible();
  await input.fill(config.searchTerm);
  await input.press('Enter');
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('a[href*="/product/"]').first()).toBeAttached({ timeout: 20_000 });
  const n = await page.locator('a[href*="/product/"]').count();
  test.info().annotations.push({ type: 'info', description: `Search "${config.searchTerm}" → ${n} product links (${page.url()})` });
});

test('[e2e] Cart page opens', async ({ page }) => {
  const res = await page.goto('/cart');
  expect(res.status()).toBeLessThan(400);
  await expect(page.locator('body')).not.toContainText(/Application error|Internal Server Error/i);
});

test('[e2e] Header & footer render', async ({ page, isMobile }) => {
  await page.goto('/');
  await expect(page.locator('header').first()).toBeVisible();
  await expect(page.locator('footer').first()).toBeAttached();
  if (isMobile) {
    await expect(page.getByRole('button', { name: /open|menu/i }).first()).toBeVisible();
  }
});
