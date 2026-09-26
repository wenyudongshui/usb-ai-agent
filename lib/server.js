// ============================================================
//  USB AI Agent — lib/server.js
//  Local management console for the portable Claude Code engine.
//  Routes: password auth, engine install/rollback, provider+pPrompt
//  profile CRUD / activate / test, terminal-session launch, residue
//  cleanup. Loopback-only + DNS-rebind protection.
//   Run with: node lib/server.js [port]   (env USBAI_PORT / 8787)
// ============================================================

'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const A     = require('./modules/auth');
const PR    = require('./modules/profiles');
const PV    = require('./modules/providers');
const RT    = require('./modules/runtime');
const AD    = require('./modules/adapter');
const CLN   = require('./modules/cleanup');
const USB   = require('./modules/usb');
const LOC   = require('./modules/local-models');
const P     = require('./paths');

const DASHBOARD = P.DASHBOARD;
const PORT = parseInt(process.argv[2], 10) || parseInt(process.env.USBAI_PORT, 10) || 8787;
const RUNLOG = path.join(P.LOGS, 'runtime-install.log');

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

function loopbackGuard(req) {
  const host = (req.headers.host || '').split(':')[0].replace(/[\[\]]/g, '');
  if (host !== '127.0.0.1' && host !== '::1' && host !== 'localhost' && host !== 'localhost.localdomain') return false;
  const origin = req.headers.origin;
  if (origin) {
    try {
      const o = new URL(origin);
      if (o.hostname !== '127.0.0.1' && o.hostname !== '::1' && o.hostname !== 'localhost') return false;
    } catch { return false; }
  }
  return true;
}

// match /api/profiles/:slug/... or /api/profiles/:slug
function matchProfile(urlPath) {
  const m = urlPath.match(/^\/api\/profiles\/([a-z0-9][a-z0-9-]{0,39})(?:\/(activate|test|claude-md))?$/);
  return m ? { slug: m[1], sub: m[2] || null } : null;
}

// ------------------------------------------------ API router
async function handleApi(req, res, urlPath) {
  const token = parseCookies(req).usbai_token;
  const session = token ? A.check(token) : null;

  if (urlPath === '/api/status') {
    return json(res, 200, { ok: true, service: 'usb-ai-agent', version: '4.0.0', port: PORT });
  }

  if (urlPath === '/api/setup') {
    if (req.method === 'GET') return json(res, 200, { needsSetup: A.needsSetup() });
    if (req.method === 'POST') {
      if (!A.needsSetup()) return json(res, 400, { error: '已初始化，请直接登录' });
      const { password, password2 } = await readBody(req);
      const rule = validatePassword(password);
      if (rule) return json(res, 400, { error: rule });
      if (password !== password2) return json(res, 400, { error: '两次输入的密码不一致' });
      A.setup(password);
      const tk = A.unlock(password);
      setSessionCookie(res, tk);
      return res.end(JSON.stringify({ ok: true, redirect: '/main.html' }));
    }
  }

  if (urlPath === '/api/login' && req.method === 'POST') {
    if (A.needsSetup()) return json(res, 400, { error: '尚未初始化，请先设置密码' });
    const { password } = await readBody(req);
    try {
      const tk = A.unlock(password);
      setSessionCookie(res, tk);
      return res.end(JSON.stringify({ ok: true, redirect: '/main.html' }));
    } catch (e) {
      await sleep(500);
      return json(res, 401, { error: e.message });
    }
  }

  if (urlPath === '/api/logout' && req.method === 'POST') {
    if (token) A.destroy(token);
    clearSessionCookie(res);
    return res.end(JSON.stringify({ ok: true }));
  }

  if (urlPath === '/api/session') {
    return json(res, 200, {
      authed: !!session,
      needsSetup: A.needsSetup(),
      active: session ? PR.getActive() : null,
      unclean: USB.hadUncleanExit(),
    });
  }

  if (!session) return json(res, 401, { error: '未登录或会话已过期' });

  // ---- engine (Claude Code runtime) ----
  if (urlPath === '/api/runtime' && req.method === 'GET') {
    return json(res, 200, await RT.runtimeStatus());
  }
  if (urlPath === '/api/runtime' && req.method === 'POST') {
    const { action } = await readBody(req);
    if (action === 'rollback') {
      try { await RT.rollbackRuntime({ onOutput: () => {} }); return json(res, 200, { ok: true }); }
      catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (action === 'install' || action === 'update') {
      P.ensureDir(P.LOGS);
      fs.appendFileSync(RUNLOG, `\n=== requested by console: ${action} ${new Date().toISOString()} ===\n`);
      RT.installRuntime({ onOutput: (s) => { try { fs.appendFileSync(RUNLOG, s); } catch {} } })
        .then((v) => { try { fs.appendFileSync(RUNLOG, `\n=== install ready: ${v}\n`); } catch {} })
        .catch((e) => { try { fs.appendFileSync(RUNLOG, `\n=== install failed: ${e.message}\n`); } catch {} });
      return json(res, 200, { ok: true, running: true });
    }
    return json(res, 400, { error: '未知动作' });
  }
  if (urlPath === '/api/runtime/log' && req.method === 'GET') {
    let text = '';
    if (fs.existsSync(RUNLOG)) text = fs.readFileSync(RUNLOG, 'utf8').slice(-8000);
    return json(res, 200, { log: text });
  }

  // ---- profiles ----
  if (urlPath === '/api/profiles' && req.method === 'GET') {
    return json(res, 200, { profiles: PR.listProfiles(), providers: Object.fromEntries(Object.entries(require('./modules/providers').PROVIDERS).map(([k, v]) => [k, { name: v.name, transport: v.transport, local: !!v.local, baseUrl: v.baseUrl, defaultModel: v.defaultModel }])) });
  }
  if (urlPath === '/api/profiles' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const slug = PR.create({
        name: body.name, description: body.description, provider: body.provider,
        model: body.model, baseUrl: body.baseUrl, key: body.key,
        systemPrompt: body.systemPrompt, adapter: body.adapter,
      });
      return json(res, 200, { ok: true, slug });
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  }

  const mp = matchProfile(urlPath);
  if (mp) {
    const { slug, sub } = mp;
    if (req.method === 'GET' && sub === 'claude-md') {
      try { return json(res, 200, { content: PR.readClaudeMD(slug) }); } catch (e) { return json(res, 404, { error: e.message }); }
    }
    if (req.method === 'POST' && sub === 'claude-md') {
      const { content } = await readBody(req);
      try { PR.writeClaudeMD(slug, content); return json(res, 200, { ok: true }); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (req.method === 'POST' && sub === 'activate') {
      try { PR.activate(slug); return json(res, 200, { ok: true, active: slug }); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (req.method === 'POST' && sub === 'test') {
      try { const r = await PR.testProfile(slug); return json(res, 200, r); } catch (e) { return json(res, 502, { error: e.message }); }
    }
    if (req.method === 'GET' && !sub) {
      try { return json(res, 200, PR.load(slug)); } catch (e) { return json(res, 404, { error: e.message }); }
    }
    if (req.method === 'POST' && !sub) {
      const body = await readBody(req);
      try { PR.update(slug, body); return json(res, 200, { ok: true }); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (req.method === 'DELETE' && !sub) {
      try { PR.remove(slug); return json(res, 200, { ok: true }); } catch (e) { return json(res, 400, { error: e.message }); }
    }
  }

  // ---- ad-hoc connection test (profile editor, before save) ----
  if (urlPath === '/api/test' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const r = await PV.testConnection({ provider: body.provider, model: body.model, baseUrl: body.baseUrl, key: body.key });
      return json(res, 200, r);
    } catch (e) {
      return json(res, 502, { error: e.message });
    }
  }

  // ---- launch a terminal session with the active/selected profile ----
  if (urlPath === '/api/launch' && req.method === 'POST') {
    const { slug } = await readBody(req);
    try {
      const target = slug || PR.getActive();
      const profile = PR.load(target);
      PR.ensureSettings(profile);
      const nodeExe = process.execPath;
      const launcher = path.join(P.ROOT, 'tools', 'launcher.mjs');
      const launchDir = path.join(P.DATA_DIR, 'launch');
      P.ensureDir(launchDir);
      const title = String(profile.name || profile.slug).replace(/[^0-9A-Za-z一-龥 _\-()]/g, '_');
      if (process.env.PORTABLE_AI_NO_OPEN) {
        // test/CI mode: just record the launch script, do not pop a console
        fs.writeFileSync(path.join(launchDir, `${profile.slug}.bat`), `@echo off\nchcp 65001 >nul\n"${process.execPath}" "${path.join(P.ROOT, 'tools', 'launcher.mjs')}" cli ${profile.slug} %*\n`, 'utf8');
        return json(res, 200, { ok: true, slug: profile.slug, simulated: true });
      }
      if (process.platform === 'win32') {
        const bat = path.join(launchDir, `${profile.slug}.bat`);
        fs.writeFileSync(bat,
          `@echo off\r\nchcp 65001 >nul\r\ntitle USB AI CLI · ${title}\r\n"${nodeExe}" "${launcher}" cli ${profile.slug} %*\r\n`,
          'utf8');
        const child = spawn('cmd.exe', ['/c', 'start', `USB AI CLI · ${title}`, 'cmd', '/k', bat], { stdio: 'ignore', detached: true, windowsHide: true });
        child.on('error', () => {});
        child.unref();
      } else {
        const sh = path.join(launchDir, `${profile.slug}.sh`);
        fs.writeFileSync(sh, `#!/bin/bash\ncd "${PR.dir(profile.slug)}"\nexport CLAUDE_CONFIG_DIR="${PR.dir(profile.slug)}"\n"${nodeExe}" "${launcher}" cli ${profile.slug} "$@"\n`, { mode: 0o755 });
        const term = process.platform === 'darwin' ? ['open', '-a', 'Terminal', sh] : ['x-terminal-emulator', '-e', sh];
        const child = spawn(term[0], term.slice(1), { stdio: 'ignore', detached: true });
        child.on('error', () => {});
        child.unref();
      }
      return json(res, 200, { ok: true, slug: profile.slug });
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  }

  // ---- system / local models ----
  if (urlPath === '/api/system' && req.method === 'GET') {
    const ollama = await LOC.localStatus();
    return json(res, 200, { node: process.version, dataDir: P.DATA_DIR, unclean: USB.hadUncleanExit(), ollama, version: '4.0.0' });
  }

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

  if (urlPath === '/api/exit' && req.method === 'POST') {
    A.destroy(token);
    try { CLN.cleanupLocal(); } catch { /* best-effort */ }
    try { USB.clearFlag(); } catch { /* best-effort */ }
    res.end(JSON.stringify({ ok: true }));
    setTimeout(() => { try { server.close(); } catch {} process.exit(0); }, 80);
    return;
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

  let rel = urlPath === '/' ? '/login.html'
    : urlPath.endsWith('/') ? urlPath + 'index.html'
    : urlPath;
  const filePath = path.normalize(path.join(DASHBOARD, rel));
  if (!filePath.startsWith(DASHBOARD)) { res.writeHead(403); res.end('Forbidden'); return; }

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

// startup: catch-up cleanup (three-tier #3)
try {
  if (USB.hadUncleanExit()) {
    CLN.cleanupLocal();
    USB.clearFlag();
    console.log('[usb-ai-agent] 检测到上次非正常退出，已补清理本机残留。');
  }
} catch { /* best-effort */ }

try { CLN.registerCachePath(); } catch { /* best-effort */ }

try {
  USB.watch(path.parse(P.ROOT).root, () => { try { CLN.cleanupLocal(); } catch {} });
} catch { /* watcher optional */ }

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[usb-ai-agent] management console on http://127.0.0.1:${PORT}`);
});