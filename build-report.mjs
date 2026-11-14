// Merges Playwright + Lighthouse + Health results into one HTML dashboard.
// Output: reports/index.html, reports/summary.json, reports/history.json
import fs from 'node:fs/promises';
import { config } from '../config.js';

const readJson = async (p, fb = null) => { try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return fb; } };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const strip = (s) => String(s || '').replace(/\u001b\[[0-9;]*m/g, '');
const now = new Date();
const dhaka = (d) => new Date(d).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', dateStyle: 'medium', timeStyle: 'short' });

const pw = await readJson('reports/playwright.json');
const lh = await readJson('reports/lighthouse.json', { results: [] });
const health = await readJson('reports/health.json', { checks: [], brokenLinks: [], sitemap: {}, ssl: {} });
const prevHistory = await readJson(process.env.HISTORY_FILE || 'site/history.json', []);

// ── Flatten Playwright results ──────────────────────────────
const tests = [];
const walk = (suite, file) => {
  for (const s of suite.suites || []) walk(s, s.file || file);
  for (const spec of suite.specs || []) {
    for (const t of spec.tests || []) {
      const last = t.results?.[t.results.length - 1] || {};
      const seen = new Set();
      const ann = [...(t.annotations || []), ...(last.annotations || [])]
        .filter((a) => { const k = a.type + '|' + a.description; return seen.has(k) ? false : seen.add(k); });
      tests.push({
        title: spec.title, project: t.projectName, file,
        status: t.status === 'expected' ? 'PASS' : t.status === 'flaky' ? 'FLAKY' : t.status === 'skipped' ? 'SKIP' : 'FAIL',
        duration: last.duration || 0,
        errors: (last.errors || []).map((e) => strip(e.message).split('\n')
          .filter((l) => l.trim() && !/^\s*expect\(/.test(l) && !/^\s*>?\s*\d+\s*\|/.test(l) && !/^\s*\|?\s*\^/.test(l) && !/^\s+at /.test(l))
          .slice(0, 5).join('\n')),
        ann,
      });
    }
  }
};
if (pw) for (const s of pw.suites || []) walk(s, s.file);
const annVal = (t, type) => t?.ann.find((a) => a.type === type)?.description;
const warnings = [];
tests.forEach((t) => t.ann.filter((a) => a.type === 'warn').forEach((a) => warnings.push({ where: `${t.title} (${t.project})`, msg: a.description })));

const failed = tests.filter((t) => t.status === 'FAIL');
const flaky = tests.filter((t) => t.status === 'FLAKY');
const passed = tests.filter((t) => t.status === 'PASS');

// ── Lighthouse ──────────────────────────────────────────────
const lhRows = lh.results || [];
const lhBelow = [];
for (const r of lhRows) {
  if (r.error) { lhBelow.push(`${r.path}: Lighthouse error`); continue; }
  for (const [k, min] of Object.entries(config.thresholds.lighthouse)) {
    if (r.scores[k] < min) lhBelow.push(`${r.path}: ${k} ${r.scores[k]} (< ${min})`);
  }
}
lhBelow.forEach((m) => warnings.push({ where: 'Lighthouse', msg: m }));
health.checks.filter((c) => c.status === 'WARN').forEach((c) => warnings.push({ where: c.name, msg: c.detail }));

// ── Overall status ──────────────────────────────────────────
const healthFails = health.checks.filter((c) => c.status === 'FAIL');
const overall = failed.length || healthFails.length || !pw ? 'FAIL' : warnings.length || flaky.length ? 'WARN' : 'PASS';

const smoke = tests.filter((t) => t.title.startsWith('[smoke]'));
const loads = smoke.map((t) => +annVal(t, 'loadMs')).filter(Boolean);
const avgLoad = loads.length ? Math.round(loads.reduce((a, b) => a + b, 0) / loads.length) : null;
const homeLh = lhRows.find((r) => r.path === '/' && r.scores);

const summary = {
  site: config.baseUrl, date: now.toISOString(), status: overall,
  tests: { total: tests.length, passed: passed.length, failed: failed.length, flaky: flaky.length },
  healthFails: healthFails.length, warnings: warnings.length,
  avgLoadMs: avgLoad, brokenLinks: health.brokenLinks.length, sslDaysLeft: health.ssl?.daysLeft ?? null,
  lighthouseHome: homeLh?.scores || null,
  topFailures: [...failed.map((t) => `${t.title} (${t.project})`), ...healthFails.map((c) => `${c.name}: ${c.detail}`)].slice(0, 8),
};
const history = [...prevHistory.filter((h) => h.date?.slice(0, 10) !== summary.date.slice(0, 10)), {
  date: summary.date, status: overall,
  passRate: tests.length ? Math.round((passed.length + flaky.length) / tests.length * 100) : 0,
  perf: homeLh?.scores.performance ?? null, seo: homeLh?.scores.seo ?? null, avgLoadMs: avgLoad, brokenLinks: summary.brokenLinks,
}].slice(-90);

// ── HTML helpers ────────────────────────────────────────────
const badge = (s) => `<span class="b b-${String(s).toLowerCase()}">${esc(s)}</span>`;
const scoreCell = (v, min) => v == null ? '<td>—</td>' : `<td class="${v >= 90 ? 'good' : v >= min ? 'ok' : 'bad'}">${v}</td>`;
const ms = (v) => (v == null || v === '' || Number.isNaN(+v) ? '—' : +v >= 1000 ? `${(+v / 1000).toFixed(1)}s` : `${Math.round(+v)}ms`);
const loadCell = (v) => { if (!v) return '<td>—</td>'; const n = +v; return `<td class="${n > config.thresholds.pageLoadMs ? 'bad' : n > config.thresholds.pageLoadWarnMs ? 'ok' : 'good'}">${ms(n)}</td>`; };
const spark = (vals, color) => {
  const v = vals.map((x) => (x == null ? null : +x)); const nums = v.filter((x) => x != null);
  if (nums.length < 2) return '<span class="muted">collecting data…</span>';
  const w = 220, h = 40, max = Math.max(...nums), min = Math.min(...nums), rng = max - min || 1;
  const pts = v.map((x, i) => x == null ? null : `${(i / (v.length - 1)) * w},${h - 4 - ((x - min) / rng) * (h - 8)}`).filter(Boolean).join(' ');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline fill="none" stroke="${color}" stroke-width="2" points="${pts}"/></svg><span class="muted"> ${nums.at(-1)} (min ${min}, max ${max})</span>`;
};
const tile = (label, value, cls = '') => `<div class="tile ${cls}"><div class="tv">${value}</div><div class="tl">${label}</div></div>`;

// Per-page performance (desktop vs mobile)
const perfRows = config.keyPages.map((p) => {
  const d = smoke.find((t) => t.title === `[smoke] ${p.name} loads` && t.project === 'desktop');
  const m = smoke.find((t) => t.title === `[smoke] ${p.name} loads` && t.project === 'mobile');
  return `<tr><td>${esc(p.name)}<div class="muted">${esc(p.path)}</div></td><td>${badge(d?.status || '—')}</td><td>${badge(m?.status || '—')}</td>
    ${loadCell(annVal(d, 'loadMs'))}${loadCell(annVal(m, 'loadMs'))}<td>${ms(annVal(d, 'ttfbMs'))}</td><td>${esc(annVal(d, 'status') || '—')}</td></tr>`;
}).join('');

const journeys = [...new Set(tests.filter((t) => t.title.startsWith('[e2e]')).map((t) => t.title))].map((title) => {
  const d = tests.find((t) => t.title === title && t.project === 'desktop');
  const m = tests.find((t) => t.title === title && t.project === 'mobile');
  const info = [d, m].flatMap((t) => t?.ann.filter((a) => a.type === 'info').map((a) => a.description) || []);
  return `<tr><td>${esc(title.replace('[e2e] ', ''))}</td><td>${badge(d?.status || '—')}</td><td>${badge(m?.status || '—')}</td><td class="muted">${esc([...new Set(info)].join(' · '))}</td></tr>`;
}).join('');

const seoRows = tests.filter((t) => t.title.startsWith('[seo]')).map((t) => {
  const w = t.ann.filter((a) => a.type === 'warn').map((a) => a.description);
  const errs = t.errors.map((e) => e.split('\n')[0]);
  return `<tr><td>${esc(t.title.replace('[seo] ', ''))}</td><td>${badge(t.status)}</td><td>${esc(annVal(t, 'info')?.replace(/^Title\(\d+\): /, '') || '')}</td>
    <td class="small">${errs.map((e) => `<div class="err">✖ ${esc(e)}</div>`).join('')}${w.map((x) => `<div>⚠ ${esc(x)}</div>`).join('') || (errs.length ? '' : '<span class="muted">clean</span>')}</td></tr>`;
}).join('');

const lhTable = lhRows.map((r) => r.error
  ? `<tr><td>${esc(r.path)}</td><td colspan="9" class="bad">${esc(r.error)}</td></tr>`
  : `<tr><td>${esc(r.path)}</td>${['performance', 'accessibility', 'best-practices', 'seo'].map((k) => scoreCell(r.scores[k], config.thresholds.lighthouse[k])).join('')}
     <td>${ms(r.metrics.LCP)}</td><td>${ms(r.metrics.FCP)}</td><td>${ms(r.metrics.TBT)}</td><td>${r.metrics.CLS?.toFixed(3) ?? '—'}</td>
     <td><a href="${esc(r.report)}">full report</a></td></tr>
     ${r.topIssues?.length ? `<tr class="sub"><td colspan="10">Top fixes: ${r.topIssues.map((i) => `${esc(i.title)} (~${ms(i.savingsMs)})`).join(' · ')}</td></tr>` : ''}`).join('');

const failBlock = failed.length || healthFails.length ? `<section><h2>❌ Failures (${failed.length + healthFails.length})</h2><table><tr><th>Test</th><th>Device</th><th>Error</th></tr>
  ${failed.map((t) => `<tr><td>${esc(t.title)}</td><td>${esc(t.project)}</td><td><pre>${esc(t.errors.join('\n---\n').slice(0, 900))}</pre></td></tr>`).join('')}
  ${healthFails.map((c) => `<tr><td>${esc(c.name)}</td><td>health</td><td><pre>${esc(c.detail)}</pre></td></tr>`).join('')}
  </table><p class="muted">Screenshots, traces &amp; step logs: <a href="playwright/index.html">Playwright report</a></p></section>` : '';

const h30 = history.slice(-30);
const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${overall} · ${esc(config.siteName)} daily test · ${dhaka(now)}</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--ink:#16181d;--mut:#6b7280;--line:#e5e7eb;--good:#0f9d58;--ok:#c77700;--bad:#d93025}
*{box-sizing:border-box}body{margin:0;font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--ink)}
.wrap{max-width:1180px;margin:0 auto;padding:24px 16px 60px}
header{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:18px}
h1{font-size:22px;margin:0}h2{font-size:16px;margin:0 0 10px}.muted{color:var(--mut);font-size:12px}
.status{font-size:20px;font-weight:700;padding:8px 18px;border-radius:999px;color:#fff}
.s-pass{background:var(--good)}.s-warn{background:var(--ok)}.s-fail{background:var(--bad)}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:18px}
.tile{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px}.tv{font-size:22px;font-weight:700}.tl{color:var(--mut);font-size:12px}
.tile.bad .tv{color:var(--bad)}.tile.ok .tv{color:var(--ok)}.tile.good .tv{color:var(--good)}
section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px;margin-bottom:14px;overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--mut)}
td.good{color:var(--good);font-weight:600}td.ok{color:var(--ok);font-weight:600}td.bad{color:var(--bad);font-weight:600}
tr.sub td{color:var(--mut);font-size:12px;border-top:0}
.b{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;font-weight:700;background:#eee}
.b-pass{background:#e6f4ea;color:var(--good)}.b-fail{background:#fce8e6;color:var(--bad)}.b-warn,.b-flaky{background:#fef3e0;color:var(--ok)}
pre{white-space:pre-wrap;margin:0;font-size:12px;max-height:180px;overflow:auto}.err{color:var(--bad)}.small{font-size:12px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}@media(max-width:800px){.grid2{grid-template-columns:1fr}}
a{color:#1a73e8}
</style></head><body><div class="wrap">
<header><div><h1>${esc(config.siteName)} — Daily Site Test</h1>
<div class="muted">${esc(config.baseUrl)} · ${dhaka(now)} (Dhaka) · ${tests.length} browser tests · ${health.checks.length} health checks · ${lhRows.length} Lighthouse audits</div></div>
<div class="status s-${overall.toLowerCase()}">${overall}</div></header>

<div class="tiles">
${tile('Tests passed', `${passed.length + flaky.length}/${tests.length}`, failed.length ? 'bad' : 'good')}
${tile('Failures', failed.length + healthFails.length, failed.length + healthFails.length ? 'bad' : 'good')}
${tile('Warnings', warnings.length, warnings.length ? 'ok' : 'good')}
${tile('Avg page load', ms(avgLoad), avgLoad > config.thresholds.pageLoadWarnMs ? 'ok' : 'good')}
${tile('Home perf (mobile)', homeLh?.scores.performance ?? '—', homeLh ? (homeLh.scores.performance >= 90 ? 'good' : homeLh.scores.performance >= config.thresholds.lighthouse.performance ? 'ok' : 'bad') : '')}
${tile('Home SEO score', homeLh?.scores.seo ?? '—', homeLh ? (homeLh.scores.seo >= config.thresholds.lighthouse.seo ? 'good' : 'bad') : '')}
${tile('Broken links', health.brokenLinks.length, health.brokenLinks.length ? 'bad' : 'good')}
${tile('SSL days left', health.ssl?.daysLeft ?? '—', health.ssl?.daysLeft < config.thresholds.sslWarnDays ? 'ok' : 'good')}
</div>

${failBlock}

<section><h2>⚡ Page availability &amp; speed</h2><table><tr><th>Page</th><th>Desktop</th><th>Mobile</th><th>Load (D)</th><th>Load (M)</th><th>TTFB</th><th>HTTP</th></tr>${perfRows}</table>
<p class="muted">Load = browser "load" event. Green &lt; ${ms(config.thresholds.pageLoadWarnMs)}, amber &lt; ${ms(config.thresholds.pageLoadMs)}, red = fail.</p></section>

<section><h2>🛒 Customer journeys</h2><table><tr><th>Journey</th><th>Desktop</th><th>Mobile</th><th>Notes</th></tr>${journeys}</table></section>

<section><h2>🚦 Lighthouse (mobile)</h2><table><tr><th>Page</th><th>Perf</th><th>A11y</th><th>Best pr.</th><th>SEO</th><th>LCP</th><th>FCP</th><th>TBT</th><th>CLS</th><th></th></tr>${lhTable || '<tr><td colspan="10" class="muted">No Lighthouse data</td></tr>'}</table>
<p class="muted">Targets: Perf ≥ ${config.thresholds.lighthouse.performance}, A11y ≥ ${config.thresholds.lighthouse.accessibility}, Best practices ≥ ${config.thresholds.lighthouse['best-practices']}, SEO ≥ ${config.thresholds.lighthouse.seo}. Good LCP &lt; 2.5s, CLS &lt; 0.1, TBT &lt; 200ms.</p></section>

<section><h2>🔎 On-page SEO</h2><table><tr><th>Page</th><th>Result</th><th>Title</th><th>Issues</th></tr>${seoRows}</table></section>

<div class="grid2">
<section><h2>🩺 Site health</h2><table><tr><th>Check</th><th>Result</th><th>Detail</th></tr>
${health.checks.map((c) => `<tr><td>${esc(c.name)}</td><td>${badge(c.status)}</td><td class="small">${esc(c.detail)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">No health data</td></tr>'}</table></section>
<section><h2>🔗 Broken links (${health.brokenLinks.length})</h2>
${health.brokenLinks.length ? `<table><tr><th>URL</th><th>Status</th><th>Found on</th></tr>${health.brokenLinks.slice(0, 50).map((b) => `<tr><td class="small"><a href="${esc(b.url)}">${esc(b.url.replace(config.baseUrl, ''))}</a></td><td class="bad">${esc(b.status)}</td><td class="small">${esc(b.foundOn)}</td></tr>`).join('')}</table>` : '<p class="muted">None found 🎉</p>'}
</section></div>

<section><h2>📈 Trend (last ${h30.length} runs)</h2><table>
<tr><td>Test pass rate %</td><td>${spark(h30.map((h) => h.passRate), '#0f9d58')}</td></tr>
<tr><td>Home perf score</td><td>${spark(h30.map((h) => h.perf), '#1a73e8')}</td></tr>
<tr><td>Avg page load (ms)</td><td>${spark(h30.map((h) => h.avgLoadMs), '#c77700')}</td></tr>
<tr><td>Broken links</td><td>${spark(h30.map((h) => h.brokenLinks), '#d93025')}</td></tr>
<tr><td>Daily status</td><td>${h30.map((h) => `<span title="${esc(dhaka(h.date))}" class="b b-${h.status.toLowerCase()}">${h.date.slice(5, 10)}</span>`).join(' ')}</td></tr>
</table></section>

<section><h2>⚠️ Warnings (${warnings.length})</h2>
${warnings.length ? `<table><tr><th>Where</th><th>Detail</th></tr>${warnings.map((w) => `<tr><td class="small">${esc(w.where)}</td><td class="small">${esc(w.msg)}</td></tr>`).join('')}</table>` : '<p class="muted">No warnings</p>'}
</section>
<p class="muted">Full browser logs, screenshots and traces: <a href="playwright/index.html">Playwright report</a> · Raw data: <a href="summary.json">summary.json</a></p>
</div></body></html>`;

await fs.mkdir('reports', { recursive: true });
await fs.writeFile('reports/index.html', html);
await fs.writeFile('reports/summary.json', JSON.stringify(summary, null, 2));
await fs.writeFile('reports/history.json', JSON.stringify(history, null, 2));
console.log(`Report built: ${overall} — ${passed.length + flaky.length}/${tests.length} passed, ${warnings.length} warnings`);
