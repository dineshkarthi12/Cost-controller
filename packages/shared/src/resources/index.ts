import type { ResourceDef } from './types.js';
import * as site from './site.js';
import * as quantities from './quantities.js';
import * as materials from './materials.js';
import * as finance from './finance.js';
import * as commercial from './commercial.js';
import * as quality from './quality.js';

export * from './types.js';
export * from './schema.js';
export { SHIFTS, WORKER_CATEGORIES } from './site.js';
export { COST_CATEGORIES } from './quantities.js';
export { PARTY_KINDS } from './materials.js';
export { EXPENSE_CATEGORIES } from './finance.js';

function collect(mod: Record<string, unknown>): ResourceDef[] {
  return Object.values(mod).filter((v): v is ResourceDef => typeof v === 'object' && v !== null && 'model' in v && 'fields' in v);
}

export const RESOURCES: Record<string, ResourceDef> = Object.fromEntries(
  [site, quantities, materials, finance, commercial, quality].flatMap(collect).map((r) => [r.key, r]),
);

export function getResource(key: string): ResourceDef | undefined {
  return RESOURCES[key];
}

export function lineFields(def: ResourceDef) {
  return def.fields.filter((f) => f.type === 'lines');
}
