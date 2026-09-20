// Line format is contractual: `[ts] LEVEL message`. Do not change it.
export function log(level, msg) { console.log(`[${Date.now()}] ${level} ${msg}`); }
