import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { MulterError } from 'multer';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { databaseSource } from '../lib/dbUrl.js';

/** Standard error envelope: { error: { code, message, details? } }. Never leaks internals. */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof MulterError) {
    return res.status(400).json({ error: { code: 'UPLOAD_ERROR', message: err.code === 'LIMIT_FILE_SIZE' ? 'File is too large' : err.message } });
  }
  // Deployment/configuration problems: say what to fix (no connection details are revealed).
  const db = databaseProblem(err);
  if (db) {
    logger.error({ err, path: req.path }, 'database unavailable');
    return res.status(503).json({ error: db });
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

/** Recognises "database not connected" and "tables not created" so the UI can show the fix. */
export function databaseProblem(err: unknown): { code: string; message: string } | null {
  if (!databaseSource) {
    return { code: 'DATABASE_NOT_CONFIGURED', message: 'No database is connected to this deployment. In Vercel: Storage → create or connect a Neon Postgres database with "Production" ticked, then Deployments → Redeploy.' };
  }
  if (err instanceof Prisma.PrismaClientInitializationError || (err instanceof Error && /Can't reach database server|P1001|P1000|P1003|P1017/.test(err.message))) {
    const code = (err as { errorCode?: string }).errorCode ?? (err as Error).message.match(/P10\d\d/)?.[0] ?? 'unknown';
    const hint = code === 'P1000' ? 'the database user or password was rejected' : code === 'P1003' ? 'the database name does not exist' : 'the database server did not respond (it may be paused or still waking up)';
    return { code: 'DATABASE_UNAVAILABLE', message: `A database is configured (${databaseSource}) but the server cannot connect: ${hint}${code === 'unknown' ? '' : ` [${code}]`}. Open Vercel → Storage → your database and check it is active, then try again in a minute.` };
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2021' || err.code === 'P2022')) {
    return { code: 'DATABASE_NOT_MIGRATED', message: 'The database has not been set up yet. Redeploy the project (Deployments → ⋯ → Redeploy) so the tables are created.' };
  }
  return null;
}
