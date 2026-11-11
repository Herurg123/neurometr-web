import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import diagnosticSchema from '../../contracts/diagnostic.schema.json';
import type { Diagnostic } from './types';
import { DiagnosticImportError, MAX_DIAGNOSTIC_BYTES, parseStrictUtf8Bytes } from './strict-json';
import { validateDiagnosticSemantics } from './semantics';

const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: true });
addFormats(ajv);
const validateSchema = ajv.compile(diagnosticSchema);
function issue(code: string, message: string): never { throw new DiagnosticImportError(code, message); }

export function parseDiagnosticBytes(bytes: Uint8Array): Diagnostic {
  const data = parseStrictUtf8Bytes(bytes);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return issue('FILE_KIND', 'Ожидался объект diagnostic.json.');
  }
  const record = data as Record<string, unknown>;
  if (record.kind !== 'neurometr.diagnostic') {
    return issue('FILE_KIND', 'Это не диагностический JSON Нейрометра. Каталог/manifest не являются диагностикой.');
  }
  if (record.schema_version !== '0.1.0') {
    return issue('SCHEMA_VERSION', 'Неподдерживаемая версия схемы. Поддерживается только diagnostic v0.1.0.');
  }
  if (!validateSchema(record)) {
    const detail = (validateSchema.errors || []).slice(0, 3)
      .map((e) => (e.instancePath || '/') + ': ' + e.message).join('; ');
    return issue('SCHEMA_INVALID', 'JSON не соответствует канонической схеме: ' + detail);
  }
  const diagnostic = record as unknown as Diagnostic;
  validateDiagnosticSemantics(diagnostic);
  return diagnostic;
}
export async function openDiagnosticFile(file: File): Promise<Diagnostic> {
  if (file.size > MAX_DIAGNOSTIC_BYTES) return issue('FILE_TOO_LARGE', 'Файл превышает лимит diagnostic.json: 2 MiB.');
  return parseDiagnosticBytes(new Uint8Array(await file.arrayBuffer()));
}
export function explainImportError(error: unknown): string {
  return error instanceof DiagnosticImportError
    ? error.message
    : 'Не удалось прочитать файл. Проверьте diagnostic.json и попробуйте снова.';
}
