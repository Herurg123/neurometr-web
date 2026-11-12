import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const LOCAL = 'http://127.0.0.1:4173';

test('WEB-QA-001: both documents use local icons, and favicon.ico is a real 200 ICO', async ({ page, request }) => {
  const external: string[] = [];
  page.on('request', req => {
    if (!req.url().startsWith(LOCAL + '/')) external.push(req.url());
  });

  for (const doc of ['/', '/viewer.html']) {
    const document = await page.goto(doc);
    expect(document?.status()).toBe(200);
    await expect(page.locator('link[rel="icon"][href="/favicon.ico"]')).toHaveAttribute('type', 'image/x-icon');
    await expect(page.locator('link[rel="icon"][href="/favicon.svg"]')).toHaveAttribute('type', 'image/svg+xml');
  }
  const ico = await request.get('/favicon.ico');
  expect(ico.status()).toBe(200);
  const icoBytes = await ico.body();
  expect(icoBytes.length).toBeGreaterThan(100);
  expect([...icoBytes.subarray(0, 6)]).toEqual([0, 0, 1, 0, 1, 0]);

  const svg = await request.get('/favicon.svg');
  expect(svg.status()).toBe(200);
  expect(await svg.text()).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
  expect(external).toEqual([]);
});

test('WEB-QA-002: keyboard return from imported private JSON is full navigation with no data transfer', async ({ page }) => {
  const external: string[] = [];
  let navigations = 0;
  page.on('request', req => {
    if (!req.url().startsWith(LOCAL + '/')) external.push(req.url());
  });
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) navigations++;
  });

  await page.goto('/viewer.html');
  const data = JSON.parse(await readFile(
    path.join(process.cwd(), 'contracts/fixtures/F02_diagnostic_llmfit_timeout.json'), 'utf8',
  )) as { errors: { message: string }[] };
  const secret = 'PRIVATE_QA_NAVIGATION_ONLY_NOT_TO_BE_SENT';
  const privateFilename = 'private-diagnostic-qa-sentinel.json';
  data.errors[0].message = secret;
  await page.locator('input[type=file]').setInputFiles({
    name: privateFilename, mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(data)),
  });
  await expect(page.getByTestId('diagnostic-results')).toBeVisible();
  await expect(page.getByText(secret)).toBeVisible();

  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("connect-src 'none'");
  expect(await page.evaluate(() => [...document.scripts].some(s => s.src.includes('mc.yandex.ru')))).toBe(false);

  const home = page.getByRole('link', { name: 'На главную', exact: true });
  await expect(home).toBeVisible();
  await expect(home).toHaveAttribute('href', '/');
  await home.focus();
  await expect(home).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(LOCAL + '/');
  await expect(page.getByRole('heading', { name: /Узнайте возможности своего ПК/ })).toBeVisible();
  expect(navigations).toBeGreaterThanOrEqual(2);

  const outcome = await page.evaluate((tokens) => {
    const serializedStorage = JSON.stringify({
      local: [...Object.entries(localStorage)],
      session: [...Object.entries(sessionStorage)],
    });
    return {
      cleanURL: location.href === location.origin + '/',
      noPrivateDOM: tokens.every(s => !(document.body.textContent ?? '').includes(s)),
      noPrivateStorage: tokens.every(s => !serializedStorage.includes(s)),
      noViewerUpload: document.querySelector('input[type=file]') === null,
      noTracker: typeof window.ym === 'undefined' && !document.querySelector('script[src^="https://mc.yandex.ru/"]'),
    };
  }, [secret, privateFilename]);
  expect(outcome).toEqual({
    cleanURL: true, noPrivateDOM: true, noPrivateStorage: true,
    noViewerUpload: true, noTracker: true,
  });
  expect(external).toEqual([]);
});

test('WEB-QA-002: back navigation is visible, focusable and usable on narrow screens', async ({ page }) => {
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/viewer.html');
    const home = page.getByRole('link', { name: 'На главную', exact: true });
    await expect(home).toBeVisible();
    const box = await home.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    await home.focus();
    await expect(home).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(LOCAL + '/');
  }
});
