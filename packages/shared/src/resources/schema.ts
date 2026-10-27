import { z } from 'zod';
import type { FieldDef, ResourceDef } from './types.js';

const decimalString = (dp: number) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => (typeof v === 'number' ? String(v) : v.trim()))
    .refine((v) => /^-?\d+(\.\d+)?$/.test(v), { message: 'Must be a number' })
    .refine((v) => (v.split('.')[1]?.length ?? 0) <= dp, { message: `At most ${dp} decimal places` })
    .refine((v) => v.replace('-', '').split('.')[0].length <= 16, { message: 'Number too large' });

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}/, 'Use YYYY-MM-DD')
  .refine((v) => !Number.isNaN(new Date(v).getTime()), 'Invalid date');

function fieldSchema(f: FieldDef): z.ZodTypeAny {
  let s: z.ZodTypeAny;
  switch (f.type) {
    case 'text':
    case 'textarea': {
      let t = z.string().trim().max(f.maxLength ?? (f.type === 'text' ? 300 : 10000));
      if (f.required) t = t.min(1, `${f.label} is required`);
      s = t;
      break;
    }
    case 'int': {
      let n = z.coerce.number().int();
      if (f.min !== undefined) n = n.min(f.min);
      if (f.max !== undefined) n = n.max(f.max);
      s = n;
      break;
    }
    case 'decimal':
      s = decimalString(4);
      break;
    case 'money':
      s = decimalString(2);
      break;
    case 'percent':
      s = decimalString(6);
      break;
    case 'date':
    case 'datetime':
      s = dateString;
      break;
    case 'select':
      s = z.enum(f.options as [string, ...string[]]);
      break;
    case 'boolean':
      s = z.boolean();
      break;
    case 'ref':
      s = z.string().min(1, `${f.label} is required`).max(64);
      break;
    case 'tags':
      s = z.array(z.string().trim().min(1).max(200)).max(100);
      break;
    case 'lines': {
      const inner = buildObjectSchema(f.lines ?? [], 'create');
      let arr = z.array(inner).max(500);
      if (f.required) arr = arr.min(1, `Add at least one ${f.label.toLowerCase()} line`);
      s = arr;
      break;
    }
    default:
      s = z.any();
  }
  if (f.type === 'decimal' || f.type === 'money' || f.type === 'percent') {
    if (f.min !== undefined) s = (s as z.ZodType<string>).refine((v) => Number(v) >= (f.min as number), `${f.label} must be ≥ ${f.min}`);
    if (f.max !== undefined) s = (s as z.ZodType<string>).refine((v) => Number(v) <= (f.max as number), `${f.label} must be ≤ ${f.max}`);
  }
  if (!f.required) {
    // Empty strings from forms become null for optional fields.
    s = z.preprocess((v) => (v === '' ? null : v), s.nullable().optional());
  }
  return s;
}

/** Builds a Zod object schema from field definitions. Read-only fields are excluded. */
export function buildObjectSchema(fields: FieldDef[], mode: 'create' | 'update'): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of fields) {
    if (f.readOnly) continue;
    if (mode === 'update' && f.createOnly) continue;
    let s = fieldSchema(f);
    if (mode === 'update') s = s.optional();
    shape[f.name] = s;
  }
  return z.object(shape).strip();
}

export function buildResourceSchemas(def: ResourceDef) {
  return {
    create: buildObjectSchema(def.fields, 'create'),
    update: buildObjectSchema(def.fields, 'update'),
  };
}

export const zDecimal = decimalString;
export const zDate = dateString;
