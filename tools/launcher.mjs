import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import net from 'node:net';

const require = createRequire(import.meta.url);

const P = require('../lib/paths.js');
const CLN = require('../lib/modules/cleanup.js');
const USB = require('../lib/modules/usb.js');
const LOC = require('../lib/modules/local-models.js');
const PR = require('../lib/modules/personas.js');
const A = require('../lib/modules/auth.js');
const RT = require('../lib/modules/runtime.js');
const AD = require('../lib/modules/adapter.js');
const { PROVIDERS } = require('../lib/modules/providers.js');
const pkg = require('../package.json');

const ROOT = P.ROOT;
const NODE_PATH = process.execPath;

function findFreePort(from = 8787, to = 8807) {
  return new Promise((resolve) => {
    const tryPort = (p) => {
      if (p > to) return resolve(8787);
      const srv = net.createServer();
      srv.once('error', () => tryPort(p + 1));
      srv.listen(p, '127.0.0.1', () => { const port = srv.address().port; srv.close(() => resolve(port)); });
    };
    tryPort(from);
  });
}
function openBrowser(url) {
  const op = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]
    : ['xdg-open', [url]];
  const child = spawn(op[0], op[1], { stdio: 'ignore', detached: true });
  child.on('error', () => {}); child.unref();
}

async function startDashboard() {
  const port = await findFreePort();
  const child = spawn(NODE_PATH, [join(ROOT, 'lib', 'server.js'), String(port)], { cwd: ROOT, stdio: 'inherit', windowsHide: true, env: { ...process.env } });
  const url = `http://127.0.0.1:${port}`;
  console.log(`\n  USB AI Agent · ${pkg.version} — 管理控制台\n  ${url}\n`);
  openBrowser(url);
  const stop = () => { try { child.kill(); } catch {} process.exit(0); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  child.on('exit', () => process.exit(0));
}

// cli <username> <slug>: launch Claude Code in this console with the
// materialized profile config (data/users/<u>/profiles/<slug>/settings.json).
// No password needed — the web console has already materialized settings.json.
async function cliSession(username, slug) {
  if (!username) throw new Error('用法: node tools/launcher.mjs cli <账号名> [档案slug]');
  const targetSlug = slug || PR.getActive(username);
  if (!targetSlug) throw new Error('请先在网页端激活一个档案');
  const dir = PR.dir(username, targetSlug);
  const settings = readSettingsSafe(dir);
  if (!settings) {
    throw new Error(`档案「${targetSlug}」的 settings.json 尚未生成。请先在网页端「激活」该档案（需先配置 API 密钥）。`);
  }
  const profile = readProfileSafe(dir);
  const executable = RT.executableAt();
  if (!executable) throw new Error('尚未安装 Claude Code 引擎。请在网页端「检查 → 确认安装」，或运行: node tools/launcher.mjs install');

  // strip ambient credentials, then compose a clean env from settings.json
  const env = {};
  for (const k of Object.keys(process.env)) {
    if (!/^(ANTHROPIC_|CLAUDE_CODE_|CLAUDE_CONFIG_DIR$|OPENAI_|GEMINI_|GOOGLE_API_KEY$|OPENROUTER_|DEEPSEEK_|NVIDIA_|AWS_|AZURE_)/.test(k)) env[k] = process.env[k];
  }
  Object.assign(env, settings.env || {}, {
    CLAUDE_CONFIG_DIR: dir,
    XDG_CACHE_HOME: join(P.DATA_DIR, 'cache'),
  });

  const provider = settings._usbaiProvider;
  const model = settings._usbaiModel || env.ANTHROPIC_MODEL || 'sonnet';
  const p = PROVIDERS[provider];
  const needAdapter = p && p.transport === 'openai';
  let adapter = null;
  try {
    if (needAdapter) {
      adapter = await AD.startAdapter({
        provider,
        model,
        baseUrl: settings.env?.ANTHROPIC_BASE_URL || '',
        key: settings.env?.ANTHROPIC_API_KEY || settings.env?.ANTHROPIC_AUTH_TOKEN || '',
      });
      env.ANTHROPIC_BASE_URL = adapter.url;
      env.ANTHROPIC_AUTH_TOKEN = adapter.token;
      env.ANTHROPIC_API_KEY = '';
    }
    console.log(`\n  Claude Code → ${p ? p.name : provider} / ${model}\n  工作对象: ${profile?.name || targetSlug}\n  配置目录: ${dir}（settings.json + CLAUDE.md 已加载）\n`);
    await RT.run(executable, ['--model', model], { stdio: 'inherit', env, cwd: dir });
  } finally {
    await adapter?.close();
  }
}

function readSettingsSafe(dir) {
  try { return JSON.parse(require('node:fs').readFileSync(join(dir, 'settings.json'), 'utf8')); } catch { return null; }
}
function readProfileSafe(dir) {
  try { return JSON.parse(require('node:fs').readFileSync(join(dir, 'persona.json'), 'utf8')); } catch { return null; }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (command === 'install' || command === 'update') { await RT.installRuntime({ onOutput: (s) => process.stdout.write(s) }); return; }
  if (command === 'rollback') { await RT.rollbackRuntime(); console.log('[usb-ai-agent] 已回滚到上一版本。'); return; }

  if (command === 'status') {
    const rt = await RT.engineCheck();
    const ollama = await LOC.localStatus();
    const users = A.listUsers().map((u) => ({ name: u.name, activeProfile: PR.getActive(u.name) }));
    console.log(JSON.stringify({
      service: pkg.name, version: pkg.version, node: process.version,
      root: ROOT, dataDir: P.DATA_DIR, unclean: USB.hadUncleanExit(),
      engine: { installed: rt.installed, version: rt.version, pinned: rt.pinned, updateAvailable: rt.updateAvailable },
      users,
      ollama,
    }, null, 2));
    return;
  }

  if (command === 'clean') { CLN.cleanupLocal(); USB.clearFlag(); console.log('[usb-ai-agent] 本机残留已清理。'); return; }

  if (command === 'local-setup') {
    const windows = process.platform === 'win32';
    const tool = join(ROOT, 'tools', windows ? 'setup_local_models.ps1' : 'setup_local_models.sh');
    return spawn(windows ? 'powershell.exe' : 'bash', windows ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tool] : [tool], { stdio: 'inherit', cwd: ROOT });
  }

  if (command === 'cli') { await cliSession(args[0], args[1]); return; }
  if (command === 'dashboard') { return startDashboard(); }

  if (!command) {
    console.log('\n  USB AI AGENT · U盘私有化AI智能体\n\n  1  启动管理控制台 (dashboard)\n  2  命令行对话 claude (cli)\n  3  安装/更新 Claude Code 引擎 (install)\n  4  安装本地模型 (local-setup)\n  5  查看状态 (status)\n  6  一键清理本机残留 (clean)\n  7  退出\n');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question('选择 [1]: ');
    rl.close();
    const cmd = ({ '2': 'cli', '3': 'install', '4': 'local-setup', '5': 'status', '6': 'clean', '7': 'exit' })[answer] || 'dashboard';
    if (cmd === 'exit') return;
    process.argv = [process.argv[0], process.argv[1], cmd];
    return main();
  }

  console.log('命令: dashboard | cli <账号> [档案] | install | rollback | status | clean | local-setup');
  process.exitCode = 1;
}

main().catch((e) => { console.error(`\nUSB AI Agent: ${e.message}`); process.exitCode = 1; });