import fsp from 'node:fs/promises';
import path from 'node:path';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, day, PASSWORD, prisma, setupWorld, type World } from './helpers.js';

/** A file missing from local storage must fail that one request (404), not stop the server. */
let w: World;
let agent: ReturnType<typeof request.agent>;
beforeAll(async () => {
  w = await setupWorld();
  agent = request.agent(app);
  await agent.post('/api/auth/login').set('X-Requested-With', 'toprock').send({ email: w.users.se.email, password: PASSWORD });
});

describe('missing stored file', () => {
  it('answers 404 and keeps serving', async () => {
    const mr = await w.c.se.ok.post(`${w.P}/r/mrs`, { department: 'Site', requiredBy: day(5), priority: 'LOW', costCodeId: w.cc.material.id, lines: [{ materialId: w.cement.id, qty: '1', unit: 'BAG' }] });
    const up = await agent.post(`/api${w.P}/attachments`).set('X-Requested-With', 'toprock').field('entityType', 'materialRequisition').field('entityId', mr.id).attach('files', Buffer.from('%PDF-1.4\n%%EOF\n'), { filename: 'a.pdf', contentType: 'application/pdf' });
    expect(up.status).toBe(201);
    const file = await prisma.fileObject.findUniqueOrThrow({ where: { id: up.body[0].fileId } });
    const get = (id: string) => agent.get(`/api/files/${id}`).set('X-Requested-With', 'toprock');
    expect((await get(file.id)).status).toBe(200);

    await fsp.rm(path.resolve('./storage-test', file.storageKey));
    const r = await get(file.id);
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('FILE_MISSING');
    expect((await agent.get('/api/auth/me').set('X-Requested-With', 'toprock')).status).toBe(200);
  });
});
