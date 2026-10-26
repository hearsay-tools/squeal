#!/bin/sh
# Throwaway probe for research/issue-105-findings.md, experiment E1. Copies ./fixture to a clone
# under /tmp, lets Squeal run every file once (the slow ones too), then makes one write per step
# and prints, per step: the revision, its changed paths, the test files whose key moved, and the
# status line. Usage: sh run.sh <squeal-worktree>
# Uses <squeal-worktree>/plugins/claude-code/dist and <squeal-worktree>/node_modules (Vitest).
# Reads only copies of its own clone's store. Stops its own daemon; removes the clone.
set -eu
SRC=$(cd "$(dirname "$0")" && pwd)
TREE=$(cd "$1" && pwd)
SQUEAL="nice -n 10 node $TREE/plugins/claude-code/dist/cli/squeal.mjs"
BASE=$(mktemp -d /tmp/issue105-XXXXXX)
REPO="$BASE/repo"
unset PLUGIN_ROOT PLUGIN_DATA CLAUDE_PLUGIN_ROOT CLAUDE_PLUGIN_DATA SQUEAL_DAEMON_CHILD SQUEAL_OBSERVE
export HOME="$BASE/home" XDG_CONFIG_HOME="$BASE/xdg/config" XDG_DATA_HOME="$BASE/xdg/data" \
  XDG_STATE_HOME="$BASE/xdg/state" XDG_CACHE_HOME="$BASE/xdg/cache" XDG_RUNTIME_DIR="$BASE/xdg/run" \
  TMPDIR="$BASE/tmp" CODEX_HOME="$BASE/codex" PLUGIN_DATA="$BASE/plugin-data"
mkdir -p "$HOME" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_STATE_HOME" "$XDG_CACHE_HOME" "$TMPDIR" "$CODEX_HOME" "$PLUGIN_DATA" "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
cp -r "$SRC/fixture" "$REPO"
mkdir -p "$REPO/.ai/qa" && touch "$REPO/.ai/qa/.gitkeep"
ln -s "$TREE/node_modules" "$REPO/node_modules"
cd "$REPO"
git init -q && git -c user.email=p@p -c user.name=probe add -A && git -c user.email=p@p -c user.name=probe commit -qm fixture
say() { echo "[$(date -u +%TZ) load $(cut -d' ' -f1 /proc/loadavg)] $*"; }
snap() { # copy this clone's own store, print revisions and keys as JSON lines
  rm -rf "$BASE/snap"; mkdir -p "$BASE/snap"; cp .git/squeal/store.sqlite* "$BASE/snap/"
  python3 -I "$SRC/keys.py" "$BASE/snap/store.sqlite" "$1"
}
step() { # label, then wait for the debounce and reconciliation, then report
  sleep 4
  say "== $1"
  snap "$BASE/keys-$1.json"
  [ -n "${PREV:-}" ] && python3 -I "$SRC/keys.py" --diff "$PREV" "$BASE/keys-$1.json"
  PREV="$BASE/keys-$1.json"
  $SQUEAL status 2>&1 | head -4 || true
  echo "git status --porcelain: [$(git status --porcelain | tr '\n' ' ')]"
}

say "start"; $SQUEAL start "$REPO" >/dev/null 2>&1 || true
say "run --all --wait"; $SQUEAL run --all --wait 180000 2>&1 | tail -2 || true
say "run --slow --wait"; $SQUEAL run --slow --wait 180000 2>&1 | tail -2 || true
step baseline

# Q1a: a scratch script and its output in a new ignored directory, no reader.
mkdir -p .ai/qa/1816 && echo 'console.log(1)' > .ai/qa/1816/probe.mjs && node .ai/qa/1816/probe.mjs > .ai/qa/1816/out.txt
step scratch
# Q1b: the declared ignored input of test/declared.test.mjs.
echo '{"v":1}' > .ai/qa/declared.json
step declared-new
echo '{"v":2}' > .ai/qa/declared.json
step declared-edit
# Q1b control: a declared ignored input that its test file never reads, created then edited.
echo '{"v":1}' > .ai/qa/declared-only.json
step declared-only-new
echo '{"v":2}' > .ai/qa/declared-only.json
step declared-only-edit
# Q1c: a rebuild of the mirror with the same bytes, then with new bytes (c.e2e.mjs reads it).
cat src/app.txt > .ai/qa/build/out.txt
step build-same-bytes
echo 'app v2 (built)' > .ai/qa/build/out.txt
step build-new-bytes
# Q1e: a boot rewrites only the descriptor (new pid and start time), as test-env-up.sh does.
printf '{"status":"running","app":{"pid":%s},"startedAt":"%s"}\n' "$$" "$(date -u +%FT%T.%NZ)" > .ai/qa/test-env.json
step descriptor
# Q1d: the agent runs one browser-like spec itself, outside Squeal, as the cezarion worker did:
# its globalSetup boots again and rewrites test-env.json (new pid and start time).
say "vitest run e2e/d.e2e.mjs by hand (reads no ignored file)"
nice -n 10 node node_modules/vitest/vitest.mjs run --project e2e e2e/d.e2e.mjs 2>&1 | grep -E 'Test Files|Tests' || true
step after-one-spec
say "settle: run --slow --wait"; $SQUEAL run --slow --wait 180000 2>&1 | tail -2 || true
step settled

# Q2: startup reconciliation. The descriptor changes while no daemon runs (a boot or a lease
# release between sessions); the next daemon's start pass sees it.
say "stop"; $SQUEAL stop "$REPO" >/dev/null 2>&1 || true
printf '{"status":"stopped","startedAt":"%s"}\n' "$(date -u +%FT%T.%NZ)" > .ai/qa/test-env.json
say "start"; $SQUEAL start "$REPO" >/dev/null 2>&1 || true
sleep 6
step restart

say "observed sets:"; python3 -I "$SRC/keys.py" --observed "$BASE/snap/store.sqlite"
say "stop"; $SQUEAL stop "$REPO" >/dev/null 2>&1 || true
cd /; rm -rf "$BASE"; say "removed $BASE"
