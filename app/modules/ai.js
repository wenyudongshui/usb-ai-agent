// app/modules/ai.js
// OpenAI-compatible chat client using native fetch. Zero dependencies.
'use strict';

const TIMEOUT_MS = 30000;

// chat(config, messages) -> { content }
//   config: { baseURL, model, apiKey, temperature }
//   messages: [{role, content}, ...]  (system/persona injected by caller)
async function chat(config, messages) {
  const url = `${config.baseURL.replace(/\/+$/, '')}/chat/completions`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: config.temperature ?? 0.7,
      }),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`API ${resp.status}: ${text.slice(0, 200)}`);
    }
    const data = await resp.json();
    return data.choices?.[0]?.message?.content ?? '';
  } finally {
    clearTimeout(timer);
  }
}

// test(config) -> cheap connectivity check (max_tokens=1)
async function test(config) {
  const url = `${config.baseURL.replace(/\/+$/, '')}/chat/completions`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
    });
    return resp.ok;
  } finally {
    clearTimeout(timer);
  }
}

// TODO(Phase 3): SSE streaming variant (chatStream) on top of this.

module.exports = { chat, test };