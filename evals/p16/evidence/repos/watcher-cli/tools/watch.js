#!/usr/bin/env node
// Callback watcher. Convert to async iteration; flags/exits frozen.
import fs from 'node:fs';
const args = process.argv.slice(2);
if (args.includes('--help')) { console.log('usage: watch [--dir D] [--once]'); process.exit(0); }
const di = args.indexOf('--dir');
const dir = di === -1 ? '.' : args[di + 1];
if (!fs.existsSync(dir)) { console.error('no such dir'); process.exit(2); }
const w = fs.watch(dir, () => {});
if (args.includes('--once')) { setTimeout(() => { w.close(); process.exit(0); }, 50); }
