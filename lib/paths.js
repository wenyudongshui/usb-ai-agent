// lib/paths.js
// Single source of truth for every path the app touches.
// Adopts the upstream "data/"-everything pattern: all app-owned state lives
// under DATA_DIR (override with PORTABLE_AI_DATA_DIR), the portable runtime
// under engine/, and web assets served from dashboard/.
'use strict';

const fs   = require('fs');
const path = require('path');

// Root of the USB drive / project folder.
const ROOT = process.env.PORTABLE_AI_ROOT
  ? path.resolve(process.env.PORTABLE_AI_ROOT)
  : path.join(__dirname, '..');

// All portable data (encrypted keys, AI configs, workspace, logs) under one tree.
const DATA_DIR = process.env.PORTABLE_AI_DATA_DIR
  ? path.resolve(process.env.PORTABLE_AI_DATA_DIR)
  : path.join(ROOT, 'data');

const KEYS      = path.join(DATA_DIR, 'keys');                 // master.key.enc · cache_path.txt · unclean.flag
const LOGS      = path.join(DATA_DIR, 'logs');
const SETTINGS  = path.join(DATA_DIR, 'settings.json');        // plaintext prefs: {version, active}
const ENGINE    = path.join(ROOT, 'engine');                   // portable Node runtime + Claude Code engine
const DASHBOARD = path.join(ROOT, 'dashboard');                // web assets

// Claude Code engine location: engine/<platform>-<arch>/current
const PLATFORM  = `${process.platform}-${process.arch}`;
const RUNTIME   = path.join(ENGINE, PLATFORM, 'current');
const NPM_CACHE = path.join(DATA_DIR, 'npm-cache');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

module.exports = {
  ROOT, DATA_DIR, KEYS, LOGS, SETTINGS,
  ENGINE, DASHBOARD, PLATFORM, RUNTIME, NPM_CACHE, ensureDir,
};