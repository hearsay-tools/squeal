#!/usr/bin/env bash
# Throwaway (018-21). Starts Squeal (lookup-only, so no test runs) in a fresh
# cezar clone with one explicit Node, lets the shared-ref reader import, and
# saves `squeal status` reads until the counts are stable. Never runs tests:
# no `squeal run`. Stops the daemon at the end.
#
# Isolation: a minimal environment (env -i) with a temporary HOME and
# XDG_RUNTIME_DIR under $TMPDIR, so no real HOME, socket dir or worker pool is
# touched. Only git's proxy and CA variables pass through, for the fetch.
#
# Usage: bash count.sh <clone> <node bin dir> <label> [out dir]
set -euo pipefail
CLONE=$1 NODEBIN=$2 LABEL=$3
OUT=${4:-$TMPDIR/sp/out}/$LABEL
SQ=${SQ:-$TMPDIR/sp/squeal-0.1.426/plugins/claude-code/dist/cli/squeal.mjs}
mkdir -p "$OUT" "$TMPDIR/sp/home" "$TMPDIR/sp/run-$LABEL"
chmod 700 "$TMPDIR/sp/run-$LABEL"
run() {
  env -i HOME="$TMPDIR/sp/home" XDG_RUNTIME_DIR="$TMPDIR/sp/run-$LABEL" TMPDIR="$TMPDIR/sp/tmp" \
    PATH="$NODEBIN:/usr/local/bin:/usr/bin:/bin" LANG="${LANG:-C.UTF-8}" \
    HTTPS_PROXY="${HTTPS_PROXY:-}" HTTP_PROXY="${HTTP_PROXY:-}" NO_PROXY="${NO_PROXY:-}" no_proxy="${no_proxy:-}" \
    GIT_SSL_CAINFO="${GIT_SSL_CAINFO:-}" SSL_CERT_FILE="${SSL_CERT_FILE:-}" \
    "$@"
}
mkdir -p "$TMPDIR/sp/tmp"
cd "$CLONE"
# A fresh store each time: the clone is fresh, only its store is reset.
[ "${KEEP_STORE:-0}" = 1 ] || rm -rf .git/squeal
{
  echo "label: $LABEL"; echo "clone: $CLONE"; echo "HEAD: $(git rev-parse HEAD)"
  echo "merge-base with origin/main: $(git merge-base HEAD origin/main)"
  echo "node: $(run node --version) at $(run sh -c 'command -v node')"
  echo "squeal: $(run node "$SQ" --version 2>&1 | head -1)"
  echo "start (UTC): $(date -u +%FT%TZ)"
  echo "one-minute load: $(cut -d' ' -f1 /proc/loadavg)"
} | tee "$OUT/meta.txt"
run node "$SQ" start 2>&1 | tee "$OUT/start.txt"
prev="" same=0
for i in $(seq 1 60); do
  sleep 15
  run node "$SQ" status --full --json > "$OUT/status-$i.json" 2>"$OUT/status-$i.err" || true
  sig=$(node -e '
    const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const i = (s.imports ?? []).map((m) => `${m.source}: ${m.currentFiles}/${m.testFiles} ${JSON.stringify(m.notCurrent)}`).join("; ");
    console.log(`rev ${s.revision} listed ${s.testFilesListed} files ${JSON.stringify(s.testFileCounts)} imported ${s.importedCount} inherited ${s.inheritedCount} imports [${i}]`);
  ' "$OUT/status-$i.json" 2>/dev/null || echo "unreadable")
  echo "$(date -u +%T) read $i: $sig" | tee -a "$OUT/reads.txt"
  if [ "$sig" = "$prev" ] && [ "${sig#*listed true}" != "$sig" ]; then same=$((same + 1)); else same=0; fi
  prev=$sig
  [ "$same" -ge 3 ] && [ "$i" -ge "${MIN_READS:-0}" ] && break
done
run node "$SQ" status --full > "$OUT/status-full.txt" 2>&1 || true
run node "$SQ" status > "$OUT/status.txt" 2>&1 || true
echo "end (UTC): $(date -u +%FT%TZ), one-minute load: $(cut -d' ' -f1 /proc/loadavg)" | tee -a "$OUT/meta.txt"
run node "$SQ" stop 2>&1 | tee "$OUT/stop.txt"
