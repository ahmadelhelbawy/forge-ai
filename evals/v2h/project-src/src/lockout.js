// Lock the account after five failed login attempts.
export const MAX_FAILED_ATTEMPTS = 5;

export function recordFailedAttempt(state) {
  return { failed: state.failed + 1 };
}

export function isLocked(state) {
  return state.failed >= MAX_FAILED_ATTEMPTS;
}
