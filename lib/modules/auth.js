// lib/modules/auth.js
// Multi-account GUI-password gate.
//
// Each account = a display name + a password. The password is NEVER stored in
// a readable form: it only derives a scrypt KEK that unwraps that account's
// AES-256-GCM-wrapped master key (data/users/<name>/master.key.enc). Reading the
// file yields ciphertext only ("禁止读取"). A dev page may DELETE an account
// ("允许删除") — that removes its whole data directory.
//
// Session token (in-memory) holds { username, masterKey } so the server can
// decrypt that user's api.enc and read its profiles.
'use strict';

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const C      = require('./crypto');
const P      = require('../paths');

const USERS_DIR   = path.join(P.DATA_DIR, 'users');
const USERS_INDEX = path.join(P.DATA_DIR, 'users.json');
const MAGIC       = 'USB-AI-V4';

// ---- in-memory sessions (never persisted) ----
const SESSIONS = new Map(); // token -> { username, masterKey, createdAt, lastUsed }
const IDLE_MS  = 10 * 60 * 1000;

// ---- brute-force throttle (per account) ----
const MAX_ATTEMPTS = 5;
const LOCK_MS      = 30 * 1000;
const fails        = new Map(); // username -> { count, lockUntil }

// ---- path helpers ----
function sanitize(name) {
  const s = String(name || '').trim().replace(/[\\/:*?"<>|\r\n]+/g, '').slice(0, 40);
  if (!s) throw new Error('账号名无效');
  return s;
}
function userDir(name) { return path.join(USERS_DIR, sanitize(name)); }
function keyFile(name) { return path.join(userDir(name), 'master.key.enc'); }

function writeIndex(users) {
  P.ensureDir(P.DATA_DIR);
  const tmp = `${USERS_INDEX}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, users }, null, 2), 'utf8');
  fs.renameSync(tmp, USERS_INDEX);
}

// ---- account CRUD ----
function listUsers() {
  if (!fs.existsSync(USERS_INDEX)) return [];
  try { const d = JSON.parse(fs.readFileSync(USERS_INDEX, 'utf8')); return Array.isArray(d.users) ? d.users : []; }
  catch { return []; }
}
function needsSetup() { return listUsers().length === 0; }

function addUser(name, password) {
  if (typeof password !== 'string' || password.length < 8) throw new Error('密码长度至少 8 位');
  if (!/[A-Z]/.test(password)) throw new Error('密码需包含大写字母');
  if (!/[a-z]/.test(password)) throw new Error('密码需包含小写字母');
  if (!/[0-9]/.test(password)) throw new Error('密码需包含数字');
  const dir = userDir(name);
  if (fs.existsSync(dir)) throw new Error('账号已存在');
  P.ensureDir(USERS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const salt = crypto.randomBytes(16);
  const kek  = C.deriveKEK(password, salt);
  const mk   = C.randomKey(32);
  const wrapped = C.encrypt({ magic: MAGIC, key: mk.toString('base64') }, kek);
  fs.writeFileSync(keyFile(name), JSON.stringify({ kdf: { N: C.KDF.N, r: C.KDF.r, p: C.KDF.p }, salt: salt.toString('base64'), wrapped }));
  const users = listUsers();
  users.push({ name: String(name).trim().slice(0, 40), created: Date.now() });
  writeIndex(users);
}

function removeUser(name) {
  const dir = userDir(name);
  fs.rmSync(dir, { recursive: true, force: true });
  const users = listUsers().filter((u) => u.name !== name);
  writeIndex(users);
  for (const [t, s] of SESSIONS) if (s.username === name) SESSIONS.delete(t);
}

// ---- unlock / sessions ----
function lockInfo(name) {
  const f = fails.get(name) || { count: 0, lockUntil: 0 };
  if (Date.now() > f.lockUntil) { f.count = 0; f.lockUntil = 0; }
  return f;
}

function unlock(name, password) {
  const f = lockInfo(name);
  if (Date.now() < f.lockUntil) {
    throw new Error(`尝试次数过多，请在 ${Math.ceil((f.lockUntil - Date.now()) / 1000)}s 后重试`);
  }
  const file = keyFile(name);
  if (!fs.existsSync(file)) throw new Error('账号不存在');
  const w = JSON.parse(fs.readFileSync(file, 'utf8'));
  const kek = C.deriveKEK(password, Buffer.from(w.salt, 'base64'));
  let plain;
  try {
    plain = C.decrypt(w.wrapped, kek);
  } catch {
    f.count++;
    if (f.count >= MAX_ATTEMPTS) { f.lockUntil = Date.now() + LOCK_MS; f.count = 0; fails.set(name, f); throw new Error('密码错误，连续失败已锁定 30 秒'); }
    fails.set(name, f);
    throw new Error('密码错误');
  }
  if (plain.magic !== MAGIC) throw new Error('密码错误');
  f.count = 0; fails.set(name, f);
  return issueToken(name, Buffer.from(plain.key, 'base64'));
}

function changePassword(username, oldPw, newPw) {
  const file = keyFile(username);
  if (!fs.existsSync(file)) throw new Error('账号不存在');
  const w = JSON.parse(fs.readFileSync(file, 'utf8'));
  const kek = C.deriveKEK(oldPw, Buffer.from(w.salt, 'base64'));
  let plain;
  try { plain = C.decrypt(w.wrapped, kek); } catch { throw new Error('原密码不正确'); }
  if (plain.magic !== MAGIC) throw new Error('原密码不正确');
  const salt = crypto.randomBytes(16);
  const newKek = C.deriveKEK(newPw, salt);
  const newWrapped = C.encrypt({ magic: MAGIC, key: plain.key }, newKek);
  fs.writeFileSync(file, JSON.stringify({ kdf: { N: C.KDF.N, r: C.KDF.r, p: C.KDF.p }, salt: salt.toString('base64'), wrapped: newWrapped }));
}

function issueToken(username, masterKey) {
  const token = crypto.randomBytes(32).toString('hex');
  SESSIONS.set(token, { username, masterKey, createdAt: Date.now(), lastUsed: Date.now() });
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
function userOf(token) { const s = SESSIONS.get(token); return s ? s.username : null; }

module.exports = {
  sanitize, userDir, listUsers, needsSetup,
  addUser, removeUser, unlock, changePassword,
  check, destroy, keyOf, userOf,
};