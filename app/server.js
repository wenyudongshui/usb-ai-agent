// ============================================================
//  USB AI Agent — app/server.js
//  Local web server: routes /api/*, serves app/public/* static.
//  Phase 1 (M1): working login / first-run-setup loop.
//   Run with: node app/server.js [port]
// ============================================================

'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');

const A  = require('./modules/auth');
const CFG = require('./modules/config');
const AI = require('./modules/ai');
const MEM = require('./modules/memory');
const CLN = require('./modules/cleanup');
const USB = require('./modules/usb');

const APP_DIR = __dirname;
const PUBLIC  = path.join(APP_DIR, 'public');
const PORT    = parseInt(process.argv[2], 10) || parseInt(process.env.USBAI_PORT, 10) || 8787;

// Pages that require a valid session (redirect to login when absent).
const PROTECTED = new Set(['/main.html', '/dev.html']);

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
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

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

// ------------------------------------------------ API router
async function handleApi(req, res, urlPath) {
  const token = parseCookies(req).usbai_token;
  const session = token ? A.check(token) : null;

  // GET /api/status — liveness
  if (urlPath === '/api/status') {
    return json(res, 200, { ok: true, service: 'usb-ai-agent', version: '1.0.0', port: PORT });
  }

  // ---- Phase 1: first-run setup ----
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
      const token = A.unlock(password);         // auto-login after setup
      setSessionCookie(res, token);             // writes headers
      return res.end(JSON.stringify({ ok: true, redirect: '/main.html' }));
    }
  }

  // ---- Phase 1: login ----
  if (urlPath === '/api/login' && req.method === 'POST') {
    if (A.needsSetup()) return json(res, 400, { error: '尚未初始化，请先设置密码' });
    const { password } = await readBody(req);
    try {
      const token = A.unlock(password);
      setSessionCookie(res, token);
      return res.end(JSON.stringify({ ok: true, redirect: '/main.html' }));
    } catch (e) {
      return json(res, 401, { error: e.message });
    }
  }

  // ---- Phase 1: logout ----
  if (urlPath === '/api/logout' && req.method === 'POST') {
    if (token) A.destroy(token);
    clearSessionCookie(res);
    return res.end(JSON.stringify({ ok: true }));
  }

  // ---- Phase 1: session guard (used by protected pages) ----
  if (urlPath === '/api/session') {
    return json(res, 200, { authed: !!session, needsSetup: A.needsSetup() });
  }

  // ---- Phase 2+ (require auth) ----
  if (!session) return json(res, 401, { error: '未登录或会话已过期' });

  const mk = A.keyOf(token);

  if (urlPath === '/api/ais' && req.method === 'GET') {
    return json(res, 200, { ais: CFG.listAIs(mk) });
  }

  if (urlPath === '/api/test' && req.method === 'POST') {
    const { baseURL, model, apiKey } = await readBody(req);
    const ok = await AI.test({ baseURL, model, apiKey });
    return json(res, ok ? 200 : 502, { ok, message: ok ? '连通性正常' : '连接失败或密钥无效' });
  }

  // TODO(Phase 2/3/4): /api/ai/select · /api/chat · /api/dev/* · /api/memory
  throw { code: 404 };
}

// ------------------------------------------------ server
const server = http.createServer((req, res) => {
  let urlPath;
  try { urlPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname); }
  catch { urlPath = '/'; }

  if (urlPath.startsWith('/api/')) {
    handleApi(req, res, urlPath)
      .catch((e) => json(res, typeof e.code === 'number' ? e.code : 500, { error: e.message || 'internal error' }));
    return;
  }

  // static files under app/public/
  let rel = urlPath === '/' ? '/login.html'
    : urlPath.endsWith('/') ? urlPath + 'index.html'
    : urlPath;
  const filePath = path.normalize(path.join(PUBLIC, rel));

  if (!filePath.startsWith(PUBLIC)) { res.writeHead(403); res.end('Forbidden'); return; }

  // protected-page guard: no valid session -> redirect to login
  if (PROTECTED.has(urlPath)) {
    const token = parseCookies(req).usbai_token;
    if (!token || !A.check(token)) {
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

// startup housekeeping
try {
  CLN.registerCachePath();
} catch { /* registry is best-effort */ }

// unplug fallback: watch the drive letter this app runs from
try {
  USB.watch(path.parse(APP_DIR).root, () => {
    try { CLN.cleanupLocal(); } catch { /* best effort */ }
  });
} catch { /* watcher optional */ }

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[USB-AI] server listening on http://127.0.0.1:${PORT}`);
});