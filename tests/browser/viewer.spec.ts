import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

const f = (name: string) => path.join(process.cwd(), 'contracts/fixtures/', name);
const input = 'input[type=file]';

test('F01 demo renders a usable offline report and creates screenshot', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (req) => { if (!req.url().startsWith('http://127.0.0.1:4173/')) requests.push(req.url()); });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Возможности вашего ПК/ })).toBeVisible();
  await page.getByRole('button', { name: 'Показать пример' }).click();
  await expect(page.getByTestId('diagnostic-results')).toBeVisible();
  await expect(page.getByText(/синтетические/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Аппаратная конфигурация' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Совместимость моделей' })).toBeVisible();
  await expect(page.getByText('Требуется авторизация')).toBeVisible();
  await expect(page.getByText('Не проверялось', { exact: true }).first()).toBeVisible();
  expect(requests).toEqual([]);
  await page.screenshot({ path: 'artifacts/screenshots/b2-f01-desktop.png', fullPage: true });
});

test('F01-F05 import through browser File API and F05 comparison', async ({ page }) => {
  await page.goto('/');
  for (const name of ['F01_diagnostic_windows_ok.json','F02_diagnostic_llmfit_timeout.json',
                      'F03_diagnostic_offline_site.json','F04_diagnostic_unknown_igpu.json',
                      'F05_diagnostic_cpu_vs_sycl.json']) {
    await page.locator(input).setInputFiles(f(name));
    await expect(page.getByTestId('diagnostic-results')).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    if (name.startsWith('F02')) await expect(page.locator('.error-item strong').getByText('llmfit: LLMFIT_TIMEOUT')).toBeVisible();
    if (name.startsWith('F03')) await expect(page.getByText('Облачные проверки не проводились.')).toBeVisible();
    if (name.startsWith('F05')) await expect(page.locator('.comparison strong').getByText('not_comparable', { exact: true })).toBeVisible();
  }
});
test('F06-F08 are controlled rejections, not catalog activation', async ({ page }) => {
  await page.goto('/');
  for (const name of ['F06_diagnostic_unsupported_schema.json','F07_catalog_invalid_checksum.json',
                      'F08_catalog_incompatible_override.json']) {
    await page.locator(input).setInputFiles(f(name));
    await expect(page.getByRole('alert')).toContainText('Файл отклонён');
    await expect(page.getByTestId('diagnostic-results')).toHaveCount(0);
  }
});
test('XSS in diagnostic error is displayed as text and not executed', async ({ page }) => {
  await page.goto('/');
  const report = JSON.parse(await readFile(f('F02_diagnostic_llmfit_timeout.json'), 'utf8')) as { errors: { message: string }[] };
  report.errors[0].message = '<img src=x onerror=window.__injected=true>';
  await page.locator(input).setInputFiles({
    name: 'xss.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(report)),
  });
  await expect(page.getByTestId('diagnostic-results')).toBeVisible();
  await expect(page.getByText('<img src=x onerror=window.__injected=true>')).toBeVisible();
  await expect(page.locator('.error-item img')).toHaveCount(0);
  expect(await page.evaluate(() => (window as Window & { __injected?: boolean }).__injected)).toBeUndefined();
});
test('mobile viewport offers import and readable F05 result', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator(input).setInputFiles(f('F05_diagnostic_cpu_vs_sycl.json'));
  await expect(page.locator('.comparison strong').getByText('not_comparable', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'artifacts/screenshots/b2-f05-mobile.png', fullPage: true });
});
