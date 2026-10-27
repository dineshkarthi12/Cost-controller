import type { Request } from 'express';
import type { z } from 'zod';
import { validationError } from './errors.js';

export function parseBody<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body ?? {});
  if (!r.success) throw validationError('Please correct the highlighted fields', r.error.flatten());
  return r.data;
}

export function param(req: Request, name: string): string {
  return String(req.params[name]);
}

export function pageParams(req: Request, max = 200) {
  const page = Math.max(1, Number(req.query.page ?? 1) || 1);
  const pageSize = Math.min(max, Math.max(1, Number(req.query.pageSize ?? 25) || 25));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export function qstr(req: Request, name: string): string | undefined {
  const v = req.query[name];
  return typeof v === 'string' && v !== '' ? v : undefined;
}
