// app/modules/cleanup.js
// Records the app's self-owned cache dirs to keys\cache_path.txt so
// clean.bat can remove them from the host. Runs on startup + on exit.
'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { execSync } = require('child_process');

const ROOT    = path.join(__dirname, '..', '..');
const KEYS    = path.join(ROOT, 'keys');
const CFGPATH = path.join(KEYS, 'cache_path.txt');

// registerCachePath(): append this host's temp workspace cache to cache_path.txt
function registerCachePath() {
  if (!fs.existsSync(KEYS)) fs.mkdirSync(KEYS, { recursive: true });
  const cacheDir = path.join(os.tmpdir(), 'usb-ai-agent');
  const lines = fs.existsSync(CFGPATH) ? fs.readFileSync(CFGPATH, 'utf8').split(/\r?\n/) : [];
  if (!lines.includes(cacheDir)) lines.push(cacheDir);
  fs.writeFileSync(CFGPATH, lines.join('\n') + '\n', 'utf8');
  return cacheDir;
}

// cleanupLocal(): delete the recorded cache dirs and drop the record.
function cleanupLocal() {
  if (!fs.existsSync(CFGPATH)) return;
  const lines = fs.readFileSync(CFGPATH, 'utf8').split(/\r?\n/).filter(Boolean);
  for (const dir of lines) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
  fs.writeFileSync(CFGPATH, '', 'utf8');
}

// TODO(Phase 5): close active connections + kill child processes on exit.

module.exports = { registerCachePath, cleanupLocal };