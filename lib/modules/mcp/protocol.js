// lib/modules/mcp/protocol.js
// Minimal MCP stdio server scaffold — newline-delimited JSON-RPC 2.0 over
// stdin/stdout. Zero dependencies: the stdio transport is small enough that
// pulling in @modelcontextprotocol/sdk (100+ transitive packages) to answer
// four methods would be the wrong trade.
//
// Answers exactly what a tools-only server must: initialize · tools/list ·
// tools/call · ping. Notifications (no id) are accepted and ignored.
//
// stdout is the PROTOCOL CHANNEL — never console.log() from a tool handler.
// Use log() (stderr) for anything human-readable.
'use strict';

function log(...args) {
  process.stderr.write('[mcp] ' + args.map(String).join(' ') + '\n');
}

function serve({ name, version, tools }) {
  const byName = new Map(tools.map((t) => [t.name, t]));

  const write = (msg) => { process.stdout.write(JSON.stringify(msg) + '\n'); };
  const reply = (id, result) => write({ jsonrpc: '2.0', id, result });
  const fail = (id, code, message) => write({ jsonrpc: '2.0', id, error: { code, message } });

  async function dispatch(msg) {
    const { id, method, params } = msg;
    const isNotification = id === undefined || id === null;

    switch (method) {
      case 'initialize':
        return reply(id, {
          // echo the client's requested version — we implement the stable core
          // surface, which both 2024-11-05 and 2025-06-18 clients speak
          protocolVersion: params?.protocolVersion || '2024-11-05',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name, version },
        });

      case 'notifications/initialized':
      case 'notifications/cancelled':
        return; // notifications never get a response

      case 'ping':
        return reply(id, {});

      case 'tools/list':
        return reply(id, {
          tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
        });

      case 'tools/call': {
        const tool = byName.get(params?.name);
        if (!tool) return fail(id, -32602, `未知工具: ${params?.name}`);
        try {
          const out = await tool.handler(params.arguments || {});
          return reply(id, { content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out, null, 2) }] });
        } catch (e) {
          // tool failures are results, not protocol errors — the model must see
          // the message so it can correct itself
          return reply(id, { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true });
        }
      }

      default:
        if (isNotification) return;
        return fail(id, -32601, `未实现的方法: ${method}`);
    }
  }

  // serialize: a chunk can carry several messages and handlers are async —
  // chain them so replies always arrive in request order
  let queue = Promise.resolve();
  let buf = '';

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    let n;
    while ((n = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, n).trim();
      buf = buf.slice(n + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { log('skipped malformed line'); continue; }
      queue = queue.then(() => dispatch(msg)).catch((e) => log('dispatch error:', e.message));
    }
  });
  process.stdin.on('end', () => process.exit(0));
}

module.exports = { serve, log };
