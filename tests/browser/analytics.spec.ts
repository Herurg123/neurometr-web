/**
 * Public analytics tests use a virtual HTTPS neurometr.ru hostname.
 * EVERY production-document request is proxied to local Vite preview and
 * EVERY mc.yandex.ru request is intercepted with an inert mock script.
 * These tests never contact the actual counter or record test visits.
 */
import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const LOCAL = 'http://127.0.0.1:4173';
const HOST = 'https://neurometr.ru';
const METRICA = 'https://mc.yandex.ru/metrika/tag.js?id=114214620';

async function mockProduction(page: Page, blocked = false) {
  const tagRequests: { url: string; method: string; body: string | null }[] = [];
  const unexpected: string[] = [];

  // No real requests to neurometr.ru; serve the locally built static files.
  await page.route(HOST + '/**', async (route) => {
    const url = new URL(route.request().url());
    const res = await route.fetch({ url: LOCAL + url.pathname + url.search });
    await route.fulfill({ response: res });
  });
  // No real requests to mc.yandex.ru. All counter and beacon calls are fake.
  await page.route('https://mc.yandex.ru/**', async (route) => {
    const req = route.request();
    tagRequests.push({ url: req.url(), method: req.method(), body: req.postData() });
    if (blocked) {
      await route.abort('failed');
    } else if (req.url() === METRICA) {
      await route.fulfill({
        status: 200, contentType: 'application/javascript',
        body: 'window.__mockMetricaScriptRuns = (window.__mockMetricaScriptRuns || 0) + 1;',
      });
    } else {
      await route.fulfill({ status: 204, body: '' });
    }
  });
  // Deny any request to any other host. No accidental real beacons.
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(HOST + '/') || url.startsWith('https://mc.yandex.ru/')) {
      await route.fallback();
    } else {
      unexpected.push(url);
      await route.abort('blockedbyclient');
    }
  });
  return { tagRequests, unexpected };
}

test('No consent: public page is usable without tracker, even with secret query/hash', async ({ page }) => {
  const intercepted = await mockProduction(page);
  await page.goto(HOST + '/?run_id=PRIVATE_RUN_ID#PRIVATE_FRAGMENT');
  await expect(page.getByRole('heading', { name: /Узнайте возможности своего ПК/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Открыть защищённый просмотрщик JSON' })).toHaveAttribute('href', '/viewer.html');
  expect(await page.evaluate(() => location.search + location.hash)).toBe('');
  expect(intercepted.tagRequests).toHaveLength(0);
  expect(intercepted.unexpected).toEqual([]);
  await expect(page.locator('input[type=file]')).toHaveCount(0);
  await expect(page.locator('script[src^="https://mc.yandex.ru/"]')).toHaveCount(0);
});

test('Opt-in on production loads once, sanitized minimal init and no extra goals', async ({ page }) => {
  const intercepted = await mockProduction(page);
  await page.goto(HOST + '/?secret=PRIVATE#private');
  await page.getByRole('button', { name: 'Разрешить аналитику' }).click();
  await expect.poll(() => intercepted.tagRequests.length).toBe(1);
  expect(intercepted.tagRequests[0]).toEqual({ url: METRICA, method: 'GET', body: null });
  expect(intercepted.unexpected).toEqual([]);
  const result = await page.evaluate(() => {
    const fun = (window as Window & { ym?: { a?: unknown[][] } }).ym;
    return {
      queue: fun?.a ?? [],
      tagCount: document.querySelectorAll('script[data-neurometr-metrica]').length,
      url: location.href,
      loaded: (window as Window & { __mockMetricaScriptRuns?: number }).__mockMetricaScriptRuns,
    };
  });
  expect(result.queue).toHaveLength(1);
  expect(result.queue[0][0]).toBe(114214620);
  expect(result.queue[0][1]).toBe('init');
  expect(result.queue[0][2]).toEqual({
    url: 'https://neurometr.ru/', referrer: '', sendTitle: false,
    webvisor: false, clickmap: false, trackLinks: false, trackHash: false,
    accurateTrackBounce: false, ecommerce: false, childIframe: false,
  });
  expect(result.tagCount).toBe(1);
  expect(result.loaded).toBe(1);
  expect(result.url).toBe('https://neurometr.ru/');
});

test('Deny keeps public CTA usable, with no analytics requests', async ({ page }) => {
  const intercepted = await mockProduction(page);
  await page.goto(HOST + '/');
  await page.getByRole('button', { name: 'Отказаться' }).click();
  await expect(page.getByRole('status')).toContainText('Аналитика не разрешена');
  expect(intercepted.tagRequests).toHaveLength(0);
  await page.getByRole('link', { name: 'Открыть защищённый просмотрщик JSON' }).click();
  await expect(page).toHaveURL(HOST + '/viewer.html');
  await expect(page.getByRole('heading', { name: /Возможности вашего ПК/ })).toBeVisible();
  expect(intercepted.tagRequests).toHaveLength(0);
  expect(intercepted.unexpected).toEqual([]);
});

test('Revoke consent destroys tracker context with full document reload', async ({ page }) => {
  const intercepted = await mockProduction(page);
  await page.goto(HOST + '/');
  await page.getByRole('button', { name: 'Разрешить аналитику' }).click();
  await expect.poll(() => intercepted.tagRequests.length).toBe(1);
  const navigate = page.waitForEvent('framenavigated', frame => frame === page.mainFrame());
  await page.getByRole('button', { name: 'Отозвать согласие' }).click();
  await navigate;
  await expect(page.getByRole('button', { name: 'Разрешить аналитику' })).toBeVisible();
  expect(await page.evaluate(() => typeof window.ym)).toBe('undefined');
  await page.waitForTimeout(150);
  expect(intercepted.tagRequests).toHaveLength(1);
  expect(intercepted.unexpected).toEqual([]);
});

test('Consent on localhost and CI never initializes or requests Metrica', async ({ page }) => {
  const attempts: string[] = [];
  await page.route('https://mc.yandex.ru/**', async route => {
    attempts.push(route.request().url());
    await route.abort('blockedbyclient');
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Разрешить аналитику' }).click();
  await expect(page.getByRole('status')).toContainText('счётчик не запускается');
  expect(attempts).toEqual([]);
  expect(await page.evaluate(() => typeof window.ym)).toBe('undefined');
  await expect(page.locator('script[src^="https://mc.yandex.ru/"]')).toHaveCount(0);
  await page.getByRole('link', { name: 'Открыть защищённый просмотрщик JSON' }).click();
  await expect(page).toHaveURL(LOCAL + '/viewer.html');
});

test('Blocked Yandex script does not break public page or private viewer', async ({ page }) => {
  const intercepted = await mockProduction(page, true);
  await page.goto(HOST + '/');
  await page.getByRole('button', { name: 'Разрешить аналитику' }).click();
  await expect.poll(() => intercepted.tagRequests.length).toBe(1);
  await expect(page.getByRole('link', { name: 'Открыть защищённый просмотрщик JSON' })).toBeVisible();
  await page.getByRole('link', { name: 'Открыть защищённый просмотрщик JSON' }).click();
  await expect(page.getByRole('button', { name: 'Открыть JSON' })).toBeVisible();
  expect(intercepted.unexpected).toEqual([]);
});

test('Actual full-document navigation isolates sensitive imported report from Metrica', async ({ page }) => {
  const intercepted = await mockProduction(page);
  await page.goto(HOST + '/');
  await page.getByRole('button', { name: 'Разрешить аналитику' }).click();
  await expect.poll(() => intercepted.tagRequests.length).toBe(1);
  const before = intercepted.tagRequests.length;

  await page.getByRole('link', { name: 'Открыть защищённый просмотрщик JSON' }).click();
  await expect(page).toHaveURL(HOST + '/viewer.html');
  await expect(page.locator('script[src^="https://mc.yandex.ru/"]')).toHaveCount(0);
  expect(await page.evaluate(() => typeof window.ym)).toBe('undefined');
  const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(policy).toContain("script-src 'self'");
  expect(policy).toContain("connect-src 'none'");

  const original = JSON.parse(await readFile(path.join(process.cwd(), 'contracts/fixtures/F02_diagnostic_llmfit_timeout.json'), 'utf8')) as {
    errors: { message: string }[];
  };
  const sentinel = 'PRIVATE_REPORT_CONTENT_MUST_NOT_LEAK_112233';
  const privateName = 'private-hardware-report-112233.json';
  original.errors[0].message = sentinel;
  await page.locator('input[type=file]').setInputFiles({
    name: privateName, mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(original)),
  });
  await expect(page.getByTestId('diagnostic-results')).toBeVisible();
  await expect(page.getByText(sentinel)).toBeVisible();
  expect(intercepted.tagRequests).toHaveLength(before);
  expect(intercepted.unexpected).toEqual([]);
  expect(JSON.stringify(intercepted.tagRequests)).not.toContain(sentinel);
  expect(JSON.stringify(intercepted.tagRequests)).not.toContain(privateName);

  // CSP must block even a deliberate attempt to append a third-party script.
  await page.evaluate((url) => {
    const attempted = document.createElement('script');
    attempted.src = url;
    document.head.append(attempted);
  }, METRICA);
  await page.waitForTimeout(150);
  expect(intercepted.tagRequests).toHaveLength(before);
  expect(await page.evaluate(() => typeof window.ym)).toBe('undefined');
});

test('Direct viewer access has no tracker or upload, regardless of public consent', async ({ page }) => {
  const intercepted = await mockProduction(page);
  await page.goto(HOST + '/viewer.html');
  await expect(page.getByRole('heading', { name: /Возможности вашего ПК/ })).toBeVisible();
  await expect(page.locator('script[data-neurometr-metrica]')).toHaveCount(0);
  expect(await page.evaluate(() => typeof window.ym)).toBe('undefined');
  expect(intercepted.tagRequests).toHaveLength(0);
  expect(intercepted.unexpected).toEqual([]);
});
