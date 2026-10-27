/**
 * Vercel build: web app, API bundle, then (when a database is connected) migrations and the
 * idempotent seed. Runs from the repository root. Safe to run on every deployment.
 */
import { execSync } from 'node:child_process';

const run = (cmd, cwd = '.', extraEnv = {}) => {
  console.log(`\n▶ ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit', env: { ...process.env, ...extraEnv } });
};

run('npm run build -w @toprock/web');
run('npx prisma generate', 'apps/api');
run('npx tsup', 'apps/api');

if (!process.env.DATABASE_URL) {
  console.warn('\n⚠ DATABASE_URL is not set: skipping migrations and seed. Connect a Postgres database (Vercel → Storage) and redeploy.');
  process.exit(0);
}

// Migrations and seeding need a direct (non-pooled) connection; Vercel/Neon provides it as *_UNPOOLED.
const direct = process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL;
run('npx prisma migrate deploy', 'apps/api', { DATABASE_URL: direct });

if (!process.env.SEED_PASSWORD) {
  console.warn('\n⚠ SEED_PASSWORD is not set: skipping seed. Set SEED_PASSWORD (12+ characters) to create the admin user, then redeploy.');
  process.exit(0);
}
// Reference data + admin always; demo data only when SEED_DEMO=true. Existing data is never overwritten.
run('npx tsx prisma/seed.ts', 'apps/api', { DATABASE_URL: direct, SEED_MODE: 'true', SEED_DEMO: process.env.SEED_DEMO === 'true' ? 'true' : 'false' });
