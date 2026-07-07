/**
 * Password hashing (Node scrypt, per-user salt) and opaque session tokens.
 * No JWTs: tokens are random 256-bit values stored server-side, revocable.
 */
import crypto from 'node:crypto';
import type { Db } from './db.js';

const SCRYPT_N = 16384;
const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N });
  return `scrypt:${SCRYPT_N}:${salt.toString('hex')}:${key.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const n = Number.parseInt(parts[1], 10);
  const salt = Buffer.from(parts[2], 'hex');
  const expected = Buffer.from(parts[3], 'hex');
  const actual = crypto.scryptSync(password, salt, expected.length, { N: n });
  return crypto.timingSafeEqual(actual, expected);
}

export function createSession(db: Db, playerId: string): string {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, player_id, created_ms) VALUES (?, ?, ?)').run(
    token,
    playerId,
    Date.now(),
  );
  return token;
}

export function sessionPlayerId(db: Db, token: string | undefined): string | null {
  if (!token || token.length > 128) return null;
  const row = db.prepare('SELECT player_id FROM sessions WHERE token = ?').get(token) as
    | { player_id: string }
    | undefined;
  return row?.player_id ?? null;
}

export function destroySession(db: Db, token: string): void {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

/** Tiny fixed-window rate limiter for auth endpoints (per key, e.g. IP). */
export function makeRateLimiter(maxPerWindow: number, windowMs: number) {
  const hits = new Map<string, { count: number; windowStart: number }>();
  return (key: string): boolean => {
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || now - entry.windowStart > windowMs) {
      hits.set(key, { count: 1, windowStart: now });
      return true;
    }
    entry.count++;
    if (hits.size > 10000) hits.clear(); // memory guard
    return entry.count <= maxPerWindow;
  };
}
