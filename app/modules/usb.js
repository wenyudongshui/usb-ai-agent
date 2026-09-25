// app/modules/usb.js
// Unplug fallback: every 1s, check the USB drive letter still exists.
// On disappearance: best-effort memory cleanup + write keys\unclean.flag.
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT    = path.join(__dirname, '..', '..');
const KEYS    = path.join(ROOT, 'keys');
const FLAG    = path.join(KEYS, 'unclean.flag');

let started = false;

// markUnclean(): called by usb watcher on unplug, by cleanup on abnormal exit.
function markUnclean(reason) {
  if (!fs.existsSync(KEYS)) fs.mkdirSync(KEYS, { recursive: true });
  fs.writeFileSync(FLAG, `${new Date().toISOString()} - ${reason}\n`, 'utf8');
}

// clearFlag(): called on a clean exit (startup checks it first).
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