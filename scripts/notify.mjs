// Sends the daily summary to Telegram / Slack / Email — whichever secrets are set.
import fs from 'node:fs/promises';

const s = JSON.parse(await fs.readFile('reports/summary.json', 'utf8'));
const env = process.env;
const reportUrl = env.REPORT_URL || '';
const icon = { PASS: '✅', WARN: '⚠️', FAIL: '❌' }[s.status];
const lh = s.lighthouseHome;
const date = new Date(s.date).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', dateStyle: 'medium', timeStyle: 'short' });

const lines = [
  `${icon} ${s.status} — Apple Gadgets BD daily test`,
  `🕘 ${date}`,
  `Tests: ${s.tests.passed + s.tests.flaky}/${s.tests.total} passed${s.tests.failed ? ` · ${s.tests.failed} failed` : ''}`,
  `Avg load: ${s.avgLoadMs ? (s.avgLoadMs / 1000).toFixed(1) + 's' : '—'} · Broken links: ${s.brokenLinks} · SSL: ${s.sslDaysLeft ?? '—'}d`,
  lh ? `Lighthouse home: Perf ${lh.performance} · SEO ${lh.seo} · A11y ${lh.accessibility}` : '',
  `Warnings: ${s.warnings}`,
  ...(s.topFailures.length ? ['', 'Failures:', ...s.topFailures.map((f) => `• ${f}`)] : []),
  reportUrl ? `\n📊 Full report: ${reportUrl}` : '',
].filter((l) => l !== '');
const text = lines.join('\n');
console.log(text);

const onlyOnIssues = env.NOTIFY_ONLY_ON_ISSUES === 'true';
if (onlyOnIssues && s.status === 'PASS') { console.log('All green — notification skipped'); process.exit(0); }

const jobs = [];
if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
  jobs.push(fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
  }).then((r) => console.log('Telegram:', r.status)));
}
if (env.SLACK_WEBHOOK_URL) {
  jobs.push(fetch(env.SLACK_WEBHOOK_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) })
    .then((r) => console.log('Slack:', r.status)));
}
if (env.SMTP_HOST && env.MAIL_TO) {
  const nodemailer = (await import('nodemailer')).default;
  const t = nodemailer.createTransport({
    host: env.SMTP_HOST, port: +(env.SMTP_PORT || 465), secure: (env.SMTP_PORT || '465') === '465',
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
  const html = await fs.readFile('reports/index.html', 'utf8');
  jobs.push(t.sendMail({
    from: env.MAIL_FROM || env.SMTP_USER, to: env.MAIL_TO,
    subject: `${icon} ${s.status} · Apple Gadgets BD daily test · ${date}`,
    text, html,
  }).then(() => console.log('Email: sent')));
}
if (!jobs.length) console.log('No notification channel configured (set TELEGRAM_*, SLACK_WEBHOOK_URL or SMTP_* secrets).');
const res = await Promise.allSettled(jobs);
res.filter((r) => r.status === 'rejected').forEach((r) => console.error('Notify error:', r.reason?.message));
