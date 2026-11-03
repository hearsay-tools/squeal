#!/usr/bin/env bash
# Throwaway probe for issue 143, variant B: no hook boundary between the conflict and its resolution.
set -u
DIST=$(cd "$1" && pwd)
S=${2:-/tmp/issue143-quiet}
HERE=$(cd "$(dirname "$0")" && pwd)
CLI=$DIST/cli/squeal.mjs
rm -rf "$S"; mkdir -p "$S/home" "$S/run"; chmod 700 "$S/run"
R=$S/r; mkdir "$R"; cp "$HERE"/fixture/*.ts "$HERE"/fixture/*.json "$R"; cp "$HERE/fixture/gitignore" "$R/.gitignore"
(cd "$R" && npm install -s --no-audit --no-fund vitest@5.0.3 >/dev/null 2>&1) || { echo "vitest install failed"; exit 1; }
export HOME=$S/home XDG_RUNTIME_DIR=$S/run
export GIT_AUTHOR_NAME=probe GIT_AUTHOR_EMAIL=p@x GIT_COMMITTER_NAME=probe GIT_COMMITTER_EMAIL=p@x GIT_EDITOR=true
ts() { date +%H:%M:%S.%3N; }
sq() { echo "\$ squeal $*  [$(ts)]"; node "$CLI" "$@" | sed 's/\x1b\[[0-9;]*m//g' | grep -v '│\|╭\|───╯'; echo "[exit ${PIPESTATUS[0]}]"; }
SESSION="{\"session_id\":\"probe143q\",\"cwd\":\"$R\",\"hook_event_name\":\"SessionStart\",\"source\":\"startup\"}"
BATCH="{\"session_id\":\"probe143q\",\"cwd\":\"$R\",\"hook_event_name\":\"PostToolBatch\"}"
hook() { echo "\$ hook $1  [$(ts)]"; printf '%s' "$2" | node --disable-warning=ExperimentalWarning "$DIST/$1" | cut -c1-900; echo; echo "[exit]"; }
cd "$R" && git init -q -b main && git add -A && git commit -qm fixture
git switch -qc side; sed -i 's/testTimeout: 5000/testTimeout: 6000/' vitest.config.ts; git commit -qam "side: 6000"
git switch -q main; sed -i 's/testTimeout: 5000/testTimeout: 7000/' vitest.config.ts; git commit -qam "main: 7000"
git switch -q side
echo "== versions"; node "$CLI" --version; node_modules/.bin/vitest --version
echo "== load"; cat /proc/loadavg; nproc
echo "== 1. baseline"
hook session-start.mjs "$SESSION"; sq start >/dev/null; sq run --all --wait | head -3; hook post-tool-batch.mjs "$BATCH"
echo "== 2. conflict, then resolution, no hook in between"
echo "\$ git rebase main  [$(ts)]"; git rebase main >/dev/null 2>&1; echo "[exit $?]"; git ls-files -u
sleep 3
echo "\$ write resolved, git add, git rebase --continue  [$(ts)]"
printf 'import { defineConfig } from "vitest/config";\nexport default defineConfig({\n  test: {\n    testTimeout: 7000,\n  },\n});\n' > vitest.config.ts
git add vitest.config.ts; git rebase --continue >/dev/null 2>&1; echo "[exit $?]"; git ls-files -u; echo "(end ls-files -u)"
sleep 3
echo "== 3. first hook after resolution"
hook post-tool-batch.mjs "$BATCH"
sq status --wait 60000
sq why a.test.ts
echo "== 4. second hook"
hook post-tool-batch.mjs "$BATCH"
echo "== stop daemon"; node "$CLI" stop; echo "[exit $?]"
