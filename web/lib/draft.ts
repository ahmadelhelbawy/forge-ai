"use client";

/**
 * The unsent message in the composer, kept per conversation in this browser.
 *
 * A convenience, like `prefs.ts`: it lets a long prompt survive a reload, a
 * conversation switch or a closed tab. It is never the record of anything —
 * a message exists for FORGE only once it is sent. Storage can be missing or
 * throw (private windows, blocked site data, quota), so every access is
 * guarded and the composer works without it.
 */
import { useCallback, useEffect, useRef, useState } from "react";

const PREFIX = "forge.draft.";
/** The composer before a conversation exists. */
const NEW = "new";
const WRITE_DELAY_MS = 250;

function keyFor(conversationId: string | null): string {
  return PREFIX + (conversationId ?? NEW);
}

function read(conversationId: string | null): string {
  try {
    return window.localStorage.getItem(keyFor(conversationId)) ?? "";
  } catch {
    return "";
  }
}

function write(conversationId: string | null, text: string): void {
  try {
    if (text.trim()) window.localStorage.setItem(keyFor(conversationId), text);
    else window.localStorage.removeItem(keyFor(conversationId));
  } catch {
    // Not saved across reloads; still in the composer for this session.
  }
}

/**
 * The composer's text for `conversationId`, restored after mount and written
 * back shortly after each change (and immediately when the page is hidden).
 *
 * A draft typed before a conversation exists moves with it when that
 * conversation is created (attaching a file creates one without sending);
 * one merely restored on load does not move into a reopened conversation.
 */
export function useDraft(conversationId: string | null): [string, (next: string) => void] {
  const [text, setText] = useState("");
  const current = useRef({ id: conversationId, text: "" });
  /** Typed into since the conversation last changed — only such a draft moves. */
  const typed = useRef(false);
  const timer = useRef<number | null>(null);

  const flush = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    write(current.current.id, current.current.text);
  }, []);

  useEffect(() => {
    const previous = current.current;
    if (timer.current !== null) flush();
    let next = read(conversationId);
    if (previous.id === null && conversationId !== null && typed.current && !next && previous.text.trim()) {
      next = previous.text;
      write(null, "");
      write(conversationId, next);
    }
    current.current = { id: conversationId, text: next };
    typed.current = false;
    setText(next);
  }, [conversationId, flush]);

  useEffect(() => {
    const onHide = (): void => flush();
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
      flush();
    };
  }, [flush]);

  const set = useCallback((next: string) => {
    current.current = { ...current.current, text: next };
    typed.current = true;
    setText(next);
    if (timer.current !== null) window.clearTimeout(timer.current);
    // Clearing (a send) is written at once, so a reload right after sending
    // never brings the sent text back.
    if (!next.trim()) {
      timer.current = null;
      write(current.current.id, next);
      return;
    }
    timer.current = window.setTimeout(() => {
      timer.current = null;
      write(current.current.id, current.current.text);
    }, WRITE_DELAY_MS);
  }, []);

  return [text, set];
}
