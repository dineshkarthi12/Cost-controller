import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, login, PASSWORD, prisma, setupWorld, type World } from './helpers.js';

let w: World;
beforeAll(async () => {
  w = await setupWorld();
});

describe('authentication', () => {
  it('rejects unauthenticated API calls', async () => {
    const r = await request(app).get('/api/projects').set('X-Requested-With', 'toprock');
    expect(r.status).toBe(401);
  });

  it('rejects wrong passwords with a generic message', async () => {
    const r = await request(app).post('/api/auth/login').set('X-Requested-With', 'toprock').send({ email: w.users.qs.email, password: 'wrong-password' });
    expect(r.status).toBe(401);
    expect(JSON.stringify(r.body)).not.toMatch(/user not found|no such user/i);
  });

  it('requires the CSRF header on state-changing requests', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: w.users.qs.email, password: PASSWORD });
    expect(r.status).toBe(403);
  });

  it('sets an HttpOnly, SameSite session cookie and never returns the password hash', async () => {
    const r = await request(app).post('/api/auth/login').set('X-Requested-With', 'toprock').send({ email: w.users.pm.email, password: PASSWORD });
    expect(r.status).toBe(200);
    const cookie = String(r.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(JSON.stringify(r.body)).not.toMatch(/passwordHash|scrypt/);
  });

  it('locks the account after 5 failed attempts, even for the right password', async () => {
    const email = w.users.auditor.email;
    for (let i = 0; i < 5; i++) await request(app).post('/api/auth/login').set('X-Requested-With', 'toprock').send({ email, password: 'nope' });
    const r = await request(app).post('/api/auth/login').set('X-Requested-With', 'toprock').send({ email, password: PASSWORD });
    expect(r.status).toBe(403);
    expect(r.body.error.message).toMatch(/locked/i);
    await prisma.user.update({ where: { email }, data: { failedLogins: 0, lockedUntil: null } });
  });

  it('logout revokes the session server-side', async () => {
    const c = await login(w.users.se2.email);
    expect((await c.get('/auth/me')).status).toBe(200);
    await c.post('/auth/logout');
    expect((await c.get('/auth/me')).status).toBe(401);
  });

  it('deactivating a user revokes their existing sessions immediately', async () => {
    const victim = await login(w.users.qs.email);
    expect((await victim.get('/auth/me')).status).toBe(200);
    await w.c.admin.ok.post(`/admin/users/${w.users.qs.id}/deactivate`, { reason: 'Left the company' });
    expect((await victim.get('/auth/me')).status).toBe(401);
    await w.c.admin.ok.post(`/admin/users/${w.users.qs.id}/reactivate`);
  });
});

describe('scheduled jobs endpoint (Vercel Cron)', () => {
  it('runs only with the exact CRON_SECRET bearer token', async () => {
    expect((await request(app).get('/api/cron/jobs')).status).toBe(404);
    expect((await request(app).get('/api/cron/jobs').set('Authorization', 'Bearer wrong')).status).toBe(404);
    const ok = await request(app).get('/api/cron/jobs').set('Authorization', 'Bearer test-cron-secret-0123456789');
    expect(ok.status).toBe(200);
    expect(ok.body).toHaveProperty('approval escalations');
  });
});
