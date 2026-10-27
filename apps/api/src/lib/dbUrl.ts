/**
 * Finds the Postgres connection string under the names hosting integrations use:
 * DATABASE_URL (Neon), POSTGRES_PRISMA_URL / POSTGRES_URL (Vercel Postgres, Supabase), or the same
 * names with a custom prefix (e.g. STORAGE_DATABASE_URL). Returns the variable *name* too so health
 * checks can say where it came from without revealing the value.
 */
const RUNTIME_NAMES = ['DATABASE_URL', 'POSTGRES_PRISMA_URL', 'POSTGRES_URL'];
const DIRECT_NAMES = ['DATABASE_URL_UNPOOLED', 'POSTGRES_URL_NON_POOLING', 'DATABASE_URL_NON_POOLING'];

function find(names: string[], env: NodeJS.ProcessEnv): { name: string; url: string } | null {
  for (const n of names) if (env[n]?.startsWith('postgres')) return { name: n, url: env[n]! };
  for (const n of names) {
    const key = Object.keys(env).find((k) => k.endsWith(`_${n}`) && env[k]?.startsWith('postgres'));
    if (key) return { name: key, url: env[key]! };
  }
  return null;
}

/** Adds parameters needed on serverless hosts. Never removes anything the provider set. */
export function tuneUrl(url: string): string {
  const add: string[] = [];
  // Poolers (PgBouncer, Neon "-pooler" hosts) do not support named prepared statements.
  if ((/-pooler\./.test(url) || /pooler\.supabase\.com/.test(url)) && !/[?&]pgbouncer=/.test(url)) add.push('pgbouncer=true');
  // Neon suspends idle databases; waking up can take longer than Prisma's 5 s default.
  if (/neon\.tech/.test(url) && !/[?&]connect_timeout=/.test(url)) add.push('connect_timeout=30');
  return add.length ? `${url}${url.includes('?') ? '&' : '?'}${add.join('&')}` : url;
}

export function resolveDatabaseUrl(env: NodeJS.ProcessEnv = process.env) {
  return find(RUNTIME_NAMES, env);
}

export function resolveDirectDatabaseUrl(env: NodeJS.ProcessEnv = process.env) {
  return find(DIRECT_NAMES, env) ?? find(RUNTIME_NAMES, env);
}

const resolved = resolveDatabaseUrl();
/** Name of the variable the connection string came from (null when none is configured). */
export const databaseSource = resolved?.name ?? null;
/** Final connection string used by Prisma (undefined when none is configured). */
export const databaseUrl = resolved ? tuneUrl(resolved.url) : undefined;
// Prisma's schema reads env("DATABASE_URL"); keep it consistent with what was resolved.
if (databaseUrl) process.env.DATABASE_URL = databaseUrl;
