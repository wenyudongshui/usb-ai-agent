// lib/modules/mcp.js
// MCP registry (工具层). Built-in servers are always present and default-on;
// third-party servers are imported by dropping a .mcp.json / mcpServers file.
//
//   data/users/<user>/mcp.enc          # encrypted registry (like agents.enc)
//   data/users/<user>/sessions/        # base_会话管理 archives (/sessions)
//
// Enabled servers are materialized into the session dir as Claude Code's native
// `.mcp.json` when a persona is activated or a terminal is launched — the engine
// starts/stops them itself. Disabling a server simply leaves it out of that file.
//
// Transport support: stdio only. Remote (http/sse) servers are rejected with an
// explicit message — ponytail: add when someone actually imports one.
'use strict';

const fs   = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const C  = require('./crypto');
const A  = require('./auth');
const P  = require('../paths');

const BUILTIN_DIR = path.join(__dirname, 'mcp');
const HAND_SHAKE_MS = 20000;

// The two zero-config servers. `ref` is stored in the registry; the file names
// never change, so a stale registry entry from an older version still resolves.
const BUILTIN = [
  {
    id: 'base_sessions', file: 'base-sessions.js', name: 'base_会话管理', prefix: 'base_session_',
    desc: '保存 / 加载 / 列出 / 删除会话存档（/sessions）',
    tools: ['base_session_save', 'base_session_list', 'base_session_load', 'base_session_delete'],
    args: (username) => [sessionsDir(username)],
  },
  {
    id: 'base_files', file: 'base-files.js', name: 'base_项目文件', prefix: 'base_fs_',
    desc: '账号目录内的浏览、搜索与文本文件读写',
    tools: ['base_fs_list', 'base_fs_tree', 'base_fs_read', 'base_fs_write', 'base_fs_search'],
    args: (username) => [A.userDir(username)],
  },
];
const builtinById = new Map(BUILTIN.map((b) => [b.id, b]));

function sessionsDir(username) { return path.join(A.userDir(username), 'sessions'); }
function storePath(username) { return path.join(A.userDir(username), 'mcp.enc'); }

function emptyRegistry() {
  return { version: 1, builtin: { base_sessions: true, base_files: true }, servers: [] };
}

function read(username, masterKey) {
  const file = storePath(username);
  if (!fs.existsSync(file)) return emptyRegistry();
  try {
    const d = C.decrypt(JSON.parse(fs.readFileSync(file, 'utf8')), masterKey);
    const reg = { ...emptyRegistry(), ...d };
    reg.builtin = { ...emptyRegistry().builtin, ...(d.builtin || {}) };
    if (!Array.isArray(reg.servers)) reg.servers = [];
    return reg;
  } catch {
    return emptyRegistry();
  }
}
function write(username, obj, masterKey) {
  const dir = A.userDir(username);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(storePath(username), JSON.stringify(C.encrypt(obj, masterKey)), 'utf8');
}

// ---- shape helpers ----
function publicServer(s) {
  const { env, ...rest } = s;
  return { ...rest, hasEnv: !!(env && Object.keys(env).length) };
}

function list(username, masterKey) {
  const reg = read(username, masterKey);
  return {
    builtin: BUILTIN.map((b) => ({
      id: b.id, name: b.name, desc: b.desc, tools: b.tools,
      builtin: true, enabled: reg.builtin[b.id] !== false,
    })),
    servers: reg.servers.map((s) => ({ ...publicServer(s), builtin: false })),
  };
}

function setEnabled(username, masterKey, id, enabled) {
  const reg = read(username, masterKey);
  if (builtinById.has(id)) reg.builtin[id] = !!enabled;
  else {
    const s = reg.servers.find((x) => x.id === id);
    if (!s) throw new Error('MCP 不存在');
    s.enabled = !!enabled;
  }
  write(username, reg, masterKey);
}

function remove(username, masterKey, id) {
  if (builtinById.has(id)) throw new Error('内置 MCP 不可删除（可停用）');
  const reg = read(username, masterKey);
  reg.servers = reg.servers.filter((x) => x.id !== id);
  write(username, reg, masterKey);
}

// ---- import ----
// Accepts a Claude-Code-style { mcpServers: {...} }, a single server record, or
// an array of them. A raw .js/.mjs/.py file path is also accepted.
function normalizeServer(raw, fallbackName) {
  if (typeof raw !== 'object' || raw === null) return null;
  if (raw.type === 'http' || raw.type === 'sse' || raw.url) {
    throw new Error('暂只支持 stdio 类 MCP（本地进程）；远程 http/sse 服务请等后续版本');
  }
  const command = raw.command || raw.cmd;
  if (!command) return null;
  const args = Array.isArray(raw.args) ? raw.args.map(String) : [];
  return {
    command: String(command),
    args,
    env: (raw.env && typeof raw.env === 'object') ? Object.fromEntries(Object.entries(raw.env).map(([k, v]) => [k, String(v)])) : {},
    name: String(raw.name || fallbackName || path.basename(String(command))).slice(0, 60),
    imported: true,
  };
}

// A dropped file may itself be a server script (not JSON).
function serverFromScript(fileName) {
  const ext = path.extname(String(fileName)).toLowerCase();
  if (!['.js', '.mjs', '.cjs', '.py', '.cmd', '.bat', '.exe'].includes(ext)) return null;
  const command = ext === '.py' ? 'python' : ext === '.js' || ext === '.mjs' || ext === '.cjs' ? 'node' : fileName;
  const args = command === fileName ? [] : [fileName];
  return { command, args, env: {}, name: path.basename(fileName).replace(ext, ''), imported: true };
}

function parseImport(content, fileName) {
  const out = [];
  const push = (raw, name) => { const s = normalizeServer(raw, name); if (s) out.push(s); };
  let doc = null;
  try { doc = JSON.parse(content); } catch { doc = null; }
  if (doc) {
    if (Array.isArray(doc)) doc.forEach((d) => push(d));
    else if (doc.mcpServers && typeof doc.mcpServers === 'object') {
      for (const [name, rec] of Object.entries(doc.mcpServers)) push({ ...rec, name: rec?.name || name }, name);
    } else if (doc.servers && Array.isArray(doc.servers)) doc.servers.forEach((d) => push(d));
    else push(doc);
  } else {
    const s = serverFromScript(fileName || '');
    if (s) out.push(s);
  }
  if (!out.length) throw new Error('未能识别 MCP 配置（需要 command + args，或直接拖入 .js/.mjs/.py 服务文件）');
  return out;
}

function importServers(username, masterKey, content, fileName) {
  const parsed = parseImport(content, fileName);
  const reg = read(username, masterKey);
  const ids = [];
  for (const s of parsed) {
    // same command+args = same server; update it instead of duplicating
    const key = JSON.stringify([s.command, s.args]);
    const existing = reg.servers.find((x) => JSON.stringify([x.command, x.args]) === key);
    if (existing) {
      if (s.env && Object.keys(s.env).length) existing.env = s.env;
      existing.enabled = true;
      ids.push(existing.id);
      continue;
    }
    const rec = { ...s, id: randomUUID(), enabled: true, addedAt: Date.now(), tools: null };
    reg.servers.push(rec);
    ids.push(rec.id);
  }
  write(username, reg, masterKey);
  return ids;
}

// ---- spawn helpers (used by the handshake) ----
// Windows needs the real extension for .cmd/.bat shims (npx, uvx, …); spawning
// bare "npx" fails there. The engine resolves this itself, so .mcp.json keeps
// the original command — this is only for our own handshake.
function resolveCommand(cmd) {
  if (process.platform !== 'win32') return cmd;
  if (path.isAbsolute(cmd) || /[\\/]/.test(cmd) || /\.(exe|cmd|bat)$/i.test(cmd)) return cmd;
  const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const ext of ['.exe', '.cmd', '.bat']) {
    for (const d of dirs) {
      const f = path.join(d, cmd + ext);
      if (fs.existsSync(f)) return f;
    }
  }
  return cmd;
}

// handshake(): initialize + tools/list against one server. Returns { tools }.
// Times out hard so a hung server can never wedge the console request.
function handshake({ command, args, env }, cwd) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(resolveCommand(command), args || [], {
        cwd: cwd || P.ROOT,
        env: { ...process.env, ...(env || {}) },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (e) { return reject(new Error(`无法启动：${e.message}`)); }

    let buf = '';
    let stderr = '';
    let settled = false;
    const done = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill(); } catch {}
      err ? reject(err) : resolve(value);
    };
    const timer = setTimeout(() => done(new Error(`握手超时（${HAND_SHAKE_MS / 1000}s）`)), HAND_SHAKE_MS);

    child.on('error', (e) => done(new Error(`无法启动：${e.message}`)));
    child.on('exit', (code) => done(new Error(`进程退出（code ${code}）${stderr ? '：' + stderr.trim().split('\n').slice(-3).join(' ') : ''}`)));
    child.stderr.on('data', (c) => { stderr += c.toString(); });

    const send = (id, method, params) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    child.stdout.on('data', (c) => {
      buf += c.toString('utf8');
      let n;
      while ((n = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, n).trim();
        buf = buf.slice(n + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === 1) {
          if (msg.error) return done(new Error(`初始化失败：${msg.error.message}`));
          send(2, 'tools/list', {});
        } else if (msg.id === 2) {
          if (msg.error) return done(new Error(`读取 Skill 列表失败：${msg.error.message}`));
          done(null, { server: msg.result?.serverInfo?.name || '', tools: (msg.result?.tools || []).map((t) => t.name) });
        }
      }
    });

    send(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'usb-ai-agent', version: '4.2.0' } });
  });
}

// test(): handshake a server, cache its skill list, report name collisions with
// every other enabled server. Collisions WARN — they never block the import.
async function test(username, masterKey, id) {
  const reg = read(username, masterKey);
  const builtin = builtinById.get(id);
  const record = builtin
    ? { command: process.execPath, args: [path.join(BUILTIN_DIR, builtin.file), ...builtin.args(username)], env: {} }
    : reg.servers.find((x) => x.id === id);
  if (!record) throw new Error('MCP 不存在');

  let result;
  try {
    result = await handshake(record, A.userDir(username));
  } catch (e) {
    if (!builtin) {
      const s = reg.servers.find((x) => x.id === id);
      if (s) { s.lastError = e.message; s.lastTestedAt = Date.now(); write(username, reg, masterKey); }
    }
    throw e;
  }

  const others = await enabledTools(username, masterKey, id);
  const mine = new Set(result.tools);
  const conflicts = [];
  for (const [name, set] of others) for (const t of set) if (mine.has(t)) conflicts.push({ tool: t, with: name });

  if (!builtin) {
    const s = reg.servers.find((x) => x.id === id);
    if (s) { s.tools = result.tools; s.lastError = null; s.lastTestedAt = Date.now(); write(username, reg, masterKey); }
  }
  return { ok: true, server: result.server, tools: result.tools, conflicts };
}

// enabledTools(): name -> skill set for every enabled server except `exceptId`.
// Built-ins answer from their static list; third-party ones use the last
// handshake result (never a live spawn — this runs on every materialize).
async function enabledTools(username, masterKey, exceptId) {
  const reg = read(username, masterKey);
  const out = new Map();
  for (const b of BUILTIN) if (b.id !== exceptId && reg.builtin[b.id] !== false) out.set(b.name, new Set(b.tools));
  for (const s of reg.servers) if (s.id !== exceptId && s.enabled && Array.isArray(s.tools)) out.set(s.name, new Set(s.tools));
  return out;
}

// materialize(): write the session dir's .mcp.json from the enabled set.
// Returns { enabled, conflicts } so the caller can log/surface collisions.
function materialize(username, masterKey, dir) {
  const reg = read(username, masterKey);
  const mcpServers = {};
  const enabled = [];
  const skills = new Map();

  for (const b of BUILTIN) {
    if (reg.builtin[b.id] === false) continue;
    mcpServers[b.id] = { command: process.execPath, args: [path.join(BUILTIN_DIR, b.file), ...b.args(username)] };
    enabled.push(b.name);
    skills.set(b.name, new Set(b.tools));
  }
  for (const s of reg.servers) {
    if (!s.enabled) continue;
    mcpServers[s.id] = { command: s.command, args: s.args || [], ...(s.env && Object.keys(s.env).length ? { env: s.env } : {}) };
    enabled.push(s.name);
    if (Array.isArray(s.tools)) skills.set(s.name, new Set(s.tools));
  }

  const conflicts = [];
  const seen = new Map();
  for (const [server, set] of skills) {
    for (const t of set) {
      if (seen.has(t)) conflicts.push({ tool: t, with: [seen.get(t), server] });
      else seen.set(t, server);
    }
  }

  const file = path.join(dir, '.mcp.json');
  if (Object.keys(mcpServers).length) {
    fs.writeFileSync(file, JSON.stringify({ mcpServers }, null, 2) + '\n', 'utf8');
  } else if (fs.existsSync(file)) {
    fs.rmSync(file, { force: true });   // all servers disabled → nothing to start
  }
  return { enabled, conflicts };
}

module.exports = {
  BUILTIN, sessionsDir, read, list, setEnabled, remove,
  importServers, test, materialize, handshake,
};
