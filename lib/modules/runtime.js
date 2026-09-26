// lib/modules/runtime.js
// Portable Claude Code engine management, transplanted from ClaudeCode-Portable
// (MIT). Installs the pinned official @anthropic-ai/claude-code into
// engine/<platform>-<arch>/current via the bundled npm, with USB-safe flags
// (--no-bin-links), transactional staging/backup/swap, and native-binary stub
// repair (FAT32/exFAT pen drives block the postinstall hardlink).
'use strict';

const fs   = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const P    = require('../paths');

const RUNTIME  = P.RUNTIME;
const PLATFORM = P.PLATFORM;
const LOGS     = P.LOGS;
const DATA     = P.DATA_DIR;

const manifest = JSON.parse(fs.readFileSync(path.join(P.ROOT, 'tools/runtime-manifest.json'), 'utf8'));

// The published wrapper ships bin/claude(.exe) as a ~500-byte stub until its
// postinstall copies the ~250MB platform-native binary over it. The postinstall
// prefers a filesystem hardlink, which removable drives do not support, so a USB
// install can silently be left with the stub. These helpers detect + repair it
// with a plain copy, which works on every filesystem.
const STUB_MARKER = 'claude native binary not installed';
const nativeBinaryName = () => (process.platform === 'win32' ? 'claude.exe' : 'claude');

function isStubExecutable(executable) {
  try {
    if (fs.statSync(executable).size >= 4096) return false;
    return fs.readFileSync(executable, 'utf8').includes(STUB_MARKER);
  } catch {
    return false;
  }
}

function nativeBinarySource(directory = RUNTIME) {
  const candidate = path.join(directory, `node_modules/@anthropic-ai/claude-code-${PLATFORM}`, nativeBinaryName());
  return fs.existsSync(candidate) ? candidate : null;
}

function wrapperExecutableAt(directory = RUNTIME) {
  const pkgPath = path.join(directory, 'node_modules/@anthropic-ai/claude-code/package.json');
  if (!fs.existsSync(pkgPath)) return null;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.claude;
  if (!bin) return null;
  const result = path.join(path.dirname(pkgPath), bin);
  return fs.existsSync(result) ? result : null;
}

function repairNativeBinary(directory = RUNTIME) {
  const executable = wrapperExecutableAt(directory);
  if (!executable || !isStubExecutable(executable)) return false;
  const source = nativeBinarySource(directory);
  if (!source) return false;
  fs.copyFileSync(source, executable);
  if (process.platform !== 'win32') fs.chmodSync(executable, 0o755);
  return !isStubExecutable(executable);
}

function executableAt(directory = RUNTIME) {
  // Prefer the platform-native package (avoids link/copy quirks on FAT/exFAT).
  return nativeBinarySource(directory) || wrapperExecutableAt(directory);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let output = '';
    child.stdout?.on('data', (c) => { output += c; options.onOutput?.(c.toString()); });
    child.stderr?.on('data', (c) => { output += c; options.onOutput?.(c.toString()); });
    child.on('error', reject);
    child.on('exit', (code, signal) =>
      code === 0 ? resolve(output.trim()) : reject(new Error(`${command.split(/[\\/]/).pop()} exited ${code ?? signal}: ${output.slice(-1500)}`)));
  });
}

function npmCLI() {
  const base = path.dirname(process.execPath);
  const candidates = [
    path.join(base, 'node_modules/npm/bin/npm-cli.js'),
    path.join(base, '../lib/node_modules/npm/bin/npm-cli.js'),
  ];
  try { candidates.push(fs.realpathSync(path.join(base, 'npm'))); } catch { /* no npm shim */ }
  const found = candidates.find(fs.existsSync);
  if (!found) throw new Error('Bundled npm is missing. Run start.bat / start.sh to repair Node.js.');
  return found;
}

async function runtimeStatus() {
  const executable = executableAt();
  const stub = !!executable && isStubExecutable(executable);
  let version = null;
  if (executable && !stub) {
    try { version = await run(executable, ['--version'], { timeout: 15000 }); } catch { /* broken install */ }
  }
  return {
    installed: !!version,
    version,
    platform: PLATFORM,
    node: process.version,
    pinned: manifest.dependencies?.['@anthropic-ai/claude-code'] || null,
    executable,
    stub,
    dataDir: DATA,
  };
}

function stagingComplete(directory) {
  return Object.keys(manifest.dependencies || {}).every((dep) =>
    fs.existsSync(path.join(directory, 'node_modules', dep, 'package.json')));
}

async function installRuntime({ onOutput = () => {}, target = RUNTIME, runner = run } = {}) {
  const base = path.dirname(target);
  const staging = path.join(base, 'staging');
  const backup = path.join(base, 'previous');
  const lock = path.join(base, 'install.lock');
  fs.mkdirSync(base, { recursive: true });
  P.ensureDir(LOGS);
  fs.mkdirSync(P.NPM_CACHE, { recursive: true });
  try { fs.mkdirSync(lock); } catch {
    throw new Error('安装正在进行中。如被中断，请在确认无安装进程后删除 engine/<platform>/install.lock 再重试。');
  }
  const log = path.join(LOGS, 'runtime-install.log');
  try {
    const resuming = fs.existsSync(staging);
    fs.mkdirSync(staging, { recursive: true });
    fs.writeFileSync(path.join(staging, 'package.json'), JSON.stringify(manifest, null, 2));
    fs.appendFileSync(log, `\n=== Runtime installation ${new Date().toISOString()} ===\n`, { mode: 0o600 });
    onOutput('正在安装固定的官方 Claude Code…\n');
    if (resuming) onOutput('检测到上次未完成的安装，将复用已验证文件。\n');
    onOutput('这一步会下载约 300MB，在 USB 上可能需要几分钟。请勿关闭窗口。\n');
    const started = Date.now();
    const heartbeat = setInterval(() => {
      onOutput(`仍在安装… 已耗时 ${Math.round((Date.now() - started) / 1000)}s。请勿关闭窗口。\n`);
    }, 20000);
    if (typeof heartbeat.unref === 'function') heartbeat.unref();
    try {
      await runner(process.execPath, [npmCLI(), 'install', '--prefix', staging, '--include=optional', '--no-audit', '--no-fund', '--save=false', '--no-bin-links', '--no-install-links', '--cache', P.NPM_CACHE], {
        cwd: staging,
        env: { ...process.env, npm_config_cache: P.NPM_CACHE },
        onOutput: (s) => { fs.appendFileSync(log, s); onOutput(s); },
      });
    } finally {
      clearInterval(heartbeat);
    }
    const wrapper = wrapperExecutableAt(staging);
    let exe = executableAt(staging);
    if (!exe) throw new Error('官方可执行文件未安装，已保留现有运行时');
    if (wrapper && isStubExecutable(wrapper)) {
      onOutput('原生二进制仍是占位文件（常见于 FAT32/exFAT 磁盘禁止硬链接）。正在以普通复制方式修复，约 250MB，在 USB 2.0 上可能需几分钟…\n');
      if (!repairNativeBinary(staging)) throw new Error('缺少平台原生包。请检查磁盘空间后重试。');
      exe = executableAt(staging);
      onOutput('原生二进制复制完成。\n');
    }
    if (!stagingComplete(staging)) throw new Error('运行时依赖不完整，已保留现有运行时');
    const version = await runner(exe, ['--version'], { timeout: 15000 });
    if (!String(version).includes('Claude Code')) throw new Error('运行时身份校验失败');
    fs.rmSync(backup, { recursive: true, force: true });
    if (fs.existsSync(target)) fs.renameSync(target, backup);
    try { fs.renameSync(staging, target); } catch (e) { if (fs.existsSync(backup)) fs.renameSync(backup, target); throw e; }
    onOutput(`就绪：${version}\n`);
    return version;
  } catch (error) {
    const detail = error?.stack || error?.message || String(error);
    try { fs.appendFileSync(log, `\nINSTALL FAILED\n${detail}\n`); } catch { /* noop */ }
    throw new Error(`${error.message}\n未完成的安装文件已保留，供下次重试。日志：${log}`, { cause: error });
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}

async function rollbackRuntime({ target = RUNTIME, runner = run } = {}) {
  const base = path.dirname(target);
  const backup = path.join(base, 'previous');
  const swap = path.join(base, 'rollback-swap');
  if (fs.existsSync(path.join(base, 'install.lock'))) throw new Error('安装正在进行中');
  const exe = executableAt(backup);
  if (!exe) throw new Error('没有可用的旧版本');
  await runner(exe, ['--version'], { timeout: 15000 });
  fs.renameSync(target, swap);
  try { fs.renameSync(backup, target); } catch (e) { fs.renameSync(swap, target); throw e; }
  fs.renameSync(swap, backup);
}

module.exports = {
  manifest, isStubExecutable, repairNativeBinary, executableAt, run,
  runtimeStatus, installRuntime, rollbackRuntime, RUNTIME, PLATFORM,
};