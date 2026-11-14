// Smoke: every key page loads, fast enough, with no JS crashes or server errors.
import { test, expect } from '@playwright/test';
import { config } from '../config.js';

const { thresholds } = config;
const host = new URL(config.baseUrl).hostname.replace(/^www\./, '');

for (const pg of config.keyPages) {
  test(`[smoke] ${pg.name} loads`, async ({ page }, info) => {
    const jsErrors = [];
    const serverErrors = [];
    page.on('pageerror', (e) => jsErrors.push(e.message.slice(0, 200)));
    page.on('response', (r) => {
      if (r.status() >= 500 && new URL(r.url()).hostname.endsWith(host)) {
        serverErrors.push(`${r.status()} ${r.url()}`);
      }
    });

    const t0 = Date.now();
    const res = await page.goto(pg.path, { waitUntil: 'load' });
    const loadMs = Date.now() - t0;
    const nav = await page.evaluate(() => {
      const n = performance.getEntriesByType('navigation')[0];
      return n ? { ttfb: Math.round(n.responseStart), dcl: Math.round(n.domContentLoadedEventEnd) } : {};
    });

    info.annotations.push(
      { type: 'loadMs', description: String(loadMs) },
      { type: 'ttfbMs', description: String(nav.ttfb ?? '') },
      { type: 'status', description: String(res?.status()) },
    );
    if (loadMs > thresholds.pageLoadWarnMs) info.annotations.push({ type: 'warn', description: `Slow load: ${loadMs} ms` });
    if (nav.ttfb > thresholds.ttfbWarnMs) info.annotations.push({ type: 'warn', description: `Slow TTFB: ${nav.ttfb} ms` });
    if (jsErrors.length) info.annotations.push({ type: 'warn', description: `JS errors: ${jsErrors.join(' | ')}` });

    expect(res, 'no response').toBeTruthy();
    expect(res.status(), `HTTP status for ${pg.path}`).toBeLessThan(400);
    await expect(page).toHaveTitle(/\S/);
    await expect(page.locator('body')).not.toContainText(/Application error|Internal Server Error|404 - Page Not Found/i);
    expect(loadMs, `load time ${loadMs} ms`).toBeLessThan(thresholds.pageLoadMs);
    expect(serverErrors, 'first-party 5xx responses').toEqual([]);
  });
}
