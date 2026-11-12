import { useRef, useState } from 'react';
import type { DragEvent, ChangeEvent } from 'react';
import sampleF01 from '../contracts/fixtures/F01_diagnostic_windows_ok.json';
import type { Diagnostic, Evidence, ComponentStatus, ProbeStatus } from './types';
import { parseDiagnosticBytes, openDiagnosticFile, explainImportError } from './diagnostic';
import { comparisonFor, isSyntheticMeasurement } from './semantics';

const langEvidence: Record<Evidence['kind'], string> = {
  detected: 'Обнаружено', estimated: 'Оценка', measured: 'Измерено',
  user_reported: 'Со слов пользователя', derived: 'Расчёт', unknown: 'Неизвестно',
};
const langComponent: Record<ComponentStatus, string> = {
  ok: 'Успешно', partial: 'Частично', failed: 'Ошибка', skipped: 'Пропущено',
};
const langProbe: Record<ProbeStatus, string> = {
  passed: 'Пройдено', failed: 'Не пройдено', indeterminate: 'Неопределённо',
  not_tested: 'Не проверялось', unsupported: 'Не поддерживается',
};
const langFit: Record<Diagnostic['model_assessments'][number]['fit']['status'], string> = {
  fits: 'Память позволяет (оценка)', limited: 'Ограниченная совместимость',
  does_not_fit: 'Недостаточно памяти (оценка)', unknown: 'Неизвестно',
  not_evaluated: 'Не рассчитывалось',
};
const langCloud: Record<Diagnostic['cloud_checks'][number]['conclusion'], string> = {
  reachable: 'Доступен по проверенному маршруту', auth_required: 'Требуется авторизация',
  access_denied_unknown_reason: 'Доступ запрещён, причина неизвестна',
  rate_limited: 'Ограничение запросов', connection_failed: 'Ошибка соединения',
  unknown: 'Недостаточно данных', not_tested: 'Не проверялось',
};

function bytes(value: number | null): string {
  if (value == null) return 'Неизвестно';
  if (value === 0) return '0 Б';
  if (value >= 1024 ** 3) return (value / 1024 ** 3).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' ГиБ';
  return (value / 1024 ** 2).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' МиБ';
}
function number(value: number | null): string {
  return value == null ? 'Неизвестно' : value.toLocaleString('ru-RU', { maximumFractionDigits: 1 });
}
function date(utc: string): string {
  return new Date(utc).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';
}
function DeviceBadge({ kind, source }: { kind: Evidence['kind']; source?: string }) {
  return <span className={'evidence evidence-' + kind} title={source ? 'Источник: ' + source : undefined}>{langEvidence[kind]}</span>;
}
function StatusBadge({ status }: { status: ComponentStatus | ProbeStatus }) {
  const label = status in langComponent ? langComponent[status as ComponentStatus] : langProbe[status as ProbeStatus];
  return <span className={'status status-' + status}>{label}</span>;
}
function Section({ id, title, note, children }: {
  id?: string; title: string; note?: string; children: React.ReactNode;
}) {
  return (
    <section id={id} className="section">
      <div className="section-head"><h2>{title}</h2>{note && <p>{note}</p>}</div>
      {children}
    </section>
  );
}
function Hardware({ report }: { report: Diagnostic }) {
  const { hardware: hw } = report;
  return (
    <Section id="hardware" title="Аппаратная конфигурация" note="То, что обнаружено системой, не обязательно означает наличие рабочего ИИ-ускорения.">
      <div className="hardware-grid">
        <article className="panel hardware-panel">
          <div className="panel-label">Процессор <DeviceBadge kind={hw.cpu.evidence.kind} source={hw.cpu.evidence.source} /></div>
          <h3>{hw.cpu.model ?? 'Модель CPU неизвестна'}</h3>
          <div className="facts">
            <div><span>Физические ядра</span><strong>{number(hw.cpu.physical_cores)}</strong></div>
            <div><span>Логические потоки</span><strong>{number(hw.cpu.logical_processors)}</strong></div>
            <div><span>ОС</span><strong>{hw.os.family} {hw.os.version ?? ''} · {hw.os.arch}</strong></div>
          </div>
        </article>
        <article className="panel hardware-panel">
          <div className="panel-label">Оперативная память <DeviceBadge kind={hw.ram.evidence.kind} source={hw.ram.evidence.source} /></div>
          <h3>{bytes(hw.ram.physical_total_bytes)}</h3>
          <div className="facts">
            <div><span>Было доступно</span><strong>{bytes(hw.ram.available_bytes)}</strong></div>
            <div><span>Замер доступности</span><strong>{hw.ram.available_observed_at ? date(hw.ram.available_observed_at) : 'Неизвестно'}</strong></div>
          </div>
        </article>
      </div>
      <div className="device-grid">
        <article className="panel">
          <div className="panel-label">Графика / GPU <span className="count">{hw.gpus.length}</span></div>
          {hw.gpus.length ? hw.gpus.map((gpu) => (
            <div className="device" key={gpu.index}>
              <div className="device-top"><strong>{gpu.name ?? 'Неизвестная GPU'}</strong><DeviceBadge kind={gpu.evidence.kind} source={gpu.evidence.source}/></div>
              <div className="facts compact">
                <div><span>Топология</span><strong>{gpu.memory_topology}</strong></div>
                <div><span>Выделенная память</span><strong data-testid="gpu-dedicated-total">{bytes(gpu.memory.dedicated_total_bytes)}</strong></div>
                <div><span>Свободная VRAM</span><strong data-testid="gpu-dedicated-free">{bytes(gpu.memory.dedicated_available_bytes)}</strong></div>
                <div><span>Разделяемая память</span><strong data-testid="gpu-shared-total">{bytes(gpu.memory.shared_total_bytes)}</strong></div>
              </div>
            </div>
          )) : <p className="empty">GPU не обнаружены в отчёте.</p>}
          <p className="footnote">Разделяемая видеопамять не прибавляется к физической RAM повторно.</p>
        </article>
        <article className="panel">
          <div className="panel-label">Нейроускорители / NPU <span className="count">{hw.npus.length}</span></div>
          {hw.npus.length ? hw.npus.map((npu, i) => (
            <div className="device" key={i}>
              <div className="device-top"><strong>{npu.name ?? 'Название неизвестно'}</strong>
                <DeviceBadge kind={npu.evidence.kind} source={npu.evidence.source} /></div>
              <p className="muted">Обнаружение: {npu.detection_status === 'unknown' ? 'неизвестно' : npu.detection_status === 'detected' ? 'обнаружен' : 'не обнаружен'}</p>
            </div>
          )) : <p className="empty">Данные об NPU отсутствуют.</p>}
        </article>
      </div>
    </Section>
  );
}
function RuntimeAndModels({ report }: { report: Diagnostic }) {
  return (
    <>
      <Section id="runtime" title="Движки и runtime" note="Обнаружение runtime и реальный запуск модели — независимые проверки.">
        <div className="panel">
          {report.engines.map((e) => (
            <div className="list-row" key={e.name}><div><strong>{e.name}</strong><p className="subtext">Версия: {e.version ?? 'неизвестна'}</p></div><StatusBadge status={e.status}/></div>
          ))}
          {report.runtime_checks.map((run, i) => (
            <div className="list-row" key={run.runtime_id + i}>
              <div><strong>{run.runtime_id}</strong><p className="subtext">Backend: {run.backend_id ?? 'неизвестен'} · Обнаружение: {run.discovery_status === 'detected' ? 'да' : run.discovery_status === 'unknown' ? 'неизвестно' : 'нет'}</p></div>
              <div className="right"><small>Запуск runtime</small><StatusBadge status={run.launch_status}/></div>
            </div>
          ))}
          {!report.engines.length && !report.runtime_checks.length && <p className="empty">Нет проверенных runtime.</p>}
        </div>
      </Section>
      <Section id="models" title="Совместимость моделей" note="Прогноз не подтверждает скорость загруженной модели. Измерения обозначены отдельно.">
        <div className="models-grid">
          {report.model_assessments.map((a, i) => {
            const cmp = comparisonFor(report, a);
            return (
              <article className="panel model-panel" key={i}>
                <div className="model-header"><div><span className="overline">Модель {i + 1}</span><h3>{a.source_model_name}</h3></div>
                  <span className="pill-outline">{a.execution.device_path === 'cpu_only' ? 'CPU only' : a.execution.device_path === 'gpu_offload' ? 'GPU offload' : a.execution.device_path}</span>
                </div>
                <p className="model-id">{a.model_id ?? 'Неидентифицированная модель'}</p>
                <div className="model-stats">
                  <div><span className="metric-label">Память / fit</span><strong className="metric-value-sm">{langFit[a.fit.status]}</strong><DeviceBadge kind={a.fit.evidence.kind} source={a.fit.evidence.source}/></div>
                  <div><span className="metric-label">Загрузка модели</span><strong className="metric-value-sm">{langProbe[a.load_status]}</strong></div>
                </div>
                <div className="metric-list">
                  {a.speed_estimate && <div className="metric-line">
                    <div><span>Прогноз генерации</span><DeviceBadge kind="estimated" source={a.speed_estimate.evidence.source}/></div>
                    <strong>{number(a.speed_estimate.tokens_per_second)} ток/с</strong>
                  </div>}
                  {a.measurements.map((m, j) => <div className="metric-line" key={j}>
                    <div>
                      <span>{m.kind === 'generation_tps' ? 'Измерено: генерация' : m.kind}</span>
                      <DeviceBadge kind={m.evidence.kind} source={m.evidence.source}/>
                      {isSyntheticMeasurement(m.evidence) && <span className="synthetic-measurement" data-testid="synthetic-measurement">Синтетическое тестовое измерение, не результат этого ПК</span>}
                    </div>
                    <strong>{number(m.value)} {m.unit}</strong>
                  </div>)}
                  {!a.speed_estimate && a.measurements.length === 0 && <div className="empty-inline">Скорость не рассчитана и не измерена.</div>}
                </div>
                {cmp && <div className={'comparison ' + (cmp === 'not_comparable' ? 'comparison-warning' : '')}>
                  <strong>{cmp}</strong>
                  <span>{cmp === 'not_comparable' ? 'Разные условия: прогноз и измерение нельзя сравнивать напрямую.' : 'Конфигурация совпадает, методики всё ещё могут отличаться.'}</span>
                </div>}
                <div className="model-meta">Backend: {a.execution.backend_id ?? 'неизвестен'} · Контекст: {a.execution.context_tokens == null ? 'неизвестен' : number(a.execution.context_tokens) + ' токенов'}</div>
              </article>
            );
          })}
          {!report.model_assessments.length && <div className="panel empty">Оценок моделей нет. Это не означает, что каталог пуст: модели из каталога не загружались и не тестировались. Частичный отказ не обнуляет результаты аппаратной диагностики.</div>}
        </div>
      </Section>
    </>
  );
}
function CloudAndIssues({ report }: { report: Diagnostic }) {
  return <>
    <Section id="cloud" title="Облачные проверки" note="Результаты получены локальным агентом. Веб-страница не выполняет сетевые проверки.">
      <div className="panel">
        {report.cloud_checks.map((c, i) => <div className="cloud-entry" key={i}>
          <div className="cloud-top"><div><strong>{c.service_id}</strong><p className="subtext">Цель: {c.target_id} · {date(c.checked_at)}</p></div><span className="pill-outline">{langCloud[c.conclusion]}</span></div>
          <div className="probes">{c.probes.map((p, j) => <div className="probe" key={j}>
            <strong>{p.stage.toUpperCase()}</strong><StatusBadge status={p.status}/>
            <span>{p.http_status == null ? 'HTTP: нет данных' : 'HTTP ' + p.http_status}</span>
            <span>{p.duration_ms == null ? 'Время неизвестно' : number(p.duration_ms) + ' мс'}</span>
          </div>)}</div>
          <div className="note-strip">HTTP 401/403 сами по себе не доказывают региональную блокировку.</div>
        </div>)}
        {!report.cloud_checks.length && <p className="empty">Облачные проверки не проводились. Это не ошибка связи и не доказательство недоступности сервисов.</p>}
      </div>
    </Section>
    <Section id="issues" title="Ошибки и ограничения" note="Частичный отчёт сохраняет независимые успешные результаты.">
      <div className="issue-grid">
        <article className="panel">
          <div className="panel-label">Статусы компонентов</div>
          {report.components.map((c) => <div className="list-row" key={c.component}><strong>{c.component}</strong><StatusBadge status={c.status}/></div>)}
        </article>
        <article className="panel">
          <div className="panel-label">Ошибки <span className="count">{report.errors.length}</span></div>
          {report.errors.length ? report.errors.map((e, i) => <div className="error-item" key={i}>
            <strong>{e.component}: {e.code}</strong><p>{e.message}</p>
          </div>) : <p className="empty">Структурированных ошибок нет.</p>}
        </article>
      </div>
      <article className="panel limitations">
        <div className="panel-label">Ограничения отчёта <span className="count">{report.limitations.length}</span></div>
        {report.limitations.length ? <ul>{report.limitations.map((s, i) => <li key={i}>{s}</li>)}</ul> : <p className="empty">Ограничения не указаны.</p>}
      </article>
    </Section>
  </>;
}

export default function App() {
  const [report, setReport] = useState<Diagnostic | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [synthetic, setSynthetic] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function readFile(file: File) {
    setBusy(true);
    setError('');
    try {
      const parsed = await openDiagnosticFile(file);
      setReport(parsed);
      setFilename(file.name);
      setSynthetic(false);
    } catch (e) {
      setError(explainImportError(e));
      setReport(null);
      setFilename(null);
    } finally { setBusy(false); }
  }
  function demo() {
    try {
      const parsed = parseDiagnosticBytes(new TextEncoder().encode(JSON.stringify(sampleF01)));
      setReport(parsed);
      setFilename('F01 · синтетический пример');
      setSynthetic(true);
      setError('');
    } catch (e) { setError(explainImportError(e)); }
  }
  function onInput(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void readFile(file);
    event.target.value = '';
  }
  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) void readFile(file);
  }
  return (
    <div className="app-shell">
      <header className="header">
        <div className="wrap header-inner">
          <div className="brand"><span className="brand-mark">N<span>.</span></span><span>НЕЙРОМЕТР</span><span className="brand-divider" /><span className="brand-sub">JSON VIEWER</span></div>
          <div className="header-right"><a className="viewer-home-link" href="/">На главную</a><span className="header-online"><span className="dot"/> БЕЗ ОТПРАВКИ ДАННЫХ</span><span className="version">v0.1.0</span></div>
        </div>
      </header>

      <main className="wrap">
        <div className="hero">
          <div className="hero-copy"><div className="eyebrow"><span className="line"/> ЛОКАЛЬНАЯ АНАЛИТИКА</div>
            <h1>Возможности вашего ПК.<br/><span>Без догадок.</span></h1>
            <p>Откройте диагностический JSON от Нейрометра. Посмотрите, что обнаружено, что рассчитано и что действительно измерено. Без аккаунта и отправки файла на сервер.</p>
          </div>
          <div className="hero-graphic" aria-hidden="true"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="hero-n">N<span>.</span></div></div>
        </div>

        <div className="upload" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
          <div className="upload-icon" aria-hidden="true">↥</div>
          <div className="upload-copy"><strong>Откройте диагностический файл</strong><span>Перетащите сюда diagnostic.json или выберите файл · до 2 МиБ</span></div>
          <div className="upload-actions">
            <input ref={inputRef} type="file" accept=".json,application/json" aria-label="Выбрать диагностический JSON" onChange={onInput}/>
            <button className="button-primary" type="button" onClick={() => inputRef.current?.click()} disabled={busy}>{busy ? 'Чтение…' : 'Открыть JSON'}</button>
            <button className="button-secondary" type="button" onClick={demo} disabled={busy}>Показать пример</button>
          </div>
        </div>
        {error && <div role="alert" className="alert"><strong>Файл отклонён</strong><span>{error}</span></div>}

        {report ? <div data-testid="diagnostic-results">
          <div className="results-head">
            <div><div className="eyebrow">РЕЗУЛЬТАТ ДИАГНОСТИКИ</div><h2>Обзор системы</h2><p>{filename} · {date(report.finished_at)}</p></div>
            <span className={'overall overall-' + report.overall_status}>{langComponent[report.overall_status]}</span>
          </div>
          {synthetic && <div className="demo-alert">Демонстрационный файл F01. Все устройства и числа синтетические, это не результаты вашего ПК.</div>}
          <div className="summary-grid">
            <div className="summary-card"><span>CPU</span><strong>{number(report.hardware.cpu.physical_cores)}</strong><small>физических ядер</small></div>
            <div className="summary-card"><span>RAM</span><strong>{bytes(report.hardware.ram.physical_total_bytes)}</strong><small>физическая память</small></div>
            <div className="summary-card"><span>GPU</span><strong>{report.hardware.gpus.length}</strong><small>устройств обнаружено</small></div>
            <div className="summary-card"><span>ОЦЕНКИ</span><strong>{report.model_assessments.length}</strong><small>конфигураций моделей</small></div>
          </div>
          <Hardware report={report}/>
          <RuntimeAndModels report={report}/>
          <CloudAndIssues report={report}/>
          <div className="report-footer"><span>Источник: {report.producer.name} {report.producer.version} · Каталог: {report.catalog_ref.version} ({report.catalog_ref.origin})</span><span>Run ID: {report.run_id}</span></div>
        </div> : <div className="start-state">
          <div className="start-heading"><span className="eyebrow">ЧТО ВНУТРИ</span><h2>Не просто цифры. Контекст.</h2></div>
          <div className="intro-grid">
            <div><span className="intro-num">01</span><h3>Железо и память</h3><p>CPU, RAM, GPU/NPU с отдельным обозначением неизвестных значений.</p></div>
            <div><span className="intro-num">02</span><h3>Оценки и измерения</h3><p>Прогнозы llmfit и фактические измерения не смешиваются.</p></div>
            <div><span className="intro-num">03</span><h3>Проверки и ограничения</h3><p>Runtime, облачные ответы и частичные ошибки без ложных выводов.</p></div>
          </div>
        </div>}
      </main>
      <footer className="footer"><div className="wrap footer-inner"><span>НЕЙРОМЕТР <span className="muted">/ Диагностика с доказательствами</span></span><span>Данные остаются в браузере · Статический сайт</span></div></footer>
    </div>
  );
}
