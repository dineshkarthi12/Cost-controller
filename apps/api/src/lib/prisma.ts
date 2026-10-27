import { PrismaClient, Prisma } from '@prisma/client';

/**
 * Through a PgBouncer-style pooler (e.g. Neon's "-pooler" host, used on Vercel) Prisma must not use
 * named prepared statements; `pgbouncer=true` turns them off. Direct connections are unchanged.
 */
function datasourceUrl(url = process.env.DATABASE_URL ?? '') {
  if (!url || !/-pooler\./.test(url) || /[?&]pgbouncer=/.test(url)) return undefined;
  return `${url}${url.includes('?') ? '&' : '?'}pgbouncer=true`;
}

export const prisma = new PrismaClient({ datasourceUrl: datasourceUrl() });
export type Tx = Prisma.TransactionClient;
export type Db = PrismaClient | Tx;
export { Prisma };

/** Runs fn inside a serializable-safe interactive transaction with sane timeouts. */
export function transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(fn, { timeout: 30_000, maxWait: 10_000 });
}
