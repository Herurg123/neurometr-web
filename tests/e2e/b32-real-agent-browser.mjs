/**
 * B3.2: real Windows Agent JSON --> browser File API.
 * Deliberately NOT a Playwright test-runner test: no automatic snapshots,
 * error-context.md, traces, video, screenshots or reporter attachments of
 * sensitive DOM. All failures are redacted, including browser exceptions.
 */
import { chromium } from '@playwright/test';
import { preview } from 'vite';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const LOCAL = 'http://127.0.0.1:4179';
const REPORT = join(process.env.RUNNER_TEMP || '', 'neurometr-b32-private', 'diagnostic.json');
function must(value) {
  if (!value) throw new Error('redacted E2E assertion failure');
}

let browser;
let previewServer;
let raw;
try {
  must(process.platform === 'win32');
  must(process.env.RUNNER_TEMP && process.env.RUNNER_TEMP.length > 1);
  raw = await readFile(REPORT);
  must(raw.length > 0 && raw.length <= 2 * 1024 * 1024);
  const report = JSON.parse(raw.toString('utf8'));
  must(report.schema_version === '0.1.0');
  must(report.catalog_ref.origin === 'bundled');
  must(report.catalog_ref.version === '2026.11.11.2');
  must(report.catalog_ref.sha256 === '1d84ff596c589a4db004f8a3fa17490d5479f57db3d7b0a433a7e448289651d2');

  previewServer = await preview({
    logLevel: 'silent',
    preview: { host: '127.0.0.1', port: 4179, strictPort: true },
  });
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
  } catch {
    // Windows image can provide Edge rather than Chrome; both are Chromium.
    browser = await chromium.launch({ channel: 'msedge', headless: true });
  }

  const context = await browser.newContext({
    acceptDownloads: false,
    serviceWorkers: 'block',
    // No recordVideoDir, no tracing.start, no screenshot calls.
  });
  const page = await context.newPage();

  let blockedRequests = 0;
  let nonReadRequests = 0;
  let pageErrors = 0;
  await context.route('**/*', async (route) => {
    const request = route.request();
    const allowed = request.url().startsWith(LOCAL + '/') &&
      (request.method() === 'GET' || request.method() === 'HEAD') &&
      !request.postDataBuffer();
    if (!allowed) {
      blockedRequests++;
      if (request.method() !== 'GET' && request.method() !== 'HEAD') nonReadRequests++;
      await route.abort();
    } else {
      await route.continue();
    }
  });
  page.on('pageerror', () => { pageErrors++; }); // Never print browser error text.
  await page.goto(LOCAL + '/', { waitUntil: 'networkidle' });
  // The only transfer of real diagnostics is a LOCAL OS file to the browser File API.
  await page.locator('input[type=file]').setInputFiles(REPORT);
  await page.locator('[data-testid=diagnostic-results]').waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForTimeout(350);
  const verdicts = await page.evaluate((expected) => {
    const text = (selector) => document.querySelector(selector)?.textContent ?? '';
    const has = (selector) => document.querySelector(selector) !== null;
    const devices = [...document.querySelectorAll('#hardware .device-grid .panel:first-child .device')];
    const gpuOk = devices.length === expected.hardware.gpus.length &&
      devices.every((node, i) => {
        const gpu = expected.hardware.gpus[i];
        const dedicated = node.querySelector('[data-testid=gpu-dedicated-total]')?.textContent?.trim();
        const free = node.querySelector('[data-testid=gpu-dedicated-free]')?.textContent?.trim();
        const shared = node.querySelector('[data-testid=gpu-shared-total]')?.textContent?.trim();
        return dedicated != null && free != null && shared != null &&
          (gpu.memory.dedicated_total_bytes === null ? dedicated === 'Неизвестно' : dedicated !== 'Неизвестно') &&
          (gpu.memory.dedicated_available_bytes === null ? free === 'Неизвестно' : free !== 'Неизвестно') &&
          (gpu.memory.shared_total_bytes === null ? shared === 'Неизвестно' : shared !== 'Неизвестно');
      });
    const components = [...document.querySelectorAll('#issues .list-row')];
    const llmfitSkipped = components.some((node) =>
      node.querySelector('strong')?.textContent === 'llmfit' && node.textContent?.includes('Пропущено'));
    const npu = expected.hardware.npus;
    const noNpuClaim = npu.length === 0
      ? text('#hardware .device-grid .panel:nth-child(2)').includes('Данные об NPU отсутствуют.')
      : true;
    const issueCount = document.querySelectorAll('#issues .limitations li').length;
    return {
      imported: has('[data-testid=diagnostic-results]') && !has('[role=alert]'),
      catalog: text('.report-footer').includes('2026.11.11.2 (bundled)'),
      cpu: text('#hardware .hardware-panel:first-child h3').includes(
        expected.hardware.cpu.model ?? 'Модель CPU неизвестна'),
      os: text('#hardware .hardware-panel:first-child').includes(expected.hardware.os.family) &&
        text('#hardware .hardware-panel:first-child').includes(expected.hardware.os.arch),
      ram: has('#hardware .hardware-panel:nth-child(2)') &&
        text('#hardware .hardware-panel:nth-child(2)').includes('Было доступно'),
      gpu: gpuOk,
      npu: noNpuClaim,
      llmfit: llmfitSkipped,
      emptyModels: text('#models').includes('Оценок моделей нет.') &&
        text('#models').includes('модели из каталога не загружались и не тестировались') &&
        !text('#models').includes('ток/с') && !text('#models').includes('tokens/s'),
      noRuntime: text('#runtime').includes('Нет проверенных runtime.'),
      limitations: expected.limitations.length > 0 && issueCount === expected.limitations.length,
      regularReport: !document.body.textContent?.includes('TEST ONLY') &&
        !document.body.textContent?.includes('Демонстрационный файл F01.'),
      cloudEmpty: text('#cloud').includes('Облачные проверки не проводились.'),
      partialSafe: expected.overall_status !== 'partial' ||
        document.querySelector('.overall-partial') !== null,
      noInjectedContent: document.querySelector('script[src^=http]') === null,
    };
  }, report);
  for (const passed of Object.values(verdicts)) must(passed === true);
  must(blockedRequests === 0 && nonReadRequests === 0);
  must(pageErrors === 0);
  await context.close();
  console.log('B32_REAL_AGENT_BROWSER_FILE_API=PASS');
  console.log('B32_OS_CPU_RAM_GPU_NPU_EMPTY_LIMITATIONS=PASS');
  console.log('B32_CATALOG_AND_NO_TPS=PASS');
  console.log('B32_LOCAL_ONLY_NO_UPLOAD=PASS');
  console.log('B32_NO_SCREENSHOT_TRACE_VIDEO=PASS');
} catch {
  // Never emit DOM snapshots, raw JSON, hardware model names or path-filled stack traces.
  console.error('B32_REAL_AGENT_BROWSER_FILE_API=FAIL_REDACTED');
  process.exitCode = 1;
} finally {
  if (raw) raw.fill(0);
  if (browser) await browser.close().catch(() => {});
  if (previewServer) await new Promise((resolve) => previewServer.httpServer.close(() => resolve()));
}
