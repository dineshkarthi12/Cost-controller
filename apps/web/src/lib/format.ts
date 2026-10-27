import { formatMoney, formatMoneyCompact, formatPct, formatQty, humanize } from '@toprock/shared';

export { formatMoney, formatMoneyCompact, formatPct, formatQty, humanize };

export function formatDate(v: string | Date | null | undefined, opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' }) {
  if (!v) return '—';
  const d = typeof v === 'string' ? new Date(v.length === 10 ? v + 'T00:00:00Z' : v) : v;
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', { ...opts, timeZone: v && typeof v === 'string' && v.length === 10 ? 'UTC' : undefined }).format(d);
}

export function formatDateTime(v: string | Date | null | undefined) {
  return formatDate(v, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function isoDay(v: string | Date | null | undefined) {
  if (!v) return '';
  return (typeof v === 'string' ? v : v.toISOString()).slice(0, 10);
}

export function todayIso() {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10);
}

export function relativeTime(v: string | Date) {
  const d = typeof v === 'string' ? new Date(v) : v;
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return formatDate(d);
}

export function fileSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
