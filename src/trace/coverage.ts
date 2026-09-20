/**
 * Byte-level trace coverage verification (INV-010, AC-006, FORGE-C100).
 *
 * The invariant, from spec.md §12.2 PV-R3:
 *
 *   Within each artifact, spans are non-overlapping and ordered, and the complement of
 *   their union contains ONLY whitespace.
 *
 * Byte-level rather than span-count-level, so it cannot be satisfied by one span
 * covering a whole file. Verification runs over the UTF-8 bytes of the artifact, which
 * is why `TracedTextBuilder` accumulates byte offsets rather than string indices.
 *
 * This module is a CHECK, not the guarantee. The guarantee comes from
 * `TracedTextBuilder` refusing to emit untraced non-whitespace text. This exists to
 * catch assembly mistakes — a rebase off by one, a section concatenated by hand — that
 * the builder cannot see.
 */
import { diagnostic, measureEvidence, type Diagnostic } from "../ir/diagnostic.js";
import { describeOrigin, type Span } from "./span.js";

/** ASCII whitespace bytes: tab, newline, carriage return, space. */
const WHITESPACE_BYTES = new Set([0x09, 0x0a, 0x0d, 0x20]);

export interface CoverageGap {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export interface CoverageReport {
  readonly artifact_path: string;
  readonly total_bytes: number;
  readonly covered_bytes: number;
  readonly gaps: readonly CoverageGap[];
  readonly overlaps: readonly (readonly [Span, Span])[];
}

/**
 * Analyse coverage of one artifact. Pure; returns findings rather than throwing, so a
 * caller can report every problem at once.
 */
export function analyseCoverage(
  artifactPath: string,
  content: string,
  spans: readonly Span[],
): CoverageReport {
  const bytes = Buffer.from(content, "utf8");
  const mine = spans
    .filter((s) => s.artifact_path === artifactPath)
    .slice()
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const overlaps: Array<readonly [Span, Span]> = [];
  const gaps: CoverageGap[] = [];
  let covered = 0;
  let cursor = 0;

  for (const span of mine) {
    if (span.start < cursor) {
      const previous = mine[mine.indexOf(span) - 1];
      if (previous) overlaps.push([previous, span]);
      // Skip the overlapping prefix so the gap walk stays monotonic.
      covered += Math.max(0, span.end - cursor);
      cursor = Math.max(cursor, span.end);
      continue;
    }
    if (span.start > cursor) {
      const slice = bytes.subarray(cursor, span.start);
      if (!slice.every((b) => WHITESPACE_BYTES.has(b))) {
        gaps.push({ start: cursor, end: span.start, text: slice.toString("utf8") });
      }
    }
    covered += span.end - span.start;
    cursor = span.end;
  }

  if (cursor < bytes.length) {
    const slice = bytes.subarray(cursor, bytes.length);
    if (!slice.every((b) => WHITESPACE_BYTES.has(b))) {
      gaps.push({ start: cursor, end: bytes.length, text: slice.toString("utf8") });
    }
  }

  return {
    artifact_path: artifactPath,
    total_bytes: bytes.length,
    covered_bytes: covered,
    gaps,
    overlaps,
  };
}

const excerpt = (text: string): string =>
  JSON.stringify(text.length > 80 ? `${text.slice(0, 80)}…` : text);

/** FORGE-C100 for every untraced non-whitespace region and every overlap. */
export function verifyCoverage(
  artifactPath: string,
  content: string,
  spans: readonly Span[],
): Diagnostic[] {
  const report = analyseCoverage(artifactPath, content, spans);
  const out: Diagnostic[] = [];

  for (const gap of report.gaps) {
    out.push(
      diagnostic(
        "FORGE-C100",
        `${artifactPath} bytes ${gap.start}–${gap.end} carry no trace origin: ${excerpt(gap.text)}. ` +
          `Every non-whitespace byte must be attributable (INV-010).`,
        [
          {
            kind: "span",
            artifact_path: artifactPath,
            start: gap.start,
            end: gap.end,
            quote: gap.text.slice(0, 200),
          },
        ],
      ),
    );
  }

  for (const [a, b] of report.overlaps) {
    out.push(
      diagnostic(
        "FORGE-C100",
        `${artifactPath} has overlapping spans: ${describeOrigin(a.origin)} covers ` +
          `${a.start}–${a.end} and ${describeOrigin(b.origin)} covers ${b.start}–${b.end}. ` +
          `Each byte must belong to exactly one span.`,
        [
          {
            kind: "span",
            artifact_path: artifactPath,
            start: b.start,
            end: b.end,
            quote: content.slice(b.start, Math.min(b.end, b.start + 200)),
          },
        ],
      ),
    );
  }

  return out;
}

/** Attribution ratio as a measured quantity. Never aggregated into a score (INV-008). */
export function coverageEvidence(report: CoverageReport) {
  return measureEvidence("attributed_bytes", report.covered_bytes, "bytes");
}
