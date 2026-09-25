// lib/modules/config.js
// Scans data/configs\ for ai_* folders; encrypted read/write of config.enc,
// plaintext read/write of prompt.md, encrypted memory via memory.js.
// Plaintext app prefs (active AI) live in data/settings.json.
'use strict';

const fs   = require('fs');
const path = require('path');
const C    = require('./crypto');
const P    = require('../paths');

const CONFIGS = P.CONFIGS;

// ---- app prefs (plaintext: only non-sensitive values, e.g. active AI id) ----
function readSettings() {
  if (!fs.existsSync(P.SETTINGS)) return { version: 1 };
  try {
    return JSON.parse(fs.readFileSync(P.SETTINGS, 'utf8'));
  } catch {
    return { version: 1 };
  }
}

function writeSettings(obj) {
  P.ensureDir(P.DATA_DIR);
  const tmp = `${P.SETTINGS}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, P.SETTINGS);
}

function getActive() { return readSettings().active || null; }
function setActive(aiId) { const s = readSettings(); s.active = aiId; writeSettings(s); }

// listAIs() -> [{ aiId, name, model, baseURL, apiKeyMasked, temperature, personaLines }]
function listAIs(masterKey) {
  if (!fs.existsSync(CONFIGS)) return [];
  return fs.readdirSync(CONFIGS)
    .filter((d) => /^ai_\d{3}$/.test(d))
    .map((aiId) => {
      const cfg = readConfig(aiId, masterKey);
      return {
        aiId,
        name: cfg.name,
        model: cfg.model,
        baseURL: cfg.baseURL,
        apiKeyMasked: mask(cfg.apiKey),
        temperature: cfg.temperature,
        personaLines: personaLines(aiId),
      };
    });
}

// createAI({name,baseURL,model,apiKey,temperature}) -> aiId
function createAI(info, masterKey) {
  P.ensureDir(CONFIGS);
  const aiId = nextId();
  const dir = path.join(CONFIGS, aiId);
  fs.mkdirSync(dir, { recursive: true });
  writeConfig(aiId, info, masterKey);
  writePrompt(aiId, seedPrompt());
  fs.writeFileSync(path.join(dir, 'memory.enc'), JSON.stringify(C.encrypt({ items: [] }, masterKey)), 'utf8');
  return aiId;
}

function readConfig(aiId, masterKey) {
  const file = path.join(CONFIGS, aiId, 'config.enc');
  if (!fs.existsSync(file)) return {};
  const blob = JSON.parse(fs.readFileSync(file, 'utf8'));
  return C.decrypt(blob, masterKey);
}

function writeConfig(aiId, info, masterKey) {
  const dir = path.join(CONFIGS, aiId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const blob = C.encrypt(info, masterKey);
  fs.writeFileSync(path.join(dir, 'config.enc'), JSON.stringify(blob), 'utf8');
}

function removeAI(aiId) {
  fs.rmSync(path.join(CONFIGS, aiId), { recursive: true, force: true });
  const s = readSettings();
  if (s.active === aiId) { s.active = null; writeSettings(s); }
}

// ---- plaintext persona (prompt.md) ----
function readPrompt(aiId) {
  const file = path.join(CONFIGS, aiId, 'prompt.md');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function writePrompt(aiId, content) {
  const dir = path.join(CONFIGS, aiId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'prompt.md'), content, 'utf8');
}

// seedPrompt(): committed template if present, else an embedded fallback.
function seedPrompt() {
  if (fs.existsSync(P.TEMPLATE_PROMPT)) return fs.readFileSync(P.TEMPLATE_PROMPT, 'utf8');
  return '# 人设与技能规则\n\n为你设定角色、技能与输出约束，将作为 system 消息注入。\n';
}

function personaLines(aiId) {
  const text = readPrompt(aiId);
  return text.split('\n').filter((l) => l.trim()).slice(0, 3).join(' · ');
}

function nextId() {
  const ids = fs.existsSync(CONFIGS) ? fs.readdirSync(CONFIGS) : [];
  let n = 1;
  while (ids.includes(`ai_${String(n).padStart(3, '0')}`)) n++;
  return `ai_${String(n).padStart(3, '0')}`;
}

function mask(key) {
  if (!key) return '';
  return key.length > 8 ? key.slice(0, 4) + '••••' + key.slice(-4) : '••••';
}

module.exports = {
  listAIs, createAI, readConfig, writeConfig, removeAI, personaLines,
  readPrompt, writePrompt, getActive, setActive, readSettings, writeSettings,
  CONFIGS,
};