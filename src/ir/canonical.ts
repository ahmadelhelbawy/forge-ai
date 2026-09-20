/**
 * Canonical serialization and content addressing (IR-R12, NFR-009).
 *
 * Determinism is achieved architecturally, not by freezing the clock (TS-R3). This
 * module is one half of that: a byte-stable serialization. The other half is the
 * allowlist projection in `projection.ts`, which decides *what* gets serialized.
 *
 * Rules (docs/architecture.md §3.1):
 *   - Object keys sorted lexicographically by UTF-16 code unit, recursively.
 *   - Array order PRESERVED. Order is semantic here: `goals` carries author priority,
 *     `context_refs` carries rank, `verification` carries execution order.
 *   - `undefined` properties dropped; `null` preserved and meaningful.
 *   - Non-finite numbers and BigInt rejected -- JSON has no honest representation.
 *   - `-0` normalized to `0`.
 *   - CRLF normalized to LF inside string values, so an IR authored on Windows hashes
 *     identically to the same IR authored on Linux.
 *   - No insignificant whitespace; UTF-8.
 */
import { createHash } from "node:crypto";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export class CanonicalizationError extends TypeError {
  constructor(message: string, readonly path: string) {
    super(`${message} (at ${path || "<root>"})`);
    this.name = "CanonicalizationError";
  }
}

const isPlainObject = (v: object): boolean => {
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

/**
 * Recursively normalize a value into canonical JSON.
 *
 * Rejects anything JSON cannot represent honestly rather than coercing it. A silently
 * coerced Date or Map would produce a stable-looking hash over corrupted content,
 * which is the failure mode this whole module exists to prevent.
 */
export function canonicalize(value: unknown, path = ""): Json {
  if (value === null) return null;

  const type = typeof value;

  if (type === "string") return (value as string).replace(/\r\n/g, "\n");
  if (type === "boolean") return value as boolean;

  if (type === "number") {
    const n = value as number;
    if (!Number.isFinite(n)) {
      throw new CanonicalizationError(
        `Cannot canonicalize non-finite number ${String(n)}: JSON has no representation for it`,
        path,
      );
    }
    return n === 0 ? 0 : n; // normalize -0
  }

  if (type === "bigint") {
    throw new CanonicalizationError(
      "Cannot canonicalize BigInt: use a string or a bounded number",
      path,
    );
  }

  if (type === "function" || type === "symbol" || type === "undefined") {
    throw new CanonicalizationError(`Cannot canonicalize a ${type}`, path);
  }

  if (Array.isArray(value)) {
    return value.map((item, i) =>
      // A hole or an explicit `undefined` in an array cannot be dropped without
      // changing length, so it becomes null rather than silently shifting indices.
      item === undefined ? null : canonicalize(item, `${path}[${i}]`),
    );
  }

  if (type === "object") {
    const obj = value as object;
    if (!isPlainObject(obj)) {
      throw new CanonicalizationError(
        `Cannot canonicalize ${obj.constructor?.name ?? "non-plain object"}: ` +
          `only plain objects, arrays and primitives are representable`,
        path,
      );
    }
    const source = obj as Record<string, unknown>;
    const out: Record<string, Json> = {};
    for (const key of Object.keys(source).sort()) {
      const child = source[key];
      if (child === undefined) continue; // dropped, per IR-R12
      out[key] = canonicalize(child, path ? `${path}.${key}` : key);
    }
    return out;
  }

  throw new CanonicalizationError(`Cannot canonicalize value of type ${type}`, path);
}

/** Canonical JSON text: sorted keys, no insignificant whitespace. */
export function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/** `sha256:<64 lowercase hex>` over the UTF-8 canonical form of a structured value. */
export function contentHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalStringify(value), "utf8").digest("hex")}`;
}

/**
 * `sha256:<64 lowercase hex>` over raw bytes or text, for file and artifact content.
 * Text input has CRLF normalized to LF first, matching `canonicalize` (NFR-009).
 */
export function rawHash(data: string | Uint8Array): string {
  const normalized = typeof data === "string" ? data.replace(/\r\n/g, "\n") : data;
  return `sha256:${createHash("sha256").update(normalized).digest("hex")}`;
}

/** The one hash format used everywhere (docs/architecture.md §3.4). */
export const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;

export const isHash = (value: string): boolean => SHA256_PATTERN.test(value);
