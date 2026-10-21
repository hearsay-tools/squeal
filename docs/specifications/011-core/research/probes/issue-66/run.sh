#!/usr/bin/env bash
# Throwaway probe for issue 66; see README.md.
set -u
CLI=$1
S=${2:-/tmp/issue66-probe}
HERE=$(cd "$(dirname "$0")" && pwd)
DIST=$(dirname "$(dirname "$CLI")")
rm -rf "$S"; mkdir -p "$S/home" "$S/run"; chmod 700 "$S/run"
export HOME=$S/home XDG_RUNTIME_DIR=$S/run ISSUE66_SCRATCH=$S
export GIT_AUTHOR_NAME=probe GIT_AUTHOR_EMAIL=p@x GIT_COMMITTER_NAME=probe GIT_COMMITTER_EMAIL=p@x
sq() { echo "\$ squeal $*  (in $(basename "$PWD"))"; node "$CLI" "$@"; echo "[exit $?]"; }
hook() { echo "\$ hook $1 (in $(basename "$PWD"))"; printf '%s' "$2" | node --disable-warning=ExperimentalWarning "$DIST/$1"; echo "[exit $?]"; }
A=$S/a; B=$S/b
mkdir "$A"; cp "$HERE"/fixture/*.ts "$HERE"/fixture/*.json "$A"; cp "$HERE/fixture/gitignore" "$A/.gitignore"
cd "$A" && git init -q -b main && npm install -s --no-audit --no-fund --prefer-offline vitest@5 >/dev/null 2>&1
git add -A && git commit -qm fixture && git worktree add -q "$B" -b b
(cd "$B" && npm install -s --no-audit --no-fund --prefer-offline >/dev/null 2>&1; [ -d node_modules ] || cp -r "$A/node_modules" "$B/")
echo "== versions"; node "$CLI" --version; (cd "$A" && npx vitest --version); git -C "$A" rev-parse --short HEAD
echo "== 1. A full suite"; cd "$A"; sq start; sq run --all --wait; sq status --wait 60000
echo "== 2. B registers, runs nothing"; cd "$B"
hook session-start.mjs "{\"session_id\":\"probe-b\",\"cwd\":\"$B\",\"hook_event_name\":\"SessionStart\",\"source\":\"startup\"}"
sq start; sq status --wait 60000; sq status --full; sq why slow.test.ts
echo "== 3. A: slow flag on, retry slow.test.ts"; touch "$S/slow-flag"; cd "$A"
sq retry slow.test.ts --reason environment
sq status --wait 60000 slow.test.ts
echo "== 4. B change notice and status"; cd "$B"; sleep 3
hook post-tool-batch.mjs "{\"session_id\":\"probe-b\",\"cwd\":\"$B\",\"hook_event_name\":\"PostToolBatch\"}"
sq status; sq status --full; sq why slow.test.ts
rm -f "$S/slow-flag"
echo "== 5. B edits setup.ts"; cd "$B"; echo '(globalThis as { FLAG?: number }).FLAG = 2;' > setup.ts
sq run --all --wait
node "$CLI" status --json > "$S/b-status.json"; echo "\$ squeal status --json (in b), origins:"; node -e 'const s=JSON.parse(require("fs").readFileSync(0,"utf8"));const st=s.states??s.checks??[];console.log(JSON.stringify(st.map(x=>({check:x.check,outcome:x.outcome,validity:x.validity,origin:x.origin,observedAt:x.observedAt})),null,1));console.log("top-level keys:",Object.keys(s).join(","))' < "$S/b-status.json"
sq why flag.test.ts; sq why slow.test.ts; (cd "$A" && sq status --full)
hook post-tool-batch.mjs "{\"session_id\":\"probe-b\",\"cwd\":\"$B\",\"hook_event_name\":\"PostToolBatch\"}"
echo "== stop daemons"; (cd "$A" && node "$CLI" stop); (cd "$B" && node "$CLI" stop)
