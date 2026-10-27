/* eslint-disable @typescript-eslint/no-explicit-any */
import request from 'supertest';
import { SMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { afterCommit, transaction } from '../src/lib/prisma.js';
import { app, approveAll, day, setupWorld, type World } from './helpers.js';

interface Mail { to: string; subject: string; text: string; from: string }
const inbox: Mail[] = [];
let server: SMTPServer;
let w: World;

const waitFor = async (pred: (m: Mail) => boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const m = inbox.find(pred);
    if (m) return m;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`no matching email; inbox: ${JSON.stringify(inbox.map((m) => [m.to, m.subject]))}`);
};

beforeAll(async () => {
  server = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS'],
    onData(stream, _session, cb) {
      simpleParser(stream).then((p) => {
        const to = Array.isArray(p.to) ? p.to.map((x) => x.text).join(',') : (p.to?.text ?? '');
        inbox.push({ to, subject: p.subject ?? '', text: p.text ?? '', from: p.from?.text ?? '' });
        cb();
      }, cb);
    },
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.server.address() as { port: number }).port;
  Object.assign(process.env, { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(port), EMAIL_FROM: 'TOPROCK GLOBAL <noreply@test.example>' });
  w = await setupWorld();
});

afterAll(async () => {
  for (const k of ['SMTP_HOST', 'SMTP_PORT', 'EMAIL_FROM']) delete process.env[k];
  await new Promise<void>((r) => server.close(() => r()));
});

describe('email delivery (SMTP)', () => {
  it('admin test email reaches the signed-in administrator', async () => {
    const r = await w.c.admin.ok.post('/admin/email/test');
    expect(r).toMatchObject({ sent: true, to: w.users.admin.email });
    const m = await waitFor((x) => x.to.includes(w.users.admin.email) && x.subject === 'TOPROCK test email');
    expect(m.from).toContain('noreply@test.example');
  });

  it('an invitation is emailed with a one-time link instead of being shown on screen', async () => {
    const email = `new.${w.tag.toLowerCase()}@test.example`;
    const r = await w.c.admin.ok.post('/admin/users/invite', { name: 'New Engineer', email, roleCodes: ['SITE_ENGINEER'] });
    expect(r.emailSent).toBe(true);
    expect(r.inviteLink).toBeUndefined();
    const m = await waitFor((x) => x.to.includes(email));
    expect(m.subject).toMatch(/invited/i);
    expect(m.text).toMatch(/\/accept-invitation\?token=[A-Za-z0-9_-]{20,}/);
  });

  it('approvers get an email when a document waits for them', async () => {
    const e = await w.c.ap.ok.post(`${w.P}/r/expenses`, { date: day(0), category: 'SITE_OVERHEAD', costCodeId: w.cc.other.id, payeeName: 'Vendor', description: 'Email test', amountBeforeTax: '1200', taxRate: '0' });
    await w.c.ap.ok.post(`${w.P}/r/expenses/${e.id}/submit`);
    const m = await waitFor((x) => x.to.includes(w.users.pm.email) && /approval/i.test(x.subject));
    expect(m.text).toContain('Open in TOPROCK');
    await approveAll(w, e.id, ['pm']);
  });

  it('password reset is emailed (same response whether or not the account exists)', async () => {
    const r1 = await request(app).post('/api/auth/password/forgot').set('X-Requested-With', 'toprock').send({ email: w.users.qs.email });
    const r2 = await request(app).post('/api/auth/password/forgot').set('X-Requested-With', 'toprock').send({ email: 'nobody@test.example' });
    expect(r1.body).toEqual({ ok: true });
    expect(r2.body).toEqual({ ok: true });
    const m = await waitFor((x) => x.to.includes(w.users.qs.email) && /reset/i.test(x.subject));
    expect(m.text).toMatch(/\/reset-password\?token=/);
    expect(inbox.some((x) => x.to.includes('nobody@test.example'))).toBe(false);
  });

  it('nothing is emailed when the transaction rolls back', async () => {
    let sent = false;
    await expect(transaction(async () => {
      afterCommit(() => { sent = true; });
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    expect(sent).toBe(false);
    await transaction(async () => afterCommit(() => { sent = true; }));
    expect(sent).toBe(true);
  });

  it('without SMTP settings the invitation link is shown to the administrator instead', async () => {
    const saved = process.env.SMTP_HOST;
    delete process.env.SMTP_HOST;
    try {
      const r = await w.c.admin.ok.post('/admin/users/invite', { name: 'No Mail', email: `nomail.${w.tag.toLowerCase()}@test.example`, roleCodes: [] });
      expect(r.emailSent).toBe(false);
      expect(r.inviteLink).toMatch(/\/accept-invitation\?token=/);
    } finally {
      process.env.SMTP_HOST = saved;
    }
  });
});
