import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { HttpError, nowIso } from './util.js';
import { stmt } from './db.js';

/**
 * Accounts and sessions.
 *  - passwords: scrypt with a per-user random salt (never stored in plain text)
 *  - sessions: random 256-bit token, stored as SHA-256; sent in an HttpOnly cookie
 *  - a fresh install has zero accounts; the first signup becomes the admin
 */

const SESSION_DAYS = 7;
const scrypt = (password, salt) => scryptSync(String(password), salt, 32);

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scrypt(password, salt).toString('hex')}`;
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, salt, hash] = String(stored).split('$');
    if (scheme !== 'scrypt' || !salt || !hash) return false;
    const expected = Buffer.from(hash, 'hex');
    const candidate = scrypt(password, salt);
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export function countUsers(db) {
  return stmt(db, 'SELECT COUNT(*) AS n FROM users').get().n;
}

export function signup(db, { username, name, password }) {
  const user = String(username ?? '').trim();
  const displayName = String(name ?? '').trim() || user;
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(user)) {
    throw new HttpError(400, 'Username must be 3–32 characters (letters, digits, . _ -)');
  }
  if (String(password ?? '').length < 6) {
    throw new HttpError(400, 'Password must be at least 6 characters');
  }
  if (stmt(db, 'SELECT 1 FROM users WHERE username = ?').get(user)) {
    throw new HttpError(409, 'That username is already taken');
  }
  const id = randomUUID();
  const role = countUsers(db) === 0 ? 'admin' : 'staff';
  stmt(db, 'INSERT INTO users(id, username, name, role, password_hash, created_at) VALUES(?,?,?,?,?,?)').run(
    id, user, displayName, role, hashPassword(password), nowIso()
  );
  return { id, username: user, name: displayName, role };
}

export function login(db, { username, password }) {
  const row = stmt(db, 'SELECT * FROM users WHERE username = ?').get(String(username ?? '').trim());
  if (!row || !verifyPassword(password, row.password_hash)) {
    throw new HttpError(401, 'Wrong username or password');
  }
  return { id: row.id, username: row.username, name: row.name, role: row.role };
}

export function createSession(db, userId) {
  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  stmt(db, 'INSERT INTO sessions(token_hash, user_id, created_at, expires_at) VALUES(?,?,?,?)').run(
    sha256(token), userId, nowIso(), expires
  );
  return token;
}

export function destroySession(db, token) {
  if (token) stmt(db, 'DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

export function sessionUser(db, req) {
  const token = parseCookies(req.headers.cookie).sid;
  if (!token) return null;
  const row = stmt(
    db,
    `SELECT s.user_id, s.expires_at, u.username, u.name, u.role
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`
  ).get(sha256(token));
  if (!row) return null;
  if (row.expires_at < nowIso()) {
    destroySession(db, token);
    return null;
  }
  return { id: row.user_id, username: row.username, name: row.name, role: row.role, token };
}

export function sessionCookie(token) {
  // HttpOnly (JS can't read it), SameSite=Lax (CSRF posture for a demo).
  // `Secure` is omitted because the demo runs on http://localhost.
  return `sid=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}

export function clearCookie() {
  return 'sid=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0';
}
