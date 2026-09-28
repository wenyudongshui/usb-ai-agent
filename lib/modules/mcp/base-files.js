// lib/modules/mcp/base-files.js
// Built-in MCP: 项目文件 (base_ 前缀). Directory browsing + read/write of the
// project tree. Every path is confined to the roots passed on the command line
// (the account's own data dir) — no system-wide access.
//
//   node base-files.js <allowedRoot> [allowedRoot...]
'use strict';

const fs   = require('fs');
const path = require('path');
const { serve } = require('./protocol');

const RAW_ROOTS = process.argv.slice(2);
if (!RAW_ROOTS.length) { process.stderr.write('usage: base-files.js <allowedRoot>...\n'); process.exit(2); }
const ROOTS = RAW_ROOTS.map((r) => path.resolve(r));
const ROOT_STRING = ROOTS.join(', ');

const MAX_READ  = 512 * 1024;   // a file bigger than this is metadata + size only
const MAX_WRITE = 2 * 1024 * 1024;
const MAX_ENTRIES = 500;        // ponytail: flat listing cap; tree() paginates

// resolve a caller-supplied path inside the allowed roots, or throw
function resolveInRoot(p) {
  const abs = path.resolve(ROOTS[0], String(p || '').replace(/^[\\/]+/, ''));
  for (const r of ROOTS) if (abs === r || abs.startsWith(r + path.sep)) return abs;
  throw new Error(`路径越界（仅允许 ${ROOT_STRING} 之内）: ${p}`);
}
function relTo(abs) {
  for (const r of ROOTS) if (abs.startsWith(r + path.sep)) return path.relative(r, abs).split(path.sep).join('/');
  return abs.split(path.sep).join('/');
}
const ignore = (f) => f === 'node_modules' || f === '.git';
const str = { type: 'string' };

const tools = [
  {
    name: 'base_fs_list',
    description: '列出项目目录下的文件与子目录。',
    inputSchema: { type: 'object', properties: { path: { ...str, description: '相对路径，默认根目录' } } },
    handler(a) {
      const dir = resolveInRoot(a.path || '');
      if (!fs.existsSync(dir)) throw new Error(`目录不存在: ${a.path || '.'}`);
      if (!fs.statSync(dir).isDirectory()) throw new Error(`不是目录: ${a.path}`);
      const entries = fs.readdirSync(dir, { withFileTypes: true })
        .filter((e) => !ignore(e.name))
        .slice(0, MAX_ENTRIES)
        .map((e) => {
          if (e.isDirectory()) return `[目录] ${e.name}/`;
          const st = fs.statSync(path.join(dir, e.name));
          return `[文件] ${e.name}  ${st.size}B`;
        });
      return entries.length ? entries.join('\n') : '（空目录）';
    },
  },
  {
    name: 'base_fs_tree',
    description: '以树形展示项目目录结构。',
    inputSchema: { type: 'object', properties: { path: { ...str, description: '相对路径，默认根目录' }, depth: { type: 'number', description: '递归深度，默认 2，最大 5' } } },
    handler(a) {
      const dir = resolveInRoot(a.path || '');
      const maxDepth = Math.min(Math.max(Number(a.depth) || 2, 1), 5);
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`不是目录: ${a.path || '.'}`);
      const lines = [];
      let count = 0;
      (function walk(d, prefix, depth) {
        if (depth > maxDepth || count > MAX_ENTRIES) return;
        const entries = fs.readdirSync(d, { withFileTypes: true }).filter((e) => !ignore(e.name)).sort((x, y) => Number(y.isDirectory()) - Number(x.isDirectory()));
        entries.forEach((e, i) => {
          if (count++ > MAX_ENTRIES) return;
          const last = i === entries.length - 1;
          lines.push(`${prefix}${last ? '└─ ' : '├─ '}${e.name}${e.isDirectory() ? '/' : ''}`);
          if (e.isDirectory()) walk(path.join(d, e.name), prefix + (last ? '   ' : '│  '), depth + 1);
        });
      })(dir, '', 1);
      return `${relTo(dir) || '.'}\n` + (lines.length ? lines.join('\n') : '（空目录）');
    },
  },
  {
    name: 'base_fs_read',
    description: '读取项目目录下的文本文件内容。',
    inputSchema: { type: 'object', required: ['path'], properties: { path: { ...str, description: '相对路径' } } },
    handler(a) {
      const f = resolveInRoot(a.path);
      if (!fs.existsSync(f)) throw new Error(`文件不存在: ${a.path}`);
      const st = fs.statSync(f);
      if (st.isDirectory()) throw new Error(`目标是目录，请用 base_fs_list: ${a.path}`);
      if (st.size > MAX_READ) return `（文件过大：${(st.size / 1048576).toFixed(1)}MB，超出 ${MAX_READ / 1024}KB 读取上限）`;
      return fs.readFileSync(f, 'utf8');
    },
  },
  {
    name: 'base_fs_write',
    description: '向项目目录下的文本文件写入内容（覆盖），父目录不存在时自动创建。',
    inputSchema: { type: 'object', required: ['path', 'content'], properties: { path: { ...str, description: '相对路径' }, content: { ...str, description: '要写入的完整内容' } } },
    handler(a) {
      const f = resolveInRoot(a.path);
      const content = String(a.content ?? '');
      const bytes = Buffer.byteLength(content);
      if (bytes > MAX_WRITE) throw new Error(`内容过大（${(bytes / 1048576).toFixed(1)}MB > 2MB）`);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, content, 'utf8');
      return `已写入 ${relTo(f)}（${bytes}B）`;
    },
  },
  {
    name: 'base_fs_search',
    description: '按文件名关键词搜索项目目录下的文件。',
    inputSchema: { type: 'object', required: ['query'], properties: { query: { ...str, description: '文件名关键词（不区分大小写）' }, path: { ...str, description: '搜索起点，默认根目录' } } },
    handler(a) {
      const dir = resolveInRoot(a.path || '');
      const q = String(a.query || '').toLowerCase();
      if (!q) throw new Error('请输入搜索关键词');
      const hits = [];
      (function walk(d, depth) {
        if (depth > 6 || hits.length >= MAX_ENTRIES) return;
        let entries;
        try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
          if (ignore(e.name) || hits.length >= MAX_ENTRIES) continue;
          const full = path.join(d, e.name);
          if (e.name.toLowerCase().includes(q)) hits.push(relTo(full) + (e.isDirectory() ? '/' : ''));
          else if (e.isDirectory()) walk(full, depth + 1);
        }
      })(dir, 1);
      return hits.length ? hits.join('\n') : `未找到匹配「${a.query}」的文件`;
    },
  },
];

serve({ name: 'base-files', version: '1.0.0', tools });
