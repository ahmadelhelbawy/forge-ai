"use client";

/**
 * Per-browser workspace preferences: panel widths, which panels are open, the
 * Studio tab. Conveniences only — anything that must survive for the
 * conversation (target, model, effort, artifact kind, shape, verifications)
 * lives on the server, in the conversation's own event log.
 *
 * Storage can be missing or throw (private windows, blocked site data), so
 * every access is guarded and the UI renders correctly without it.
 */
import { useCallback, useEffect, useState } from "react";

const PREFIX = "forge.pref.";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // A preference that cannot be saved is still applied for this session.
  }
}

/**
 * A preference, read after mount so server and client render the same first
 * frame; `loaded` says when the stored value has been applied.
 */
export function usePref<T>(key: string, fallback: T): [T, (next: T) => void, boolean] {
  const [value, setValue] = useState<T>(fallback);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setValue(read(key, fallback));
    setLoaded(true);
    // `fallback` is a literal at every call site; reading once per key is intended.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const set = useCallback(
    (next: T) => {
      setValue(next);
      write(key, next);
    },
    [key],
  );
  return [value, set, loaded];
}

/** True while the viewport matches the query. False during server render. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = (): void => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}
