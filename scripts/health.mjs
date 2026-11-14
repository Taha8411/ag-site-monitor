// Site health: SSL expiry, redirects, robots.txt, sitemap sample, broken links.
// Output: reports/health.json
import tls from 'node:tls';
import fs from 'node:fs/promises';
import { config, url } from '../config.js';

const UA = { 'user-agent': config.userAgent, accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' };
const base = new URL(config.baseUrl);
const out = { generatedAt: new Date().toISOString(), checks: [], brokenLinks: [], sitemap: {}, ssl: {} };
const add = (name, status, detail = '') => { out.checks.push({ name, status, detail }); console.log(`[${status}] ${name} ${detail}`); };

async function get(u, opts = {}) {
  const t0 = Date.now();
  try {
    const r = await fetch(u, { headers: UA, redirect: opts.redirect || 'follow', signal: AbortSignal.timeout(opts.timeout || 25_000) });
    const body = opts.body ? await r.text() : (r.body?.cancel(), '');
    return { status: r.status, ms: Date.now() - t0, body, location: r.headers.get('location'), finalUrl: r.url };
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, error: e.cause?.code || e.name || String(e), body: '' };
  }
}

async function pool(items, n, fn) {
  const res = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; res[k] = await fn(items[k]); } }));
  return res;
}

// 1. SSL certificate
async function ssl() {
  if (base.protocol !== 'https:') return add('SSL certificate', 'SKIP', 'not https');
  await new Promise((resolve) => {
    const s = tls.connect({ host: base.hostname, port: 443, servername: base.hostname, timeout: 15000 }, () => {
      const c = s.getPeerCertificate();
      const days = Math.floor((new Date(c.valid_to) - Date.now()) / 864e5);
      out.ssl = { issuer: c.issuer?.O || c.issuer?.CN, validTo: c.valid_to, daysLeft: days };
      add('SSL certificate', days < 0 ? 'FAIL' : days < config.thresholds.sslWarnDays ? 'WARN' : 'PASS', `${days} days left (${c.issuer?.O || ''})`);
      s.end(); resolve();
    });
    s.on('error', (e) => { add('SSL certificate', 'FAIL', e.message); resolve(); });
    s.on('timeout', () => { add('SSL certificate', 'FAIL', 'timeout'); s.destroy(); resolve(); });
  });
}

// 2. Redirects: http → https, non-www → www
async function redirects() {
  if (base.protocol !== 'https:') return add('Redirects', 'SKIP', 'not https');
  const variants = [`http://${base.hostname}/`];
  if (base.hostname.startsWith('www.')) variants.push(`https://${base.hostname.slice(4)}/`);
  for (const v of variants) {
    const r = await get(v);
    const ok = r.status < 400 && r.finalUrl?.startsWith(config.baseUrl);
    add(`Redirect ${v}`, ok ? 'PASS' : 'FAIL', `→ ${r.finalUrl || r.error} (${r.status})`);
  }
}

// 3. robots.txt
async function robots() {
  const r = await get(url('/robots.txt'), { body: true });
  if (r.status !== 200) return add('robots.txt', 'FAIL', `HTTP ${r.status || r.error}`);
  const blocksAll = /^\s*disallow:\s*\/\s*$/im.test(r.body.split(/user-agent:\s*\*/i)[1]?.split(/user-agent:/i)[0] || '');
  add('robots.txt', blocksAll ? 'FAIL' : 'PASS', blocksAll ? 'Disallow: / for all bots!' : `${r.body.split('\n').length} lines`);
  return [...r.body.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]);
}

// 4. Sitemap: parse (incl. sitemap index), sample URLs
async function sitemap(fromRobots) {
  const roots = fromRobots?.length ? fromRobots : [url('/sitemap.xml')];
  const urls = []; const files = [];
  const locs = (xml) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, '&'));
  const queue = [...roots];
  while (queue.length && files.length < 30) {
    const sm = queue.shift();
    const r = await get(sm, { body: true, timeout: 40_000 });
    files.push({ url: sm, status: r.status });
    if (r.status !== 200) continue;
    if (/<sitemapindex/i.test(r.body)) queue.push(...locs(r.body)); else urls.push(...locs(r.body));
  }
  const badFiles = files.filter((f) => f.status !== 200);
  out.sitemap = { files: files.length, badFiles, totalUrls: urls.length };
  add('Sitemap', !urls.length || badFiles.length ? 'FAIL' : 'PASS', `${files.length} file(s), ${urls.length} URLs${badFiles.length ? `, ${badFiles.length} broken file(s)` : ''}`);

  const sample = urls.sort(() => Math.random() - 0.5).slice(0, config.sitemapSampleSize);
  const results = await pool(sample, config.linkCheck.concurrency, async (u) => ({ url: u, ...(await get(u)) }));
  const bad = results.filter((r) => r.status === 0 || r.status >= 400);
  const slow = results.filter((r) => r.ms > config.thresholds.pageLoadWarnMs);
  out.sitemap.sample = results.map(({ url: u, status, ms }) => ({ url: u, status, ms }));
  out.sitemap.avgMs = results.length ? Math.round(results.reduce((a, r) => a + r.ms, 0) / results.length) : 0;
  add('Sitemap URL sample', bad.length ? 'FAIL' : slow.length ? 'WARN' : 'PASS',
    `${sample.length} checked, ${bad.length} broken, ${slow.length} slow, avg ${out.sitemap.avgMs} ms`);
  bad.forEach((b) => out.brokenLinks.push({ url: b.url, status: b.status || b.error, foundOn: 'sitemap.xml' }));
}

// 5. Broken links on seed pages (internal links only)
async function links() {
  const found = new Map();
  for (const seed of config.linkCheck.seedPages) {
    const r = await get(url(seed), { body: true });
    for (const m of r.body.matchAll(/href="([^"#]+)"/g)) {
      let u; try { u = new URL(m[1].replace(/&amp;/g, '&'), config.baseUrl); } catch { continue; }
      if (u.hostname !== base.hostname || /\.(css|js|png|jpe?g|webp|svg|ico|woff2?|json)$/i.test(u.pathname) || u.pathname.startsWith('/_next')) continue;
      u.hash = '';
      if (!found.has(u.href)) found.set(u.href, seed);
    }
  }
  const list = [...found.entries()].slice(0, config.linkCheck.maxLinks);
  const results = await pool(list, config.linkCheck.concurrency, async ([u, seed]) => ({ url: u, seed, ...(await get(u)) }));
  const bad = results.filter((r) => r.status === 0 || r.status >= 400);
  bad.forEach((b) => out.brokenLinks.push({ url: b.url, status: b.status || b.error, foundOn: b.seed }));
  add('Internal links', bad.length ? 'FAIL' : 'PASS', `${results.length} checked, ${bad.length} broken`);
}

await ssl();
await redirects();
const sm = await robots();
await sitemap(sm);
await links();
await fs.mkdir('reports', { recursive: true });
await fs.writeFile('reports/health.json', JSON.stringify(out, null, 2));
console.log('health.json written');
