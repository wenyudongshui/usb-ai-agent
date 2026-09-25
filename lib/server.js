// ============================================================
//  USB AI Agent — lib/server.js
//  Local web server: routes /api/*, serves dashboard/* static.
//  Features: first-run setup, GUI-password login, AES-256-GCM
//  encrypted multi-AI configs, SSE streaming chat, save-and-exit
//  cleanup, three-tier residue cleanup, loopback-only + DNS-rebind
//  protection.
//   Run with: node lib/server.js [port]   (env USBAI_PORT / 8787)
// ============================================================

'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');

const A    = require('./modules/auth');
const CFG  = require('./modules/config');
const AI   = require('./modules/ai');
const MEM  = require('./modules/memory');
const CLN  = require('./modules/cleanup');
const USB  = require('./modules/usb');
const LOC  = require('./modules/local-models');
const P    = require('./paths');

const DASHBOARD = P.DASHBOARD;
const PORT = parseInt(process.argv[2], 10) || parseInt(process.env.USBAI_PORT, 10) || 8787;

// Pages that require a valid session (redirect to login when absent).
const PROTECTED = new Set(['/main.html', '/exit.html']);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css' : 'text/css; charset=utf-8',
  '.js'  : 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg' : 'image/svg+xml',
  '.png' : 'image/png',
  '.ico' : 'image/x-icon',
};

// ------------------------------------------------ helpers
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(body);
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function parseCookies(req) {
  const out = {};
  const h = req.headers.cookie || '';
  for (const pair of h.split(';')) {
    const i = pair.indexOf('=');
    if (i < 0) continue;
    out[pair.slice(0, i).trim()] = decodeURIComponent(pair.slice(i + 1).trim());
  }
  return out;
}

function setSessionCookie(res, token) {
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Set-Cookie': `usbai_token=${token}; HttpOnly; SameSite=Strict; Path=/`,
  });
}

function clearSessionCookie(res) {
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Set-Cookie': 'usbai_token=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0',
  });
}

function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return '密码长度至少 8 位';
  if (!/[A-Z]/.test(pw)) return '密码需包含大写字母';
  if (!/[a-z]/.test(pw)) return '密码需包含小写字母';
  if (!/[0-9]/.test(pw)) return '密码需包含数字';
  return null;
}

// Loopback-only: reject DNS-rebinding / cross-origin requests.
function loopbackGuard(req) {
  const host = (req.headers.host || '').split(':')[0].replace(/[\[\]]/g, '');
  if (host !== '127.0.0.1' && host !== '::1' && host !== 'localhost' && host !== 'localhost.localdomain') return false;
  const origin = req.headers.origin;
  if (origin) {
    try {
      const o = new URL(origin);
      const oh = o.hostname;
      if (oh !== '127.0.0.1' && oh !== '::1' && oh !== 'localhost') return false;
    } catch { return false; }
  }
  return true;
}

// ------------------------------------------------ API router
async function handleApi(req, res, urlPath) {
  const token = parseCookies(req).usbai_token;
  const session = token ? A.check(token) : null;

  if (urlPath === '/api/status') {
    return json(res, 200, { ok: true, service: 'usb-ai-agent', version: '4.0.0', port: PORT });
  }

  // ---- first-run setup ----
  if (urlPath === '/api/setup') {
    if (req.method === 'GET') {
      return json(res, 200, { needsSetup: A.needsSetup() });
    }
    if (req.method === 'POST') {
      if (!A.needsSetup()) return json(res, 400, { error: '已初始化，请直接登录' });
      const { password, password2 } = await readBody(req);
      const rule = validatePassword(password);
      if (rule) return json(res, 400, { error: rule });
      if (password !== password2) return json(res, 400, { error: '两次输入的密码不一致' });
      A.setup(password);
      const tk = A.unlock(password);            // auto-login after setup
      setSessionCookie(res, tk);
      return res.end(JSON.stringify({ ok: true, redirect: '/main.html' }));
    }
  }

  // ---- login (brute-force delay on failure) ----
  if (urlPath === '/api/login' && req.method === 'POST') {
    if (A.needsSetup()) return json(res, 400, { error: '尚未初始化，请先设置密码' });
    const { password } = await readBody(req);
    try {
      const tk = A.unlock(password);
      setSessionCookie(res, tk);
      return res.end(JSON.stringify({ ok: true, redirect: '/main.html' }));
    } catch (e) {
      await sleep(500);                          // README-required failed-response delay
      return json(res, 401, { error: e.message });
    }
  }

  // ---- logout ----
  if (urlPath === '/api/logout' && req.method === 'POST') {
    if (token) A.destroy(token);
    clearSessionCookie(res);
    return res.end(JSON.stringify({ ok: true }));
  }

  // ---- session guard (used by protected pages / login page) ----
  if (urlPath === '/api/session') {
    return json(res, 200, {
      authed: !!session,
      needsSetup: A.needsSetup(),
      active: session ? CFG.getActive() : null,
      unclean: USB.hadUncleanExit(),
    });
  }

  // ---- everything below requires auth ----
  if (!session) return json(res, 401, { error: '未登录或会话已过期' });

  const mk = A.keyOf(token);

  if (urlPath === '/api/ais' && req.method === 'GET') {
    return json(res, 200, { ais: CFG.listAIs(mk), active: CFG.getActive() });
  }

  // ---- create AI (optionally with connectivity test) ----
  if (urlPath === '/api/ai/create' && req.method === 'POST') {
    const { name, baseURL, model, apiKey, temperature, test } = await readBody(req);
    if (!name || !baseURL || !model || !apiKey) return json(res, 400, { error: '请填写名称、API 地址、模型名与密钥' });
    const info = { name: String(name).slice(0, 60), baseURL: String(baseURL).slice(0, 200), model: String(model).slice(0, 120), apiKey: String(apiKey).slice(0, 200), temperature: Number(temperature) || 0.7 };
    if (test) {
      const ok = await AI.test(info);
      if (!ok) return json(res, 502, { error: '连通性测试失败：请检查 API 地址 / 模型名 / 密钥', ok: false });
    }
    const aiId = CFG.createAI(info, mk);
    return json(res, 200, { ok: true, aiId });
  }

  // ---- select active AI ----
  if (urlPath === '/api/ai/select' && req.method === 'POST') {
    const { aiId } = await readBody(req);
    if (!CFG.readConfig(aiId, mk)?.baseURL) return json(res, 404, { error: '未找到该 AI 配置' });
    CFG.setActive(aiId);
    return json(res, 200, { ok: true, active: aiId });
  }

  // ---- remove AI ----
  if (urlPath === '/api/ai/remove' && req.method === 'POST') {
    const { aiId } = await readBody(req);
    CFG.removeAI(aiId);
    return json(res, 200, { ok: true });
  }

  // ---- connectivity test ----
  if (urlPath === '/api/test' && req.method === 'POST') {
    const { baseURL, model, apiKey } = await readBody(req);
    const ok = await AI.test({ baseURL, model, apiKey });
    return json(res, ok ? 200 : 502, { ok, message: ok ? '连通性正常' : '连接失败或密钥无效' });
  }

  // ---- chat (SSE streaming, with non-stream fallback) ----
  if (urlPath === '/api/chat' && req.method === 'POST') {
    const body = await readBody(req);
    const cfg = CFG.readConfig(body.aiId, mk);
    if (!cfg || !cfg.baseURL || !cfg.model) return json(res, 404, { error: '未找到该 AI 配置' });
    const prompt = CFG.readPrompt(body.aiId);
    const history = Array.isArray(body.messages) ? body.messages.slice(-50) : [];
    const messages = prompt ? [{ role: 'system', content: prompt }, ...history] : history;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    });
    let closed = false;
    req.on('close', () => { closed = true; });
    const send = (obj) => { if (!closed) res.write(`data: ${JSON.stringify(obj)}\n\n`); };

    try {
      let content;
      try {
        content = await AI.chatStream(cfg, messages, (delta) => send({ type: 'delta', content: delta }));
      } catch (streamErr) {
        // endpoint may not support streaming -> fall back to non-streaming
        content = await AI.chat(cfg, messages);
        send({ type: 'delta', content });
      }
      send({ type: 'done', content });
    } catch (e) {
      send({ type: 'error', error: e.message });
    } finally {
      res.end();
    }
    return;
  }

  // ---- change password ----
  if (urlPath === '/api/password' && req.method === 'POST') {
    const { oldPassword, newPassword, newPassword2 } = await readBody(req);
    if (newPassword !== newPassword2) return json(res, 400, { error: '两次输入的新密码不一致' });
    const rule = validatePassword(newPassword);
    if (rule) return json(res, 400, { error: rule });
    try {
      A.changePassword(oldPassword, newPassword);
      return json(res, 200, { ok: true });
    } catch (e) {
      return json(res, 401, { error: e.message });
    }
  }

  // ---- save-and-exit / no-save exit ----
  if (urlPath === '/api/exit' && req.method === 'POST') {
    const { save, aiId, messages } = await readBody(req);
    if (save && aiId && Array.isArray(messages) && messages.length) {
      const tail = messages.slice(-6).map((m) => `${m.role}: ${String(m.content || '').slice(0, 500)}`).join('\n');
      try { MEM.saveSummary(aiId, { content: `本次会话摘要（尾部）:\n${tail}` }, mk); } catch { /* best-effort */ }
    }
    A.destroy(token);
    try { CLN.cleanupLocal(); } catch { /* best-effort */ }
    try { USB.clearFlag(); } catch { /* best-effort */ }
    res.end(JSON.stringify({ ok: true }));
    setTimeout(() => { try { server.close(); } catch {} process.exit(0); }, 80);
    return;
  }

  // ---- system info (runtime / unclean flag / local models) ----
  if (urlPath === '/api/system' && req.method === 'GET') {
    const ollama = await LOC.localStatus();
    return json(res, 200, {
      node: process.version,
      dataDir: P.DATA_DIR,
      unclean: USB.hadUncleanExit(),
      ollama,
      version: '4.0.0',
    });
  }

  // ---- local model control (Ollama) ----
  if (urlPath === '/api/local' && req.method === 'POST') {
    const { action, model } = await readBody(req);
    try {
      if (action === 'start') return json(res, 200, { ok: true, ...(await LOC.startLocal()) });
      if (action === 'stop') { LOC.stopLocal(); return json(res, 200, { ok: true }); }
      if (action === 'pull') { await LOC.pullModel(model); return json(res, 200, { ok: true }); }
      return json(res, 400, { error: '未知动作' });
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  }

  throw { code: 404 };
}

// ------------------------------------------------ server
const server = http.createServer((req, res) => {
  if (!loopbackGuard(req)) { res.writeHead(403); res.end('Forbidden'); return; }

  let urlPath;
  try { urlPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname); }
  catch { urlPath = '/'; }

  if (urlPath.startsWith('/api/')) {
    handleApi(req, res, urlPath)
      .catch((e) => json(res, typeof e.code === 'number' ? e.code : 500, { error: e.message || 'internal error' }));
    return;
  }

  // static files under dashboard/
  let rel = urlPath === '/' ? '/login.html'
    : urlPath.endsWith('/') ? urlPath + 'index.html'
    : urlPath;
  const filePath = path.normalize(path.join(DASHBOARD, rel));
  if (!filePath.startsWith(DASHBOARD)) { res.writeHead(403); res.end('Forbidden'); return; }

  // protected-page guard: no valid session -> redirect to login
  if (PROTECTED.has(urlPath)) {
    const tk = parseCookies(req).usbai_token;
    if (!tk || !A.check(tk)) {
      res.writeHead(302, { Location: '/login.html' });
      res.end();
      return;
    }
  }

  sendFile(res, filePath);
});

function sendFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// startup: catch-up cleanup for an unclean previous exit (three-tier #3)
try {
  if (USB.hadUncleanExit()) {
    CLN.cleanupLocal();
    USB.clearFlag();
    console.log('[usb-ai-agent] 检测到上次非正常退出，已补清理本机残留。');
  }
} catch { /* best-effort */ }

// startup housekeeping: register this run's cache path
try { CLN.registerCachePath(); } catch { /* best-effort */ }

// unplug fallback: watch the drive this app runs from
try {
  USB.watch(path.parse(P.ROOT).root, () => {
    try { CLN.cleanupLocal(); } catch { /* best-effort */ }
  });
} catch { /* watcher optional */ }

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[usb-ai-agent] server listening on http://127.0.0.1:${PORT}`);
});