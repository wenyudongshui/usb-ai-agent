// lib/modules/memory.js
// Per-AI memory store (data/configs/<ai>/memory.enc, AES-256-GCM array of items).
'use strict';

const fs   = require('fs');
const path = require('path');
const C    = require('./crypto');
const { CONFIGS } = require('./config');

function read(aiId, masterKey) {
  const file = path.join(CONFIGS, aiId, 'memory.enc');
  if (!fs.existsSync(file)) return { items: [] };
  const blob = JSON.parse(fs.readFileSync(file, 'utf8'));
  return C.decrypt(blob, masterKey); // { items: [] }
}

function write(aiId, obj, masterKey) {
  const dir = path.join(CONFIGS, aiId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const blob = C.encrypt(obj, masterKey);
  fs.writeFileSync(path.join(dir, 'memory.enc'), JSON.stringify(blob), 'utf8');
}

// saveSummary(aiId, {content}) appends a summary item
function saveSummary(aiId, { content }, masterKey) {
  const mem = read(aiId, masterKey);
  if (!Array.isArray(mem.items)) mem.items = [];
  mem.items.push({ role: 'summary', content, ts: Date.now() });
  write(aiId, mem, masterKey);
}

// TODO(Phase 4): export / archive / clear endpoints wired via dev API.

module.exports = { read, write, saveSummary };