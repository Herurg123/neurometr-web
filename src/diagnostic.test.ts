import { describe, expect, it } from 'vitest';
import F01 from '../contracts/fixtures/F01_diagnostic_windows_ok.json';
import F02 from '../contracts/fixtures/F02_diagnostic_llmfit_timeout.json';
import F03 from '../contracts/fixtures/F03_diagnostic_offline_site.json';
import F04 from '../contracts/fixtures/F04_diagnostic_unknown_igpu.json';
import F05 from '../contracts/fixtures/F05_diagnostic_cpu_vs_sycl.json';
import F06 from '../contracts/fixtures/F06_diagnostic_unsupported_schema.json';
import F07 from '../contracts/fixtures/F07_catalog_invalid_checksum.json';
import F08 from '../contracts/fixtures/F08_catalog_incompatible_override.json';
import numeric from '../contracts/fixtures/numeric-vectors.json';
import { DiagnosticImportError, MAX_DIAGNOSTIC_BYTES, parseStrictJson, parseStrictUtf8Bytes } from './strict-json';
import { parseDiagnosticBytes, openDiagnosticFile } from './diagnostic';
import { comparisonFor, compareAssessments } from './semantics';

function parsed(value: unknown) { return parseDiagnosticBytes(new TextEncoder().encode(JSON.stringify(value))); }
function codeOf(callback: () => unknown) {
  try { callback(); return 'ACCEPTED'; }
  catch (error) {
    if (error instanceof DiagnosticImportError) return error.code;
    throw error;
  }
}

describe('B2 contract fixtures F01–F08', () => {
  it('F01 normal Windows report loads without network', () => {
    const d = parsed(F01);
    expect(d.overall_status).toBe('ok');
    expect(d.hardware.cpu.model).toBeTruthy();
    expect(d.cloud_checks[0].conclusion).toBe('auth_required');
    expect(d.model_assessments[0].speed_estimate?.evidence.kind).toBe('estimated');
    expect(d.runtime_checks[0].launch_status).toBe('not_tested');
  });
  it('F02 llmfit timeout preserves a partial hardware report', () => {
    const d = parsed(F02);
    expect(d.overall_status).toBe('partial');
    expect(d.errors[0].code).toBe('LLMFIT_TIMEOUT');
    expect(d.hardware.ram.physical_total_bytes).toBeGreaterThan(0);
    expect(d.model_assessments).toHaveLength(0);
  });
  it('F03 offline / bundled catalog is not marked failed', () => {
    const d = parsed(F03);
    expect(d.catalog_ref.origin).toBe('bundled');
    expect(d.cloud_checks).toHaveLength(0);
    expect(d.components.find((x) => x.component === 'cloud')?.status).toBe('skipped');
  });
  it('F04 unknown VRAM/NPU values remain null/unknown, never 0', () => {
    const d = parsed(F04);
    expect(d.hardware.gpus[0].memory.dedicated_total_bytes).toBeNull();
    expect(d.hardware.gpus[0].memory.shared_total_bytes).toBeNull();
    expect(d.hardware.npus[0].detection_status).toBe('unknown');
  });
  it('F05 measured CPU-only and estimated SYCL are not comparable', () => {
    const d = parsed(F05);
    expect(d.model_assessments).toHaveLength(2);
    const [cpu, sycl] = d.model_assessments;
    expect(cpu.measurements[0].evidence.kind).toBe('measured');
    expect(sycl.speed_estimate?.evidence.kind).toBe('estimated');
    expect(compareAssessments(sycl, cpu)).toBe('not_comparable');
    expect(comparisonFor(d, sycl)).toBe('not_comparable');
  });
  it('F06 unsupported schema is rejected explicitly', () => {
    expect(codeOf(() => parsed(F06))).toBe('SCHEMA_VERSION');
  });
  it('F07 valid catalog is not a diagnostic; no activation or download', () => {
    expect(codeOf(() => parsed(F07))).toBe('FILE_KIND');
  });
  it('F08 incompatible catalog override is not imported as diagnostic', () => {
    expect(codeOf(() => parsed(F08))).toBe('FILE_KIND');
  });
});

describe('Strict JSON, UTF-8 and portable numeric policy', () => {
  it.each(numeric.vectors)('canonical numeric vector $input', ({ input, accept }) => {
    expect(codeOf(() => parseStrictJson('{"v":' + input + '}')) === 'ACCEPTED').toBe(accept);
  });
  it('rejects nested duplicate keys including escaped equivalents', () => {
    expect(codeOf(() => parseStrictJson('{"x":{"a":1,"a":2}}'))).toBe('JSON_DUPLICATE_KEY');
    expect(codeOf(() => parseStrictJson('{"x":1,"\\u0078":2}'))).toBe('JSON_DUPLICATE_KEY');
  });
  it('cannot pollute the prototype through JSON keys', () => {
    const obj = parseStrictJson('{"__proto__":{"isAdmin":true}}') as Record<string, unknown>;
    expect(Object.getPrototypeOf(obj)).toBeNull();
    expect(({} as { isAdmin?: boolean }).isAdmin).toBeUndefined();
  });
  it('rejects invalid JSON syntax and trailing data', () => {
    for (const s of ['{"x":}', '{"x":01}', '{"x":1,}', '{"x":true} false', '{"x":"\\q"}']) {
      expect(codeOf(() => parseStrictJson(s))).toBe('JSON_INVALID');
    }
  });
  it('rejects BOM, malformed UTF-8 and file beyond 2 MiB', () => {
    expect(codeOf(() => parseStrictUtf8Bytes(new Uint8Array([0xef,0xbb,0xbf,0x7b,0x7d])))).toBe('JSON_INVALID');
    expect(codeOf(() => parseStrictUtf8Bytes(new Uint8Array([0xff])))).toBe('FILE_UTF8');
    expect(codeOf(() => parseStrictUtf8Bytes(new Uint8Array(MAX_DIAGNOSTIC_BYTES + 1)))).toBe('FILE_TOO_LARGE');
  });
  it('rejects oversized File before File.arrayBuffer is called', async () => {
    const file = { size: MAX_DIAGNOSTIC_BYTES + 1, arrayBuffer: () => { throw Error('Should not be called'); } } as unknown as File;
    await expect(openDiagnosticFile(file)).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
  });
  it('rejects depth and node budget exhaustion', () => {
    const deep = '['.repeat(65) + '0' + ']'.repeat(65);
    expect(codeOf(() => parseStrictJson(deep))).toBe('JSON_STRUCTURE');
    const many = '[' + '0,'.repeat(100_000) + '0]';
    expect(codeOf(() => parseStrictJson(many))).toBe('JSON_STRUCTURE');
  });
  it('never silently accepts numeric overflow or precision loss', () => {
    for (const token of ['1e999','-1e999','9007199254740992','9007199254740992.0','1.0000000000000001','1e-999']) {
      expect(codeOf(() => parseStrictJson('[' + token + ']'))).toBe('JSON_NUMBER');
    }
  });
});

describe('Semantic invariants equivalent to B1 validators', () => {
  it('rejects overall ok with failed components or engine and structured errors', () => {
    const a = structuredClone(F01);
    a.components[0].status = 'failed';
    expect(codeOf(() => parsed(a))).toBe('SEMANTIC_INVALID');
    const b = structuredClone(F01);
    b.engines[0].status = 'partial';
    expect(codeOf(() => parsed(b))).toBe('SEMANTIC_INVALID');
    const c = structuredClone(F01);
    (c.errors as { component: string; code: string; message: string; retryable: boolean }[]).push({ component: 'hardware', code: 'FAIL', message: 'Synthetic failure', retryable: false });
    expect(codeOf(() => parsed(c))).toBe('SEMANTIC_INVALID');
  });
  it('rejects cloud_checks without cloud component, even when probes passed', () => {
    const d = structuredClone(F01);
    d.components = d.components.filter((c) => c.component !== 'cloud');
    expect(codeOf(() => parsed(d))).toBe('SEMANTIC_INVALID');
    const e = structuredClone(F01);
    e.components.find((c) => c.component === 'cloud')!.status = 'skipped';
    expect(codeOf(() => parsed(e))).toBe('SEMANTIC_INVALID');
  });
  it('rejects nested execution mismatch and impossible measurement units', () => {
    const d = structuredClone(F05);
    d.model_assessments[1].speed_estimate!.execution.backend_id = 'cpu';
    expect(codeOf(() => parsed(d))).toBe('SEMANTIC_INVALID');
    const e = structuredClone(F05);
    e.model_assessments[0].measurements[0].unit = 'ms';
    expect(codeOf(() => parsed(e))).toBe('SEMANTIC_INVALID');
  });
  it('rejects 401 misclassified as connection failure', () => {
    const d = structuredClone(F01);
    d.cloud_checks[0].conclusion = 'connection_failed';
    expect(codeOf(() => parsed(d))).toBe('SEMANTIC_INVALID');
  });
  it('rejects non-UTC date before semantic checks', () => {
    const d = structuredClone(F01);
    d.started_at = '2026-11-11T13:00:00+03:00';
    expect(codeOf(() => parsed(d))).toBe('SCHEMA_INVALID');
  });
  it('rejects XSS as markup by treating it as plain data', () => {
    const d = structuredClone(F02);
    const xss = '<img src=x onerror=alert(1)>';
    d.errors[0].message = xss;
    expect(parsed(d).errors[0].message).toBe(xss);
  });
});
