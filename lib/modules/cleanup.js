// lib/modules/cleanup.js
// Records the app's self-owned cache dirs to data/keys\cache_path.txt so
// clean.bat / clean.sh can remove them from the host. Runs on startup + exit.
'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const P    = require('../paths');

const KEYS    = P.KEYS;
const CFGPATH = path.join(KEYS, 'cache_path.txt');

// registerCachePath(): append this host's temp workspace cache to cache_path.txt
function registerCachePath() {
  P.ensureDir(KEYS);
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

module.exports = { registerCachePath, cleanupLocal };