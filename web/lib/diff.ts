/**
 * Line diff for prompt versions (client- and server-safe, dependency-free).
 *
 * Classic LCS on lines with a size guard: beyond 4000 combined lines it
 * degrades to a single replace hunk rather than burning quadratic time.
 */
export interface DiffHunk {
  readonly type: "same" | "del" | "add";
  readonly lines: readonly string[];
}

const SIZE_GUARD = 4000;

export function diffLines(before: string, after: string): DiffHunk[] {
  const a = before.split("\n");
  const b = after.split("\n");
  if (a.length + b.length > SIZE_GUARD) {
    return [
      { type: "del", lines: a },
      { type: "add", lines: b },
    ];
  }
  const n = a.length;
  const m = b.length;
  const lengths: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lengths[i]![j] = a[i] === b[j] ? (lengths[i + 1]![j + 1]! + 1) : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
    }
  }
  const hunks: DiffHunk[] = [];
  let i = 0;
  let j = 0;
  const push = (type: DiffHunk["type"], line: string): void => {
    const last = hunks[hunks.length - 1];
    if (last && last.type === type) {
      (last.lines as string[]).push(line);
    } else {
      hunks.push({ type, lines: [line] });
    }
  };
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push("same", a[i]!);
      i++;
      j++;
    } else if (lengths[i + 1]![j]! >= lengths[i]![j + 1]!) {
      push("del", a[i]!);
      i++;
    } else {
      push("add", b[j]!);
      j++;
    }
  }
  while (i < n) push("del", a[i++]!);
  while (j < m) push("add", b[j++]!);
  return hunks;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
