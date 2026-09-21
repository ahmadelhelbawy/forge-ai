#!/usr/bin/env bash
# V2-H real acceptance, CLI half. Builds a real git repository from project-src/,
# packages ir.json, runs the suite EXTERNALLY (ci-run.sh), and explains the
# package with the repository bound. Outputs land in out/ with host paths scrubbed.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
ROOTS="${V2H_ROOTS:-$(mktemp -d /tmp/forge-v2h-roots.XXXXXX)}"
REPO="$ROOTS/authlib"
OUT="$HERE/out"
FAKE="AKIA""Q7XJ4MZ2KD9PL3WB"
rm -rf "$REPO" "$OUT"; mkdir -p "$OUT"

# 1. A real repository: two commits, a planted fake credential, a denied .env, an ignored dir.
cp -r "$HERE/project-src" "$REPO"
sed -i "s/__FAKE_KEY__/$FAKE/" "$REPO/src/config.js"
printf 'SMTP_PASSWORD=%s\n' "$FAKE" > "$REPO/.env"
mkdir -p "$REPO/tmp"; printf '%s\n' '// passwords hashed scrypt per-user salt storage' > "$REPO/tmp/scratch.js"
git -C "$REPO" init -q
git -C "$REPO" -c user.name=v2h -c user.email=v2h@example.invalid add src/password.js test/password-hashing.test.js package.json .gitignore
git -C "$REPO" -c user.name=v2h -c user.email=v2h@example.invalid commit -q -m "password hashing"
git -C "$REPO" -c user.name=v2h -c user.email=v2h@example.invalid add src/lockout.js test/lockout.test.js src/config.js
git -C "$REPO" -c user.name=v2h -c user.email=v2h@example.invalid commit -q -m "account lockout"
git -C "$REPO" log --oneline --name-only > "$OUT/git-log.txt"

# 2. Package. 3. External run.
rm -rf "$HERE/package"
( cd "$ROOT" && pnpm -s forge package --ir "$HERE/ir.json" --target claude-code --out "$HERE/package" ) > "$OUT/package.txt"
"$HERE/ci-run.sh" "$REPO" "$HERE/package" "$OUT/evidence"

# 4. Explain with the repository bound, twice for determinism.
EXPLAIN=(pnpm -s forge explain --package "$HERE/package" --workspace "$REPO" --governance "$HERE/governance.json" --evidence "$OUT/evidence/evidence.json")
( cd "$ROOT" && "${EXPLAIN[@]}" ) > "$OUT/explain.txt"
( cd "$ROOT" && "${EXPLAIN[@]}" --json ) > "$OUT/matrix.json"
( cd "$ROOT" && "${EXPLAIN[@]}" --json ) > "$OUT/matrix.again.json"
cmp "$OUT/matrix.json" "$OUT/matrix.again.json" && echo "matrix byte-identical across runs" | tee "$OUT/determinism.txt"
rm "$OUT/matrix.again.json"
( cd "$ROOT" && pnpm -s forge explain --package "$HERE/package" ) > "$OUT/explain-unbound.txt"

# 5. The planted credential must appear in no output.
if grep -rl "$FAKE" "$OUT" "$HERE/package"; then echo "LEAK"; exit 1; fi
echo "planted credential absent from every output" | tee "$OUT/secret-scan.txt"

# Scrub host paths before anything is committed (PK-R7's reasoning).
sed -i "s#$HERE#evals/v2h#g; s#$ROOTS#<roots>#g" "$OUT"/*.txt "$OUT"/evidence/logs/* 2>/dev/null || true
echo "roots: $ROOTS"
