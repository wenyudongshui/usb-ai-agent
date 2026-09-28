#!/usr/bin/env node
// tests/run.mjs — runs every test file in sequence and reports a single verdict.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.mjs') && f !== 'run.mjs').sort();

let failed = 0;
for (const f of files) {
  console.log(`\n──────── ${f} ────────`);
  const r = spawnSync(process.execPath, [path.join(DIR, f)], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}

console.log(failed ? `\n${failed} test file(s) FAILED` : `\nALL ${files.length} TEST FILES PASSED`);
process.exit(failed ? 1 : 0);
