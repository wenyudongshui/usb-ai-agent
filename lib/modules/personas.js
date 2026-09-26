// lib/modules/personas.js
// Per-account work-persona records. A persona carries ONLY a name, description
// and CLAUDE.md — no provider/model/API key (those live in agents.js).
//
// The persona content is stored in **CLAUDE.md**, the file Claude Code natively
// loads from its working directory at session start. settings.json carries only
// the agent env (never a systemPrompt field, which the engine does not read).
//
//   data/users/<user>/personas/<slug>/
//     persona.json    # { slug, name, description, createdAt }  (display only)
//     CLAUDE.md       # the persona/rules (hand-written or imported, loaded by cwd)
//     settings.json   # generated on activate/launch: env from the ACTIVE agent
'use strict';

const fs   = require('fs');
const path = require('path');
const A    = require('./auth');
const AK   = require('./agents');
const PV   = require('./providers');

function profilesDir(username) { return path.join(A.userDir(username), 'personas'); }
function dirFor(username, slug) { return path.join(profilesDir(username), slug); }
function prefsFile(username) { return path.join(A.userDir(username), 'prefs.json'); }

function validSlug(slug) { return /^[a-z0-9][a-z0-9-]{0,39}$/.test(slug); }
function slugify(name) {
  const base = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36);
  // CJK-only names collapse to a too-short slug; keep it usable
  if (base.length < 3) return `work-${Date.now().toString(36).slice(-4)}`;
  return base;
}

function readPrefs(username) {
  const f = prefsFile(username);
  if (!fs.existsSync(f)) return { version: 1 };
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return { version: 1 }; }
}
function writePrefs(username, obj) {
  const dir = A.userDir(username);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(prefsFile(username), JSON.stringify(obj, null, 2), 'utf8');
}
function getActive(username) { return readPrefs(username).activeProfile || null; }

function defaultClaudeMD(name) {
  return `# ${name}\n\n（此文件为明文。启动时以本档案目录为工作目录，Claude Code 自动加载，作为人格与规则。可直接编辑，或拖入文件填充。）\n`;
}

function previewPersona(username, slug) {
  const text = readClaudeMD(username, slug) || defaultClaudeMD('');
  return text.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 2).join(' · ').slice(0, 80);
}

function listPersonas(username) {
  const dir = profilesDir(username);
  if (!fs.existsSync(dir)) return [];
  const active = getActive(username);
  return fs.readdirSync(dir).filter(validSlug).map((slug) => {
    const file = path.join(dirFor(username, slug), 'persona.json');
    if (!fs.existsSync(file)) return null;
    try {
      const p = JSON.parse(fs.readFileSync(file, 'utf8'));
      return { slug, name: p.name, description: p.description, personaPreview: previewPersona(username, slug), active: slug === active, hasClaudeMD: fs.existsSync(path.join(dirFor(username, slug), 'CLAUDE.md')) };
    } catch { return null; }
  }).filter(Boolean);
}

function load(username, slug) {
  if (!validSlug(slug)) throw new Error('非法的档案名');
  const file = path.join(dirFor(username, slug), 'persona.json');
  if (!fs.existsSync(file)) throw new Error('档案不存在');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function create(username, input) {
  const dir = profilesDir(username);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const name = String(input.name || '').trim().slice(0, 60);
  if (!name) throw new Error('请填写档案名称');
  let slug = slugify(name);
  if (fs.existsSync(dirFor(username, slug))) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
  fs.mkdirSync(dirFor(username, slug), { recursive: true });
  const profile = {
    slug,
    name,
    description: String(input.description || '').slice(0, 200),
    createdAt: new Date().toISOString(),
  };
  writeProfile(username, profile);
  writeClaudeMD(username, slug, String(input.persona ?? '').trim() || defaultClaudeMD(name));
  return slug;
}

function update(username, slug, input) {
  const existing = load(username, slug);
  const profile = {
    ...existing,
    name: String(input.name ?? existing.name).trim().slice(0, 60),
    description: String(input.description ?? existing.description).slice(0, 200),
  };
  writeProfile(username, profile);
  if (input.persona !== undefined) writeClaudeMD(username, slug, String(input.persona ?? ''));
  return slug;
}

function writeProfile(username, profile) {
  const d = dirFor(username, profile.slug);
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'persona.json'), JSON.stringify(profile, null, 2) + '\n', 'utf8');
}

function remove(username, slug) {
  if (!validSlug(slug)) throw new Error('非法的档案名');
  fs.rmSync(dirFor(username, slug), { recursive: true, force: true });
  if (getActive(username) === slug) { const p = readPrefs(username); p.activeProfile = null; writePrefs(username, p); }
  return slug;
}

function activate(username, slug) {
  load(username, slug); // validates existence
  const p = readPrefs(username);
  p.activeProfile = slug;
  writePrefs(username, p);
  return slug;
}

// ---- CLAUDE.md (the native persona entry Claude Code loads) ----
function readClaudeMD(username, slug) {
  const file = path.join(dirFor(username, slug), 'CLAUDE.md');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : defaultClaudeMD(load(username, slug).name);
}
function writeClaudeMD(username, slug, content) {
  const d = dirFor(username, slug);
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'CLAUDE.md'), content, 'utf8');
}

// ---- mainstream settings.json generation (agent env ONLY; persona lives in
//      CLAUDE.md — the engine does not read a systemPrompt field here) ----
function writeSettings(username, slug, masterKey) {
  load(username, slug);
  const api = AK.getActive(username, masterKey);
  if (!api) throw new Error('尚未配置智能体（API 地址 / 密钥 / 模型）。请先在「② 选择智能体」新增并设为当前。');
  const env = AK.buildEnvVars(api);
  const settings = { env };
  settings._usbaiProvider = api.provider;
  settings._usbaiModel = api.model;
  settings._usbaiName = String(api.name || '').slice(0, 60);
  settings._usbaiSite = PV.PROVIDERS[api.provider]?.name || api.provider;
  settings._usbaiBaseUrl = api.baseUrl;
  const d = dirFor(username, slug);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'settings.json'), JSON.stringify(settings, null, 2) + '\n', 'utf8');
  return settings;
}

function dir(username, slug) { return dirFor(username, slug); }

module.exports = {
  listPersonas, load, create, update, remove, activate,
  getActive, readClaudeMD, writeClaudeMD, writeSettings, dir,
};