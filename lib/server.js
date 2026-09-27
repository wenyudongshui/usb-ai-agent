// ============================================================
//  USB AI Agent — lib/server.js
//  Management console for the portable Claude Code engine.
//  Multi-account login, engine check→install (two steps), API-key
//  management (manual + CC Switch settings.json import), minimal
//  work-object profiles, terminal launch, two-mode exit.
//  Loopback-only + DNS-rebind protection.
//   Run with: node lib/server.js [port]   (env USBAI_PORT / 8787)
// ============================================================

'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const A   = require('./modules/auth');
const AK  = require('./modules/agents');
const PR  = require('./modules/personas');
const RT  = require('./modules/runtime');
const DL  = require('./modules/dialog');
const PV  = require('./modules/providers');
const CLN = require('./modules/cleanup');
const USB = require('./modules/usb');
const LOC = require('./modules/local-models');
const P   = require('./paths');

const DASHBOARD = P.DASHBOARD;
const PORT = parseInt(process.argv[2], 10) || parseInt(process.env.USBAI_PORT, 10) || 8787;
const RUNLOG = path.join(P.LOGS, 'runtime-install.log');

const PROTECTED = new Set(['/main.html', '/exit.html', '/dialog.html']);

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
    'Cache-Control': 'no-store',
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
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('invalid JSON body')); } });
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
function loopbackGuard(req) {
  const host = (req.headers.host || '').split(':')[0].replace(/[\[\]]/g, '');
  if (host !== '127.0.0.1' && host !== '::1' && host !== 'localhost' && host !== 'localhost.localdomain') return false;
  const origin = req.headers.origin;
  if (origin) {
    try { const o = new URL(origin); if (o.hostname !== '127.0.0.1' && o.hostname !== '::1' && o.hostname !== 'localhost') return false; } catch { return false; }
  }
  return true;
}

const AGENT_ID = /^\/api\/agents\/([0-9a-f-]{36})(?:\/(activate|test))?$/;
const PERSONA = /^\/api\/personas\/([a-z0-9][a-z0-9-]{0,39})(?:\/(activate|claude-md))?$/;

// ------------------------------------------------ API router
async function handleApi(req, res, urlPath) {
  const token = parseCookies(req).usbai_token;
  const session = token ? A.check(token) : null;
  const username = session ? A.userOf(token) : null;
  const mk = session ? A.keyOf(token) : null;

  if (urlPath === '/api/status') {
    return json(res, 200, { ok: true, service: 'usb-ai-agent', version: '4.1.0', port: PORT });
  }

  // ---- accounts (login page) ----
  if (urlPath === '/api/users' && req.method === 'GET') {
    return json(res, 200, { users: A.listUsers(), needsSetup: A.needsSetup() });
  }
  if (urlPath === '/api/users' && req.method === 'POST') {
    const { username, password } = await readBody(req);
    try { A.addUser(username, password); return json(res, 200, { ok: true }); }
    catch (e) { return json(res, 400, { error: e.message }); }
  }
  if (urlPath === '/api/setup' && req.method === 'GET') {
    return json(res, 200, { needsSetup: A.needsSetup() });
  }
  if (urlPath === '/api/login' && req.method === 'POST') {
    const { username, password } = await readBody(req);
    try {
      const tk = A.unlock(username, password);
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
      username,
      users: A.listUsers().map((u) => u.name),
      activeProfile: session ? PR.getActive(username) : null,
      unclean: USB.hadUncleanExit(),
    });
  }

  if (!session) return json(res, 401, { error: '未登录或会话已过期' });

  // ---- dev page: delete an account ----
  const um = urlPath.match(/^\/api\/users\/([^/]+)\/delete$/);
  if (um && req.method === 'POST') {
    try { A.removeUser(um[1]); return json(res, 200, { ok: true }); }
    catch (e) { return json(res, 400, { error: e.message }); }
  }

  if (urlPath === '/api/password' && req.method === 'POST') {
    const { oldPassword, newPassword, newPassword2 } = await readBody(req);
    if (newPassword !== newPassword2) return json(res, 400, { error: '两次输入的新密码不一致' });
    if (typeof newPassword !== 'string' || newPassword.length < 8) return json(res, 400, { error: '密码长度至少 8 位' });
    try { A.changePassword(username, oldPassword, newPassword); return json(res, 200, { ok: true }); }
    catch (e) { return json(res, 401, { error: e.message }); }
  }

  // ---- engine: CHECK first, then INSTALL (two separate steps) ----
  if (urlPath === '/api/engine/check' && req.method === 'GET') {
    return json(res, 200, await RT.engineCheck());
  }
  if (urlPath === '/api/engine/progress' && req.method === 'GET') {
    return json(res, 200, await RT.engineProgress());
  }
  if (urlPath === '/api/engine/install' && req.method === 'POST') {
    const { action } = await readBody(req);
    if (action === 'rollback') {
      try { await RT.rollbackRuntime({ runner: RT.run }); return json(res, 200, { ok: true }); }
      catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (action !== 'install' && action !== 'update') return json(res, 400, { error: '未知动作' });
    P.ensureDir(P.LOGS);
    fs.appendFileSync(RUNLOG, `\n=== ${action} requested ${new Date().toISOString()} ===\n`);
    RT.installRuntime({ onOutput: (s) => { try { fs.appendFileSync(RUNLOG, s); } catch {} } })
      .then((v) => { try { fs.appendFileSync(RUNLOG, `\n=== ready: ${v}\n`); } catch {} })
      .catch((e) => { try { fs.appendFileSync(RUNLOG, `\n=== failed: ${e.message}\n`); } catch {} });
    return json(res, 200, { ok: true, running: true });
  }
  if (urlPath === '/api/engine/log' && req.method === 'GET') {
    let text = '';
    if (fs.existsSync(RUNLOG)) text = fs.readFileSync(RUNLOG, 'utf8').slice(-8000);
    return json(res, 200, { log: text });
  }

  // ---- API keys (current user, encrypted) ----
  if (urlPath === '/api/agents' && req.method === 'GET') {
    const d = AK.read(username, mk);
    return json(res, 200, {
      configs: AK.list(username, mk),
      providers: Object.fromEntries(Object.entries(PV.PROVIDERS).map(([k, v]) => [k, { name: v.name, transport: v.transport, local: !!v.local, baseUrl: v.baseUrl, defaultModel: v.defaultModel }])),
      activeId: d.active,
    });
  }
  if (urlPath === '/api/agents' && req.method === 'POST') {
    const b = await readBody(req);
    try { const id = AK.add(username, mk, b); return json(res, 200, { ok: true, id }); }
    catch (e) { return json(res, 400, { error: e.message }); }
  }
  if (urlPath === '/api/agents/import' && req.method === 'POST') {
    const { content } = await readBody(req);
    try { const ids = AK.importSettings(username, mk, content); return json(res, 200, { ok: true, ids }); }
    catch (e) { return json(res, 400, { error: e.message }); }
  }
  const km = urlPath.match(AGENT_ID);
  if (km) {
    const [ , id, sub ] = km;
    if (req.method === 'POST' && sub === 'activate') {
      try { AK.setActive(username, mk, id); return json(res, 200, { ok: true, active: id }); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (req.method === 'POST' && sub === 'test') {
      try { const r = await AK.test(username, mk, id); return json(res, 200, r); } catch (e) { return json(res, 502, { error: e.message }); }
    }
    if (req.method === 'DELETE') {
      try { AK.remove(username, mk, id); return json(res, 200, { ok: true }); } catch (e) { return json(res, 400, { error: e.message }); }
    }
  }

  // ---- profiles (work objects: name/description/persona/CLAUDE.md) ----
  if (urlPath === '/api/personas' && req.method === 'GET') {
    return json(res, 200, { personas: PR.listPersonas(username), active: PR.getActive(username) });
  }
  if (urlPath === '/api/personas' && req.method === 'POST') {
    const b = await readBody(req);
    try { const slug = PR.create(username, b); return json(res, 200, { ok: true, slug }); }
    catch (e) { return json(res, 400, { error: e.message }); }
  }
  const pm = urlPath.match(PERSONA);
  if (pm) {
    const [ , slug, sub ] = pm;
    if (req.method === 'GET' && sub === 'claude-md') { try { return json(res, 200, { content: PR.readClaudeMD(username, slug) }); } catch (e) { return json(res, 404, { error: e.message }); } }
    if (req.method === 'POST' && sub === 'claude-md') {
      const { content } = await readBody(req);
      try { PR.writeClaudeMD(username, slug, content); return json(res, 200, { ok: true }); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (req.method === 'POST' && sub === 'activate') {
      // generate settings.json FIRST (validates an active agent exists); only
      // then commit the active persona — otherwise a "selected but unusable"
      // state could persist even though activation failed.
      try {
        PR.writeSettings(username, slug, mk);
        PR.activate(username, slug);
        return json(res, 200, { ok: true, active: slug });
      } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (req.method === 'GET' && !sub) { try { return json(res, 200, PR.load(username, slug)); } catch (e) { return json(res, 404, { error: e.message }); } }
    if (req.method === 'POST' && !sub) { const b = await readBody(req); try { PR.update(username, slug, b); return json(res, 200, { ok: true }); } catch (e) { return json(res, 400, { error: e.message }); } }
    if (req.method === 'DELETE' && !sub) { try { PR.remove(username, slug); return json(res, 200, { ok: true }); } catch (e) { return json(res, 400, { error: e.message }); } }
  }

  // ---- launch a terminal session for the current user ----
  if (urlPath === '/api/launch' && req.method === 'POST') {
    const { slug } = await readBody(req);
    try {
      const targetSlug = slug && slug !== '__active__' ? slug : PR.getActive(username);
      if (!targetSlug || !PR.load(username, targetSlug)) throw new Error('请先创建并激活档案');
      PR.writeSettings(username, targetSlug, mk); // materialize settings.json (env + persona)
      const profile = PR.load(username, targetSlug);
      const launchDir = path.join(P.DATA_DIR, 'launch');
      P.ensureDir(launchDir);
      const bat = path.join(launchDir, `${A.sanitize(username)}-${targetSlug}.bat`);
      const nodeExe = process.execPath;
      const launcher = path.join(P.ROOT, 'tools', 'launcher.mjs');
      fs.writeFileSync(bat,
        `@echo off\r\nchcp 65001 >nul\r\ntitle USB AI CLI · ${String(profile.name || targetSlug).replace(/[^0-9A-Za-z一-龥 _\-()]/g, '_')}\r\n"${nodeExe}" "${launcher}" cli ${A.sanitize(username)} ${targetSlug} %*\r\n`,
        'utf8');
      if (process.env.PORTABLE_AI_NO_OPEN) return json(res, 200, { ok: true, slug: targetSlug, simulated: true });
      if (process.platform === 'win32') {
        const child = spawn('cmd.exe', ['/c', 'start', `USB AI CLI · ${profile.name || targetSlug}`, 'cmd', '/k', bat], { stdio: 'ignore', detached: true, windowsHide: true });
        child.on('error', () => {}); child.unref();
      } else {
        const sh = path.join(launchDir, `${A.sanitize(username)}-${targetSlug}.sh`);
        fs.writeFileSync(sh, `#!/bin/bash\n"${nodeExe}" "${launcher}" cli ${A.sanitize(username)} ${targetSlug} "$@"\n`, { mode: 0o755 });
        const term = process.platform === 'darwin' ? ['open', '-a', 'Terminal', sh] : ['x-terminal-emulator', '-e', sh];
        const child = spawn(term[0], term.slice(1), { stdio: 'ignore', detached: true }); child.on('error', () => {}); child.unref();
      }
      return json(res, 200, { ok: true, slug: targetSlug });
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  }

  // ---- dialog mode (SDK chat) ----
  if (urlPath === '/api/dialog/info' && req.method === 'GET') {
    const agent = AK.getActive(username, mk);
    const personaSlug = PR.getActive(username);
    const rt = await RT.engineCheck();
    return json(res, 200, {
      agent: agent ? { name: agent.name, provider: agent.provider, model: agent.model, hasKey: !!agent.key } : null,
      persona: personaSlug ? PR.load(username, personaSlug) : null,
      personaSlug,
      engineInstalled: rt.installed,
    });
  }
  if (urlPath === '/api/dialog/run' && req.method === 'POST') {
    const { prompt, permissionMode, confirmation } = await readBody(req);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    });
    let closed = false;
    req.on('close', () => { closed = true; });
    const emit = (ev) => { if (!closed) res.write(`data: ${JSON.stringify(ev)}\n\n`); };
    try {
      const s = DL.getSession(username, mk);
      await DL.runTurn(s, { prompt, permissionMode, confirmation, emit });
    } catch (e) {
      emit({ type: 'result', status: 'failed', error: e.message });
    }
    res.end();
    return;
  }
  if (urlPath === '/api/dialog/approve' && req.method === 'POST') {
    const { requestId, approved, answers } = await readBody(req);
    try { DL.approve(DL.getSession(username, mk), requestId, !!approved, answers); return json(res, 200, { ok: true }); }
    catch (e) { return json(res, 400, { error: e.message }); }
  }
  if (urlPath === '/api/dialog/cancel' && req.method === 'POST') {
    DL.cancel(DL.getSession(username, mk));
    return json(res, 200, { ok: true });
  }

  // ---- system / local models ----
  if (urlPath === '/api/system' && req.method === 'GET') {
    const ollama = await LOC.localStatus();
    return json(res, 200, { node: process.version, dataDir: P.DATA_DIR, unclean: USB.hadUncleanExit(), ollama, version: '4.1.0' });
  }
  if (urlPath === '/api/local' && req.method === 'POST') {
    const { action, model } = await readBody(req);
    try {
      if (action === 'start') return json(res, 200, { ok: true, ...(await LOC.startLocal()) });
      if (action === 'stop') { LOC.stopLocal(); return json(res, 200, { ok: true }); }
      if (action === 'pull') { await LOC.pullModel(model); return json(res, 200, { ok: true }); }
      return json(res, 400, { error: '未知动作' });
    } catch (e) { return json(res, 400, { error: e.message }); }
  }

  // ---- safe exit: clean host residue only, keep all account/agent/persona data ----
  if (urlPath === '/api/exit' && req.method === 'POST') {
    try { CLN.cleanupLocal(); } catch {}
    try { USB.clearFlag(); } catch {}
    A.destroy(token);
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
    if (!tk || !A.check(tk)) { res.writeHead(302, { Location: '/login.html' }); res.end(); return; }
  }
  sendFile(res, filePath);
});

function sendFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    // no-store for pages/assets so a USB re-plug / exit-and-re-enter always
    // fetches the latest HTML (never a stale cached login page)
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}

// startup: catch-up cleanup (three-tier #3)
try { if (USB.hadUncleanExit()) { CLN.cleanupLocal(); USB.clearFlag(); console.log('[usb-ai-agent] 检测到上次非正常退出，已补清理本机残留。'); } } catch { /* best-effort */ }
try { CLN.registerCachePath(); } catch { /* best-effort */ }
try { USB.watch(path.parse(P.ROOT).root, () => { try { CLN.cleanupLocal(); } catch {} }); } catch { /* watcher optional */ }

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[usb-ai-agent] management console on http://127.0.0.1:${PORT}`);
});