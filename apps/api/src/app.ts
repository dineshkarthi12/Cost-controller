import { timingSafeEqual } from 'node:crypto';
import express, { Router } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { requireAuth, requireCsrfHeader, ctxOf } from './middleware/auth.js';
import { databaseProblem, errorHandler } from './middleware/errors.js';
import { databaseSource } from './lib/dbUrl.js';
import { registerAllHandlers } from './services/handlers/index.js';
import { authRouter } from './routes/auth.js';
import { projectsRouter } from './routes/projects.js';
import { lookupsRouter } from './routes/lookups.js';
import { resourceRouter } from './resources/router.js';
import { approvalsRouter } from './routes/approvals.js';
import { budgetRouter } from './routes/budget.js';
import { measurementsRouter } from './routes/measurements.js';
import { procurementRouter } from './routes/procurement.js';
import { stockRouter } from './routes/stock.js';
import { billingRouter } from './routes/billing.js';
import { filesRouter, projectFilesRouter } from './routes/files.js';
import { myTasksRouter, projectTasksRouter } from './routes/tasks.js';
import { documentsRouter } from './routes/documents.js';
import { periodsRouter } from './routes/periods.js';
import { notificationsRouter } from './routes/notifications.js';
import { adminRouter } from './routes/admin.js';
import { reportsRouter, portfolioRouter } from './routes/reports.js';
import { searchRouter } from './routes/search.js';
import { importsRouter } from './routes/imports.js';
import { manpowerRouter } from './routes/manpower.js';
import { scheduleRouter } from './routes/schedule.js';
import { runAllJobs } from './jobs.js';
import { assertCan } from './services/access.js';

registerAllHandlers();

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], imgSrc: ["'self'", 'data:', 'blob:'], frameAncestors: ["'none'"] } }, crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cors({ origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin)), credentials: true, allowedHeaders: ['Content-Type', 'X-Requested-With', 'Idempotency-Key'] }));
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' }, customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info') }));
  app.use('/api', rateLimit({ windowMs: 60_000, limit: config.relaxedLimits ? 100_000 : 600, standardHeaders: 'draft-7', legacyHeaders: false }));

  app.get('/api/health', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      // Also confirms migrations ran and at least one user exists (yes/no only; nothing sensitive).
      const hasUsers = (await prisma.user.count()) > 0;
      res.json({ status: 'ok', time: new Date().toISOString(), database: 'connected', databaseVariable: databaseSource, setup: hasUsers ? 'complete' : 'no users yet: set SEED_PASSWORD and redeploy', storage: config.storageDriver });
    } catch (err) {
      const problem = databaseProblem(err) ?? { code: 'ERROR', message: 'Health check failed' };
      res.status(503).json({ status: 'error', ...problem, databaseVariable: databaseSource, storage: config.storageDriver });
    }
  });

  // Scheduled jobs for serverless hosts (Vercel Cron sends "Authorization: Bearer $CRON_SECRET").
  // Disabled unless CRON_SECRET is configured.
  app.get('/api/cron/jobs', async (req, res) => {
    const expected = Buffer.from(`Bearer ${config.cronSecret}`);
    const given = Buffer.from(req.get('authorization') ?? '');
    if (!config.cronSecret || given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } });
    }
    res.json(await runAllJobs());
  });

  app.use('/api', requireCsrfHeader);
  app.use('/api/auth', authRouter);

  const api = Router();
  api.use(requireAuth);
  api.use('/projects', projectsRouter);
  api.use('/projects/:projectId/r', resourceRouter(true));
  api.use('/org/r', resourceRouter(false));
  api.use('/projects/:projectId/lookups', lookupsRouter);
  api.use('/lookups', lookupsRouter);
  api.use('/projects/:projectId', budgetRouter);
  api.use('/projects/:projectId/measurements', measurementsRouter);
  api.use('/projects/:projectId/procurement', procurementRouter);
  api.use('/projects/:projectId/stock', stockRouter);
  api.use('/projects/:projectId/billing', billingRouter);
  api.use('/projects/:projectId', projectFilesRouter);
  api.use('/projects/:projectId/tasks', projectTasksRouter);
  api.use('/projects/:projectId', documentsRouter);
  api.use('/projects/:projectId', periodsRouter);
  api.use('/projects/:projectId', reportsRouter);
  api.use('/projects/:projectId/manpower', manpowerRouter);
  api.use('/projects/:projectId/schedule', scheduleRouter);
  api.use('/portfolio', portfolioRouter);
  api.use('/files', filesRouter);
  api.use('/my/tasks', myTasksRouter);
  api.use('/approvals', approvalsRouter);
  api.use('/notifications', notificationsRouter);
  api.use('/admin', adminRouter);
  api.use('/imports', importsRouter);
  api.use('/search', searchRouter);
  api.post('/system/run-jobs', async (req, res) => {
    assertCan(ctxOf(req), 'settings.manage');
    res.json(await runAllJobs());
  });
  app.use('/api', api);

  app.use('/api', (_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } }));
  app.use(errorHandler);
  return app;
}
