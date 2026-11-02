import type { FieldDef, ResourceDef } from '@toprock/shared';
import { formatDate, formatMoney } from '../../lib/format';

type Rec = Record<string, unknown> & { _labels?: Record<string, string> };

function valueText(f: FieldDef, r: Rec, currency?: string): string {
  const v = r[f.name];
  if (f.type === 'ref') return r._labels?.[f.name] ?? '';
  if (v === null || v === undefined || v === '') return '';
  if (f.type === 'date' || f.type === 'datetime') return formatDate(String(v));
  if (f.type === 'money') return formatMoney(String(v), currency);
  if (f.type === 'percent') return `${Math.round(Number(v) * 10000) / 100}%`;
  if (f.type === 'boolean') return v ? 'Yes' : 'No';
  if (f.type === 'decimal') return Number(v).toLocaleString('en-IN', { maximumFractionDigits: 3 });
  if (Array.isArray(v)) return v.join(', ');
  return String(v).replace(/_/g, ' ');
}

/** A record (PO, MR, GRN, bill, DPR…) as a WhatsApp message: heading, main fields and its lines. */
export function recordShareText(def: ResourceDef, rec: Rec, projectName?: string, currency?: string): string {
  const title = String(rec.number ?? rec[def.titleField] ?? '');
  const out = [`*${def.label} ${title}*${rec.status ? ` · ${String(rec.status).replace(/_/g, ' ')}` : ''}`];
  if (projectName) out.push(`Project: ${projectName}`);
  for (const f of def.fields) {
    if (f.type === 'lines' || f.hideInForm || f.name === 'number' || f.name === 'status' || f.name === def.titleField) continue;
    if (!f.list && !f.required && f.type !== 'money' && f.type !== 'textarea') continue;
    const t = valueText(f, rec, currency);
    if (t) out.push(`${f.label}: ${f.type === 'textarea' && t.length > 400 ? `${t.slice(0, 399)}…` : t}`);
  }
  for (const lf of def.fields.filter((f) => f.type === 'lines')) {
    const rows = (rec[lf.name] as Rec[] | undefined) ?? [];
    if (!rows.length) continue;
    out.push('', `*${lf.label}* (${rows.length})`);
    const cols = (lf.lines ?? []).filter((x) => !x.hideInForm);
    const name = cols.find((x) => x.name === 'description') ?? cols.find((x) => x.type === 'ref') ?? cols[0];
    const qty = cols.find((x) => x.name === 'qty' || x.name === 'quantity');
    const unit = cols.find((x) => x.name === 'unit');
    const rate = cols.find((x) => /rate$/i.test(x.name) && x.type !== 'percent');
    const amount = cols.find((x) => x.name === 'amount');
    rows.slice(0, 40).forEach((r, i) => {
      const parts = [`${i + 1}. ${valueText(name, r, currency) || '—'}`];
      if (qty) parts.push(`${valueText(qty, r, currency)} ${unit ? valueText(unit, r, currency) : ''}`.trim());
      if (rate && r[rate.name] !== undefined && r[rate.name] !== '') parts.push(`@ ${formatMoney(String(r[rate.name]), currency)}`);
      if (amount && r[amount.name]) parts.push(`= ${formatMoney(String(r[amount.name]), currency)}`);
      out.push(parts.join(' '));
    });
    if (rows.length > 40) out.push(`… and ${rows.length - 40} more`);
  }
  return out.join('\n');
}
