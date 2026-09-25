// lib/modules/usb.js
// Unplug fallback: every 1s, check the USB drive letter still exists.
// On disappearance: best-effort cleanup + write data/keys\unclean.flag.
'use strict';

const fs   = require('fs');
const path = require('path');
const P    = require('../paths');

const KEYS = P.KEYS;
const FLAG = path.join(KEYS, 'unclean.flag');

let started = false;

// markUnclean(): called by usb watcher on unplug.
function markUnclean(reason) {
  P.ensureDir(KEYS);
  fs.writeFileSync(FLAG, `${new Date().toISOString()} - ${reason}\n`, 'utf8');
}

// clearFlag(): called on a clean exit / after catch-up cleanup.
function clearFlag() {
  if (fs.existsSync(FLAG)) fs.rmSync(FLAG, { force: true });
}

// hadUncleanExit(): must be checked BEFORE clearFlag() on startup.
function hadUncleanExit() {
  return fs.existsSync(FLAG);
}

// watch(driveLetter, onUnplug): poll every 1s.
function watch(driveLetter, onUnplug) {
  if (started) return;
  started = true;
  const interval = setInterval(() => {
    try {
      fs.accessSync(driveLetter + '\\');
    } catch {
      clearInterval(interval);
      started = false;
      try { markUnclean('drive unplugged'); } catch { /* drive gone */ }
      onUnplug && onUnplug();
    }
  }, 1000);
}

module.exports = { watch, markUnclean, clearFlag, hadUncleanExit };