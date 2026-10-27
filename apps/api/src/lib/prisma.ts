import { AsyncLocalStorage } from 'node:async_hooks';
import { PrismaClient, Prisma } from '@prisma/client';
import { databaseUrl } from './dbUrl.js';

export const prisma = new PrismaClient(databaseUrl ? { datasourceUrl: databaseUrl } : undefined);
export type Tx = Prisma.TransactionClient;
export type Db = PrismaClient | Tx;
export { Prisma };

const afterCommitStore = new AsyncLocalStorage<Array<() => void>>();

/**
 * Runs `fn` after the surrounding transaction commits (immediately when there is none).
 * Use for side effects outside the database, such as email, that must not happen on rollback.
 */
export function afterCommit(fn: () => void) {
  const queue = afterCommitStore.getStore();
  if (queue) queue.push(fn);
  else fn();
}

/** Runs fn inside a serializable-safe interactive transaction with sane timeouts. */
export async function transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const queue: Array<() => void> = [];
  const result = await afterCommitStore.run(queue, () => prisma.$transaction(fn, { timeout: 30_000, maxWait: 10_000 }));
  for (const cb of queue) {
    try {
      cb();
    } catch {
      /* side effects never undo a committed transaction */
    }
  }
  return result;
}
