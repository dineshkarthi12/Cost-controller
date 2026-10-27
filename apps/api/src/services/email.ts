/**
 * Outgoing email over SMTP (Gmail, Microsoft 365, or any SMTP server). Configured only through
 * environment variables, so switching from a personal Gmail to the company mailbox is a settings
 * change, not a code change:
 *   SMTP_HOST, SMTP_PORT (465 = TLS, 587 = STARTTLS), SMTP_USER, SMTP_PASS, EMAIL_FROM
 *   or a single SMTP_URL such as smtps://user:pass@smtp.gmail.com:465
 * Without configuration nothing is sent and the attempt is logged.
 */
import nodemailer, { type Transporter } from 'nodemailer';
import { waitUntil } from '@vercel/functions';
import { logger } from '../lib/logger.js';
import { config } from '../config.js';

export interface EmailMessage {
  to: string | string[];
  subject: string;
  /** Plain-text body; an HTML version is generated from it. */
  text: string;
  /** Optional call-to-action link and label. */
  action?: { url: string; label: string };
}

function settings() {
  const env = process.env;
  const url = env.SMTP_URL?.trim();
  const host = env.SMTP_HOST?.trim();
  if (!url && !host) return null;
  const user = env.SMTP_USER?.trim();
  // Google shows app passwords in groups of four ("abcd efgh ijkl mnop"); spaces are not part of it.
  const pass = env.SMTP_PASS?.replace(/\s+/g, '');
  const port = Number(env.SMTP_PORT ?? 465);
  const from = env.EMAIL_FROM?.trim() || (user ? `TOPROCK GLOBAL <${user}>` : '');
  return { url, host, port, user, pass, from };
}

export function emailConfigured() {
  const s = settings();
  return !!s && !!s.from;
}

/** Safe description of the configuration for the admin screen (never the password). */
export function emailStatus() {
  const s = settings();
  if (!s) return { configured: false as const };
  const host = s.host ?? (() => { try { return new URL(s.url!).hostname; } catch { return 'invalid SMTP_URL'; } })();
  return { configured: true as const, host, from: s.from };
}

let transporter: Transporter | null = null;
let transporterKey = '';
function getTransport(): Transporter {
  const s = settings()!;
  const key = JSON.stringify(s);
  if (!transporter || key !== transporterKey) {
    transporter = s.url
      ? nodemailer.createTransport(s.url)
      : nodemailer.createTransport({ host: s.host, port: s.port, secure: s.port === 465, auth: s.user ? { user: s.user, pass: s.pass } : undefined, connectionTimeout: 15_000, socketTimeout: 20_000 });
    transporterKey = key;
  }
  return transporter;
}

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function html(m: EmailMessage) {
  const paras = m.text.split(/\n{2,}/).map((p) => `<p style="margin:0 0 12px">${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
  const button = m.action ? `<p style="margin:20px 0"><a href="${esc(m.action.url)}" style="background:#123a7a;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">${esc(m.action.label)}</a></p><p style="font-size:12px;color:#5b6475">Or open: ${esc(m.action.url)}</p>` : '';
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1c2333;font-size:14px;line-height:1.5"><div style="border-bottom:3px solid #123a7a;padding:12px 0;margin-bottom:16px"><strong style="color:#123a7a;font-size:16px;letter-spacing:.5px">TOPROCK GLOBAL</strong><span style="color:#5b6475;font-size:12px"> · Construction Cost Control</span></div>${paras}${button}<p style="font-size:11px;color:#8a93a3;border-top:1px solid #e3e8f0;padding-top:10px;margin-top:24px">Automated message from the TOPROCK GLOBAL cost control system. Do not reply.</p></div>`;
}

/** Sends now and reports the result. Used by the admin "send test email" action. */
export async function sendEmailNow(m: EmailMessage): Promise<{ sent: boolean; error?: string }> {
  if (!emailConfigured()) {
    logger.info({ to: m.to, subject: m.subject }, 'email not configured — not sent');
    return { sent: false, error: 'Email is not configured' };
  }
  try {
    const action = m.action ? `\n\n${m.action.label}: ${m.action.url}` : '';
    await getTransport().sendMail({ from: settings()!.from, to: m.to, subject: m.subject, text: `${m.text}${action}`, html: html(m) });
    return { sent: true };
  } catch (err) {
    const error = (err as Error).message;
    logger.error({ err: error, to: m.to, subject: m.subject }, 'email send failed');
    return { sent: false, error };
  }
}

/**
 * Fire-and-forget send. On Vercel the function is kept alive until the send finishes.
 * Failures are logged; they never break the business operation that triggered them.
 */
export function sendEmail(m: EmailMessage) {
  const p = sendEmailNow(m);
  try {
    waitUntil(p);
  } catch {
    /* not on Vercel */
  }
  return p;
}

/** Absolute link into the web app. */
export const appLink = (path: string) => `${config.appBaseUrl.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
