import { log } from './logger.js';
import { redactUrl } from './redact.js';
export function connect(url) {
  try { openDb(url); }
  catch (e) { log('error', 'connect failed for ' + redactUrl(url) + ': ' + e.message); throw e; }
}
function openDb() { throw new Error('down'); }
