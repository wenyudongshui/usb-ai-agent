#!/usr/bin/env node
// tests/smoke.mjs — end-to-end regression smoke test for the management console
// (multi-account + engine check/install + API-key import + minimal profiles +
// two-mode exit). Exits 0 on success, 1 on any failure.
import { spawn } from 'node:child_process';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MOCK_PORT = 18999;
const MAIN_PORT = 18887;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'usbai-smoke-'));
const PASS = 'Abc12345x';

let failures = 0;
function assert(cond, name) {
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.log(`  FAIL  ${name}`); }
}

// mock Anthropic-compatible endpoint (POST /v1/messages)
let messagesHits = 0;
const mock = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/v1/messages') {
    messagesHits++;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ type: 'message', model: 'sonnet', content: [], stop_reason: 'end_turn' }));
    return;
  }
  res.writeHead(404); res.end();
});
await new Promise((r) => mock.listen(MOCK_PORT, '127.0.0.1', r));

const server = spawn(process.execPath, ['lib/server.js', String(MAIN_PORT)], {
  cwd: ROOT, env: { ...process.env, PORTABLE_AI_DATA_DIR: DATA_DIR, PORTABLE_AI_NO_OPEN: '1' }, stdio: 'ignore',
});
await new Promise((r) => setTimeout(r, 800));

const BASE = `http://127.0.0.1:${MAIN_PORT}`;
let jar = '';
async function req(pathname, { method = 'GET', body } = {}) {
  const res = await fetch(BASE + pathname, {
    method,
    headers: body ? { 'Content-Type': 'application/json', Cookie: jar } : { Cookie: jar },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) jar = setCookie.split(';')[0];
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

try {
  assert((await req('/api/status')).json.ok === true, 'GET /api/status ok');

  // ---- multi-account: no users → add alice → login ----
  let r = await req('/api/users');
  assert(r.json.needsSetup === true && r.json.users.length === 0, 'GET /api/users empty first-run');

  r = await req('/api/users', { method: 'POST', body: { username: 'alice', password: PASS } });
  assert(r.status === 200 && r.json.ok === true, 'POST /api/users add alice ok');

  r = await req('/api/login', { method: 'POST', body: { username: 'alice', password: PASS } });
  assert(r.status === 200, 'POST /api/login alice ok');

  r = await req('/api/session');
  assert(r.json.authed === true && r.json.username === 'alice', 'session bound to alice');

  // master.key.enc is ciphertext (no plaintext password anywhere)
  const mkFile = fs.readFileSync(path.join(DATA_DIR, 'users', 'alice', 'master.key.enc'), 'utf8');
  assert(!mkFile.includes(PASS) && mkFile.includes('"wrapped"'), 'password not stored in readable form');

  // ---- API keys: manual + CC Switch import ----
  r = await req('/api/api-keys', { method: 'POST', body: { name: 'Mock', provider: 'anthropic', model: 'sonnet', baseUrl: `http://127.0.0.1:${MOCK_PORT}`, key: 'sk-x' } });
  assert(r.status === 200 && !!r.json.id, 'POST /api/api-keys manual ok');

  const ccSettings = JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic', ANTHROPIC_AUTH_TOKEN: 'sk-imported', ANTHROPIC_MODEL: 'deepseek-chat' } });
  r = await req('/api/api-keys/import', { method: 'POST', body: { content: ccSettings } });
  assert(r.status === 200 && r.json.ids?.length === 1, 'POST /api/api-keys/import cc-switch settings.json ok');

  r = await req('/api/api-keys');
  assert(r.json.configs.length === 2, 'GET /api/api-keys lists 2 configs');

  const manualId = r.json.configs.find((c) => c.name === 'Mock').id;
  r = await req(`/api/api-keys/${manualId}/activate`, { method: 'POST', body: {} });
  assert(r.status === 200, 'POST /api/api-keys/:id/activate ok');

  r = await req(`/api/api-keys/${manualId}/test`, { method: 'POST', body: {} });
  assert(r.status === 200 && r.json.ok === true && messagesHits >= 1, 'POST /api/api-keys/:id/test ok (mock hit)');

  // ---- profiles: only name/description/persona/CLAUDE.md ----
  r = await req('/api/profiles', { method: 'POST', body: { name: 'DailyQA', description: 'desc', persona: '你是测试助手。' } });
  assert(r.status === 200 && r.json.slug === 'dailyqa', 'POST /api/profiles create ok (no provider/model/key)');

  r = await req('/api/profiles/dailyqa/activate', { method: 'POST', body: {} });
  assert(r.status === 200 && r.json.active === 'dailyqa', 'POST /api/profiles/:slug/activate ok');

  const pdir = path.join(DATA_DIR, 'users', 'alice', 'profiles', 'dailyqa');
  const settings = JSON.parse(fs.readFileSync(path.join(pdir, 'settings.json'), 'utf8'));
  assert(settings.systemPrompt === '你是测试助手。' && settings.env?.ANTHROPIC_MODEL === 'sonnet', 'mainstream settings.json generated (persona + active API env)');
  assert(fs.existsSync(path.join(pdir, 'CLAUDE.md')), 'CLAUDE.md seeded');

  // ---- engine: check (step 1) reports not installed; launch works ----
  r = await req('/api/engine/check');
  assert(r.json.installed === false, 'GET /api/engine/check reports not installed');

  r = await req('/api/launch', { method: 'POST', body: { slug: '__active__' } });
  assert(r.status === 200 && r.json.simulated === true, 'POST /api/launch ok (simulated)');
  assert(fs.existsSync(path.join(DATA_DIR, 'launch', 'alice-dailyqa.bat')), 'launch script generated');

  // ---- dev page: delete a second account (forbid-read, allow-delete) ----
  await req('/api/users', { method: 'POST', body: { username: 'bob', password: PASS } });
  r = await req('/api/users/bob/delete', { method: 'POST', body: {} });
  assert(r.status === 200 && r.json.ok === true, 'POST /api/users/bob/delete ok (dev page)');
  assert(!fs.existsSync(path.join(DATA_DIR, 'users', 'bob')), 'deleted account data removed');

  // ---- exit wipe: clears all app data + host residue, then stops ----
  r = await req('/api/exit', { method: 'POST', body: { mode: 'wipe' } });
  assert(r.status === 200 && r.json.mode === 'wipe', 'POST /api/exit wipe ok');
  const code = await new Promise((res) => server.once('exit', res));
  assert(code === 0, 'server process exited cleanly (code 0)');
  const leftovers = fs.existsSync(DATA_DIR) ? fs.readdirSync(DATA_DIR) : [];
  assert(leftovers.length === 0, 'all app data cleared after wipe exit');
} finally {
  mock.close();
  server.kill();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
}

console.log(failures ? `\nSMOKE TEST: ${failures} failure(s)` : '\nSMOKE TEST: ALL PASSED');
process.exit(failures ? 1 : 0);