/**
 * Strict, bounded JSON parser for diagnostics. No eval, fetch or DOM injection.
 * JSON.parse is used only on individual validated string literals.
 */
export const MAX_DIAGNOSTIC_BYTES = 2 * 1024 * 1024;
export const MAX_JSON_DEPTH = 64;
export const MAX_JSON_NODES = 100_000;
const MAX_SAFE_DECIMAL = '9007199254740991';

export class DiagnosticImportError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'DiagnosticImportError';
  }
}
function invalid(code: string, message: string): never {
  throw new DiagnosticImportError(code, message);
}
type DecimalForm = { negative: boolean; digits: string; exponent: number };
function decimalForm(raw: string): DecimalForm {
  const match = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/.exec(raw);
  if (!match) return invalid('JSON_INVALID', 'Некорректный числовой литерал JSON.');
  const exponent = Number(match[4] || 0);
  if (!Number.isFinite(exponent) || Math.abs(exponent) > 10_000) {
    return invalid('JSON_NUMBER', 'Экспонента выходит за допустимые пределы.');
  }
  const fraction = match[3] || '';
  let digits = (match[2] + fraction).replace(/^0+/, '');
  if (digits.length === 0) return { negative: false, digits: '0', exponent: 0 };
  let scale = exponent - fraction.length;
  while (digits.endsWith('0')) {
    digits = digits.slice(0, -1);
    scale += 1;
  }
  return { negative: match[1] === '-', digits, exponent: scale };
}
function sameDecimal(a: DecimalForm, b: DecimalForm): boolean {
  return a.negative === b.negative && a.digits === b.digits && a.exponent === b.exponent;
}
function integerOverflowsSafeRange(value: DecimalForm): boolean {
  if (value.digits === '0' || value.exponent < 0) return false;
  const len = value.digits.length + value.exponent;
  if (len > MAX_SAFE_DECIMAL.length) return true;
  if (len < MAX_SAFE_DECIMAL.length) return false;
  return value.digits + '0'.repeat(value.exponent) > MAX_SAFE_DECIMAL;
}
export function parseSafeJsonNumber(raw: string): number {
  const original = decimalForm(raw);
  const value = Number(raw);
  if (!Number.isFinite(value)) return invalid('JSON_NUMBER', 'Бесконечное значение или переполнение числа JSON.');
  if (integerOverflowsSafeRange(original) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
    return invalid('JSON_NUMBER', 'Целое число превышает диапазон безопасных целых JavaScript.');
  }
  if (original.digits !== '0' && value === 0) return invalid('JSON_NUMBER', 'Недопустимое округление малого числа до нуля.');
  if (!sameDecimal(original, decimalForm(value.toString()))) {
    return invalid('JSON_NUMBER', 'Потеря точности числового литерала JSON.');
  }
  return value;
}
class JsonReader {
  private pos = 0;
  private nodes = 0;
  constructor(private readonly source: string) {}
  read(): unknown {
    this.skipWhite();
    const value = this.value(1);
    this.skipWhite();
    if (this.pos !== this.source.length) invalid('JSON_INVALID', 'После JSON обнаружены дополнительные данные.');
    return value;
  }
  private skipWhite() {
    while (this.pos < this.source.length) {
      const c = this.source[this.pos];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') this.pos++;
      else break;
    }
  }
  private value(depth: number): unknown {
    this.nodes++;
    if (depth > MAX_JSON_DEPTH || this.nodes > MAX_JSON_NODES) invalid('JSON_STRUCTURE', 'JSON превышает допустимую глубину или сложность.');
    this.skipWhite();
    const ch = this.source[this.pos];
    if (ch === '{') return this.object(depth);
    if (ch === '[') return this.array(depth);
    if (ch === '"') return this.string();
    if (ch === '-' || (ch !== undefined && ch >= '0' && ch <= '9')) return this.number();
    if (this.source.startsWith('true', this.pos)) { this.pos += 4; return true; }
    if (this.source.startsWith('false', this.pos)) { this.pos += 5; return false; }
    if (this.source.startsWith('null', this.pos)) { this.pos += 4; return null; }
    return invalid('JSON_INVALID', 'Некорректный JSON или неожиданный конец файла.');
  }
  private object(depth: number): Record<string, unknown> {
    this.pos++;
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    const keys = new Set<string>();
    this.skipWhite();
    if (this.source[this.pos] === '}') { this.pos++; return result; }
    while (true) {
      this.skipWhite();
      if (this.source[this.pos] !== '"') return invalid('JSON_INVALID', 'Ожидалось имя поля JSON.');
      const key = this.string();
      if (keys.has(key)) return invalid('JSON_DUPLICATE_KEY', 'Повторяющийся ключ JSON: ' + key.slice(0, 80));
      keys.add(key);
      this.skipWhite();
      this.expect(':');
      result[key] = this.value(depth + 1);
      this.skipWhite();
      const sep = this.source[this.pos];
      if (sep === '}') { this.pos++; return result; }
      if (sep !== ',') return invalid('JSON_INVALID', 'Ожидался разделитель JSON-объекта.');
      this.pos++;
    }
  }
  private array(depth: number): unknown[] {
    this.pos++;
    const result: unknown[] = [];
    this.skipWhite();
    if (this.source[this.pos] === ']') { this.pos++; return result; }
    while (true) {
      result.push(this.value(depth + 1));
      this.skipWhite();
      const sep = this.source[this.pos];
      if (sep === ']') { this.pos++; return result; }
      if (sep !== ',') return invalid('JSON_INVALID', 'Ожидался разделитель JSON-массива.');
      this.pos++;
    }
  }
  private string(): string {
    const start = this.pos;
    this.expect('"');
    while (this.pos < this.source.length) {
      const c = this.source[this.pos++];
      if (c === '"') return JSON.parse(this.source.slice(start, this.pos)) as string;
      if (c < ' ') return invalid('JSON_INVALID', 'Неэкранированный управляющий символ.');
      if (c !== '\\') continue;
      const next = this.source[this.pos++];
      if (next === 'u') {
        const hex = this.source.slice(this.pos, this.pos + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) return invalid('JSON_INVALID', 'Некорректное экранирование Unicode.');
        this.pos += 4;
      } else if (next === undefined || !'"\\/bfnrt'.includes(next)) {
        return invalid('JSON_INVALID', 'Некорректный escape в JSON-строке.');
      }
    }
    return invalid('JSON_INVALID', 'Незакрытая JSON-строка.');
  }
  private number(): number {
    const start = this.pos;
    if (this.source[this.pos] === '-') this.pos++;
    if (this.source[this.pos] === '0') {
      this.pos++;
      if (this.isDigit(this.source[this.pos])) return invalid('JSON_INVALID', 'В JSON запрещены ведущие нули.');
    } else {
      if (!this.isDigit19(this.source[this.pos])) return invalid('JSON_INVALID', 'Недопустимое JSON-число.');
      while (this.isDigit(this.source[this.pos])) this.pos++;
    }
    if (this.source[this.pos] === '.') {
      this.pos++;
      if (!this.isDigit(this.source[this.pos])) return invalid('JSON_INVALID', 'Отсутствует дробная часть.');
      while (this.isDigit(this.source[this.pos])) this.pos++;
    }
    if (this.source[this.pos] === 'e' || this.source[this.pos] === 'E') {
      this.pos++;
      if (this.source[this.pos] === '+' || this.source[this.pos] === '-') this.pos++;
      if (!this.isDigit(this.source[this.pos])) return invalid('JSON_INVALID', 'Отсутствует экспонента.');
      while (this.isDigit(this.source[this.pos])) this.pos++;
    }
    return parseSafeJsonNumber(this.source.slice(start, this.pos));
  }
  private isDigit(c: string | undefined): boolean { return c !== undefined && c >= '0' && c <= '9'; }
  private isDigit19(c: string | undefined): boolean { return c !== undefined && c >= '1' && c <= '9'; }
  private expect(c: string) {
    if (this.source[this.pos] !== c) return invalid('JSON_INVALID', 'Некорректный синтаксис JSON.');
    this.pos++;
  }
}
export function parseStrictJson(source: string): unknown { return new JsonReader(source).read(); }
export function parseStrictUtf8Bytes(bytes: Uint8Array): unknown {
  if (bytes.byteLength > MAX_DIAGNOSTIC_BYTES) invalid('FILE_TOO_LARGE', 'Размер diagnostic.json превышает 2 MiB.');
  let text: string;
  try {
    // ignoreBOM:true preserves U+FEFF, which the JSON parser rejects.
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return invalid('FILE_UTF8', 'Файл не является корректным UTF-8.');
  }
  return parseStrictJson(text);
}
