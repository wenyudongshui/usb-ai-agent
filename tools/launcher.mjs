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
const PR = require('../lib/modules/profiles.js');
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
      srv.listen(p, '127.0.0.1', () => {
        const port = srv.address().port;
        srv.close(() => resolve(port));
      });
    };
    tryPort(from);
  });
}

function openBrowser(url) {
  const op = process.platform === 'darwin'
    ? ['open', [url]]
    : process.platform === 'win32'
      ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]
      : ['xdg-open', [url]];
  const child = spawn(op[0], op[1], { stdio: 'ignore', detached: true });
  child.on('error', () => {});
  child.unref();
}

async function startDashboard() {
  const port = await findFreePort();
  const serverPath = join(ROOT, 'lib', 'server.js');
  const child = spawn(NODE_PATH, [serverPath, String(port)], {
    cwd: ROOT,
    stdio: 'inherit',
    windowsHide: true,
    env: { ...process.env },
  });
  const url = `http://127.0.0.1:${port}`;
  console.log(`\n  USB AI Agent · ${pkg.version} — 管理控制台\n  ${url}\n  输入密码后管理 Claude Code 引擎 / 档案；「安全退出」或 Ctrl+C 停止。\n`);
  openBrowser(url);
  const stop = () => { try { child.kill(); } catch {} process.exit(0); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  child.on('exit', () => process.exit(0));
}

async function cliSession(slugArg) {
  const slug = slugArg || PR.getActive();
  const profile = slug ? PR.load(slug) : null;
  if (!profile) throw new Error('没有可用的档案。请先在网页端创建并激活一个档案（提供商 + 模型 + 提示词）。');
  PR.ensureSettings(profile);
  const executable = RT.executableAt();
  if (!executable) throw new Error('尚未安装 Claude Code 引擎。请在网页端点击「安装引擎」，或运行: node tools/launcher.mjs install');
  const provider = PROVIDERS[profile.provider];
  const useAdapter = provider.transport === 'openai';
  const adapter = useAdapter ? await AD.startAdapter({ provider: profile.provider, model: profile.model, baseUrl: profile.baseUrl, key: profile.key }) : null;
  const env = PR.launchEnvironment(profile, adapter);
  console.log(`\n  Claude Code → ${provider.name} / ${profile.model}\n  配置目录: ${PR.dir(profile.slug)}（settings.json + CLAUDE.md 已加载）\n`);
  try {
    await RT.run(executable, ['--model', profile.model, ...(slugArg ? [] : [])], { stdio: 'inherit', env, cwd: PR.dir(profile.slug) });
  } finally {
    await adapter?.close();
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (command === 'install' || command === 'update') {
    await RT.installRuntime({ onOutput: (s) => process.stdout.write(s) });
    return;
  }
  if (command === 'rollback') { await RT.rollbackRuntime(); console.log('[usb-ai-agent] 已回滚到上一版本。'); return; }

  if (command === 'status') {
    const rt = await RT.runtimeStatus();
    const ollama = await LOC.localStatus();
    console.log(JSON.stringify({
      service: pkg.name, version: pkg.version, node: process.version,
      root: ROOT, dataDir: P.DATA_DIR, unclean: USB.hadUncleanExit(),
      engine: { installed: rt.installed, version: rt.version, pinned: rt.pinned },
      activeProfile: PR.getActive(),
      profiles: PR.listProfiles().map((p) => ({ slug: p.slug, provider: p.provider, model: p.model, active: p.active })),
      ollama,
    }, null, 2));
    return;
  }

  if (command === 'clean') {
    CLN.cleanupLocal();
    USB.clearFlag();
    console.log('[usb-ai-agent] 本机残留已清理。');
    return;
  }

  if (command === 'local-setup') {
    const windows = process.platform === 'win32';
    const tool = join(ROOT, 'tools', windows ? 'setup_local_models.ps1' : 'setup_local_models.sh');
    return spawn(windows ? 'powershell.exe' : 'bash',
      windows ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tool] : [tool],
      { stdio: 'inherit', cwd: ROOT });
  }

  if (command === 'cli') {
    await cliSession(args[0]);
    return;
  }

  if (command === 'dashboard') {
    return startDashboard();
  }

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

  console.log('命令: dashboard | cli [slug] | install | rollback | status | clean | local-setup');
  process.exitCode = 1;
}

main().catch((e) => { console.error(`\nUSB AI Agent: ${e.message}`); process.exitCode = 1; });