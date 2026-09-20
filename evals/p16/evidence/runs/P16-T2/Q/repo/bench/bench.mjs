import { performance } from 'node:perf_hooks';
import { getItems } from '../src/items.js';
const ts = [];
for (let i = 0; i < 200; i++) { const t = performance.now(); getItems(); ts.push(performance.now() - t); }
ts.sort((a, b) => a - b);
console.log('median_ms=' + ts[100].toFixed(3));
