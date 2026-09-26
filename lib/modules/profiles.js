// lib/modules/profiles.js
// Per-work-object "profile" management. Each profile is a directory that IS a
// Claude Code config dir (CLAUDE_CONFIG_DIR), saved in the mainstream Claude
// Code format so the user can also use/edit it directly:
//
//   data/profiles/<slug>/
//     profile.json     # panel master record (provider + model + key + prompts)
//     settings.json    # generated mainstream Claude Code settings (env + systemPrompt)
//     CLAUDE.md        # plaintext habits/rules for this work object (loaded by cwd)
//     prompts/         # optional custom slash prompts (prompts/<name>.md)
//
// "Switching" (the CC-switch idea) = choosing which profile dir is active and
// launching Claude Code with its CLAUDE_CONFIG_DIR + cwd.
'use strict';

const fs   = require('fs');
const path = require('path');
const P    = require('../paths');
const PR   = require('./providers');

const PROFILES_DIR = P.PROFILES;

// ---- app prefs (plaintext: only the active profile slug) ----
function readSettings() {
  if (!fs.existsSync(P.SETTINGS)) return { version: 1 };
  try { return JSON.parse(fs.readFileSync(P.SETTINGS, 'utf8')); } catch { return { version: 1 }; }
}
function writeSettings(obj) {
  P.ensureDir(P.DATA_DIR);
  const tmp = `${P.SETTINGS}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, P.SETTINGS);
}
function getActive() { return readSettings().active || null; }
function setActive(slug) { const s = readSettings(); s.active = slug; writeSettings(s); }

// ---- helpers ----
function slugify(name) {
  const s = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return s || 'profile';
}
function dir(slug) { return path.join(PROFILES_DIR, slug); }
function validSlug(slug) { return /^[a-z0-9][a-z0-9-]{0,39}$/.test(slug); }
function mask(key) {
  if (!key) return '';
  return key.length > 8 ? key.slice(0, 4) + '••••' + key.slice(-4) : '••••';
}

function publicProfile(p) {
  const { key, ...safe } = p;
  return { ...safe, hasKey: !!key, keyMasked: mask(key) };
}

function listProfiles() {
  if (!fs.existsSync(PROFILES_DIR)) return [];
  const active = getActive();
  return fs.readdirSync(PROFILES_DIR)
    .filter(validSlug)
    .map((slug) => {
      const file = path.join(dir(slug), 'profile.json');
      if (!fs.existsSync(file)) return null;
      try { return { ...publicProfile(JSON.parse(fs.readFileSync(file, 'utf8'))), active: slug === active }; } catch { return null; }
    })
    .filter(Boolean);
}

function load(slug) {
  if (!validSlug(slug)) throw new Error('非法的档案名');
  const file = path.join(dir(slug), 'profile.json');
  if (!fs.existsSync(file)) throw new Error('档案不存在');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function validate(input, existing) {
  if (!PR.PROVIDERS[input.provider]) throw new Error('未知提供商');
  const model = String(input.model || '').trim();
  if (!model || model.length > 250 || /[\r\n\0]/.test(model)) throw new Error('请输入有效的模型名');
  const baseUrl = PR.validateBaseURL(input.baseUrl || PR.PROVIDERS[input.provider].baseUrl);
  const key = input.key === undefined ? existing?.key || '' : String(input.key);
  if (/[\r\n\0]/.test(key)) throw new Error('无效的凭据');
  if (!PR.PROVIDERS[input.provider].local && !key && input.provider !== 'custom') throw new Error('该提供商需要 API 密钥');
  return {
    provider: input.provider,
    model,
    baseUrl,
    key,
    name: String(input.name || PR.PROVIDERS[input.provider].name).slice(0, 60),
    description: String(input.description || '').slice(0, 200),
    adapter: input.adapter === undefined ? 'builtin' : String(input.adapter),
    toolFormat: input.toolFormat === undefined ? 'native' : String(input.toolFormat),
    systemPrompt: String(input.systemPrompt || ''),
    modelAliases: (typeof input.modelAliases === 'object' && input.modelAliases) ? input.modelAliases : {},
  };
}

function create(input) {
  P.ensureDir(PROFILES_DIR);
  const profile = validate(input, null);
  let slug = slugify(input.name);
  if (fs.existsSync(dir(slug))) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
  profile.slug = slug;
  profile.createdAt = new Date().toISOString();
  writeProfile(profile);
  ensureClaudeMD(profile);
  ensureSettings(profile);
  return slug;
}

function update(slug, input) {
  const existing = load(slug);
  const profile = validate({ ...existing, ...input, key: input.key === undefined ? existing.key : input.key }, existing);
  profile.slug = slug;
  writeProfile(profile);
  ensureSettings(profile);
  return slug;
}

function writeProfile(profile) {
  P.ensureDir(dir(profile.slug));
  fs.writeFileSync(path.join(dir(profile.slug), 'profile.json'), JSON.stringify(profile, null, 2) + '\n', 'utf8');
}

function remove(slug) {
  if (!validSlug(slug)) throw new Error('非法的档案名');
  fs.rmSync(dir(slug), { recursive: true, force: true });
  if (getActive() === slug) setActive(null);
}

function activate(slug) {
  const p = load(slug);
  ensureSettings(p);
  setActive(slug);
  return slug;
}

// ---- mainstream Claude Code config generation ----
function buildSettings(profile) {
  const isAnthropic = profile.provider === 'anthropic';
  const env = {
    ANTHROPIC_API_KEY: isAnthropic ? profile.key : '',
    ...(!isAnthropic ? { ANTHROPIC_AUTH_TOKEN: profile.key || profile.provider } : {}),
    ANTHROPIC_BASE_URL: profile.baseUrl,
    ANTHROPIC_MODEL: profile.model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: profile.model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: profile.model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: profile.model,
    ANTHROPIC_SMALL_FAST_MODEL: profile.model,
    CLAUDE_CODE_SUBAGENT_MODEL: profile.model,
    DISABLE_AUTOUPDATER: '1',
    DISABLE_UPDATES: '1',
    DISABLE_TELEMETRY: '1',
    DISABLE_ERROR_REPORTING: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  };
  if (profile.provider !== 'anthropic') env.CLAUDE_CODE_ATTRIBUTION_HEADER = '0';
  const settings = { env };
  if (profile.systemPrompt) settings.systemPrompt = profile.systemPrompt;
  return settings;
}

function ensureSettings(profile) {
  const d = dir(profile.slug);
  P.ensureDir(d);
  fs.writeFileSync(path.join(d, 'settings.json'), JSON.stringify(buildSettings(profile), null, 2) + '\n', 'utf8');
  ensureClaudeMD(profile);
}

function ensureClaudeMD(profile) {
  const file = path.join(dir(profile.slug), 'CLAUDE.md');
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file,
      `# ${profile.name} — 工作对象与习惯\n\n（此文件为明文。启动时以本档案目录为工作目录，Claude Code 会自动加载它，作为针对该工作对象的习惯/规则记忆。可直接编辑。）\n`,
      'utf8');
  }
}

function readClaudeMD(slug) {
  const file = path.join(dir(slug), 'CLAUDE.md');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}
function writeClaudeMD(slug, content) {
  fs.writeFileSync(path.join(dir(slug), 'CLAUDE.md'), content, 'utf8');
}

// ---- launch environment for Claude Code ----
function launchEnvironment(profile, adapter) {
  const env = PR.providerEnvironment(profile, { adapter });
  env.CLAUDE_CONFIG_DIR = dir(profile.slug); // this profile dir IS the config dir
  return env;
}

async function testProfile(slug) {
  const p = load(slug);
  return PR.testConnection({ provider: p.provider, model: p.model, baseUrl: p.baseUrl, key: p.key, adapter: p.adapter });
}

module.exports = {
  listProfiles, load, create, update, remove, activate,
  readSettings, writeSettings, getActive, setActive,
  ensureSettings, buildSettings, launchEnvironment, testProfile,
  readClaudeMD, writeClaudeMD, dir, PROFILES_DIR,
};