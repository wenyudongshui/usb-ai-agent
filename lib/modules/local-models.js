// lib/modules/local-models.js
// Portable Ollama support (transplanted from the ClaudeCode-Portable base).
// The Ollama engine + models live under data/ollama and data/models so the
// USB drive carries everything. The web chat reaches it as an
// OpenAI-compatible endpoint: http://127.0.0.1:11434/v1.
'use strict';

const { spawn } = require('child_process');
const fs   = require('fs');
const path = require('path');
const P    = require('../paths');

const OLLAMA_DIR  = path.join(P.DATA_DIR, 'ollama');
const OLLAMA_DATA = path.join(OLLAMA_DIR, 'data');
const BASE = 'http://127.0.0.1:11434';

function ollamaExecutable() {
  return [
    path.join(OLLAMA_DIR, process.platform === 'win32' ? 'ollama.exe' : 'ollama'),
    path.join(OLLAMA_DIR, `ollama-${process.platform}`),
    path.join(OLLAMA_DIR, 'bin', 'ollama'),
  ].find(fs.existsSync);
}

async function localStatus() {
  let models = [];
  let online = false;
  try {
    const r = await fetch(`${BASE}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (r.ok) { models = (await r.json()).models || []; online = true; }
  } catch { /* offline */ }
  return {
    installed: !!ollamaExecutable(),
    online,
    models: models.map((m) => ({ name: m.name, size: m.size })),
  };
}

let owned = null;

async function startLocal() {
  const st = await localStatus();
  if (st.online) return { alreadyRunning: true };
  const exe = ollamaExecutable();
  if (!exe) throw new Error('未安装便携 Ollama：请先运行「本地模型安装」(local-setup)');
  await new Promise((resolve, reject) => {
    owned = spawn(exe, ['serve'], {
      env: { ...process.env, OLLAMA_MODELS: OLLAMA_DATA, OLLAMA_HOST: '127.0.0.1:11434' },
      stdio: 'ignore',
    });
    owned.once('spawn', resolve);
    owned.once('error', (e) => { owned = null; reject(e); });
    owned.once('exit', () => { owned = null; });
  });
  return { starting: true };
}

function stopLocal() {
  if (!owned) throw new Error('该服务非本程序启动，请在其自身应用中停止');
  owned.kill('SIGTERM');
  owned = null;
}

async function pullModel(model) {
  if (typeof model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,180}$/.test(model)) {
    throw new Error('非法的 Ollama 模型名');
  }
  const res = await fetch(`${BASE}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, stream: false }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

module.exports = { ollamaExecutable, localStatus, startLocal, stopLocal, pullModel, BASE };