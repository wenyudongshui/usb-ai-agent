// ============================================================
//  USB AI Agent — app/server.js
//  Local web server: routes /api/*, serves app/public/* static.
//  Phase 1 skeleton. Run with: node app/server.js [port]
// ============================================================

'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');

const APP_DIR  = __dirname;
const PUBLIC   = path.join(APP_DIR, 'public');
const ROOT     = path.dirname(APP_DIR);           // USB drive root (parent of app/)
const PORT     = parseInt(process.argv[2], 10) || parseInt(process.env.USBAI_PORT, 10) || 8787;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css' : 'text/css; charset=utf-8',
  '.js'  : 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg' : 'image/svg+xml',
  '.png' : 'image/png',
  '.ico' : 'image/x-icon',
};

// ---- shared in-memory session store (token -> {ts}) ----
// TODO(Phase 1): replace with real auth.js module logic.
const SESSIONS = new Map();

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function sendFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---- API router ----
async function handleApi(req, res, urlPath) {
  // TODO(Phase 1..5): wire real logic per plan:
  //   GET  /api/setup      -> first-run password setup needed?
  //   POST /api/login      -> verify password, issue token
  //   POST /api/logout     -> destroy session
  //   GET  /api/session    -> auth guard for pages
  //   GET  /api/ais        -> list decrypted AI configs (keys masked)
  //   POST /api/ai/select  -> set current AI, cache decrypted result
  //   POST /api/chat       -> run a chat turn, append to in-memory session
  //   POST /api/test       -> connectivity test (max_tokens=1)
  //   POST /api/dev/*      -> dev-mode CRUD / prompt / memory / password
  if (urlPath === '/api/status') {
    json(res, 200, { ok: true, service: 'usb-ai-agent', version: '0.1.0-skeleton', port: PORT });
    return;
  }
  // default: break out to 404 below
  throw { code: 404 };
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);

  if (urlPath.startsWith('/api/')) {
    handleApi(req, res, urlPath)
      .catch(() => json(res, 404, { error: 'Not found', hint: 'API skeleton — see README implementation phases' }));
    return;
  }

  // static files under app/public/
  let rel = urlPath === '/' ? '/login.html' : urlPath;
  if (rel.endsWith('/')) rel += 'index.html';
  const filePath = path.normalize(path.join(PUBLIC, rel));

  if (!filePath.startsWith(PUBLIC)) { res.writeHead(403); res.end('Forbidden'); return; }
  sendFile(res, filePath);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[USB-AI] server listening on http://127.0.0.1:${PORT}`);
});
