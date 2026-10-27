/**
 * Migrates, empties and seeds the dedicated e2e database, then exits.
 * Runs from apps/api before the e2e API server starts. Refuses any database not named *_e2e.
 */
import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

const url = process.env.DATABASE_URL ?? '';
const name = new URL(url).pathname.slice(1);
if (!name.endsWith('_e2e')) throw new Error(`Refusing to seed "${name}": e2e database names must end with _e2e`);
execSync('npx prisma migrate deploy', { stdio: 'pipe' });
const db = new PrismaClient();
const tables = await db.$queryRaw<Array<{ tablename: string }>>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
if (tables.length) await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
await db.$disconnect();
execSync('npx tsx prisma/seed.ts', { env: { ...process.env, SEED_MODE: 'true' }, stdio: 'pipe', timeout: 600_000 });
console.log(`e2e database ${name} migrated and seeded`);
