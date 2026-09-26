// lib/modules/dialog.js
// Dialog mode: drive the official Claude Agent SDK (bundled in the installed
// runtime) to stream a chat conversation in a GUI dialog — as opposed to the
// terminal (CLI) mode. Companion to lib/modules/runtime.js (loadSDK) and the
// agent/persona layers. One in-memory conversation per account; nothing is
// persisted to the host.
'use strict';

const { randomUUID } = require('crypto');
const RT = require('./runtime');
const AD = require('./adapter');
const PV = require('./providers');
const AK = require('./agents');
const PR = require('./personas');

const sessions = new Map(); // username -> DialogSession

class DialogSession {
  constructor(username, masterKey) {
    this.username = username;
    this.mk = masterKey;
    this.messages = [];      // in-memory transcript
    this.sdkSessionId = null;
    this.run = null;         // active turn state
  }
}

function getSession(username, masterKey) {
  let s = sessions.get(username);
  if (!s) { s = new DialogSession(username, masterKey); sessions.set(username, s); }
  s.mk = masterKey;
  return s;
}

function providerDiagnostic(message, provider, model) {
  const code = String(message || '').match(/http\s+(\d{3})/i)?.[1];
  return `${provider} 请求${code ? `返回 HTTP ${code}` : '失败'}（模型 ${model}）。端点未提供诊断信息，模型可能拒绝了请求、超出上下文，或缺少完整的 Claude Code 工具支持。请换个模型或新建对话重试。`;
}

// runTurn(): stream one user prompt through the Agent SDK.
async function runTurn(session, { prompt, permissionMode = 'default', confirmation, emit = () => {} }) {
  if (session.run && session.run.running) throw new Error('上一条回复仍在进行中，请稍候');
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 100000) throw new Error('请输入不超过 10 万字的消息');
  if (!['default', 'acceptEdits', 'bypassPermissions'].includes(permissionMode)) throw new Error('不支持的权限模式');
  if (permissionMode === 'bypassPermissions' && confirmation !== 'UNRESTRICTED') throw new Error('无限制模式需要输入 UNRESTRICTED 确认');

  const agent = AK.getActive(session.username, session.mk);
  if (!agent) throw new Error('尚未配置智能体。请在管理控制台「智能体」中选择一个。');
  const personaSlug = PR.getActive(session.username);
  if (!personaSlug) throw new Error('尚未选择工作人格。请在管理控制台「工作人格」中选择一个。');
  const cwd = PR.dir(session.username, personaSlug);
  if (!require('node:fs').existsSync(cwd)) throw new Error('工作人格目录不存在');

  const executable = RT.executableAt();
  if (!executable) throw new Error('尚未安装 Claude Code 引擎。请先到「环境检查 → 确认安装」。');

  // materialize mainstream settings.json (persona + active agent env) so the
  // SDK picks up systemPrompt + CLAUDE.md
  PR.writeSettings(session.username, personaSlug, session.mk);

  let adapter = null;
  try {
    const provider = PV.PROVIDERS[agent.provider];
    if (provider.transport === 'openai') adapter = await AD.startAdapter(agent, {});
    const env = PV.providerEnvironment(agent, { adapter });
    env.CLAUDE_CONFIG_DIR = cwd;

    const sdk = await RT.loadSDK();
    const run = {
      id: randomUUID(), running: true, approvals: new Map(), cancelled: false,
      controller: new AbortController(), query: null, lastError: null, startedAt: Date.now(),
    };
    session.run = run;
    session.messages.push({ role: 'user', content: prompt });

    const options = {
      cwd,
      env,
      pathToClaudeCodeExecutable: executable,
      model: agent.model,
      permissionMode,
      allowDangerouslySkipPermissions: permissionMode === 'bypassPermissions',
      includePartialMessages: true,
      maxTurns: 30,
      abortController: run.controller,
      ...(session.sdkSessionId ? { resume: session.sdkSessionId } : {}),
      ...(adapter ? { thinking: { type: 'disabled' } } : {}),
      canUseTool: async (name, input, context) => {
        if (run.cancelled) return { behavior: 'deny', message: '会话已取消' };
        const requestId = randomUUID();
        emit({ type: 'approval', requestId, tool: name, input, toolUseId: context?.toolUseID });
        return new Promise((resolve) => {
          let settled = false;
          const finish = (decision) => {
            if (settled) return; settled = true;
            run.approvals.delete(requestId);
            emit({ type: 'approval_resolved', requestId, approved: decision.behavior === 'allow' });
            resolve(decision);
          };
          run.approvals.set(requestId, { name, input, finish });
          context?.signal?.addEventListener?.('abort', () => finish({ behavior: 'deny', message: '审批已取消' }), { once: true });
        });
      },
      stderr: (data) => {
        run.lastError = String(data).slice(-2000);
        if (/authentication_error|rate_limit_error|overloaded_error|invalid_request_error|HTTP\s+[45]\d\d|ECONNREFUSED|ENOTFOUND|fetch failed/i.test(run.lastError)) run.providerError = run.lastError;
      },
    };

    run.query = sdk.query({ prompt, options });
    emit({ type: 'status', status: 'running' });

    const streamBlocks = new Map();
    let streamMessageId = 'partial', resultSeen = false;

    for await (const message of run.query) {
      if (['stream_event', 'assistant', 'result'].includes(message.type)) run.lastActivity = Date.now();
      if (message.session_id) session.sdkSessionId = message.session_id;
      if (message.type === 'system' && message.subtype === 'init') emit({ type: 'session', sdkSessionId: message.session_id, model: message.model });

      if (message.type === 'stream_event') {
        const ev = message.event;
        if (ev?.type === 'message_start') streamMessageId = ev.message.id;
        if (ev?.delta?.type === 'text_delta') {
          const id = `${streamMessageId}:${ev.index ?? 0}`;
          const block = streamBlocks.get(id) || { id, text: '' };
          block.text += ev.delta.text; streamBlocks.set(id, block);
          emit({ type: 'delta', id, text: ev.delta.text });
        }
      }
      if (message.type === 'assistant') {
        let text = '';
        for (const block of message.message?.content || []) {
          if (block.type === 'text') text += block.text;
          if (block.type === 'thinking' && typeof block.thinking === 'string' && block.thinking.trim()) emit({ type: 'thinking', text: block.thinking });
          if (block.type === 'tool_use') emit({ type: 'tool', id: block.id, name: block.name, input: block.input, status: 'running' });
        }
        if (text) { session.messages.push({ role: 'assistant', content: text }); emit({ type: 'message', role: 'assistant', text }); }
      }
      if (message.type === 'user') {
        for (const block of message.message?.content || []) {
          if (block.type === 'tool_result') emit({ type: 'tool_result', id: block.tool_use_id, output: block.content, status: block.is_error ? 'failed' : 'completed' });
        }
      }
      if (message.type === 'result') {
        resultSeen = true;
        const failed = run.providerError || run.cancelled || message.is_error;
        const error = !run.cancelled && (run.providerError ? providerDiagnostic(run.providerError, PV.PROVIDERS[agent.provider]?.name || agent.provider, agent.model) : (message.is_error ? providerDiagnostic(String((message.errors || [message.result]).join('\n')), PV.PROVIDERS[agent.provider]?.name || agent.provider, agent.model) : null));
        emit({ type: 'result', status: failed ? 'failed' : 'completed', usage: message.usage, costUSD: message.total_cost_usd, durationMs: Math.max(0, Date.now() - run.startedAt), error });
      }
    }
    if (!resultSeen) {
      emit({ type: 'result', status: run.cancelled ? 'cancelled' : 'failed', durationMs: Math.max(0, Date.now() - run.startedAt), error: run.cancelled ? null : providerDiagnostic(run.providerError || run.lastError || 'Unknown error', PV.PROVIDERS[agent.provider]?.name || agent.provider, agent.model) });
    }
  } catch (error) {
    emit({ type: 'result', status: 'failed', durationMs: 0, error: error.message });
  } finally {
    if (session.run) session.run.running = false;
    if (adapter) await adapter.close();
  }
}

function approve(session, requestId, approved, answers) {
  const run = session.run;
  const pending = run?.approvals?.get(requestId);
  if (!pending) throw new Error('该审批已不存在或已处理');
  let input = pending.input;
  if (approved && pending.name === 'AskUserQuestion') {
    if (!answers || typeof answers !== 'object') throw new Error('回答每个问题后才能继续');
    const clean = {};
    for (const q of input.questions || []) {
      if (typeof answers[q.question] !== 'string' || !answers[q.question].trim()) throw new Error(`请回答: ${q.question}`);
      clean[q.question] = answers[q.question].slice(0, 4000);
    }
    input = { ...input, answers: clean };
  }
  pending.finish(approved ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: '用户已拒绝该操作' });
}

async function cancel(session) {
  const run = session.run;
  if (!run) return;
  run.cancelled = true;
  for (const p of run.approvals.values()) p.finish({ behavior: 'deny', message: '用户取消了本次回复' });
  try { await run.query?.interrupt?.(); } catch {}
  run.controller.abort();
}

module.exports = { getSession, runTurn, approve, cancel };