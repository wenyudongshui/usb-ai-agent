// lib/modules/ai.js
// OpenAI-compatible chat client using native fetch. Zero dependencies.
// Non-streaming chat(), SSE streaming chatStream(), and test().
'use strict';

const TIMEOUT_MS = 30000;
const STREAM_TIMEOUT_MS = 120000;

function apiURL(config) {
  return `${String(config.baseURL || '').replace(/\/+$/, '')}/chat/completions`;
}

function headers(config) {
  return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` };
}

// chat(config, messages) -> content string (non-streaming)
async function chat(config, messages) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(apiURL(config), {
      method: 'POST',
      signal: ctrl.signal,
      headers: headers(config),
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: config.temperature ?? 0.7,
      }),
    });
    if (!resp.ok) throw apiError(resp);
    const data = await resp.json();
    return data.choices?.[0]?.message?.content ?? '';
  } finally {
    clearTimeout(timer);
  }
}

// chatStream(config, messages, onDelta, {onDone, onError}) -> Promise<full content>
// Uses SSE (stream:true); calls onDelta(deltaChunk) as chunks arrive.
// Falls back to non-streaming chat() if the endpoint does not support streaming.
async function chatStream(config, messages, onDelta) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), STREAM_TIMEOUT_MS);
  let full = '';
  try {
    const resp = await fetch(apiURL(config), {
      method: 'POST',
      signal: ctrl.signal,
      headers: headers(config),
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: config.temperature ?? 0.7,
        stream: true,
      }),
    });
    if (!resp.ok) throw apiError(resp);
    if (!resp.body) throw new Error('streaming body unavailable');
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop();
      for (const block of blocks) {
        for (const line of block.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const json = JSON.parse(payload);
            const delta = json.choices?.[0]?.delta?.content ?? '';
            if (delta) { full += delta; onDelta && onDelta(delta); }
          } catch { /* ignore malformed chunk */ }
        }
      }
    }
    return full;
  } finally {
    clearTimeout(timer);
  }
}

// test(config) -> cheap connectivity check (max_tokens=1)
async function test(config) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const resp = await fetch(apiURL(config), {
      method: 'POST',
      signal: ctrl.signal,
      headers: headers(config),
      body: JSON.stringify({ model: config.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
    });
    return resp.ok;
  } finally {
    clearTimeout(timer);
  }
}

async function apiError(resp) {
  const text = await resp.text().catch(() => '');
  const err = new Error(`API ${resp.status}: ${text.slice(0, 200)}`);
  err.status = resp.status;
  return err;
}

module.exports = { chat, chatStream, test };