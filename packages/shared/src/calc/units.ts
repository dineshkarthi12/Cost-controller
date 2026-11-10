import Decimal from 'decimal.js';

/**
 * Units as written on site and in estimators' sheets ("Mtr", "Sq.ft", "Bags", "Kgs"…) mapped to one
 * canonical unit, with a factor to that dimension's base unit. Used to compare a BOM / PO line with
 * the material master: a rate per MT must never be applied to a quantity in Kg without converting.
 *
 * "MT" means metric tonne (as on Indian purchase orders); metre is "M", "Mtr", "Rmt" or "RM".
 */
interface UnitDef {
  code: string;
  dimension: string;
  /** How many base units one of this unit is. */
  toBase: string;
}

const DEFS: Array<[UnitDef, string[]]> = [
  [{ code: 'NOS', dimension: 'COUNT', toBase: '1' }, ['nos', 'no', 'number', 'numbers', 'each', 'ea', 'pcs', 'pc', 'piece', 'pieces', 'unit', 'units']],
  [{ code: 'PAIR', dimension: 'COUNT', toBase: '2' }, ['pair', 'pairs']],
  [{ code: 'DOZEN', dimension: 'COUNT', toBase: '12' }, ['dozen', 'doz']],
  [{ code: 'BAG', dimension: 'BAG', toBase: '1' }, ['bag', 'bags']],
  [{ code: 'SET', dimension: 'SET', toBase: '1' }, ['set', 'sets']],
  [{ code: 'LS', dimension: 'LUMPSUM', toBase: '1' }, ['ls', 'lumpsum', 'lump sum', 'job', 'lot']],
  [{ code: 'M', dimension: 'LENGTH', toBase: '1' }, ['m', 'mtr', 'mtrs', 'metre', 'metres', 'meter', 'meters', 'rm', 'rmt', 'r m', 'running metre', 'running meter', 'lm', 'lmt']],
  [{ code: 'MM', dimension: 'LENGTH', toBase: '0.001' }, ['mm']],
  [{ code: 'FT', dimension: 'LENGTH', toBase: '0.3048' }, ['ft', 'feet', 'foot', 'rft', 'r ft', 'running feet']],
  [{ code: 'SQM', dimension: 'AREA', toBase: '1' }, ['sqm', 'sq m', 'sqmt', 'sq mt', 'sq mtr', 'm2', 'sq metre', 'square metre', 'square meter', 'smt']],
  [{ code: 'SQFT', dimension: 'AREA', toBase: '0.09290304' }, ['sqft', 'sq ft', 'sft', 'ft2', 'square feet', 'sq feet']],
  [{ code: 'CUM', dimension: 'VOLUME', toBase: '1' }, ['cum', 'cu m', 'cumt', 'cu mt', 'm3', 'cbm', 'cubic metre', 'cubic meter']],
  [{ code: 'CFT', dimension: 'VOLUME', toBase: '0.028316846592' }, ['cft', 'cu ft', 'cubic feet', 'ft3']],
  [{ code: 'BRASS', dimension: 'VOLUME', toBase: '2.8316846592' }, ['brass']],
  [{ code: 'LTR', dimension: 'VOLUME', toBase: '0.001' }, ['ltr', 'ltrs', 'l', 'lit', 'litre', 'litres', 'liter', 'liters']],
  [{ code: 'KL', dimension: 'VOLUME', toBase: '1' }, ['kl', 'kilolitre', 'kiloliter']],
  [{ code: 'KG', dimension: 'WEIGHT', toBase: '1' }, ['kg', 'kgs', 'kilogram', 'kilograms', 'kilo']],
  [{ code: 'G', dimension: 'WEIGHT', toBase: '0.001' }, ['g', 'gm', 'gms', 'gram', 'grams']],
  [{ code: 'QTL', dimension: 'WEIGHT', toBase: '100' }, ['qtl', 'quintal', 'quintals']],
  [{ code: 'MT', dimension: 'WEIGHT', toBase: '1000' }, ['mt', 'ton', 'tons', 'tonne', 'tonnes', 't', 'm t', 'metric ton', 'metric tonne']],
  [{ code: 'HR', dimension: 'TIME', toBase: '1' }, ['hr', 'hrs', 'hour', 'hours']],
  [{ code: 'DAY', dimension: 'TIME', toBase: '8' }, ['day', 'days']],
];

const ALIASES = new Map<string, UnitDef>();
for (const [def, aliases] of DEFS) {
  ALIASES.set(def.code.toLowerCase(), def);
  for (const a of aliases) ALIASES.set(a, def);
}

const clean = (u: string) =>
  u
    .toLowerCase()
    .replace(/[.]/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Canonical unit for what was written ("Sq.ft" → SQFT), or null when the unit is not known. */
export function normalizeUnit(unit: string | null | undefined): UnitDef | null {
  if (!unit) return null;
  const c = clean(unit);
  return ALIASES.get(c) ?? ALIASES.get(c.replace(/ /g, '')) ?? (c.endsWith('s') ? (ALIASES.get(c.slice(0, -1)) ?? null) : null);
}

/**
 * Factor f so that a quantity in `from` equals qty × f in `to` (Kg → MT is 0.001).
 * 1 when both are the same text, null when the units cannot be compared (Bag → Kg, Nos → Sqm, unknown units).
 */
export function unitFactor(from: string | null | undefined, to: string | null | undefined): Decimal | null {
  if (!from || !to) return null;
  if (clean(from) === clean(to)) return new Decimal(1);
  const a = normalizeUnit(from);
  const b = normalizeUnit(to);
  if (!a || !b || a.dimension !== b.dimension) return null;
  return new Decimal(a.toBase).div(b.toBase);
}

// ── Matching a free-text line (BOM, quotation…) to the material master ──────────────────────────

const STOP = new Set(['for', 'of', 'the', 'and', 'with', 'in', 'to', 'a', 'an', 'as', 'per', 'type', 'grade', 'supply', 'supplying', 'providing', 'material', 'materials']);

/**
 * Lower-case words. A size written with its unit is split ("12mm" → "12", "mm") so sizes compare as
 * numbers; grade codes that start with letters stay whole ("Fe500D", "M20").
 */
export function materialTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9.]+/)
    .map((t) => t.replace(/^\.+|\.+$/g, ''))
    .flatMap((t) => {
      const m = /^(\d+(?:\.\d+)?)([a-z]+)$/.exec(t);
      return m ? [m[1], m[2]] : [t];
    })
    .filter((t) => t && !STOP.has(t));
}

const isNumber = (t: string) => /^\d+(\.\d+)?$/.test(t);

export interface MaterialRef {
  id: string;
  code: string;
  name: string;
}

/**
 * The material a line describes, or null when unsure. Exact name or code wins. Otherwise the material
 * whose words mostly appear in the line (at least 60 % of its words and two words in common), whose
 * sizes (plain numbers such as 12 in "12 mm" or 53 in "OPC 53") all appear in the line, and only when
 * exactly one material scores best.
 * Deliberately cautious: an unlinked line is easy to link by hand; a wrong link silently prices the line.
 */
export function matchMaterial<T extends MaterialRef>(description: string, materials: readonly T[]): T | null {
  const d = description.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!d) return null;
  const exact = materials.find((m) => m.name.trim().toLowerCase().replace(/\s+/g, ' ') === d || m.code.trim().toLowerCase() === d);
  if (exact) return exact;
  const dt = new Set(materialTokens(description));
  let best: { m: T; score: number; common: number } | null = null;
  let tie = false;
  for (const m of materials) {
    const mt = [...new Set(materialTokens(m.name))];
    if (!mt.length) continue;
    const common = mt.filter((t) => dt.has(t)).length;
    const score = common / mt.length;
    if (common < 2 || score < 0.6) continue;
    if (!mt.filter(isNumber).every((n) => dt.has(n))) continue;
    if (!best || score > best.score || (score === best.score && common > best.common)) {
      best = { m, score, common };
      tie = false;
    } else if (score === best.score && common === best.common) tie = true;
  }
  return best && !tie ? best.m : null;
}
