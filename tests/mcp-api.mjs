// tests/mcp-api.mjs — MCP registry through the management console: import,
// toggle, handshake/collision detection, built-in servers, and the .mcp.json
// materialized for the engine. Exits 0 on success, 1 on any failure.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 18888;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'usbai-mcpapi-'));
const PASS = 'Abc12345x';

let failures = 0;
function assert(cond, name, extra = '') {
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}

const server = spawn(process.execPath, ['lib/server.js', String(PORT)], {
  cwd: ROOT, env: { ...process.env, PORTABLE_AI_DATA_DIR: DATA_DIR, PORTABLE_AI_NO_OPEN: '1' }, stdio: 'ignore',
});
await new Promise((r) => setTimeout(r, 800));

const BASE = `http://127.0.0.1:${PORT}`;
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
  await req('/api/users', { method: 'POST', body: { username: 'alice', password: PASS } });
  await req('/api/login', { method: 'POST', body: { username: 'alice', password: PASS } });
  await req('/api/agents', { method: 'POST', body: { name: 'Mock', baseUrl: 'http://127.0.0.1:18990', apiKey: 'sk-x', model: 'sonnet', transport: 'anthropic' } });

  // ---- built-ins: present, enabled, base_ prefixed skills ----
  let r = await req('/api/mcp');
  assert(r.json.builtin?.length === 2, 'GET /api/mcp lists 2 built-in servers');
  assert(r.json.builtin.every((b) => b.enabled), 'built-ins default to enabled');
  assert(r.json.builtin.every((b) => b.tools.every((t) => t.startsWith('base_'))), 'every built-in skill carries the base_ prefix');
  assert(r.json.servers.length === 0, 'no third-party MCP on a fresh account');

  // ---- handshake the built-in session server ----
  r = await req('/api/mcp/base_sessions/test', { method: 'POST', body: {} });
  assert(r.status === 200 && r.json.ok && r.json.tools.length === 4, 'built-in base_sessions handshake returns its 4 skills', JSON.stringify(r.json).slice(0, 160));

  // ---- import a third-party server ----
  const mcpJson = JSON.stringify({ mcpServers: { 'demo-tools': { command: 'node', args: ['-e', 'process.exit(0)'] } } });
  r = await req('/api/mcp/import', { method: 'POST', body: { content: mcpJson, fileName: 'mcp.json' } });
  assert(r.status === 200 && r.json.ids?.length === 1, 'POST /api/mcp/import accepts a CC-style mcpServers file');
  const serverId = r.json.ids[0];

  r = await req('/api/mcp');
  const imported = r.json.servers[0];
  assert(imported?.name === 'demo-tools' && imported.enabled === true, 'imported server is listed and enabled by default');

  // ---- handshake failure is reported, server stays imported ----
  r = await req(`/api/mcp/${serverId}/test`, { method: 'POST', body: {} });
  assert(r.status === 502 && /退出|超时|启动/.test(r.json.error || ''), 'a dead server reports a handshake error', r.json.error);

  // ---- re-import the same command updates instead of duplicating ----
  r = await req('/api/mcp/import', { method: 'POST', body: { content: mcpJson, fileName: 'mcp.json' } });
  assert(r.json.ids?.[0] === serverId, 're-importing the same command updates the existing entry');
  r = await req('/api/mcp');
  assert(r.json.servers.length === 1, 'no duplicate entry after re-import');

  // ---- toggle + materialize ----
  r = await req(`/api/mcp/${serverId}/toggle`, { method: 'POST', body: { enabled: false } });
  assert(r.status === 200 && r.json.enabled === false, 'POST /api/mcp/:id/toggle disables a third-party server');

  await req('/api/personas', { method: 'POST', body: { name: 'DailyQA', persona: '你是测试助手。' } });
  await req('/api/personas/dailyqa/activate', { method: 'POST', body: {} });
  const dir = path.join(DATA_DIR, 'users', 'alice', 'personas', 'dailyqa');
  let mcp = JSON.parse(fs.readFileSync(path.join(dir, '.mcp.json'), 'utf8'));
  assert(Object.keys(mcp.mcpServers).length === 2 && mcp.mcpServers.base_sessions && mcp.mcpServers.base_files,
    '.mcp.json materialized with the 2 enabled built-ins');
  assert(!mcp.mcpServers[serverId], 'a disabled third-party server is left out of .mcp.json');
  assert(mcp.mcpServers.base_sessions.command === process.execPath, 'built-ins run under the portable Node');
  assert(path.isAbsolute(mcp.mcpServers.base_sessions.args[0]), 'built-in server file path is absolute');
  assert(fs.existsSync(mcp.mcpServers.base_sessions.args[0]) && mcp.mcpServers.base_sessions.args[0].includes('base-sessions.js'),
    'built-in script resolves to a real file');

  const settings = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
  assert(settings.enableAllProjectMcpServers === true, 'settings.json auto-approves project MCP servers');

  // ---- re-enable → back into .mcp.json ----
  await req(`/api/mcp/${serverId}/toggle`, { method: 'POST', body: { enabled: true } });
  await req('/api/personas/dailyqa/activate', { method: 'POST', body: {} });
  mcp = JSON.parse(fs.readFileSync(path.join(dir, '.mcp.json'), 'utf8'));
  assert(!!mcp.mcpServers[serverId], 're-enabled server is materialized again');

  // ---- disabling every built-in removes .mcp.json entirely ----
  await req('/api/mcp/base_sessions/toggle', { method: 'POST', body: { enabled: false } });
  await req('/api/mcp/base_files/toggle', { method: 'POST', body: { enabled: false } });
  await req(`/api/mcp/${serverId}/toggle`, { method: 'POST', body: { enabled: false } });
  await req('/api/personas/dailyqa/activate', { method: 'POST', body: {} });
  assert(!fs.existsSync(path.join(dir, '.mcp.json')), '.mcp.json removed when every server is disabled');

  // ---- built-ins cannot be deleted; third-party can ----
  r = await req('/api/mcp/base_sessions', { method: 'DELETE' });
  assert(r.status === 400, 'built-in MCP cannot be deleted');
  r = await req(`/api/mcp/${serverId}`, { method: 'DELETE' });
  assert(r.status === 200, 'third-party MCP can be deleted');

  // ---- remote transports are refused with an explicit message ----
  r = await req('/api/mcp/import', { method: 'POST', body: { content: JSON.stringify({ mcpServers: { remote: { type: 'http', url: 'https://example.com/mcp' } } }) } });
  assert(r.status === 400 && /stdio/.test(r.json.error || ''), 'remote (http/sse) MCP is refused with a clear reason', r.json.error);

  // ---- no persona: the bare session dir gets the same treatment ----
  await req('/api/mcp/base_files/toggle', { method: 'POST', body: { enabled: true } });
  await req('/api/personas/dailyqa/deactivate', { method: 'POST', body: {} });
  r = await req('/api/launch', { method: 'POST', body: { slug: '__active__' } });
  assert(r.status === 200 && r.json.slug === '__none__', 'no-persona launch uses the bare dir');
  const bare = path.join(DATA_DIR, 'users', 'alice', 'bare');
  mcp = JSON.parse(fs.readFileSync(path.join(bare, '.mcp.json'), 'utf8'));
  assert(!!mcp.mcpServers.base_files, 'bare (no-persona) session also materializes .mcp.json');

  // ---- sessions dir is created for the built-in archive server ----
  assert(fs.existsSync(path.join(DATA_DIR, 'users', 'alice', 'sessions')), '/sessions dir exists for base_会话管理');
} finally {
  server.kill();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
}

console.log(failures ? `\nMCP API TEST: ${failures} failure(s)` : '\nMCP API TEST: ALL PASSED');
process.exit(failures ? 1 : 0);
