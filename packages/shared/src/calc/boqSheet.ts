/**
 * Lays BOQ items out the way the estimator's Excel shows them:
 *   1      PRELIMINARIES                             ← section
 *   1.01   Site Mobilisation & Protection:- Allow …  ← item heading (the specification)
 *   a      Location: whole area   1 Item 34945 34945 ← priced line
 *          TOTAL AMOUNT (PRELIMINARIES)      160210  ← section total
 * Imported items carry the section, the heading text (specification) and codes such as 1.01.a,
 * so the layout is rebuilt from them, in the order given (the order of the file).
 */
import { D, money, type DecInput } from '../money.js';

export interface BoqSheetItem {
  id: string;
  itemCode: string;
  description: string;
  section?: string | null;
  specification?: string | null;
  unit: string;
  contractQty: DecInput;
  unitRate: DecInput;
  revisedQty?: DecInput | null;
  revisedRate?: DecInput | null;
}

export type BoqSheetRow =
  | { kind: 'SECTION'; key: string; no: string; title: string }
  | { kind: 'HEADING'; key: string; code: string; title: string; text: string }
  | { kind: 'ITEM'; key: string; code: string; text: string; item: BoqSheetItem; qty: string; rate: string; amount: string }
  | { kind: 'TOTAL'; key: string; title: string; amount: string }
  | { kind: 'GRAND_TOTAL'; key: string; amount: string; items: number };

/** "Site Mobilisation & Protection:- Allow cost for …" → "Site Mobilisation & Protection". */
const titleOf = (t: string) => t.split(/:-|\n/)[0].replace(/[:\s]+$/, '').trim();

export function boqSheetRows(items: BoqSheetItem[]): BoqSheetRow[] {
  const out: BoqSheetRow[] = [];
  let section: string | null | undefined;
  let sectionTitle = '';
  let sectionAmount = D(0);
  let heading: string | null = null;
  let grand = D(0);
  const closeSection = () => {
    if (section !== undefined && (section || out.some((r) => r.kind === 'SECTION'))) out.push({ kind: 'TOTAL', key: `t${out.length}`, title: `TOTAL AMOUNT (${sectionTitle || 'OTHER ITEMS'})`, amount: money(sectionAmount) });
  };
  for (const it of items) {
    const sec = it.section?.trim() || null;
    if (sec !== section) {
      closeSection();
      section = sec;
      sectionTitle = sec ?? '';
      sectionAmount = D(0);
      heading = null;
      if (sec) out.push({ kind: 'SECTION', key: `s${out.length}`, no: /^\d+/.exec(it.itemCode)?.[0] ?? '', title: sec });
    }
    // 1.01.a → heading 1.01, line a; codes without a line part are shown whole.
    const m = /^(.+\d)\.([a-z]{1,3}|[ivx]+)(-\d+)?$/i.exec(it.itemCode);
    const headCode = m ? m[1] : null;
    const spec = it.specification?.trim() || '';
    const title = spec ? titleOf(spec) : headCode ? it.description.split(' – ')[0] : '';
    if (headCode && headCode !== heading) {
      heading = headCode;
      out.push({ kind: 'HEADING', key: `h${out.length}`, code: headCode, title, text: spec || title });
    } else if (!headCode) heading = null;
    // "Heading – Location: …" shows only the part after the heading under it.
    const text = headCode && title && it.description.startsWith(`${title} – `) ? it.description.slice(title.length + 3) : it.description;
    const qty = D(it.revisedQty ?? it.contractQty);
    const rate = D(it.revisedRate ?? it.unitRate);
    const amount = qty.times(rate);
    sectionAmount = sectionAmount.plus(amount);
    grand = grand.plus(amount);
    out.push({ kind: 'ITEM', key: it.id, code: m ? m[2] + (m[3] ?? '') : it.itemCode, text, item: it, qty: qty.toString(), rate: rate.toString(), amount: money(amount) });
  }
  if (items.length) closeSection();
  out.push({ kind: 'GRAND_TOTAL', key: 'grand', amount: money(grand), items: items.length });
  return out;
}
