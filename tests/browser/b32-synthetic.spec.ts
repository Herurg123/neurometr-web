import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const f = (name: string) => path.join(process.cwd(), 'contracts', 'fixtures', name);
const input = 'input[type=file]';

test('B3.2 synthetic partial hardware and optional llmfit failure preserve hardware', async ({ page }) => {
  await page.goto('/');
  const d = JSON.parse(await readFile(f('F01_diagnostic_windows_ok.json'), 'utf8')) as {
    overall_status:string; components:{component:string;status:string}[];
  };
  d.overall_status = 'partial';
  const hardware = d.components.find(x => x.component === 'hardware');
  if (!hardware) throw new Error('Synthetic hardware fixture missing');
  hardware.status = 'partial';
  await page.locator(input).setInputFiles({ name:'synthetic-partial.json',
    mimeType:'application/json', buffer:Buffer.from(JSON.stringify(d)) });
  await expect(page.locator('.overall-partial')).toBeVisible();
  await expect(page.getByRole('heading', {name:'Аппаратная конфигурация'})).toBeVisible();
  await page.locator(input).setInputFiles(f('F02_diagnostic_llmfit_timeout.json'));
  await expect(page.locator('.overall-partial')).toBeVisible();
  await expect(page.locator('.error-item strong')).toContainText('LLMFIT_TIMEOUT');
  await expect(page.getByRole('heading', {name:'Аппаратная конфигурация'})).toBeVisible();
});

test('B3.2 synthetic unknown dedicated and free VRAM stay unknown', async ({ page }) => {
  await page.goto('/');
  await page.locator(input).setInputFiles(f('F04_diagnostic_unknown_igpu.json'));
  await expect(page.getByTestId('diagnostic-results')).toBeVisible();
  await expect(page.getByTestId('gpu-dedicated-total').first()).toHaveText('Неизвестно');
  await expect(page.getByTestId('gpu-dedicated-free').first()).toHaveText('Неизвестно');
});

test('B3.2 rejects damaged JSON, duplicate keys, wrong kind, oversized and unsigned manifest', async ({ page }) => {
  await page.goto('/');
  const cases = [
    {name:'broken.json',buffer:Buffer.from('{"kind":')},
    {name:'duplicate.json',buffer:Buffer.from('{"kind":"neurometr.diagnostic","kind":"neurometr.diagnostic"}')},
    {name:'wrong.json',buffer:Buffer.from('{"kind":"not.diagnostic","schema_version":"0.1.0"}')},
    {name:'oversize.json',buffer:Buffer.alloc(2 * 1024 * 1024 + 1, 0x20)},
    {name:'unsigned-manifest.json',buffer:await readFile(path.join(process.cwd(), 'catalog', 'manifests', '2026.11.11.2', 'manifest.json'))},
  ];
  for (const c of cases) {
    await page.locator(input).setInputFiles({name:c.name,mimeType:'application/json',buffer:c.buffer});
    await expect(page.getByRole('alert')).toContainText('Файл отклонён');
    await expect(page.getByTestId('diagnostic-results')).toHaveCount(0);
  }
});
