#!/usr/bin/env node
// Async-iteration watcher (Node 22, no shims, no libraries). Flags/exits frozen.
import fs from 'node:fs';
const args = process.argv.slice(2);
if (args.includes('--help')) { console.log('usage: watch [--dir D] [--once]'); process.exit(0); }
const di = args.indexOf('--dir');
const dir = di === -1 ? '.' : args[di + 1];
if (!fs.existsSync(dir)) { console.error('no such dir'); process.exit(2); }
const watcher = fs.watch(dir);
if (args.includes('--once')) setTimeout(() => watcher.close(), 50);
try {
  for await (const _event of watcher) { /* consume; events need no handling */ }
} catch { /* watcher closed */ }
process.exit(0);
