import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import net from 'node:net';

const require = createRequire(import.meta.url);

const P = require('../lib/paths.js');
const CLN = require('../lib/modules/cleanup.js');
const USB = require('../lib/modules/usb.js');
const { localStatus } = require('../lib/modules/local-models.js');
const pkg = require('../package.json');

const ROOT = P.ROOT;
const NODE_PATH = process.execPath; // launcher runs under the bootstrapped portable Node

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
  console.log(`\n  USB AI Agent · ${pkg.version}\n  网页界面: ${url}\n  输入密码后使用; 「保存并退出」或 Ctrl+C 停止。\n`);
  openBrowser(url);
  const stop = () => { try { child.kill(); } catch {} process.exit(0); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  child.on('exit', () => process.exit(0));
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  // Node runtime is managed by the bootstrap layer, not npm — informational only.
  if (command === 'install' || command === 'update' || command === 'rollback') {
    console.log('[usb-ai-agent] The portable Node runtime is managed by tools/bootstrap.ps1 / bootstrap.sh.\nRe-run start.bat (Windows) or start.sh (POSIX) to re-bootstrap.');
    return;
  }

  if (command === 'status') {
    const ollama = await localStatus();
    console.log(JSON.stringify({
      service: pkg.name,
      version: pkg.version,
      node: process.version,
      root: ROOT,
      dataDir: P.DATA_DIR,
      unclean: USB.hadUncleanExit(),
      ollama,
      server: 'start with: node tools/launcher.mjs dashboard',
    }, null, 2));
    return;
  }

  if (command === 'clean') {
    CLN.cleanupLocal();
    USB.clearFlag();
    console.log('[usb-ai-agent] Host residue cleaned (cache_path.txt entries removed).');
    return;
  }

  if (command === 'local-setup') {
    const windows = process.platform === 'win32';
    const tool = join(ROOT, 'tools', windows ? 'setup_local_models.ps1' : 'setup_local_models.sh');
    return spawn(windows ? 'powershell.exe' : 'bash',
      windows ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tool] : [tool],
      { stdio: 'inherit', cwd: ROOT });
  }

  if (command === 'dashboard') {
    return startDashboard();
  }

  if (!command) {
    console.log('\n  USB AI AGENT · U盘私有化AI智能体\n\n  1  启动网页界面 (dashboard)\n  2  安装本地模型 (local-setup)\n  3  查看状态 (status)\n  4  一键清理本机残留 (clean)\n  5  退出\n');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question('选择 [1]: ');
    rl.close();
    const cmd = ({ '2': 'local-setup', '3': 'status', '4': 'clean', '5': 'exit' })[answer] || 'dashboard';
    if (cmd === 'exit') return;
    return mainWith([cmd]);
  }

  console.log('命令: dashboard | local-setup | status | clean | install/update/rollback');
  process.exitCode = 1;
}

// re-dispatch single-arg from the menu without re-parsing
async function mainWith(cmd) { process.argv = [process.argv[0], process.argv[1], ...cmd]; return main(); }

main().catch((e) => { console.error(`\nUSB AI Agent: ${e.message}`); process.exitCode = 1; });
