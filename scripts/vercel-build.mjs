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

// Same lookup as apps/api/src/lib/dbUrl.ts: Neon (DATABASE_URL), Vercel Postgres / Supabase
// (POSTGRES_PRISMA_URL, POSTGRES_URL), or those names with a custom prefix.
function find(names) {
  const env = process.env;
  for (const n of names) if (env[n]?.startsWith('postgres')) return { name: n, url: env[n] };
  for (const n of names) {
    const key = Object.keys(env).find((k) => k.endsWith(`_${n}`) && env[k]?.startsWith('postgres'));
    if (key) return { name: key, url: env[key] };
  }
  return null;
}
const runtime = find(['DATABASE_URL', 'POSTGRES_PRISMA_URL', 'POSTGRES_URL']);
const directFound = find(['DATABASE_URL_UNPOOLED', 'POSTGRES_URL_NON_POOLING', 'DATABASE_URL_NON_POOLING']) ?? runtime;

if (!runtime) {
  const seen = Object.keys(process.env).filter((k) => k.startsWith('PG') || /DATABASE|POSTGRES/.test(k));
  console.warn(`\n⚠ No database connection variable found (looked for DATABASE_URL, POSTGRES_PRISMA_URL, POSTGRES_URL${seen.length ? `; related variables present: ${seen.join(', ')}` : ''}).`);
  console.warn('  Skipping migrations and seed. In Vercel: Storage → connect a Neon Postgres database (Production ticked), then Redeploy.');
  process.exit(0);
}
// Migrations and seeding need a direct (non-pooled) connection. Neon may need time to wake up.
const withTimeout = (u) => (/neon\.tech/.test(u) && !/[?&]connect_timeout=/.test(u) ? `${u}${u.includes('?') ? '&' : '?'}connect_timeout=30` : u);
const direct = withTimeout(directFound.url);
console.log(`\nDatabase: using ${directFound.name} for migrations, ${runtime.name} at runtime.`);
run('npx prisma migrate deploy', 'apps/api', { DATABASE_URL: direct });

if (!process.env.SEED_PASSWORD) {
  console.warn('\n⚠ SEED_PASSWORD is not set: skipping seed. Set SEED_PASSWORD (12+ characters) to create the admin user, then redeploy.');
  process.exit(0);
}
// Reference data + admin always; demo data only when SEED_DEMO=true. Existing data is never overwritten.
run('npx tsx prisma/seed.ts', 'apps/api', { DATABASE_URL: direct, SEED_MODE: 'true', SEED_DEMO: process.env.SEED_DEMO === 'true' ? 'true' : 'false' });
