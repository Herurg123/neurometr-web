/** B1 STATUS_EXECUTION_INVARIANTS.md, browser-side parity without new wire fields. */
import type { Diagnostic, Evidence, Execution } from './types';
import { DiagnosticImportError } from './strict-json';
function fail(message: string): never { throw new DiagnosticImportError('SEMANTIC_INVALID', message); }
const EXECUTION_KEYS: (keyof Execution)[] = [
  'device_path', 'backend_id', 'runtime_id', 'runtime_version', 'gpu_layers', 'context_tokens', 'threads',
];
export function executionEqual(a: Execution, b: Execution): boolean {
  return EXECUTION_KEYS.every((key) => a[key] === b[key]);
}
export function compareAssessments(
  estimateAssessment: Diagnostic['model_assessments'][number],
  measuredAssessment: Diagnostic['model_assessments'][number],
): 'comparable_configuration' | 'not_comparable' {
  if (!estimateAssessment.speed_estimate ||
    !measuredAssessment.measurements.some((m) => m.kind === 'generation_tps')) return 'not_comparable';
  if (!estimateAssessment.model_id || !estimateAssessment.artifact_id ||
    estimateAssessment.model_id !== measuredAssessment.model_id ||
    estimateAssessment.artifact_id !== measuredAssessment.artifact_id) return 'not_comparable';
  const a = estimateAssessment.execution;
  const b = measuredAssessment.execution;
  if (a.device_path === 'unknown' ||
      EXECUTION_KEYS.some((key) => a[key] == null || b[key] == null || a[key] !== b[key])) return 'not_comparable';
  return measuredAssessment.measurements.some(
    (m) => m.kind === 'generation_tps' && executionEqual(m.execution, b),
  ) ? 'comparable_configuration' : 'not_comparable';
}
export function comparisonFor(
  report: Diagnostic, assessed: Diagnostic['model_assessments'][number],
): 'comparable_configuration' | 'not_comparable' | null {
  if (!assessed.speed_estimate) return null;
  const peers = report.model_assessments.filter((a) =>
    a.model_id === assessed.model_id && a.artifact_id === assessed.artifact_id &&
    a.measurements.some((m) => m.kind === 'generation_tps'));
  if (peers.length === 0) return null;
  return peers.some((peer) => compareAssessments(assessed, peer) === 'comparable_configuration')
    ? 'comparable_configuration'
    : 'not_comparable';
}
/** Provenance-specific warning: "measured" alone never implies a synthetic result. */
export function isSyntheticMeasurement(evidence: Evidence): boolean {
  return evidence.kind === 'measured' && evidence.source === 'synthetic:fixture';
}
export function validateDiagnosticSemantics(d: Diagnostic): void {
  if (Date.parse(d.finished_at) < Date.parse(d.started_at)) fail('Время окончания раньше начала диагностики.');
  const components = new Map(d.components.map((c) => [c.component, c.status]));
  if (components.size !== d.components.length) fail('Повторяющиеся имена компонентов.');
  if (new Set(d.engines.map((e) => e.name)).size !== d.engines.length) fail('Повторяющиеся имена engines.');
  if (new Set(d.hardware.gpus.map((g) => g.index)).size !== d.hardware.gpus.length) fail('Повторяющиеся индексы GPU.');
  for (const e of d.engines) {
    const owner = components.get(e.name.split('/')[0]);
    if (!owner) fail('Engine не соответствует существующему компоненту.');
    if (owner === 'skipped' && e.status !== 'skipped') fail('Пропущенный компонент содержит выполненный engine.');
    if ((e.status === 'failed' || e.status === 'partial') && (owner === 'ok' || owner === 'skipped')) {
      fail('Статус engine противоречит статусу компонента.');
    }
  }
  for (const e of d.errors) {
    const status = components.get(e.component);
    if (!status) fail('Ошибка ссылается на отсутствующий компонент.');
    if (status === 'ok' || status === 'skipped') fail('Ошибка противоречит статусу компонента.');
  }
  const cloud = components.get('cloud');
  if (d.cloud_checks.length > 0 && !cloud) fail('Облачные проверки без компонента cloud.');
  if (d.cloud_checks.length > 0 && cloud === 'skipped') fail('Пропущенный компонент cloud содержит проверки.');
  for (const check of d.cloud_checks) {
    if (check.probes.some((p) => p.status === 'failed') && cloud !== 'partial' && cloud !== 'failed') {
      fail('Ошибка облачной пробы противоречит статусу компонента cloud.');
    }
    if (check.probes.some((p) => p.http_status === 401) && check.conclusion === 'connection_failed') {
      fail('HTTP 401 не является ошибкой соединения или региональной блокировкой.');
    }
  }
  const states = d.components.map((c) => c.status).concat(d.engines.map((e) => e.status));
  const degraded = d.errors.length > 0 || states.some((s) => s === 'failed' || s === 'partial');
  const usable = d.components.some((c) => c.status === 'ok' || c.status === 'partial');
  if (d.overall_status === 'ok') {
    if (degraded || !d.components.some((c) => c.status === 'ok')) fail('Неверный агрегатный статус ok.');
  } else if (d.overall_status === 'partial') {
    if (!usable || !degraded) fail('Неверный агрегатный статус partial.');
  } else if (usable || d.engines.some((e) => e.status === 'ok' || e.status === 'partial') || !degraded) {
    fail('Неверный агрегатный статус failed.');
  }
  const units: Record<string, string> = {
    generation_tps: 'tokens/s', prompt_tps: 'tokens/s', ttft_ms: 'ms',
    total_latency_ms: 'ms', peak_working_set_bytes: 'bytes',
  };
  for (const assessed of d.model_assessments) {
    if (assessed.speed_estimate) {
      if (!executionEqual(assessed.execution, assessed.speed_estimate.execution)) {
        fail('Конфигурация estimate.execution отличается от assessment.execution.');
      }
      if (assessed.speed_estimate.backend_id !== assessed.execution.backend_id) {
        fail('Backend оценки не совпадает с конфигурацией assessment.');
      }
    }
    for (const measured of assessed.measurements) {
      if (!executionEqual(assessed.execution, measured.execution)) {
        fail('Конфигурация measurement.execution отличается от assessment.execution.');
      }
      if (units[measured.kind] !== measured.unit) fail('Единицы измерений не соответствуют типу метрики.');
    }
  }
}
