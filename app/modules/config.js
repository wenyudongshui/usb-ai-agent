// app/modules/config.js
// Scan configs\ for ai_* folders; encrypted read/write of config.enc,
// plaintext read/write of prompt.md, encrypted memory via memory.js.
'use strict';

const fs   = require('fs');
const path = require('path');
const C    = require('./crypto');

const CONFIGS = path.join(__dirname, '..', '..', 'configs');

// listAIs() -> [{ aiId, name, model, baseURL, hasMemory, personaLines }]  (key masked)
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
  if (!fs.existsSync(CONFIGS)) fs.mkdirSync(CONFIGS, { recursive: true });
  const aiId = nextId();
  const dir = path.join(CONFIGS, aiId);
  fs.mkdirSync(dir, { recursive: true });
  writeConfig(aiId, info, masterKey);
  fs.writeFileSync(path.join(dir, 'prompt.md'), '# 人设与技能规则\n\n（在此编辑该 AI 的角色定义、技能规则与输出约束，将作为 system 消息注入）\n', 'utf8');
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
}

function personaLines(aiId) {
  const file = path.join(CONFIGS, aiId, 'prompt.md');
  if (!fs.existsSync(file)) return '';
  return fs.readFileSync(file, 'utf8')
    .split('\n').filter((l) => l.trim()).slice(0, 3).join(' · ');
}

// TODO(Phase 1..5): readPrompt / writePrompt / memory delegation.

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

module.exports = { listAIs, createAI, readConfig, writeConfig, removeAI, personaLines, CONFIGS };