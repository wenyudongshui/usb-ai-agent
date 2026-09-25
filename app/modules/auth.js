// app/modules/auth.js
// GUI password auth: first-run setup, login (scrypt KEK -> unwrap master key),
// in-memory session tokens, brute-force throttling.
'use strict';

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const C      = require('./crypto');

const ROOT    = path.join(__dirname, '..', '..');   // USB drive root
const KEYS    = path.join(ROOT, 'keys');
const KEYFILE = path.join(KEYS, 'master.key.enc');
const MAGIC   = 'USB-AI-V4';

// ---- in-memory state (never persisted to host) ----
let masterKey  = null;   // 32-byte Buffer, set on successful unlock
const SESSIONS = new Map(); // token -> { masterKey, createdAt, lastUsed }

const MAX_ATTEMPTS = 5;
const LOCK_MS      = 30 * 1000;
const IDLE_MS      = 10 * 60 * 1000;
let failCount      = 0;
let lockUntil      = 0;

function ensureKeysDir() {
  if (!fs.existsSync(KEYS)) fs.mkdirSync(KEYS, { recursive: true });
}

function wrapped() {
  const raw = fs.readFileSync(KEYFILE, 'utf8');
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('master.key.enc corrupt');
  }
}

// needsSetup() -> true on first run (no keyfile yet)
function needsSetup() {
  return !fs.existsSync(KEYFILE);
}

// setup(password): generate master key, wrap with scrypt-derived KEK, persist
function setup(password) {
  ensureKeysDir();
  const salt = crypto.randomBytes(16);
  const kek  = C.deriveKEK(password, salt);
  const mk   = C.randomKey(32);
  const wrapped = C.encrypt({ magic: MAGIC, key: mk.toString('base64') }, kek);
  fs.writeFileSync(KEYFILE, JSON.stringify({ kdf: { N: C.KDF.N, r: C.KDF.r, p: C.KDF.p }, salt: salt.toString('base64'), wrapped }));
}

// unlock(password): derive KEK, unwrap master key, validate magic
function unlock(password) {
  if (Date.now() < lockUntil) {
    throw new Error(`Too many attempts. Try again in ${Math.ceil((lockUntil - Date.now()) / 1000)}s.`);
  }
  const w = wrapped();
  const kek = C.deriveKEK(password, Buffer.from(w.salt, 'base64'));
  let plain;
  try {
    plain = C.decrypt(w.wrapped, kek);
  } catch {
    failCount++;
    if (failCount >= MAX_ATTEMPTS) {
      lockUntil = Date.now() + LOCK_MS;
      failCount = 0;
      throw new Error('Wrong password. Login locked for 30s due to repeated failures.');
    }
    throw new Error('Wrong password.');
  }
  if (plain.magic !== MAGIC) throw new Error('Wrong password.');
  failCount = 0;
  masterKey = Buffer.from(plain.key, 'base64');
  return issueToken();
}

// changePassword(oldPw, newPw): unwrap with old KDF, re-wrap with new password
function changePassword(oldPw, newPw) {
  if (!masterKey) { unlock(oldPw); }              // ensure unlocked w/ old pw first
  ensureKeysDir();
  const salt = crypto.randomBytes(16);
  const kek  = C.deriveKEK(newPw, salt);
  const wrapped = C.encrypt({ magic: MAGIC, key: masterKey.toString('base64') }, kek);
  fs.writeFileSync(KEYFILE, JSON.stringify({ kdf: { N: C.KDF.N, r: C.KDF.r, p: C.KDF.p }, salt: salt.toString('base64'), wrapped }));
}

// ---- session tokens ----
function issueToken() {
  const token = crypto.randomBytes(32).toString('hex');
  SESSIONS.set(token, { masterKey, createdAt: Date.now(), lastUsed: Date.now() });
  return token;
}
function check(token) {
  const s = SESSIONS.get(token);
  if (!s) return null;
  if (Date.now() - s.lastUsed > IDLE_MS) { SESSIONS.delete(token); return null; }
  s.lastUsed = Date.now();
  return s;
}
function destroy(token) { SESSIONS.delete(token); }
function keyOf(token) { const s = SESSIONS.get(token); return s ? s.masterKey : null; }

module.exports = {
  needsSetup, setup, unlock, changePassword,
  issueToken, check, destroy, keyOf,
};