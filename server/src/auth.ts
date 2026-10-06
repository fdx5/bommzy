import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Client } from '@libsql/client';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
export const SESSION_DAYS = 30;

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return { hash: hash.toString('hex'), salt: salt.toString('hex') };
}

export async function verifyPassword(password: string, hashHex: string, saltHex: string) {
  const hash = await scrypt(password, Buffer.from(saltHex, 'hex'), 64);
  const want = Buffer.from(hashHex, 'hex');
  return want.length === hash.length && timingSafeEqual(want, hash);
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** New session: the client keeps the raw token, the DB only its hash. */
export async function createSession(db: Client, userId: number, userAgent = '') {
  const token = randomBytes(32).toString('hex');
  const now = Date.now();
  await db.execute({
    sql: 'INSERT INTO sessions (token_hash, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)',
    args: [sha256(token), userId, now, now + SESSION_DAYS * 864e5, userAgent.slice(0, 200)],
  });
  return token;
}

export async function userFromToken(db: Client, authHeader: string | undefined) {
  const m = /^Bearer ([a-f0-9]{64})$/i.exec(authHeader ?? '');
  if (!m) return null;
  const rs = await db.execute({
    sql: `SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`,
    args: [sha256(m[1]), Date.now()],
  });
  return rs.rows.length ? { id: Number(rs.rows[0].id), username: String(rs.rows[0].username) } : null;
}

/** Tiny in-memory brute-force guard: 8 failures per key per 10 minutes. */
const fails = new Map<string, { n: number; until: number }>();
export function loginBlocked(key: string) {
  const f = fails.get(key);
  return !!f && f.n >= 8 && Date.now() < f.until;
}
export function noteLoginFailure(key: string) {
  const now = Date.now();
  const f = fails.get(key);
  if (!f || now > f.until) fails.set(key, { n: 1, until: now + 10 * 60_000 });
  else f.n++;
}
export function clearLoginFailures(key: string) { fails.delete(key); }
