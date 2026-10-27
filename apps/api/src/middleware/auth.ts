import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { sha256 } from '../lib/crypto.js';
import { unauthorized, forbidden } from '../lib/errors.js';
import { config } from '../config.js';
import { loadAccessContext, type AccessContext } from '../services/access.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      ctx?: AccessContext;
    }
  }
}

export async function resolveSession(token: string | undefined) {
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: { select: { status: true } } } });
  if (!session || session.revokedAt || session.mfaPending) return null;
  const now = Date.now();
  if (session.expiresAt.getTime() < now) return null;
  if (session.lastSeenAt.getTime() + config.sessionIdleHours * 3600_000 < now) return null;
  if (session.user.status !== 'ACTIVE') return null;
  if (now - session.lastSeenAt.getTime() > 60_000) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  }
  return session;
}

/** Requires a valid session and attaches the access context. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const session = await resolveSession(req.cookies?.[config.cookieName]);
  if (!session) throw unauthorized('Your session has expired. Please sign in again.');
  req.ctx = await loadAccessContext(session.userId, session.id, req);
  next();
}

/**
 * CSRF defence: state-changing requests must carry a custom header that browsers
 * will not send cross-origin without a CORS preflight (which our CORS policy rejects).
 */
export function requireCsrfHeader(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== 'toprock') throw forbidden('Missing request header');
  next();
}

export function ctxOf(req: Request): AccessContext {
  if (!req.ctx) throw unauthorized();
  return req.ctx;
}
