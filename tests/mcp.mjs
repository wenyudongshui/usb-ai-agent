#!/usr/bin/env node
// tests/mcp.mjs — built-in MCP servers: stdio handshake, tools/list, tools/call,
// path confinement, CJK archive names. Exits 0 on success, 1 on any failure.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'usbai-mcp-'));
const SESSIONS = path.join(TMP, 'sessions');
const FILES = path.join(TMP, 'files');
fs.mkdirSync(path.join(FILES, 'sub'), { recursive: true });
fs.writeFileSync(path.join(FILES, 'readme.txt'), 'hello usb\n', 'utf8');

let failures = 0;
function assert(cond, name, extra = '') {
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}

// ---- minimal MCP stdio client: spawn server, initialize, call tools ----
function connect(script, ...scriptArgs) {
  const child = spawn(process.execPath, [path.join(ROOT, 'lib', 'modules', 'mcp', script), ...scriptArgs], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buf = '';
  let nextId = 0;
  const pending = new Map();
  child.on('error', (e) => { console.error('spawn failed:', e.message); process.exit(1); });
  child.stdout.on('data', (c) => {
    buf += c.toString('utf8');
    let n;
    while ((n = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, n).trim();
      buf = buf.slice(n + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      const slot = pending.get(msg.id);
      if (slot) { pending.delete(msg.id); slot(msg); }
    }
  });
  const send = (method, params) => new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  const call = async (name, args) => {
    const msg = await send('tools/call', { name, arguments: args });
    return { text: msg.result?.content?.[0]?.text ?? '', isError: !!msg.result?.isError, error: msg.error?.message };
  };
  return {
    raw: send,
    call,
    listTools: async () => (await send('tools/list', {})).result.tools.map((t) => t.name),
    async init() {
      const r = await send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
      return r.result;
    },
    close: () => child.kill(),
  };
}

// ============ base_会话管理 ============
console.log('\n== base_会话管理 ==');
{
  const c = connect('base-sessions.js', SESSIONS);
  const init = await c.init();
  assert(init?.serverInfo?.name === 'base-sessions', 'initialize handshake', JSON.stringify(init));
  const tools = await c.listTools();
  assert(tools.length === 4 && tools.every((t) => t.startsWith('base_session_')), 'tools/list uses base_ prefix', tools.join(','));

  const saved = await c.call('base_session_save', {
    name: '粤菜大厨会话', title: '粤菜大厨会话', model: 'deepseek-chat',
    personaPath: '/data/users/alice/personas/chef',
    mcpEnabled: ['base_sessions', 'base_files'],
    messages: [{ role: 'user', content: '你好' }, { role: 'assistant', content: '你好，我是粤菜大厨' }],
  });
  assert(!saved.isError, 'base_session_save with a CJK name', saved.text);

  const listed = await c.call('base_session_list', {});
  assert(!listed.isError && listed.text.includes('粤菜大厨会话'), 'base_session_list shows the archive', listed.text);

  const loaded = await c.call('base_session_load', { name: '粤菜大厨会话' });
  const parsed = JSON.parse(loaded.text);
  assert(parsed.messages.length === 2 && parsed.model === 'deepseek-chat' && parsed.mcpEnabled.length === 2,
    'archive round-trips messages + model + enabled MCP list');

  const bad = await c.call('base_session_load', { name: '不存在的存档' });
  assert(bad.isError, 'loading a missing archive reports an error');

  const del = await c.call('base_session_delete', { name: '粤菜大厨会话' });
  assert(!del.isError && !fs.existsSync(path.join(SESSIONS, '粤菜大厨会话.json')), 'base_session_delete removes the file', del.text);
  c.close();
}

// ============ base_项目文件 ============
console.log('\n== base_项目文件 ==');
{
  const c = connect('base-files.js', FILES);
  await c.init();
  const tools = await c.listTools();
  assert(tools.length === 5 && tools.every((t) => t.startsWith('base_fs_')), 'tools/list uses base_ prefix', tools.join(','));

  const read = await c.call('base_fs_read', { path: 'readme.txt' });
  assert(read.text.trim() === 'hello usb', 'base_fs_read reads inside the root', read.text);

  const wrote = await c.call('base_fs_write', { path: 'sub/new.md', content: '# 新文件\n' });
  assert(!wrote.isError && fs.readFileSync(path.join(FILES, 'sub', 'new.md'), 'utf8') === '# 新文件\n',
    'base_fs_write creates parent dirs and writes UTF-8', wrote.text);

  const esc = await c.call('base_fs_read', { path: '../../../etc/hosts' });
  assert(esc.isError && esc.text.includes('越界'), 'path escape outside the root is refused', esc.text);

  const escWrite = await c.call('base_fs_write', { path: '../escaped.txt', content: 'x' });
  assert(escWrite.isError, 'write escape outside the root is refused');

  const listed = await c.call('base_fs_list', { path: '' });
  assert(listed.text.includes('readme.txt'), 'base_fs_list lists the root', listed.text);

  c.close();
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(failures ? `\nMCP TEST: ${failures} failure(s)` : '\nMCP TEST: ALL PASSED');
process.exit(failures ? 1 : 0);
