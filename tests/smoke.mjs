#!/usr/bin/env node
// tests/smoke.mjs — end-to-end regression smoke test.
// Spins up a mock OpenAI-compatible server + the real lib/server.js under a
// temp PORTABLE_AI_DATA_DIR, then exercises: setup → create AI (with
// connectivity test) → select → SSE chat → password change (old-pw check) →
// save-exit. Exits 0 on success, 1 on any failure.
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
const NEW_PASS = 'Abc12345y';

let failures = 0;
function assert(cond, name) {
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.log(`  FAIL  ${name}`); }
}

// ---- mock OpenAI-compatible endpoint ----
const mock = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    let j = {}; try { j = JSON.parse(b); } catch {}
    if (j.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end('data: {"choices":[{"delta":{"content":"ok-stream"}}]}\n\ndata: [DONE]\n\n');
    } else {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'ok-plain' } }] }));
    }
  });
});
await new Promise((r) => mock.listen(MOCK_PORT, '127.0.0.1', r));

// ---- start the real server as a child ----
const server = spawn(process.execPath, ['lib/server.js', String(MAIN_PORT)], {
  cwd: ROOT, env: { ...process.env, PORTABLE_AI_DATA_DIR: DATA_DIR }, stdio: 'ignore',
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
  // status
  assert((await req('/api/status')).json.ok === true, 'GET /api/status ok');

  // setup
  let r = await req('/api/setup', { method: 'POST', body: { password: PASS, password2: PASS } });
  assert(r.status === 200 && r.json.ok === true, 'POST /api/setup ok');

  // create AI with connectivity test
  r = await req('/api/ai/create', { method: 'POST', body: { name: 'SmokeAI', baseURL: `http://127.0.0.1:${MOCK_PORT}`, model: 'mock', apiKey: 'sk-x', test: true } });
  assert(r.status === 200 && r.json.aiId === 'ai_001', 'POST /api/ai/create ok');

  // list + select
  r = await req('/api/ais');
  assert(r.json.ais.length === 1, 'GET /api/ais returns 1 AI');
  r = await req('/api/ai/select', { method: 'POST', body: { aiId: 'ai_001' } });
  assert(r.status === 200, 'POST /api/ai/select ok');

  // SSE chat (stream)
  const chatRes = await fetch(BASE + '/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: jar },
    body: JSON.stringify({ aiId: 'ai_001', messages: [{ role: 'user', content: 'hi' }], stream: true }),
  });
  const text = await chatRes.text();
  assert(text.includes('ok-stream') && text.includes('type":"done"'), 'SSE chat streams ok-stream');

  // password change: wrong old must fail, correct old must pass
  r = await req('/api/password', { method: 'POST', body: { oldPassword: 'wrongpw123', newPassword: NEW_PASS, newPassword2: NEW_PASS } });
  assert(r.status === 401, 'POST /api/password rejects wrong old password');
  r = await req('/api/password', { method: 'POST', body: { oldPassword: PASS, newPassword: NEW_PASS, newPassword2: NEW_PASS } });
  assert(r.status === 200 && r.json.ok === true, 'POST /api/password accepts correct old password');

  // relogin with the new password
  jar = '';
  r = await req('/api/login', { method: 'POST', body: { password: NEW_PASS } });
  assert(r.status === 200, 'login with new password ok');

  // DNS-rebind guard (raw request: fetch() sanitizes Host, so use node:http)
  const rebindStatus = await new Promise((resolve) => {
    const rq = http.request({ host: '127.0.0.1', port: MAIN_PORT, path: '/api/status', headers: { Host: 'evil.example.com' } }, (rs) => resolve(rs.statusCode));
    rq.on('error', () => resolve(-1));
    rq.end();
  });
  assert(rebindStatus === 403, 'DNS-rebind Host rejected (403)');

  // save-exit writes memory + cleans + stops server
  r = await req('/api/exit', { method: 'POST', body: { save: true, aiId: 'ai_001', messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'ok-stream' }] } });
  assert(r.status === 200, 'POST /api/exit ok');

  // child should have exited (clean exit path)
  const code = await new Promise((res) => server.once('exit', res));
  assert(code === 0, 'server process exited cleanly (code 0)');
} finally {
  mock.close();
  server.kill();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
}

console.log(failures ? `\nSMOKE TEST: ${failures} failure(s)` : '\nSMOKE TEST: ALL PASSED');
process.exit(failures ? 1 : 0);
