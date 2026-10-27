import { PrismaClient, Prisma } from '@prisma/client';

export const prisma = new PrismaClient();
export type Tx = Prisma.TransactionClient;
export type Db = PrismaClient | Tx;
export { Prisma };

/** Runs fn inside a serializable-safe interactive transaction with sane timeouts. */
export function transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(fn, { timeout: 30_000, maxWait: 10_000 });
}
