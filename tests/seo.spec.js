// On-page SEO checks for every key page (desktop only).
// Hard failures = things that break indexing. Soft issues are logged as warnings.
import { test, expect } from '@playwright/test';
import { config, url } from '../config.js';

for (const pg of config.keyPages) {
  test(`[seo] ${pg.name}`, async ({ page }, info) => {
    await page.goto(pg.path, { waitUntil: 'domcontentloaded' });
    const d = await page.evaluate(() => {
      const meta = (sel) => document.querySelector(sel)?.getAttribute('content') || '';
      const ld = [...document.querySelectorAll('script[type="application/ld+json"]')]
        .map((s) => { try { return JSON.parse(s.textContent); } catch { return null; } }).filter(Boolean);
      const types = [];
      const walk = (o) => {
        if (!o || typeof o !== 'object') return;
        if (o['@type']) types.push(...[].concat(o['@type']));
        Object.values(o).forEach(walk);
      };
      ld.forEach(walk);
      const product = JSON.stringify(ld).includes('"Product"');
      const hasPrice = /"price"\s*:\s*"?\d/.test(JSON.stringify(ld));
      return {
        title: document.title.trim(),
        desc: meta('meta[name="description"]'),
        robots: meta('meta[name="robots"]'),
        canonical: document.querySelector('link[rel="canonical"]')?.href || '',
        h1: [...document.querySelectorAll('h1')].map((h) => h.textContent.trim()).filter(Boolean),
        ogTitle: meta('meta[property="og:title"]'),
        ogImage: meta('meta[property="og:image"]'),
        lang: document.documentElement.lang,
        imgNoAlt: [...document.querySelectorAll('img')].filter((i) => !i.hasAttribute('alt')).length,
        schemaTypes: [...new Set(types)],
        product, hasPrice,
      };
    });

    const warn = (m) => info.annotations.push({ type: 'warn', description: m });
    info.annotations.push({ type: 'info', description: `Title(${d.title.length}): ${d.title}` });
    info.annotations.push({ type: 'info', description: `Schema: ${d.schemaTypes.join(', ') || 'none'}` });

    // Soft (warnings)
    if (d.title.length < 20 || d.title.length > 65) warn(`Title length ${d.title.length} (aim 20–65)`);
    if (d.desc && (d.desc.length < 70 || d.desc.length > 165)) warn(`Meta description length ${d.desc.length} (aim 70–165)`);
    if (d.h1.length > 1) warn(`${d.h1.length} H1 tags`);
    if (!d.ogTitle || !d.ogImage) warn('Missing og:title / og:image');
    if (!d.lang) warn('Missing <html lang>');
    if (d.imgNoAlt > 0) warn(`${d.imgNoAlt} image(s) without alt attribute`);

    // Hard (failures)
    expect.soft(d.title, 'title present').not.toBe('');
    expect.soft(d.desc, 'meta description present').not.toBe('');
    expect.soft(d.robots.toLowerCase(), 'page is not noindex').not.toContain('noindex');
    expect.soft(d.h1.length, 'has an H1').toBeGreaterThan(0);
    expect.soft(d.canonical, 'canonical present').not.toBe('');
    if (d.canonical) {
      const canon = new URL(d.canonical);
      const expected = new URL(url(pg.path));
      expect.soft(canon.pathname.replace(/\/$/, ''), 'canonical points to itself')
        .toBe(expected.pathname.replace(/\/$/, ''));
    }
    if (pg.type === 'product') {
      expect.soft(d.product, 'Product schema (JSON-LD)').toBe(true);
      expect.soft(d.hasPrice, 'Product schema has offers.price').toBe(true);
    }
  });
}
