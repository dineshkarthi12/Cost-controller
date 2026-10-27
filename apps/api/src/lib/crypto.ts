import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, keylen: number, opts: crypto.ScryptOptions) => Promise<Buffer>;
const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** scrypt password hash: scrypt$N$r$p$salt$hash (base64). */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, 64, PARAMS);
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const [alg, N, r, p, saltB64, hashB64] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hashB64, 'base64');
  const key = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, { N: Number(N), r: Number(r), p: Number(p), maxmem: PARAMS.maxmem });
  return crypto.timingSafeEqual(key, expected);
}

export function passwordPolicyErrors(password: string): string[] {
  const errs: string[] = [];
  if (password.length < 10) errs.push('at least 10 characters');
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password)) errs.push('upper and lower case letters');
  if (!/\d/.test(password)) errs.push('a number');
  return errs;
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(v: string | Buffer): string {
  return crypto.createHash('sha256').update(v).digest('hex');
}

// ── TOTP (RFC 6238) for optional MFA ──
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of clean) {
    const idx = B32.indexOf(c);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

export function totp(secret: string, timeMs = Date.now(), step = 30, digits = 6): string {
  const counter = Math.floor(timeMs / 1000 / step);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const offset = h[h.length - 1] & 0xf;
  const code = ((h.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits).toString();
  return code.padStart(digits, '0');
}

export function verifyTotp(secret: string, code: string, window = 1): boolean {
  const now = Date.now();
  for (let w = -window; w <= window; w++) {
    const candidate = totp(secret, now + w * 30_000);
    if (candidate.length === code.length && crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(code))) return true;
  }
  return false;
}
