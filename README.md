# Apple Gadgets BD — Daily Site Test

Tests **https://www.applegadgetsbd.com** automatically every morning and publishes a full report. It runs on GitHub Actions, which is free for this usage.

| What runs daily | Tool | Checks |
|---|---|---|
| **Smoke** (10 key pages × desktop + mobile) | Playwright | HTTP status, page load time, TTFB, JS crashes, 5xx errors |
| **Customer journeys** (desktop + mobile) | Playwright | Category → product, product page (price, buy button, images), search, cart, header/footer |
| **On-page SEO** (10 pages) | Playwright | Title, meta description, H1, canonical, noindex, OG tags, alt text, Product JSON-LD + price |
| **Lighthouse** (3 pages, mobile) | Lighthouse | Performance, Accessibility, Best Practices, SEO, LCP / FCP / TBT / CLS, top fixes |
| **Site health** | Node | SSL expiry, http→https and non-www→www redirects, robots.txt, sitemap files, 40 random sitemap URLs, internal broken links |

**Result:** one HTML report with a scorecard, failures, speed table, journeys, Lighthouse, SEO, health, broken links, a 30-day trend and warnings. Each run is marked **PASS / WARN / FAIL**.

---

## Setup (about 10 minutes)

1. **Create a GitHub repo**, for example `ag-site-monitor`, and push this folder:
   ```bash
   git init && git add . && git commit -m "Daily site test"
   git branch -M main
   git remote add origin https://github.com/<you>/ag-site-monitor.git
   git push -u origin main
   ```
2. **Run it once by hand.** Go to **Actions → Daily site test → Run workflow**. The first run creates the `gh-pages` branch.
3. **Turn on the report website.** Go to **Settings → Pages → Source: Deploy from a branch → `gh-pages` / root**.
   - Latest report: `https://<you>.github.io/ag-site-monitor/`
   - Any past day: `https://<you>.github.io/ag-site-monitor/runs/2026-11-14/`
   - ⚠️ Pages on a **private** repo needs a paid GitHub plan. On a public repo, anyone with the link can see the report. If you don't want that, skip Pages and use the email report or the run artifact instead.
4. **Add notifications** under **Settings → Secrets and variables → Actions → New repository secret**. Every channel is optional.

| Channel | Secrets |
|---|---|
| Telegram | `TELEGRAM_BOT_TOKEN` (from @BotFather), `TELEGRAM_CHAT_ID` (your group or chat ID) |
| Slack | `SLACK_WEBHOOK_URL` |
| Email (the full HTML report is in the email body) | `SMTP_HOST`, `SMTP_PORT` (465), `SMTP_USER`, `SMTP_PASS`, `MAIL_TO` (comma-separated), `MAIL_FROM` |

For Gmail SMTP, use `smtp.gmail.com` on port 465 with an **App Password**, not your normal password.
To get a message only when something is wrong, add a repository **variable** `NOTIFY_ONLY_ON_ISSUES` = `true`.

GitHub also emails the repo owner whenever a run ends in **FAIL**, because the job turns red.

---

## Change the schedule

Edit `.github/workflows/daily-site-test.yml`. Times are in **UTC**, and Dhaka = UTC+6.

| Want (Dhaka) | cron |
|---|---|
| 9:17 AM daily (default) | `17 3 * * *` |
| 9 AM + 7 PM | `17 3 * * *` and `17 13 * * *` |
| Every 6 hours | `17 */6 * * *` |
| Weekdays only, 10 AM | `17 4 * * 0-4` |

GitHub can start scheduled runs 5–30 minutes late. Avoid minute `0` because that is the busiest time.

## Change what gets tested

Everything is set in **`config.js`**: key pages, sample products, search term, which pages get Lighthouse, thresholds (load time, Lighthouse minimums, SSL warning days) and link-check limits.
When a product used in the tests is removed from the site, swap in a live product URL there.

## Run locally

```bash
npm ci && npx playwright install chromium
npm run all          # browser tests + health + lighthouse + report
open reports/index.html
```

## Files

```
config.js                  ← edit this
tests/smoke.spec.js        page up / speed / errors
tests/e2e.spec.js          customer journeys
tests/seo.spec.js          on-page SEO
scripts/health.mjs         SSL, redirects, robots, sitemap, broken links
scripts/lighthouse.mjs     Lighthouse audits
scripts/build-report.mjs   merges everything into reports/index.html
scripts/notify.mjs         Telegram / Slack / Email
.github/workflows/daily-site-test.yml   the daily schedule
```

## Troubleshooting

- **Everything fails with 403:** Cloudflare is blocking GitHub's servers. In Cloudflare, go to **Security → WAF → Custom rule** and allow requests whose User-Agent contains `AG-DailyTest`. You can also skip bot checks for that UA.
- **Search journey fails after a redesign:** update the selector in `tests/e2e.spec.js`. It currently looks for `input#search`.
- **Lighthouse scores jump around:** that's normal on shared runners (±5–10). Watch the trend, not a single day.
