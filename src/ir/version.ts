/**
 * IR schema versioning (FR-009, NFR-012).
 *
 * Three version axes are pinned independently across FORGE; this module owns one of
 * them. See spec.md NFR-012 and docs/architecture.md §2.3.
 *
 * Loading an object whose IR major version is unknown is REFUSED rather than
 * best-effort parsed: a silently mis-parsed IR is worse than a hard failure, because
 * every downstream artifact would inherit the corruption.
 */

/** The IR schema version this build emits. */
export const IR_VERSION = "1.0";

/** The single IR major version this build can read. */
export const IR_SUPPORTED_MAJOR = 1;

export interface IrVersion {
  readonly major: number;
  readonly minor: number;
}

const VERSION_PATTERN = /^(\d+)\.(\d+)$/;

export class UnsupportedIrVersionError extends Error {
  constructor(
    readonly received: string,
    reason: string,
  ) {
    super(`Unsupported ir_version ${JSON.stringify(received)}: ${reason}`);
    this.name = "UnsupportedIrVersionError";
  }
}

export function parseIrVersion(raw: string): IrVersion {
  const match = VERSION_PATTERN.exec(raw);
  if (!match) {
    throw new UnsupportedIrVersionError(raw, 'expected "<major>.<minor>", e.g. "1.0"');
  }
  // Both groups are guaranteed present by the pattern.
  return { major: Number(match[1]), minor: Number(match[2]) };
}

/** True when this build knows how to read the given version, possibly after migration. */
export function isReadableIrVersion(raw: string): boolean {
  try {
    return parseIrVersion(raw).major === IR_SUPPORTED_MAJOR;
  } catch {
    return false;
  }
}

/** Negative when `a` precedes `b`, zero when equal, positive when `a` follows `b`. */
export function compareIrVersions(a: string, b: string): number {
  const va = parseIrVersion(a);
  const vb = parseIrVersion(b);
  return va.major - vb.major || va.minor - vb.minor;
}
