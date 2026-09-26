// lib/modules/providers.js
// Provider catalog + per-profile environment for launching Claude Code,
// transplanted from ClaudeCode-Portable (MIT).
'use strict';

const path = require('path');
const P = require('../paths');

const PROVIDERS = {
  anthropic: { name: 'Anthropic', short: 'AN', description: 'Claude models · API key', transport: 'anthropic', baseUrl: 'https://api.anthropic.com', defaultModel: 'sonnet' },
  openrouter: { name: 'OpenRouter', short: 'OR', description: '统一模型市场（Anthropic 兼容端点）', transport: 'anthropic', baseUrl: 'https://openrouter.ai/api/v1', modelsUrl: 'https://openrouter.ai/api/v1/models' },
  deepseek: { name: 'DeepSeek', short: 'DS', description: 'Anthropic 兼容 API', transport: 'anthropic', baseUrl: 'https://api.deepseek.com/anthropic', modelsUrl: 'https://api.deepseek.com/models' },
  nvidia: { name: 'NVIDIA NIM', short: 'NV', description: '云推理 · 本地适配器', transport: 'openai', baseUrl: 'https://integrate.api.nvidia.com/v1' },
  gemini: { name: 'Google Gemini', short: 'GE', description: 'Google AI · 本地适配器', transport: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  openai: { name: 'OpenAI', short: 'OA', description: 'Chat Completions · 本地适配器', transport: 'openai', baseUrl: 'https://api.openai.com/v1' },
  ollama: { name: 'Ollama', short: 'OL', description: '本地模型 · 离线推理 · 本地适配器', transport: 'openai', baseUrl: 'http://127.0.0.1:11434/v1', local: true },
  lmstudio: { name: 'LM Studio', short: 'LM', description: '本地模型服务器 · 本地适配器', transport: 'openai', baseUrl: 'http://127.0.0.1:1234/v1', local: true },
  custom: { name: 'Custom API', short: '<>', description: '任意 Chat Completions 兼容 API · 本地适配器', transport: 'openai', baseUrl: 'http://127.0.0.1:8080/v1', local: true },
  'custom-anthropic': { name: '自定义 · Anthropic 兼容', short: 'CA', description: '任意 Anthropic Messages 兼容端点（Claude Code 直连）', transport: 'anthropic', baseUrl: 'https://api.anthropic.com', local: false },
};

function tierModel(profile, tier) {
  if (profile.adapter !== 'external') return profile.model;
  const alias = profile.modelAliases?.[tier];
  return typeof alias === 'string' && alias.trim() ? alias.trim() : profile.model;
}

function providerEnvironment(profile, { adapter, dashboard = false, parent = process.env } = {}) {
  const env = { ...parent };
  // Do not allow ambient credentials to choose a different backend.
  for (const k of Object.keys(env)) {
    if (/^(ANTHROPIC_|CLAUDE_CODE_|CLAUDE_CONFIG_DIR$|OPENAI_|GEMINI_|GOOGLE_API_KEY$|OPENROUTER_|DEEPSEEK_|NVIDIA_|AWS_|AZURE_)/.test(k)) delete env[k];
  }
  const p = PROVIDERS[profile.provider];
  if (!p) throw new Error('Unknown provider');
  Object.assign(env, {
    XDG_CACHE_HOME: path.join(P.DATA_DIR, 'cache'),
    DISABLE_AUTOUPDATER: '1',
    DISABLE_UPDATES: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    DISABLE_TELEMETRY: '1',
    DISABLE_ERROR_REPORTING: '1',
  });
  if (p.transport === 'openai' && !adapter) throw new Error('该提供商需要本地适配器，但适配器未运行');
  env.ANTHROPIC_BASE_URL = adapter?.url || profile.baseUrl;
  if (profile.provider === 'anthropic') env.ANTHROPIC_API_KEY = profile.key;
  else { env.ANTHROPIC_AUTH_TOKEN = adapter?.token || profile.key || profile.provider; env.ANTHROPIC_API_KEY = ''; }
  Object.assign(env, {
    ANTHROPIC_MODEL: profile.model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: tierModel(profile, 'opus'),
    ANTHROPIC_DEFAULT_SONNET_MODEL: tierModel(profile, 'sonnet'),
    ANTHROPIC_DEFAULT_HAIKU_MODEL: tierModel(profile, 'haiku'),
    ANTHROPIC_SMALL_FAST_MODEL: tierModel(profile, 'haiku'),
    CLAUDE_CODE_SUBAGENT_MODEL: tierModel(profile, 'sonnet'),
  });
  if (profile.provider !== 'anthropic') env.CLAUDE_CODE_ATTRIBUTION_HEADER = '0';
  return env;
}

function providerURL(profile) {
  const p = PROVIDERS[profile.provider];
  if (!p) throw new Error('Unknown provider');
  const base = profile.baseUrl || p.baseUrl;
  if (profile.provider === 'ollama') return `${base.replace(/\/+$/, '')}/../api/tags`;
  if (p.modelsUrl && base === p.baseUrl) return p.modelsUrl;
  return `${base.replace(/\/+$/, '')}/models`;
}

function providerHeaders(profile) {
  if (profile.provider === 'anthropic') return { 'x-api-key': profile.key || '', 'anthropic-version': '2023-06-01' };
  return profile.key ? { Authorization: `Bearer ${profile.key}` } : {};
}

async function testConnection(profile, { fetcher = fetch, signal } = {}) {
  const p = PROVIDERS[profile.provider];
  if (!p) throw new Error('Unknown provider');
  const base = profile.baseUrl || p.baseUrl;
  const url = p.transport === 'anthropic' ? `${base.replace(/\/+$/, '')}/v1/messages` : providerURL(profile);
  let res;
  try {
    res = await fetcher(url, {
      method: p.transport === 'anthropic' ? 'POST' : 'GET',
      headers: {
        ...providerHeaders(profile),
        ...(p.transport === 'anthropic' ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(p.transport === 'anthropic' ? { body: JSON.stringify({ model: profile.model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }) } : {}),
      signal: signal || AbortSignal.timeout(15000),
      redirect: 'error',
    });
  } catch (error) {
    if (error.name === 'TimeoutError') throw new Error('连接超时（15 秒）。请检查端点与网络。');
    throw new Error(`无法连接端点：${error.message}`);
  }
  if (!res.ok) {
    let detail = '';
    try { const body = await res.json(); detail = body?.error?.message || body?.message || body?.detail || ''; } catch { /* noop */ }
    if (profile.key && detail) detail = String(detail).split(profile.key).join('[REDACTED]');
    const reason = (res.status === 401 || res.status === 403) ? '凭据被拒绝。' : '端点返回错误。';
    throw new Error(`${reason} HTTP ${res.status}${detail ? `：${String(detail).slice(0, 300)}` : ''}`);
  }
  return { ok: true, message: profile.key ? '连接成功，端点和密钥有效。' : '连接成功，端点可达。' };
}

function validateBaseURL(value) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Base URL 必须是不带凭据/查询串/锚点的 HTTP(S) 地址');
  }
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('远程端点必须使用 HTTPS');
  }
  return url.href.replace(/\/+$/, '');
}

module.exports = {
  PROVIDERS, providerEnvironment, testConnection, validateBaseURL,
};