#!/usr/bin/env bash
# V2-H real acceptance, workspace half. Drives a running workspace over HTTP.
# Usage: web-acceptance.sh <base-url> <allowed-roots-dir> <data-dir>
set -euo pipefail
BASE=$1; ROOTS=$2; DATA=$3
HERE="$(cd "$(dirname "$0")" && pwd)"; OUT="$HERE/out/web"; mkdir -p "$OUT"
FAKE="AKIA""Q7XJ4MZ2KD9PL3WB"
j() { curl -s -H 'content-type: application/json' "$@"; }
code() { curl -s -o /dev/null -w '%{http_code}' -H 'content-type: application/json' "$@"; }

# 10. An unbound conversation still works normally.
U=$(j -X POST "$BASE/api/conversations" -d '{}' | jq -r .id)
j -X POST "$BASE/api/conversations/$U/messages" -d '{"content":"Write a prompt for hardening password storage."}' > /dev/null
j "$BASE/api/conversations/$U" | jq '{versions: (.promptVersions|length), repository: .repository}' > "$OUT/10-unbound-conversation.json"
j -X POST "$BASE/api/conversations/$U/traceability" -d '{"target":"claude-code"}' | jq '{repository_bound, rows: [.rows[] | {text, files: (.files|length)}]}' >> "$OUT/10-unbound-conversation.json"

# 1/4. Explicit binding; escapes refused.
C=$(j -X POST "$BASE/api/conversations" -d '{}' | jq -r .id)
j -X POST "$BASE/api/conversations/$C/messages" -d '{"content":"Harden the auth library: hash passwords and lock accounts."}' > /dev/null
for t in "Passwords are hashed with scrypt and a per-user salt before storage" "Lock the account after five failed login attempts" "Lock the account after three failed login attempts"; do
  j -X POST "$BASE/api/conversations/$C/ledger" -d "$(jq -n --arg t "$t" '{text:$t}')" > /dev/null
done
ln -sfn /etc "$ROOTS/escape-link"
{
  echo "traversal:  $(code -X POST "$BASE/api/conversations/$C/repository" -d "$(jq -n --arg p "$ROOTS/authlib/../.." '{path:$p}')")"
  echo "outside:    $(code -X POST "$BASE/api/conversations/$C/repository" -d '{"path":"/etc"}')"
  echo "symlink:    $(code -X POST "$BASE/api/conversations/$C/repository" -d "$(jq -n --arg p "$ROOTS/escape-link" '{path:$p}')")"
  echo "relative:   $(code -X POST "$BASE/api/conversations/$C/repository" -d '{"path":"authlib"}')"
  echo "valid bind: $(code -X POST "$BASE/api/conversations/$C/repository" -d "$(jq -n --arg p "$ROOTS/authlib" '{path:$p}')")"
} > "$OUT/04-binding-escapes.txt"
j -X POST "$BASE/api/conversations/$C/repository" -d "$(jq -n --arg p "$ROOTS/authlib/../.." '{path:$p}')" | jq -c . >> "$OUT/04-binding-escapes.txt"
j "$BASE/api/conversations/$C/repository" | jq '{bound, usable}' > "$OUT/01-binding.json"
rm -f "$ROOTS/escape-link"

# 6. Supersession by explicit decision.
M=$(j -X POST "$BASE/api/conversations/$C/traceability" -d '{"target":"claude-code"}')
FIVE=$(echo "$M" | jq -r '.rows[] | select(.text|test("five")) | .id')
THREE=$(echo "$M" | jq -r '.rows[] | select(.text|test("three")) | .id')
HASH=$(echo "$M" | jq -r '.rows[] | select(.text|test("scrypt")) | .id')
{
  echo "with origin field: $(code -X POST "$BASE/api/conversations/$C/requirements" -d "$(jq -n --arg r "$FIVE" '{decision:{kind:"accept",requirement_id:$r,origin:"user_stated"}}')")"
  echo "supersede five by three: $(code -X POST "$BASE/api/conversations/$C/requirements" -d "$(jq -n --arg a "$FIVE" --arg b "$THREE" '{decision:{kind:"supersede",requirement_id:$a,successor_id:$b}}')")"
  echo "cycle back: $(code -X POST "$BASE/api/conversations/$C/requirements" -d "$(jq -n --arg a "$THREE" --arg b "$FIVE" '{decision:{kind:"supersede",requirement_id:$a,successor_id:$b}}')")"
} > "$OUT/06-supersession.txt"

# 8. Advisory link: kept apart; escapes refused.
{
  echo "../ path:  $(code -X POST "$BASE/api/conversations/$C/links" -d "$(jq -n --arg r "$HASH" '{requirementId:$r,path:"../../etc/passwd"}')")"
  echo ".env path: $(code -X POST "$BASE/api/conversations/$C/links" -d "$(jq -n --arg r "$HASH" '{requirementId:$r,path:".env"}')")"
  echo "asserted:  $(code -X POST "$BASE/api/conversations/$C/links" -d "$(jq -n --arg r "$HASH" '{requirementId:$r,path:"test/lockout.test.js",note:"I believe this covers hashing"}')")"
} > "$OUT/08-advisory.txt"

# 7. V2-G evidence joined.
PKG=$(j -X POST "$BASE/api/conversations/$C/package" -d '{"target":"claude-code"}')
SEM=$(echo "$PKG" | jq -r .semanticId)
EVID=$(echo "$PKG" | jq -r '.files[] | select(.path=="verification.json") | .content' | jq -c --arg s "$SEM" \
  '{records: [.entries[] | {obligation_id: .id, kind: .kind, exit_code: 0, stdout_hash: null, stderr_hash: null, started_at: "2026-09-22T00:00:00Z", duration_ms: 1, runner: "ci", repo_commit: null, package_semantic_id: $s}]}')
j -X POST "$BASE/api/conversations/$C/verify" -d "$(jq -n --arg e "$EVID" '{target:"claude-code",evidence:$e}')" | jq '{packageValid, verdicts: [.verdicts[] | {obligation_id, verdict}]}' > "$OUT/07-verify.json"
curl -s -H 'content-type: application/json' -X POST "$BASE/api/conversations/$C/traceability" -d "$(jq -n --arg e "$EVID" '{target:"claude-code",evidence:$e}')" > "$OUT/matrix.json"
curl -s -H 'content-type: application/json' -X POST "$BASE/api/conversations/$C/traceability" -d "$(jq -n --arg e "$EVID" '{target:"claude-code",evidence:$e}')" > "$OUT/matrix.again.json"
cmp "$OUT/matrix.json" "$OUT/matrix.again.json" && echo "workspace matrix byte-identical across requests" > "$OUT/determinism.txt"; rm "$OUT/matrix.again.json"

# 5. The planted credential appears in no response and nowhere in the store.
for f in "$OUT"/*; do :; done
{ j "$BASE/api/conversations/$C"; j "$BASE/api/conversations/$C/requirements"; j "$BASE/api/conversations/$C/links"; echo "$PKG"; } > "$OUT/.all-responses"
if grep -rl "$FAKE" "$OUT" "$DATA" 2>/dev/null; then echo LEAK; exit 1; fi
rm "$OUT/.all-responses"
echo "planted credential absent from every response and from the store" > "$OUT/05-secret-scan.txt"
echo "$C" > "$OUT/conversation-id.txt"
sed -i "s#$ROOTS#<roots>#g" "$OUT"/*.txt "$OUT"/*.json
