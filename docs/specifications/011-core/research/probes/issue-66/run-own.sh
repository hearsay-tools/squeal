#!/usr/bin/env bash
# Throwaway probe for issue 66, B's own timeout after a setup edit; see README.md.
set -u
CLI=$1
S=${2:-/tmp/issue66-own}
HERE=$(cd "$(dirname "$0")" && pwd)
DIST=$(dirname "$(dirname "$CLI")")
rm -rf "$S"; mkdir -p "$S/home" "$S/run"; chmod 700 "$S/run"
export HOME=$S/home XDG_RUNTIME_DIR=$S/run
export GIT_AUTHOR_NAME=probe GIT_AUTHOR_EMAIL=p@x GIT_COMMITTER_NAME=probe GIT_COMMITTER_EMAIL=p@x
sq() { echo "\$ squeal $*  (in $(basename "$PWD"))"; node "$CLI" "$@"; echo "[exit $?]"; }
hook() { echo "\$ hook $1 (in $(basename "$PWD"))"; printf '%s' "$2" | node --disable-warning=ExperimentalWarning "$DIST/$1"; echo; echo "[exit $?]"; }
A=$S/a; B=$S/b
mkdir "$A"; cp "$HERE"/fixture/*.ts "$HERE"/fixture/*.json "$A"; cp "$HERE/fixture/gitignore" "$A/.gitignore"
cp "$HERE/fixture-own/slow.test.ts" "$A/slow.test.ts"
cd "$A" && git init -q -b main && npm install -s --no-audit --no-fund --prefer-offline vitest@5 >/dev/null 2>&1
git add -A && git commit -qm fixture && git worktree add -q "$B" -b b
(cd "$B" && npm install -s --no-audit --no-fund --prefer-offline >/dev/null 2>&1)
echo "== versions"; node "$CLI" --version; echo "commit $(git -C "$A" rev-parse --short HEAD)"
SS="{\"session_id\":\"probe-b\",\"cwd\":\"$B\",\"hook_event_name\":\"SessionStart\",\"source\":\"startup\"}"
PB="{\"session_id\":\"probe-b\",\"cwd\":\"$B\",\"hook_event_name\":\"PostToolBatch\"}"
echo "== 1. A full suite: own PASS"; cd "$A"; sq start >/dev/null; sq run --all --wait
echo "== 2. B registers and inherits"; cd "$B"; hook session-start.mjs "$SS"; sq start >/dev/null; sq status --wait 60000
hook post-tool-batch.mjs "$PB"; sq why slow.test.ts
echo "== 3. B edits setup.ts; B's own run of slow.test.ts times out"
echo '(globalThis as { FLAG?: number }).FLAG = 2;' > setup.ts
sq status --wait 60000 slow.test.ts; sq run --all --wait
echo "== 4. B change notice, status, why"; hook post-tool-batch.mjs "$PB"
sq status; sq status --full; sq why slow.test.ts
echo "== stop daemons"; (cd "$A" && node "$CLI" stop); (cd "$B" && node "$CLI" stop)
