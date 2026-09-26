#!/usr/bin/env node
// tests/smoke.mjs — end-to-end regression smoke test for the management console.
// Spins up a mock Anthropic-compatible endpoint + the real lib/server.js under a
// temp PORTABLE_AI_DATA_DIR, then exercises: setup → profile create (mainstream
// settings.json + CLAUDE.md generated) → activate → connection test → runtime
// status (not installed) → launch-script generation → safe exit. Exits 0 on
// success, 1 on any failure.
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

// ---- mock Anthropic-compatible endpoint (POST /v1/messages) ----
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

// ---- start the real server as a child ----
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

  let r = await req('/api/setup', { method: 'POST', body: { password: PASS, password2: PASS } });
  assert(r.status === 200 && r.json.ok === true, 'POST /api/setup ok');

  // ---- profile create (provider = anthropic, mock endpoint) ----
  r = await req('/api/profiles', { method: 'POST', body: { name: 'Smoke', provider: 'anthropic', model: 'sonnet', baseUrl: `http://127.0.0.1:${MOCK_PORT}`, key: 'sk-x', systemPrompt: '你是测试助手。' } });
  assert(r.status === 200 && r.json.slug === 'smoke', 'POST /api/profiles create ok');

  // mainstream artifacts generated
  const pdir = path.join(DATA_DIR, 'profiles', 'smoke');
  assert(fs.existsSync(path.join(pdir, 'profile.json')), 'profile.json written');
  const settings = JSON.parse(fs.readFileSync(path.join(pdir, 'settings.json'), 'utf8'));
  assert(settings.env?.ANTHROPIC_MODEL === 'sonnet' && settings.systemPrompt === '你是测试助手。', 'mainstream settings.json generated (env + systemPrompt)');
  assert(fs.existsSync(path.join(pdir, 'CLAUDE.md')), 'CLAUDE.md seeded');

  // ---- list + activate ----
  r = await req('/api/profiles');
  assert(r.json.profiles.length === 1 && !!r.json.providers, 'GET /api/profiles lists profile + providers');
  r = await req('/api/profiles/smoke/activate', { method: 'POST', body: {} });
  assert(r.status === 200 && r.json.active === 'smoke', 'POST /api/profiles/smoke/activate ok');

  // ---- connection test hits the mock /v1/messages ----
  r = await req('/api/profiles/smoke/test', { method: 'POST', body: {} });
  assert(r.status === 200 && r.json.ok === true && messagesHits >= 1, 'POST /api/profiles/smoke/test ok (mock hit)');

  // ---- runtime status: engine not installed ----
  r = await req('/api/runtime');
  assert(r.json.installed === false, 'GET /api/runtime reports not installed');

  // ---- launch generates a script without opening a console (PORTABLE_AI_NO_OPEN) ----
  r = await req('/api/launch', { method: 'POST', body: { slug: 'smoke' } });
  assert(r.status === 200 && r.json.simulated === true, 'POST /api/launch ok (simulated)');
  assert(fs.existsSync(path.join(DATA_DIR, 'launch', 'smoke.bat')), 'launch script generated');

  // ---- ad-hoc connection test (editor) ----
  r = await req('/api/test', { method: 'POST', body: { provider: 'anthropic', model: 'sonnet', baseUrl: `http://127.0.0.1:${MOCK_PORT}`, key: 'sk-x' } });
  assert(r.status === 200 && r.json.ok === true, 'POST /api/test (ad-hoc) ok');

  // ---- save-exit cleans + stops ----
  r = await req('/api/exit', { method: 'POST', body: {} });
  assert(r.status === 200, 'POST /api/exit ok');
  const code = await new Promise((res) => server.once('exit', res));
  assert(code === 0, 'server process exited cleanly (code 0)');
} finally {
  mock.close();
  server.kill();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
}

console.log(failures ? `\nSMOKE TEST: ${failures} failure(s)` : '\nSMOKE TEST: ALL PASSED');
process.exit(failures ? 1 : 0);