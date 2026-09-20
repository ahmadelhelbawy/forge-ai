// T06: staging logs the full URL including password on retry.
export function connect(url) {
  try { return open(url); }
  catch (e) { console.error('connect failed for ' + url + ': ' + e.message); throw e; }
}
function open() { throw new Error('down'); }
