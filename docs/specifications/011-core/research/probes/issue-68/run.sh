#!/usr/bin/env bash
# Throwaway probe for issue 68; see README.md.
set -u
DIST=$(cd "$1" && pwd)   # a Claude Code plugin dist directory (cli/squeal.mjs, post-tool-batch.mjs)
S=${2:-/tmp/issue68-probe}
HERE=$(cd "$(dirname "$0")" && pwd)
CLI=$DIST/cli/squeal.mjs
rm -rf "$S"; mkdir -p "$S/home" "$S/run"; chmod 700 "$S/run"
export HOME=$S/home XDG_RUNTIME_DIR=$S/run
export GIT_AUTHOR_NAME=probe GIT_AUTHOR_EMAIL=p@x GIT_COMMITTER_NAME=probe GIT_COMMITTER_EMAIL=p@x
ts() { date +%H:%M:%S.%3N; }
sq() { echo "\$ squeal $*  [$(ts)]"; node "$CLI" "$@"; echo "[exit $?]"; }
hook() { echo "\$ hook $1  [$(ts)]"; printf '%s' "$2" | node --disable-warning=ExperimentalWarning "$DIST/$1"; echo "[exit $?]"; }
SESSION="{\"session_id\":\"probe68\",\"cwd\":\"$S/r\",\"hook_event_name\":\"SessionStart\",\"source\":\"startup\"}"
BATCH="{\"session_id\":\"probe68\",\"cwd\":\"$S/r\",\"hook_event_name\":\"PostToolBatch\"}"
R=$S/r; mkdir "$R"; cp "$HERE"/fixture/*.ts "$HERE"/fixture/*.json "$R"; cp "$HERE/fixture/gitignore" "$R/.gitignore"
cd "$R" && git init -q -b main && npm install -s --no-audit --no-fund --prefer-offline vitest@5 >/dev/null 2>&1
git add -A && git commit -qm fixture
git switch -qc side; sed -i 's/return 1;/return 2;/' helper.ts; git commit -qam "side: 2"
git switch -q main; sed -i 's/return 1;/return 3;/' helper.ts; git commit -qam "main: 3"
echo "== versions"; node "$CLI" --version; npx vitest --version; git --version
echo "== 1. baseline full suite"
hook session-start.mjs "$SESSION"
sq start; sq run --all --wait
hook post-tool-batch.mjs "$BATCH"
echo "== 2. git merge side (conflict)"
echo "\$ git merge side  [$(ts)]"; git merge side; echo "[exit $?]"
echo "\$ git ls-files -u"; git ls-files -u
echo "\$ head helper.ts"; cat helper.ts
sleep 2; sq status --wait 60000
sq status --full
hook post-tool-batch.mjs "$BATCH"
sq why a.test.ts
echo "== 3a. write the resolved file, no git add yet"
echo "\$ write helper.ts (return 3)  [$(ts)]"; printf 'export function value(): number {\n  return 3;\n}\n' > helper.ts
echo "\$ git ls-files -u"; git ls-files -u; echo "(end)"
sleep 2; sq status --wait 60000
hook post-tool-batch.mjs "$BATCH"
echo "== 3b. git add helper.ts"
echo "\$ git add helper.ts  [$(ts)]"; git add helper.ts; echo "[exit $?]"
echo "\$ git ls-files -u"; git ls-files -u; echo "(end)"
sleep 2; sq status --wait 60000
echo "== 3c. git commit --no-edit"
echo "\$ git commit --no-edit  [$(ts)]"; git commit -q --no-edit; echo "[exit $?]"
sleep 2; sq status --wait 60000
sq status --full
hook post-tool-batch.mjs "$BATCH"
echo "== stop daemon"; node "$CLI" stop; echo "[exit $?]"
