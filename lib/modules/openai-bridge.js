// lib/modules/openai-bridge.js
// OpenAI-compatible proxy for the embedded NextChat frontend.
//
//   GET  /v1/models              -> the active agent's model
//   POST /v1/chat/completions    -> streams/returns in OpenAI format, routed to
//      the ACTIVE agent (per-session, same-origin cookie auth).
//
// Two transports:
//   - 'openai'    : proxy straight to <agent.baseUrl>/chat/completions
//   - 'anthropic' : translate OpenAI request -> Anthropic /v1/messages and back
// The active persona (CLAUDE.md) is prepended as a system message, so the
// dialog reflects the selected work persona without re-entering keys.
'use strict';

const AK = require('./agents');
const PR = require('./personas');
const PV = require('./providers');

const TIMEOUT_MS = 120000;

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

function resolveSession(username, masterKey) {
  const agent = AK.getActive(username, masterKey);
  if (!agent) throw httpError(400, '尚未配置智能体，请先在控制台「② 选择智能体」激活一个。');
  const slug = PR.getActive(username);
  if (!slug) throw httpError(400, '尚未选择工作人格，请先在控制台「③ 选择工作人格」激活一个。');
  let system = '';
  try { system = PR.readClaudeMD(username, slug); } catch { /* persona may be empty */ }
  return { agent, system: String(system || '') };
}

function modelsList(req, res, username, masterKey) {
  let agent = null;
  try { agent = AK.getActive(username, masterKey); } catch {}
  const id = agent?.model || '';
  return { object: 'list', data: id ? [{ id, object: 'model', owned_by: 'agent' }] : [] };
}

// ---- Anthropic request translation ----
function toAnthropicBody(body, system, model) {
  const messages = [];
  if (system && system.trim()) messages.push({ role: 'system', content: system });
  for (const m of body.messages || []) {
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '');
    if (!content) continue;
    messages.push({ role, content });
  }
  const req = { model: model || body.model || '', messages, stream: !!body.stream };
  if (body.max_tokens) req.max_tokens = body.max_tokens;
  if (body.temperature !== undefined) req.temperature = body.temperature;
  return req;
}

// Anthropic SSE -> OpenAI SSE chunks (write to res)
async function anthropicToOpenAI(upstreamBody, res) {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const value of upstreamBody) {
    buf += decoder.decode(value, { stream: true });
    let n;
    while ((n = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, n); buf = buf.slice(n + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      let ev; try { ev = JSON.parse(data); } catch { continue; }
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
        res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: ev.delta.text }, index: 0 }] }) + '\n\n');
      }
    }
  }
}

// ---- entry ----
async function handleChatCompletions(req, res, username, masterKey) {
  req.setTimeout(TIMEOUT_MS);
  const chunks = [];
  for await (const c of req) chunks.push(c);
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { throw httpError(400, 'bad JSON'); }
  const { agent, system } = resolveSession(username, masterKey);
  const p = PV.PROVIDERS[agent.provider];
  if (!p) throw httpError(400, '未知提供商');
  const useStream = !!body.stream;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    if (p.transport === 'anthropic') {
      const upstream = await fetch(`${agent.baseUrl.replace(/\/+$/, '')}/v1/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': agent.key || '', 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(toAnthropicBody(body, system, agent.model)),
        signal: controller.signal,
      });
      if (!upstream.ok) throw await apiError(upstream, 'anthropic');
      if (!useStream) {
        const j = await upstream.json();
        const text = (j.content || []).map((b) => (b.type === 'text' ? b.text : '')).join('') || '';
        return sendJson(res, 200, openaiCompletion(agent.model, text, j.usage));
      }
      writeSSE(res);
      await anthropicToOpenAI(upstream.body, res);
      res.write('data: ' + JSON.stringify({ choices: [{ delta: {}, index: 0, finish_reason: 'stop' }] }) + '\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    // ---- openai transport: prepend persona system, then proxy ----
    const messages = [];
    if (system && system.trim()) messages.push({ role: 'system', content: system });
    for (const m of body.messages || []) { if (m.role && m.content !== undefined) messages.push({ role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }); }
    const payload = { ...body, model: agent.model, messages };
    const upstream = await fetch(`${agent.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${agent.key || ''}` },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!upstream.ok) throw await apiError(upstream, 'openai');
    if (!useStream) return sendJson(res, 200, await upstream.json());
    writeSSE(res);
    for await (const chunk of upstream.body) res.write(chunk);
    res.end();
  } finally {
    clearTimeout(timer);
  }
}

function sendJson(res, code, obj) {
  const b = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(b);
  return true;
}
function writeSSE(res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff' });
}
function openaiCompletion(model, content, usage) {
  return {
    id: `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: usage?.input_tokens || 0, completion_tokens: usage?.output_tokens || 0, total_tokens: (usage?.input_tokens || 0) + (usage?.output_tokens || 0) },
  };
}
async function apiError(resp, label) {
  let detail = '';
  try { const t = await resp.text(); try { detail = JSON.stringify(JSON.parse(t)).slice(0, 300); } catch { detail = t.slice(0, 300); } } catch {}
  return httpError(resp.status, `${label} upstream ${resp.status}: ${detail || 'no detail'}`);
}

module.exports = { handleChatCompletions, modelsList, resolveSession };