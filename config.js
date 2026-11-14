// ─────────────────────────────────────────────────────────────
//  Central config — edit this file to change what gets tested.
// ─────────────────────────────────────────────────────────────
export const config = {
  siteName: 'Apple Gadgets BD',
  baseUrl: (process.env.BASE_URL || 'https://www.applegadgetsbd.com').replace(/\/$/, ''),

  // Pages that must always be up. type drives which SEO rules apply.
  keyPages: [
    { name: 'Home', path: '/', type: 'home' },
    { name: 'Mobile Phone', path: '/category/mobile-phone', type: 'category' },
    { name: 'Laptops', path: '/category/laptops', type: 'category' },
    { name: 'Tablet', path: '/category/tablet', type: 'category' },
    { name: 'Gadgets & Gears', path: '/category/gadgets-and-gears', type: 'category' },
    { name: 'Brand: Apple', path: '/brands/apple', type: 'category' },
    { name: 'Offers', path: '/offer', type: 'listing' },
    { name: 'Blog', path: '/blog', type: 'listing' },
    { name: 'Product: AirTag', path: '/product/apple-airtag', type: 'product' },
    { name: 'Product: iPhone 18 Pro Max', path: '/product/iphone-18-pro-max', type: 'product' },
  ],

  // Category used for the browse → product journey
  journeyCategory: '/category/mobile-phone',
  searchTerm: 'iphone',

  // Lighthouse: pages to audit (mobile) — keep to 3-5, each takes ~30-60s
  lighthousePages: ['/', '/category/mobile-phone', '/product/apple-airtag'],

  thresholds: {
    pageLoadMs: 8000,      // full "load" event per page (FAIL above)
    pageLoadWarnMs: 4000,  // WARN above
    ttfbWarnMs: 1200,      // server response time (WARN above)
    lighthouse: { performance: 50, accessibility: 80, 'best-practices': 80, seo: 90 },
    sslWarnDays: 21,
  },

  linkCheck: {
    seedPages: ['/', '/category/mobile-phone', '/category/laptops'],
    maxLinks: 200,
    concurrency: 6,
  },
  sitemapSampleSize: 40,   // random sitemap URLs checked per run

  // Sends a browser-like UA so Cloudflare doesn't block the checker
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 AG-DailyTest/1.0',
};

export const url = (p) => (p.startsWith('http') ? p : config.baseUrl + p);
