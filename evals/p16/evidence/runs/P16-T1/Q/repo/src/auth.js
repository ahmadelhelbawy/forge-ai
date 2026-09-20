import { allow } from './limiter.js';
export function login(req) {
  if (!allow(req)) return { status: 429 };
  return req.body.user === 'ada' && req.body.pass === 's3cret'
    ? { status: 200 } : { status: 401 };
}
