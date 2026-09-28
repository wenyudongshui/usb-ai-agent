// lib/modules/mcp/base-sessions.js
// Built-in MCP: 会话存档 (base_ 前缀). Lets the MODEL save / load / list /
// delete conversation archives — there is no auto-save and no UI for this;
// the user asks in chat and the model calls these tools.
//
//   node base-sessions.js <userSessionsDir>
//
// Archives live in <userSessionsDir>/<slug>.json and are fully decoupled from
// work personas (main 规范 3): each record carries its own mcp/model/persona
// snapshot so a load can tell the model what context produced it.
'use strict';

const fs   = require('fs');
const path = require('path');
const { serve } = require('./protocol');

const DIR = process.argv[2];
if (!DIR) { process.stderr.write('usage: base-sessions.js <sessionsDir>\n'); process.exit(2); }
fs.mkdirSync(DIR, { recursive: true });

const MAX_BYTES = 8 * 1024 * 1024;   // ponytail: one archive capped at 8MB; index+split if that bites
const MAX_LIST  = 50;

function slugify(name) {
  const s = String(name || '').trim().toLowerCase()
    .replace(/[^a-z0-9一-龥]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  if (!s) throw new Error('存档名无效');
  return s;
}
function fileFor(slug) {
  const f = path.join(DIR, slug + '.json');
  // defence in depth: the slug came from slugify(), but never trust a join
  if (!f.startsWith(DIR + path.sep)) throw new Error('存档名无效');
  return f;
}

function listFiles() {
  return fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();
}
function readMeta(file) {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
    return { name: file.replace(/\.json$/, ''), title: d.title || '', updatedAt: d.updatedAt || '', turns: Array.isArray(d.messages) ? d.messages.length : 0, persona: d.persona?.slug ?? null, mcp: (d.mcpEnabled || []).length };
  } catch { return null; }
}

const str = { type: 'string' };

const tools = [
  {
    name: 'base_session_save',
    description: '保存当前会话存档到 U 盘 /sessions 目录。由用户口头指令触发，无自动保存。',
    inputSchema: {
      type: 'object',
      required: ['name', 'messages'],
      properties: {
        name: { ...str, description: '存档名（会转成 slug 作为文件名）' },
        title: { ...str, description: '展示用标题' },
        messages: { type: 'array', description: '完整对话上下文，逐条原样保存', items: { type: 'object', properties: { role: str, content: {} }, required: ['role'] } },
        personaPath: { ...str, description: '当时的人格路径' },
        model: { ...str, description: '当时的模型名' },
        mcpEnabled: { type: 'array', items: str, description: '当时启用的 MCP 列表' },
      },
    },
    handler(a) {
      const slug = slugify(a.name);
      const blob = {
        slug, title: String(a.title || a.name).slice(0, 120), updatedAt: new Date().toISOString(),
        persona: { path: a.personaPath || null, slug: a.personaPath ? path.basename(a.personaPath) : null },
        model: a.model || null, mcpEnabled: a.mcpEnabled || [], messages: a.messages || [],
      };
      const body = JSON.stringify(blob, null, 2);
      const bytes = Buffer.byteLength(body);
      if (bytes > MAX_BYTES) throw new Error(`存档过大（${(bytes / 1048576).toFixed(1)}MB > 8MB）`);
      const f = fileFor(slug);
      // tmp + rename: a crash mid-write never leaves a half-archive that
      // base_session_list would then describe as valid
      const tmp = f + '.tmp';
      fs.writeFileSync(tmp, body, 'utf8');
      fs.renameSync(tmp, f);
      return `已保存会话存档「${blob.title}」(${slug}.json, ${blob.messages.length} 条消息, ${(bytes / 1024).toFixed(1)}KB)`;
    },
  },
  {
    name: 'base_session_list',
    description: '列出 /sessions 里的全部会话存档（按更新时间倒序）。',
    inputSchema: { type: 'object', properties: {} },
    handler() {
      const items = listFiles().map(readMeta).filter(Boolean)
        .sort((x, y) => String(y.updatedAt).localeCompare(String(x.updatedAt)));
      if (!items.length) return '（暂无会话存档）';
      return items.slice(0, MAX_LIST).map((i) =>
        `- ${i.name} · ${i.title} · ${i.turns} 条 · ${i.updatedAt}${i.persona ? ` · 人格 ${i.persona}` : ''}`).join('\n');
    },
  },
  {
    name: 'base_session_load',
    description: '读取一个会话存档的完整内容，用于恢复上下文。',
    inputSchema: { type: 'object', required: ['name'], properties: { name: { ...str, description: '存档 slug 或名称' } } },
    handler(a) {
      const f = fileFor(slugify(a.name));
      if (!fs.existsSync(f)) throw new Error(`会话存档不存在: ${a.name}`);
      return fs.readFileSync(f, 'utf8');
    },
  },
  {
    name: 'base_session_delete',
    description: '删除一个会话存档。',
    inputSchema: { type: 'object', required: ['name'], properties: { name: { ...str, description: '存档 slug 或名称' } } },
    handler(a) {
      const slug = slugify(a.name);
      const f = fileFor(slug);
      if (!fs.existsSync(f)) throw new Error(`会话存档不存在: ${a.name}`);
      fs.rmSync(f, { force: true });
      return `已删除会话存档「${slug}」`;
    },
  },
];

serve({ name: 'base-sessions', version: '1.0.0', tools });
