// T12: callback watcher CLI. Flags and exit codes must stay identical.
import fs from 'node:fs';
const dir = process.argv[2] || '.';
fs.watch(dir, (ev, f) => console.log(ev, f));
