import path from 'node:path';

function num(v: string | undefined, d: number) {
  const n = Number(v);
  return Number.isFinite(n) && v !== undefined && v !== '' ? n : d;
}

const env = process.env;
const isTest = env.NODE_ENV === 'test' || env.VITEST === 'true';
/** Seeding drives the API in-process: relax rate limits and quieten request logs. */
const isSeed = env.SEED_MODE === 'true';

export const config = {
  env: env.NODE_ENV ?? 'development',
  isProd: env.NODE_ENV === 'production',
  isTest,
  port: num(env.API_PORT, 4000),
  databaseUrl: env.DATABASE_URL ?? '',
  corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean),
  sessionTtlHours: num(env.SESSION_TTL_HOURS, 12),
  sessionIdleHours: num(env.SESSION_IDLE_HOURS, 4),
  cookieSecure: env.COOKIE_SECURE === 'true' || env.NODE_ENV === 'production',
  cookieName: 'tr_session',
  storageDriver: env.STORAGE_DRIVER ?? 'local',
  storageDir: path.resolve(env.STORAGE_DIR ?? './storage'),
  maxUploadBytes: num(env.MAX_UPLOAD_MB, 15) * 1024 * 1024,
  smtpUrl: env.SMTP_URL ?? '',
  appBaseUrl: env.APP_BASE_URL ?? 'http://localhost:5173',
  logLevel: isSeed ? 'warn' : (env.LOG_LEVEL ?? (isTest ? 'silent' : 'info')),
  relaxedLimits: isTest || isSeed,
  /** Disable the in-process job scheduler (tests). */
  disableJobs: isTest || env.DISABLE_JOBS === 'true',
};
