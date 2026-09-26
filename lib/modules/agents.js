// lib/modules/agents.js
// Per-user agent configurations (the "智能体" layer, CC-switch style).
// Stored AES-256-GCM-encrypted under the user's master key (data/users/<name>/agents.enc)
// so the file itself does not expose credentials. Two entry methods:
//   1) manual fill (provider/model/baseURL/key)
//   2) import / drag-drop a CC Switch settings.json (env.ANTHROPIC_* or provider records)
'use strict';

const fs   = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const C    = require('./crypto');
const A    = require('./auth');
const PV   = require('./providers');

const { PROVIDERS, testConnection, validateBaseURL } = PV;

function storePath(username) { return path.join(A.userDir(username), 'agents.enc'); }

function read(username, masterKey) {
  const file = storePath(username);
  if (!fs.existsSync(file)) return { version: 1, active: null, configs: [] };
  try {
    const blob = JSON.parse(fs.readFileSync(file, 'utf8'));
    return C.decrypt(blob, masterKey);
  } catch {
    return { version: 1, active: null, configs: [] };
  }
}
function write(username, obj, masterKey) {
  const dir = A.userDir(username);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(storePath(username), JSON.stringify(C.encrypt(obj, masterKey)), 'utf8');
}

function mask(key) {
  if (!key) return '';
  return key.length > 8 ? key.slice(0, 4) + '••••' + key.slice(-4) : '••••';
}

function publicConfigs(username, masterKey) {
  const d = read(username, masterKey);
  return d.configs.map((c) => ({ ...c, key: undefined, hasKey: !!c.key, keyMasked: mask(c.key), active: c.id === d.active }));
}

function getActive(username, masterKey) {
  const d = read(username, masterKey);
  if (!d.configs.length) return null;
  return d.configs.find((c) => c.id === d.active) || d.configs[0];
}

// resolve a provider id from baseURL + explicit transport hint.
// 'anthropic' = direct Anthropic Messages endpoint; 'openai' = needs the adapter.
function resolveProvider(baseUrl, transport) {
  const detected = detectProvider(baseUrl);
  const p = PROVIDERS[detected];
  if (p && p.transport === transport) return detected;
  return transport === 'openai' ? 'custom' : 'custom-anthropic';
}

function buildConfig(input, existing) {
  const baseUrl = input.baseUrl || existing?.baseUrl;
  if (!baseUrl) throw new Error('请填写 API 地址');
  const validated = validateBaseURL(baseUrl);
  const transport = input.transport === 'openai'
    ? 'openai'
    : (existing && PROVIDERS[existing.provider]?.transport === 'openai' ? 'openai' : 'anthropic');
  const provider = input.provider || resolveProvider(validated, transport);
  const p = PROVIDERS[provider];
  if (!p) throw new Error('未知提供商');
  const model = String(input.model || existing?.model || '').trim();
  if (!model || model.length > 250 || /[\r\n\0]/.test(model)) throw new Error('请输入模型名');
  const key = input.apiKey ?? input.key ?? existing?.key ?? '';
  if (/[\r\n\0]/.test(key)) throw new Error('无效的凭据');
  if (!p.local && !key && provider !== 'custom' && provider !== 'custom-anthropic') throw new Error('该提供商需要 API 密钥');
  return {
    provider,
    model,
    baseUrl: validated,
    key: String(key),
    name: String(input.name || existing?.name || p.name).slice(0, 60),
    adapter: input.adapter || existing?.adapter || 'builtin',
    imported: !!(input.imported || existing?.imported),
  };
}

function add(username, masterKey, input) {
  const d = read(username, masterKey);
  const cfg = buildConfig(input, null);
  cfg.id = randomUUID();
  cfg.createdAt = Date.now();
  d.configs.push(cfg);
  if (!d.active) d.active = cfg.id;
  write(username, d, masterKey);
  return cfg.id;
}

function remove(username, masterKey, id) {
  const d = read(username, masterKey);
  d.configs = d.configs.filter((c) => c.id !== id);
  if (d.active === id) d.active = d.configs[0]?.id || null;
  write(username, d, masterKey);
}

function setActive(username, masterKey, id) {
  const d = read(username, masterKey);
  if (!d.configs.some((c) => c.id === id)) throw new Error('配置不存在');
  d.active = id;
  write(username, d, masterKey);
}

async function test(username, masterKey, id) {
  const d = read(username, masterKey);
  const cfg = d.configs.find((c) => c.id === id);
  if (!cfg) throw new Error('配置不存在');
  return testConnection(cfg);
}

// ---- clean env object for settings.json / launch (no process.env inheritance) ----
// Minimal: a single model (ANTHROPIC_MODEL) + endpoint + credential + telemetry off.
// Non-official endpoints use ANTHROPIC_AUTH_TOKEN (Bearer) — the same format
// CC Switch writes, which Claude Code recognizes for relays (API_KEY would make
// it fall back to the official OAuth/login → api.anthropic.com).
function buildEnvVars(cfg) {
  const official = cfg.provider === 'anthropic';
  const env = {
    ANTHROPIC_API_KEY: official ? cfg.key : '',
    ...(!official ? { ANTHROPIC_AUTH_TOKEN: cfg.key || cfg.provider } : {}),
    ANTHROPIC_BASE_URL: cfg.baseUrl,
    ANTHROPIC_MODEL: cfg.model,
    DISABLE_AUTOUPDATER: '1',
    DISABLE_UPDATES: '1',
    DISABLE_TELEMETRY: '1',
    DISABLE_ERROR_REPORTING: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  };
  if (cfg.provider !== 'anthropic') env.CLAUDE_CODE_ATTRIBUTION_HEADER = '0';
  return env;
}

// ---- CC Switch settings.json import ----
function detectProvider(baseUrl) {
  const u = String(baseUrl || '');
  if (u.includes('deepseek.com')) return 'deepseek';
  if (u.includes('openrouter.ai')) return 'openrouter';
  if (u.includes('nvidia.com')) return 'nvidia';
  if (u.includes('generativelanguage') || u.includes('gemini')) return 'gemini';
  if (u.includes('api.openai.com')) return 'openai';
  if (u.includes('anthropic.com')) return 'anthropic';
  if (u.includes(':11434')) return 'ollama';
  if (u.includes(':1234')) return 'lmstudio';
  return 'custom';
}

function normalizeImported(raw, nameFallback) {
  if (typeof raw !== 'object' || raw === null) return null;
  const env = raw.env || raw.environment || {};
  const key = env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN || raw.apiKey || raw.key || raw.api_key || '';
  const baseUrl = env.ANTHROPIC_BASE_URL || raw.baseUrl || raw.base_url || raw.endpoint || '';
  const model = env.ANTHROPIC_MODEL || env.ANTHROPIC_DEFAULT_OPUS_MODEL || env.ANTHROPIC_SMALL_FAST_MODEL || raw.model || '';
  const anthropicIntent = !!(env.ANTHROPIC_BASE_URL || env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY);
  let provider = raw.provider || detectProvider(baseUrl || raw.base_url || raw.endpoint);
  if (!PROVIDERS[provider]) return null;
  // An unknown endpoint configured via ANTHROPIC_* env is meant for Claude Code
  // direct (Anthropic-compatible) use — not the OpenAI adapter.
  if (anthropicIntent && provider === 'custom') provider = 'custom-anthropic';
  if (!baseUrl && !key && !model) return null;
  return {
    provider,
    baseUrl: baseUrl || PROVIDERS[provider].baseUrl,
    model: model || (PROVIDERS[provider].defaultModel || '') ,
    key: String(key || ''),
    name: String(raw.name || raw.remark || nameFallback || PROVIDERS[provider].name).slice(0, 60),
    imported: true,
  };
}

function parseImport(content) {
  let doc;
  if (typeof content === 'string') doc = JSON.parse(content);
  else doc = content;
  if (doc === null || typeof doc !== 'object') throw new Error('无法解析的 settings.json');
  const out = [];
  const push = (raw) => { const c = normalizeImported(raw, out.length ? undefined : '导入配置'); if (c) out.push(c); };
  if (Array.isArray(doc)) { doc.forEach(push); }
  else if (Array.isArray(doc.profiles)) { doc.profiles.forEach(push); }
  else if (doc.profiles && typeof doc.profiles === 'object') { Object.values(doc.profiles).forEach(push); }
  else push(doc);
  if (!out.length) throw new Error('未在 settings.json 中找到可识别的提供商配置（看 env.ANTHROPIC_* 字段）');
  return out;
}

function importSettings(username, masterKey, content) {
  const parsed = parseImport(content);
  const ids = parsed.map((c) => add(username, masterKey, c));
  return ids;
}

module.exports = {
  read, list: publicConfigs, getActive,
  add, remove, setActive, test, buildEnvVars, importSettings,
};