#!/usr/bin/env bash
# Issue 12 probe 2 (throwaway). See README.md. Usage: probe-slow.sh <squeal.mjs>
# Requested slow files wait for a held slot; then the store's write lock is held
# 16 s. Records the waits' verdicts, status, daemon processes, a `squeal start`
# during the lapse, and whether the same daemon runs the slow files afterwards.
set -u
CLI=${1:?usage: probe-slow.sh <path to dist/cli/squeal.mjs>}
HERE=$(cd "$(dirname "$0")" && pwd)
NPM_CACHE=${npm_config_cache:-$HOME/.npm}
T=$(mktemp -d /tmp/issue12s-XXXXXX)
export HOME=$T/home XDG_RUNTIME_DIR=$T/run CLAUDE_CONFIG_DIR=$T/home/.claude CODEX_HOME=$T/home/.codex
mkdir -p "$HOME" "$XDG_RUNTIME_DIR/squeal"; chmod 700 "$XDG_RUNTIME_DIR" "$XDG_RUNTIME_DIR/squeal"
R=$T/repo; mkdir -p "$R/test/slow"; cd "$R"
git init -q . && git config user.email p@p && git config user.name p
echo '{"name":"fixture","private":true,"type":"module"}' > package.json
echo 'node_modules' > .gitignore
cat > squeal.config.json <<'J'
{ "slow": { "include": ["test/slow/**"], "maxParallel": 1, "maxLoadPerCpu": 1000 } }
J
echo 'import { it, expect } from "vitest"; it("fast", () => expect(1).toBe(1));' > test/fast.test.js
for n in a b c; do
  echo "import { it, expect } from \"vitest\"; it(\"slow $n\", () => expect(1).toBe(1));" > test/slow/$n.test.js
done
npm i -D -s --no-audit --no-fund --prefer-offline --cache "$NPM_CACHE" vitest@5 >/dev/null 2>&1 || { echo "npm install failed"; exit 2; }
git add -A && git commit -qm init
ts() { date -u +%H:%M:%S; }
daemons() { pgrep -f "squeal.mjs daemon $R" | tr '\n' ' '; }
st() { node "$CLI" status 2>&1 | grep -E '^Daemon:|no daemon|Slow|slot|pending' | head -4 | tr '\n' '|'; }
node "$HERE/hold-slots.mjs" "$XDG_RUNTIME_DIR/squeal" 75000 1 & SPID=$!
sleep 1
node "$CLI" daemon "$R" 2>"$T/daemon.err" & DPID=$!
echo "== squeal $(node "$CLI" --version), vitest $(node -p 'require("vitest/package.json").version'), fixture $T, daemon pid $DPID"
for _ in $(seq 60); do node "$CLI" status 2>&1 | grep -q 'fast.test.js\|1 passed\|passed' && break; sleep 1; done
echo "== $(ts) baseline: $(st)"
(node "$CLI" run --slow --wait 60000 > "$T/run-slow.out" 2>&1; echo "exit $?" >> "$T/run-slow.out") &
sleep 3
echo "== $(ts) slow requested, slot held elsewhere: $(st)"
(node "$CLI" status --wait 60000 test/slow/a.test.js > "$T/named.out" 2>&1; echo "exit $?" >> "$T/named.out") &
sleep 2
echo "== $(ts) store write lock held 16 s"
node "$HERE/hold-store.mjs" "$R/.git/squeal/store.sqlite" 16000 & HPID=$!
for i in $(seq 16); do
  echo "$(ts) daemons [$(daemons)] | $(st)"
  if [ "$i" = 13 ]; then echo "$(ts) squeal start during the lapse:"; node "$CLI" start 2>&1 | head -3 | sed 's/^/    /'; sleep 2; echo "$(ts) daemons after start [$(daemons)]"; fi
  sleep 1
done
wait $HPID
echo "== $(ts) negative control: store free, slot still held elsewhere, 20 s of status"
for _ in $(seq 20); do node "$CLI" status 2>&1 | grep -E '^Daemon:'; sleep 1; done | sort | sed -E 's/[0-9]+ s ago/N s ago/' | uniq -c | sed 's/^/    /'
echo "== $(ts) daemons [$(daemons)]"
echo "== named wait (status --wait 60000 test/slow/a.test.js):"; sed 's/^/    /' "$T/named.out"
echo "== slot released at 75 s; waiting for the requested slow run"
wait $SPID
for _ in $(seq 60); do grep -q '^exit' "$T/run-slow.out" && break; sleep 1; done
echo "== run --slow --wait 60000:"; sed 's/^/    /' "$T/run-slow.out"
for _ in $(seq 90); do node "$CLI" status 2>&1 | grep -q '^Slow tier: 3 test files; 3 current' && break; sleep 1; done
echo "== $(ts) final: daemons [$(daemons)] | $(node "$CLI" status 2>&1 | grep -E '^(Affected|Slow tier|Daemon)' | tr '\n' '|')"
echo "== daemon stderr:"; sed 's/^/    /' "$T/daemon.err"
kill -TERM $DPID 2>/dev/null; wait $DPID 2>/dev/null
for p in $(pgrep -f "squeal.mjs daemon $R"); do kill -TERM "$p"; done
echo "== cleanup"; rm -rf "$T"; echo "removed $T"
