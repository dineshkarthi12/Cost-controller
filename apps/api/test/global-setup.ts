import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

/**
 * Prepares the dedicated test database: applies migrations (creating the database if needed)
 * and empties every table. Refuses to run against a database whose name does not end in _test.
 */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? '';
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (!dbName.endsWith('_test')) throw new Error(`Refusing to prepare "${dbName}": test database names must end with _test`);
  execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
  const db = new PrismaClient({ datasourceUrl: url });
  const tables = await db.$queryRaw<Array<{ tablename: string }>>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  await db.$disconnect();
}
