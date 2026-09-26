// lib/modules/adapter.js
// Built-in local adapter: translates Anthropic Messages requests from Claude
// Code into OpenAI Chat Completions for providers whose transport is 'openai'
// (OpenRouter/NVIDIA/Gemini/OpenAI/Ollama/LM Studio/custom). Loops back on
// 127.0.0.1 with a per-run token, streaming SSE. Transplanted from
// ClaudeCode-Portable (MIT).
'use strict';

const { createServer } = require('node:http');
const { randomBytes, randomUUID } = require('node:crypto');

// ---- tiny http helpers (from upstream lib/http.mjs) ----
function readBody(req, limit = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(Object.assign(new Error('Request too large'), { status: 413 })); req.destroy(); } chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); } });
    req.on('error', reject);
  });
}
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
}
async function* sseData(body) {
  const decoder = new TextDecoder(); let buffer = ''; let data = [];
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let n;
    while ((n = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, n).replace(/\r$/, ''); buffer = buffer.slice(n + 1);
      if (!line) { if (data.length) yield data.join('\n'); data = []; }
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
  }
  if (buffer.startsWith('data:')) data.push(buffer.slice(5).trim());
  if (data.length) yield data.join('\n');
}

// ---- translation ----
function textContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) throw new Error('Unsupported message content');
  return content.map((b) => { if (b.type !== 'text') throw new Error(`Unsupported content: ${b.type}`); return b.text; }).join('\n');
}
function imageContent(block) {
  const source = block?.source;
  if (source?.type !== 'base64' || !/^image\/(png|jpeg|gif|webp)$/.test(source.media_type)) throw new Error('仅支持 base64 的 PNG/JPEG/GIF/WebP 图片');
  return { type: 'image_url', image_url: { url: `data:${source.media_type};base64,${source.data}` } };
}
function toolResultContent(block) {
  if (typeof block.content === 'string') return { text: block.content, images: [] };
  if (!Array.isArray(block.content)) return { text: '', images: [] };
  const text = [], images = [];
  for (const part of block.content) {
    if (part.type === 'text') text.push(part.text);
    else if (part.type === 'image') images.push(imageContent(part));
    else throw new Error(`Unsupported content: ${part.type}`);
  }
  return { text: text.join('\n'), images };
}
function translateRequest(body, model, { toolMetadata = new Map() } = {}) {
  if (!Array.isArray(body.messages)) throw new Error('messages must be an array');
  if (body.thinking && body.thinking.type !== 'disabled') throw new Error('该适配器不支持 extended thinking，请对该模型关闭');
  const messages = [];
  if (body.system) messages.push({ role: 'system', content: textContent(body.system) });
  for (const message of body.messages) {
    if (message.role === 'system') { messages.push({ role: 'system', content: textContent(message.content) }); continue; }
    if (!['user', 'assistant'].includes(message.role)) throw new Error(`Unsupported message role: ${String(message.role)}`);
    if (typeof message.content === 'string') { messages.push({ role: message.role, content: message.content }); continue; }
    const content = [], calls = [], results = [];
    for (const b of message.content || []) {
      if (b.type === 'text') content.push({ type: 'text', text: b.text });
      else if (b.type === 'image' && message.role === 'user') content.push(imageContent(b));
      else if (b.type === 'tool_use' && message.role === 'assistant') {
        const call = { id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input) } };
        const metadata = toolMetadata.get(b.id); if (metadata) call.extra_content = metadata;
        calls.push(call);
      } else if (b.type === 'tool_result' && message.role === 'user') {
        const converted = toolResultContent(b);
        const label = converted.images.length ? '该工具返回了图片内容。' : '';
        results.push({ role: 'tool', tool_call_id: b.tool_use_id, content: (b.is_error ? 'Tool error: ' : '') + (converted.text || label) });
        if (converted.images.length) content.push({ type: 'text', text: `工具调用 ${b.tool_use_id} 返回了图片。` }, ...converted.images);
      } else throw new Error(`Unsupported content block: ${b.type}`);
    }
    messages.push(...results);
    if (content.length || calls.length) {
      messages.push({
        role: message.role,
        content: content.length ? (content.every((b) => b.type === 'text') ? content.map((b) => b.text).join('\n') : content) : null,
        ...(calls.length ? { tool_calls: calls } : {}),
      });
    }
  }
  const request = { model, messages, stream: !!body.stream };
  if (body.max_tokens) request.max_tokens = body.max_tokens;
  if (body.temperature !== undefined) request.temperature = body.temperature;
  if (body.top_p !== undefined) request.top_p = body.top_p;
  if (body.stop_sequences?.length) request.stop = body.stop_sequences;
  if (body.tools?.length) request.tools = body.tools.map((t) => {
    if (t.type && t.type !== 'custom') throw new Error(`Server tool ${t.type} 该提供商不支持`);
    return { type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } };
  });
  if (body.tool_choice) {
    const c = body.tool_choice;
    request.tool_choice = c.type === 'tool' ? { type: 'function', function: { name: c.name } } : c.type === 'any' ? 'required' : c.type;
    if (!['auto', 'none', 'any', 'tool'].includes(c.type)) throw new Error('不支持的 tool_choice');
    if (c.disable_parallel_tool_use) request.parallel_tool_calls = false;
  }
  if (request.stream) request.stream_options = { include_usage: true };
  return request;
}
const stopReason = (reason) => reason === 'tool_calls' || reason === 'function_call' ? 'tool_use' : reason === 'length' ? 'max_tokens' : 'end_turn';
function usage(value = {}) { return { input_tokens: value.prompt_tokens || 0, output_tokens: value.completion_tokens || 0 }; }
function translateResponse(body, model, { onToolCall = () => {} } = {}) {
  const choice = body.choices?.[0];
  if (!choice) throw new Error('Provider returned no completion');
  if (choice.finish_reason === 'content_filter' || choice.message?.refusal) throw new Error('Provider refused the request');
  const content = [];
  if (choice.message?.content) content.push({ type: 'text', text: choice.message.content });
  for (const call of choice.message?.tool_calls || []) { onToolCall(call.id, call.extra_content); content.push({ type: 'tool_use', id: call.id, name: call.function.name, input: JSON.parse(call.function.arguments) }); }
  return { id: body.id || `msg_${randomUUID()}`, type: 'message', role: 'assistant', model, content, stop_reason: stopReason(choice.finish_reason), stop_sequence: null, usage: usage(body.usage) };
}
async function translateStream(body, model, send, { onToolCall = () => {} } = {}) {
  send('message_start', { type: 'message_start', message: { id: `msg_${randomUUID()}`, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: usage() } });
  let next = 0, textIndex = null, finish = null, counts = usage(); const calls = new Map();
  for await (const data of sseData(body)) {
    if (data === '[DONE]') break;
    const chunk = JSON.parse(data);
    if (chunk.error) throw new Error(chunk.error.message || 'Provider streaming error');
    if (chunk.usage) counts = usage(chunk.usage);
    const choice = chunk.choices?.[0]; if (!choice) continue;
    if (choice.finish_reason) finish = choice.finish_reason;
    const delta = choice.delta || {};
    if (delta.refusal || finish === 'content_filter') throw new Error('Provider refused the request');
    if (delta.content) {
      if (textIndex === null) { textIndex = next++; send('content_block_start', { type: 'content_block_start', index: textIndex, content_block: { type: 'text', text: '' } }); }
      send('content_block_delta', { type: 'content_block_delta', index: textIndex, delta: { type: 'text_delta', text: delta.content } });
    }
    for (const t of delta.tool_calls || []) {
      let call = calls.get(t.index);
      if (!call) { call = { id: '', name: '', args: '', extraContent: null }; calls.set(t.index, call); }
      call.id ||= t.id || ''; call.name += t.function?.name || ''; call.args += t.function?.arguments || ''; if (t.extra_content) call.extraContent = t.extra_content;
    }
  }
  if (!finish) throw new Error('Provider stream ended without a completion marker');
  if (textIndex !== null) send('content_block_stop', { type: 'content_block_stop', index: textIndex });
  for (const call of calls.values()) {
    call.index = next++;
    if (!call.id || !call.name) throw new Error('Provider returned an incomplete tool call');
    JSON.parse(call.args || '{}');
    onToolCall(call.id, call.extraContent);
    send('content_block_start', { type: 'content_block_start', index: call.index, content_block: { type: 'tool_use', id: call.id, name: call.name, input: {} } });
    send('content_block_delta', { type: 'content_block_delta', index: call.index, delta: { type: 'input_json_delta', partial_json: call.args || '{}' } });
    send('content_block_stop', { type: 'content_block_stop', index: call.index });
  }
  send('message_delta', { type: 'message_delta', delta: { stop_reason: stopReason(finish), stop_sequence: null }, usage: counts });
  send('message_stop', { type: 'message_stop' });
}
async function upstreamError(response, label, key) {
  let detail = '';
  try { const text = await response.text(); try { const body = JSON.parse(text); detail = body?.error?.message || body?.message || body?.detail || text; } catch { detail = text; } } catch { /* noop */ }
  if (key && detail) detail = String(detail).split(key).join('[REDACTED]');
  return `${label} returned HTTP ${response.status}${detail ? `: ${String(detail).slice(0, 500)}` : ''}`;
}

async function startAdapter(profile, { fetchImpl = fetch, onError = () => {} } = {}) {
  const token = randomBytes(32).toString('hex');
  const controllers = new Set();
  const toolMetadata = new Map();
  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${token}` && req.headers['x-api-key'] !== token) {
      return json(res, 401, { error: { type: 'authentication_error', message: 'Invalid local adapter token' } });
    }
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (req.method !== 'POST' || !['/v1/messages', '/v1/messages/count_tokens'].includes(pathname)) {
      return json(res, 404, { error: { type: 'not_found_error', message: 'Unsupported adapter endpoint' } });
    }
    const controller = new AbortController(); controllers.add(controller);
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    let streaming = false;
    const send = (event, value) => res.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`);
    try {
      const body = await readBody(req, 20 * 1024 * 1024);
      if (pathname.endsWith('/count_tokens')) {
        const count = Math.ceil(JSON.stringify({ system: body.system, messages: body.messages, tools: body.tools }).length / 3);
        res.setHeader('X-Portable-AI-Token-Count', 'estimate');
        return json(res, 200, { input_tokens: count, estimated: true });
      }
      const remember = (id, metadata) => { if (id && metadata) toolMetadata.set(id, metadata); };
      const request = translateRequest(body, profile.model, { toolMetadata });
      const upstream = await fetchImpl(`${profile.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(profile.key ? { Authorization: `Bearer ${profile.key}` } : {}) },
        body: JSON.stringify(request),
        redirect: 'error',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(180000)]),
      });
      if (!upstream.ok) {
        const status = upstream.status;
        const message = await upstreamError(upstream, 'Provider', profile.key);
        onError(message);
        return json(res, status, { type: 'error', error: { type: status === 429 ? 'rate_limit_error' : status === 401 || status === 403 ? 'authentication_error' : 'api_error', message } });
      }
      if (body.stream) {
        streaming = true;
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
        await translateStream(upstream.body, profile.model, send, { onToolCall: remember });
        res.end();
      } else {
        json(res, 200, translateResponse(await upstream.json(), profile.model, { onToolCall: remember }));
      }
    } catch (error) {
      let message = error.message;
      if (profile.key) message = message.split(profile.key).join('[REDACTED]');
      if (!controller.signal.aborted) onError(message);
      const value = { type: 'error', error: { type: 'invalid_request_error', message } };
      if (streaming) { send('error', value); res.end(); } else if (!res.destroyed) json(res, error.status || 400, value);
    } finally {
      controllers.delete(controller);
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return {
    token,
    url: `http://127.0.0.1:${server.address().port}`,
    close: async () => { controllers.forEach((c) => c.abort()); server.closeAllConnections(); await new Promise((r) => server.close(r)); },
  };
}

module.exports = { startAdapter };