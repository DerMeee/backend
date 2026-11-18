function toText(value: unknown): string {
  return typeof value === 'object'
    ? JSON.stringify(value)
    : String(value as string);
}

/**
 * Escapes one CSV cell.
 * Cells starting with = + - @ (or tab / CR) are prefixed with a quote so spreadsheet
 * apps don't run them as formulas (CSV injection).
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  let s = value instanceof Date ? value.toISOString() : toText(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n;]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function csvRow(values: unknown[]): string {
  return values.map(csvCell).join(',') + '\r\n';
}

/** UTF-8 byte order mark, so Excel opens accented and Arabic text correctly. */
export const CSV_BOM = String.fromCharCode(0xfeff);

/** Same formula guard for values written into XLSX cells. */
export function safeSheetValue(value: unknown): string | number | Date | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || value instanceof Date) return value;
  const s = toText(value);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}
