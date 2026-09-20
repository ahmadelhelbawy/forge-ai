import { log } from './logger.js';
export function connect(url) {
  try { openDb(url); }
  catch (e) { log('error', 'connect failed for ' + url + ': ' + e.message); throw e; }
}
function openDb() { throw new Error('down'); }
