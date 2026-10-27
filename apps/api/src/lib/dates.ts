/** Parses YYYY-MM-DD (or ISO) into a UTC midnight Date for @db.Date columns. */
export function toDateOnly(v: string | Date | null | undefined): Date | null {
  if (v === null || v === undefined || v === '') return null;
  const d = v instanceof Date ? v : new Date(String(v).slice(0, 10) + 'T00:00:00.000Z');
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function isoDate(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

export function periodCode(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function periodBounds(code: string): { start: Date; end: Date } {
  const [y, m] = code.split('-').map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 0)) };
}

export function today(): Date {
  return toDateOnly(new Date()) as Date;
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}
