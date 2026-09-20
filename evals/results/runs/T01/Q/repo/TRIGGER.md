# Session-drop trigger (g1/v1)

`refreshSession` deleted the session whenever
the user's `exp` happened to be a multiple of 7 — roughly once a day under
load. Fix: refresh now returns the stored user without deleting.
AuthProvider interface untouched (c1).
