// lib/modules/profiles.js
// Per-user work-object profiles. A profile carries ONLY a name, description,
// persona (systemPrompt) and CLAUDE.md — no provider/model/API key (those live
// in the API-key layer). Each profile is a directory that IS a Claude Code
// config dir (CLAUDE_CONFIG_DIR), saved in the mainstream format:
//
//   data/users/<user>/profiles/<slug>/
//     profile.json    # { slug, name, description, persona, createdAt }
//     CLAUDE.md       # habits/rules for this work object (loaded by cwd)
//     settings.json   # generated when the profile is activated: env from the
//                      # ACTIVE API config + systemPrompt = persona
'use strict';

const fs   = require('fs');
const path = require('path');
const A    = require('./auth');
const AK   = require('./api-keys');

function profilesDir(username) { return path.join(A.userDir(username), 'profiles'); }
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

function previewPersona(p) {
  const lines = String(p.persona || '').split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.slice(0, 2).join(' · ').slice(0, 80);
}

function listProfiles(username) {
  const dir = profilesDir(username);
  if (!fs.existsSync(dir)) return [];
  const active = getActive(username);
  return fs.readdirSync(dir).filter(validSlug).map((slug) => {
    const file = path.join(dirFor(username, slug), 'profile.json');
    if (!fs.existsSync(file)) return null;
    try {
      const p = JSON.parse(fs.readFileSync(file, 'utf8'));
      return { slug, name: p.name, description: p.description, personaPreview: previewPersona(p), active: slug === active, hasClaudeMD: fs.existsSync(path.join(dirFor(username, slug), 'CLAUDE.md')) };
    } catch { return null; }
  }).filter(Boolean);
}

function load(username, slug) {
  if (!validSlug(slug)) throw new Error('非法的档案名');
  const file = path.join(dirFor(username, slug), 'profile.json');
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
    persona: String(input.persona || ''),
    createdAt: new Date().toISOString(),
  };
  writeProfile(username, profile);
  ensureClaudeMD(username, slug, name);
  return slug;
}

function update(username, slug, input) {
  const existing = load(username, slug);
  const profile = {
    ...existing,
    name: String(input.name ?? existing.name).trim().slice(0, 60),
    description: String(input.description ?? existing.description).slice(0, 200),
    persona: String(input.persona ?? existing.persona),
  };
  writeProfile(username, profile);
  return slug;
}

function writeProfile(username, profile) {
  const d = dirFor(username, profile.slug);
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'profile.json'), JSON.stringify(profile, null, 2) + '\n', 'utf8');
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

// ---- CLAUDE.md ----
function readClaudeMD(username, slug) {
  const file = path.join(dirFor(username, slug), 'CLAUDE.md');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}
function ensureClaudeMD(username, slug, name) {
  const file = path.join(dirFor(username, slug), 'CLAUDE.md');
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file,
      `# ${name} — 工作对象与习惯\n\n（此文件为明文。启动时以本档案目录为工作目录，Claude Code 自动加载，作为该工作对象的习惯/规则记忆。可直接编辑。）\n`,
      'utf8');
  }
}
function writeClaudeMD(username, slug, content) {
  ensureClaudeMD(username, slug, load(username, slug).name);
  fs.writeFileSync(path.join(dirFor(username, slug), 'CLAUDE.md'), content, 'utf8');
}

// ---- mainstream settings.json generation (env from ACTIVE API config + persona) ----
function writeSettings(username, slug, masterKey) {
  const profile = load(username, slug);
  const api = AK.getActive(username, masterKey);
  if (!api) throw new Error('尚未配置 API 密钥。请在「API 密钥管理」中添加或导入后激活档案。');
  const env = AK.buildEnvVars(api);
  const settings = { env };
  if (profile.persona) settings.systemPrompt = profile.persona;
  settings._usbaiProvider = api.provider;
  settings._usbaiModel = api.model;
  const d = dirFor(username, slug);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'settings.json'), JSON.stringify(settings, null, 2) + '\n', 'utf8');
  return settings;
}

function dir(username, slug) { return dirFor(username, slug); }

module.exports = {
  listProfiles, load, create, update, remove, activate,
  getActive, readPrefs, writePrefs, readClaudeMD, writeClaudeMD,
  writeSettings, dir,
};