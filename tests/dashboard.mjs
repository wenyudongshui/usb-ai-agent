#!/usr/bin/env node
// tests/dashboard.mjs — the management console renders: 5-step layout, MCP
// section wired to /api/mcp, built-ins listed, empty states, no stale markup.
// Exits 0 on success, 1 on any failure.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(ROOT, 'dashboard', 'main.html'), 'utf8');
const css  = fs.readFileSync(path.join(ROOT, 'dashboard', 'styles.css'), 'utf8');

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); }
  catch (e) { failures++; console.log(`  FAIL  ${name} — ${e.message}`); }
}

check('five steps, numbered 1/5 … 5/5', () => {
  for (const n of [1, 2, 3, 4, 5]) assert.ok(html.includes(`${n} / 5 ·`), `missing step ${n}/5`);
  assert.ok(!html.includes('/ 4 ·'), 'a stale "x / 4" step tag survived');
});

check('MCP section sits between 智能体 and 工作人格', () => {
  const order = ['2 / 5 · 选择智能体', '3 / 5 · MCP 管理', '4 / 5 · 选择工作人格'];
  const idx = order.map((t) => html.indexOf(t));
  assert.ok(idx.every((i) => i >= 0), 'a step tag is missing');
  assert.ok(idx[0] < idx[1] && idx[1] < idx[2], 'steps are out of order');
});

check('MCP markup carries the required ids and copy', () => {
  for (const id of ['mcpBuiltin', 'mcpList', 'mcpDropZone', 'mcpFileInput']) assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
  assert.ok(html.includes('AI 自主调用'), 'missing the AI-autonomy label');
  assert.ok(html.includes('内置规范：统一 base_ 前缀防重名'), 'missing the simplified built-in note');
  assert.ok(html.includes('检查 skill 列表，握手测试'), 'missing the handshake hint');
});

check('trimmed copy is gone (per design pass)', () => {
  for (const gone of ['/sessions', '前缀隔离', '仅警告、不拦截', '冲突处理（三层）', '不参与 MCP 数据', '每个工作人格一套 settings.json + CLAUDE.md', '保留原生 Skill 名', '安全性、兼容性由用户自行负责']) {
    assert.ok(!html.includes(gone), `stale copy survived: ${gone}`);
  }
});

check('MCP section is wired to the API', () => {
  for (const call of ['/api/mcp', '/toggle', '/test', '/api/mcp/import']) assert.ok(html.includes(call), `missing call to ${call}`);
});

check('empty states replaced the old placeholder hints', () => {
  assert.ok(html.includes('暂无已导入的智能体配置'), 'agent empty state missing');
  assert.ok(html.includes('暂无工作人格'), 'persona empty state missing');
  assert.ok(html.includes('暂无第三方 MCP'), 'third-party MCP empty state missing');
  assert.ok(!html.includes('（暂无智能体）') && !html.includes('（暂无工作人格）'), 'old placeholder hints survived');
});

check('imported names are escaped before rendering', () => {
  assert.ok(/const esc = \(s\)/.test(html), 'no esc() helper');
  assert.ok(/tools\.map\(esc\)/.test(html), 'skill names are not escaped');
  assert.ok(/esc\(name\)/.test(html), 'server name is not escaped');
});

check('step 5 mentions the enabled MCP tools', () => {
  assert.ok(html.includes('已启用的 MCP 工具'), 'step 5 copy does not mention MCP');
});

check('styles define the new MCP components', () => {
  for (const cls of ['.empty-state', '.mcp-item', '.switch', '.slider', '.badge.ok', '.block-label']) {
    assert.ok(css.includes(cls), `missing ${cls} in styles.css`);
  }
  assert.ok(!css.includes('.conflict-strip'), 'dead .conflict-strip styles survived');
});

console.log(failures ? `\nDASHBOARD TEST: ${failures} failure(s)` : '\nDASHBOARD TEST: ALL PASSED');
process.exit(failures ? 1 : 0);
