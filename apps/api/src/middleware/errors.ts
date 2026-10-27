import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { MulterError } from 'multer';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

/** Standard error envelope: { error: { code, message, details? } }. Never leaks internals. */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof MulterError) {
    return res.status(400).json({ error: { code: 'UPLOAD_ERROR', message: err.code === 'LIMIT_FILE_SIZE' ? 'File is too large' : err.message } });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const target = (err.meta?.target as string[] | undefined)?.join(', ');
      return res.status(409).json({ error: { code: 'DUPLICATE', message: `A record with the same ${target ?? 'unique value'} already exists`, details: { target } } });
    }
    if (err.code === 'P2003') return res.status(409).json({ error: { code: 'REFERENCE', message: 'This record is referenced by other records or references a missing record' } });
    if (err.code === 'P2025') return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Record not found' } });
  }
  if (err instanceof SyntaxError && 'body' in (err as object)) {
    return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Malformed JSON body' } });
  }
  logger.error({ err, path: req.path, method: req.method }, 'unhandled error');
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong. The error has been logged.' } });
}
