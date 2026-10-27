import { Router } from 'express';
import type { RefSource } from '@toprock/shared';
import { prisma } from '../lib/prisma.js';
import { ctxOf } from '../middleware/auth.js';
import { assertProjectAccess } from '../services/access.js';
import { LOOKUPS, resolveLabels, searchLookup } from '../services/lookups.js';
import { notFound } from '../lib/errors.js';

export const lookupsRouter = Router({ mergeParams: true });

/** GET /projects/:projectId/lookups/:source?q=&poId= — options for reference pickers. */
lookupsRouter.get('/:source', async (req, res) => {
  const ctx = ctxOf(req);
  const params = req.params as Record<string, string | undefined>;
  const projectId = params.projectId ? String(params.projectId) : null;
  if (projectId) await assertProjectAccess(prisma, ctx, projectId);
  const source = String(req.params.source) as RefSource;
  if (!LOOKUPS[source]) throw notFound('Lookup');
  if (LOOKUPS[source].scope === 'project' && !projectId) throw notFound('Lookup');
  if (typeof req.query.ids === 'string' && req.query.ids) {
    const labels = await resolveLabels(prisma, source, ctx.orgId, projectId, req.query.ids.split(',').slice(0, 100));
    return res.json([...labels.entries()].map(([value, label]) => ({ value, label })));
  }
  const extra: Record<string, unknown> = {};
  if (source === 'poLines' && typeof req.query.poId === 'string') extra.poId = req.query.poId;
  if (typeof req.query.status === 'string' && ['mrs', 'prs', 'purchaseOrders'].includes(source)) extra.status = { in: req.query.status.split(',') };
  if (source === 'users' && projectId && req.query.members === 'true') extra.memberships = { some: { projectId, isActive: true } };
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  res.json(await searchLookup(prisma, source, ctx.orgId, projectId, q, extra, Math.min(200, Number(req.query.limit ?? 50) || 50)));
});
