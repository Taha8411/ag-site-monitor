// Lighthouse (mobile) for a few key pages. Output: reports/lighthouse.json + HTML per page.
import fs from 'node:fs/promises';
import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';
import { config, url } from '../config.js';

async function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  try { const { chromium } = await import('playwright-core'); const p = chromium.executablePath(); await fs.access(p); return p; } catch { return undefined; }
}

await fs.mkdir('reports/lighthouse', { recursive: true });
const chrome = await chromeLauncher.launch({
  chromePath: await chromePath(),
  chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
});

const results = [];
for (const path of config.lighthousePages) {
  const target = url(path);
  console.log('Lighthouse →', target);
  try {
    const r = await lighthouse(target, {
      port: chrome.port, output: 'html', logLevel: 'error',
      onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
      emulatedUserAgent: undefined, maxWaitForLoad: 60_000,
    });
    const { categories: c, audits: a } = r.lhr;
    const slug = path === '/' ? 'home' : path.replace(/^\/|\/$/g, '').replace(/\//g, '_');
    await fs.writeFile(`reports/lighthouse/${slug}.html`, r.report);
    const score = (k) => Math.round((c[k]?.score ?? 0) * 100);
    const num = (k) => a[k]?.numericValue;
    results.push({
      path, report: `lighthouse/${slug}.html`,
      scores: { performance: score('performance'), accessibility: score('accessibility'), 'best-practices': score('best-practices'), seo: score('seo') },
      metrics: {
        LCP: num('largest-contentful-paint'), FCP: num('first-contentful-paint'), TBT: num('total-blocking-time'),
        CLS: a['cumulative-layout-shift']?.numericValue, SI: num('speed-index'),
      },
      topIssues: Object.values(a)
        .filter((x) => x.score !== null && x.score < 0.5 && x.details?.type === 'opportunity')
        .sort((x, y) => (y.numericValue || 0) - (x.numericValue || 0)).slice(0, 4)
        .map((x) => ({ title: x.title, savingsMs: Math.round(x.numericValue || 0) })),
    });
  } catch (e) {
    console.error('Lighthouse failed for', path, e.message);
    results.push({ path, error: e.message });
  }
}
await chrome.kill();
await fs.writeFile('reports/lighthouse.json', JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
console.log('lighthouse.json written');
