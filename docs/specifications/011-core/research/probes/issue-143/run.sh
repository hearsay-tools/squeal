#!/usr/bin/env bash
# Throwaway probe for issue 143; see README.md. Usage: run.sh <claude-code-dist> [scratch]
set -u
DIST=$(cd "$1" && pwd)
S=${2:-/tmp/issue143-probe}
HERE=$(cd "$(dirname "$0")" && pwd)
CLI=$DIST/cli/squeal.mjs
rm -rf "$S"; mkdir -p "$S/home" "$S/run"; chmod 700 "$S/run"
R=$S/r; mkdir "$R"; cp "$HERE"/fixture/*.ts "$HERE"/fixture/*.json "$R"; cp "$HERE/fixture/gitignore" "$R/.gitignore"
# Install before HOME moves, so npm uses its usual cache.
(cd "$R" && npm install -s --no-audit --no-fund vitest@5.0.3 >/dev/null 2>&1) || { echo "vitest install failed"; exit 1; }
export HOME=$S/home XDG_RUNTIME_DIR=$S/run
export GIT_AUTHOR_NAME=probe GIT_AUTHOR_EMAIL=p@x GIT_COMMITTER_NAME=probe GIT_COMMITTER_EMAIL=p@x GIT_EDITOR=true
ts() { date +%H:%M:%S.%3N; }
sq() { echo "\$ squeal $*  [$(ts)]"; node "$CLI" "$@"; echo "[exit $?]"; }
js() { echo "\$ squeal status --json (summary)  [$(ts)]"; node "$CLI" status --json > "$S/status.json"; node -e '
  const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const pick = (o, ks) => Object.fromEntries(ks.filter(k => o && k in o).map(k => [k, o[k]]));
  console.log(JSON.stringify({ revision: s.revision ?? s.header?.revision, holds: s.holds ?? s.header?.holds, counts: s.counts ?? s.summary }, null, 0).slice(0, 1500));
' "$S/status.json"; }
SESSION="{\"session_id\":\"probe143\",\"cwd\":\"$R\",\"hook_event_name\":\"SessionStart\",\"source\":\"startup\"}"
BATCH="{\"session_id\":\"probe143\",\"cwd\":\"$R\",\"hook_event_name\":\"PostToolBatch\"}"
hook() { echo "\$ hook $1  [$(ts)]"; printf '%s' "$2" | node --disable-warning=ExperimentalWarning "$DIST/$1"; echo "[exit $?]"; }
cd "$R" && git init -q -b main && git add -A && git commit -qm fixture
git switch -qc side; sed -i 's/testTimeout: 5000/testTimeout: 6000/' vitest.config.ts; git commit -qam "side: 6000"
git switch -q main; sed -i 's/testTimeout: 5000/testTimeout: 7000/' vitest.config.ts; git commit -qam "main: 7000"
git switch -q side
echo "== versions"; node "$CLI" --version; node_modules/.bin/vitest --version; git --version; node --version
echo "== load"; cat /proc/loadavg; nproc
echo "== 1. baseline on side"
hook session-start.mjs "$SESSION"
sq start; sq run --all --wait; js
hook post-tool-batch.mjs "$BATCH"
echo "== 2. git rebase main (conflict in vitest.config.ts)"
echo "\$ git rebase main  [$(ts)]"; git rebase main; echo "[exit $?]"
echo "\$ git ls-files -u"; git ls-files -u
echo "\$ cat vitest.config.ts"; cat vitest.config.ts
sleep 3; sq status; js; sq status --full
hook post-tool-batch.mjs "$BATCH"
sq why a.test.ts
echo "== 2b. edit a test during the hold (queues work)"
echo "\$ edit b.test.ts  [$(ts)]"; sed -i 's/toBe(2); }/toBe(2); }); test("b2", () => { expect(3).toBe(3); }/' b.test.ts; cat b.test.ts
sleep 3; sq status; js
echo "== 3a. write resolved vitest.config.ts, no git add yet"
echo "\$ write vitest.config.ts (7000)  [$(ts)]"
printf 'import { defineConfig } from "vitest/config";\nexport default defineConfig({\n  test: {\n    testTimeout: 7000,\n  },\n});\n' > vitest.config.ts
git ls-files -u; echo "(end ls-files -u)"
sleep 3; sq status; js
hook post-tool-batch.mjs "$BATCH"
echo "== 3b. git add vitest.config.ts"
echo "\$ git add  [$(ts)]"; git add vitest.config.ts b.test.ts; git ls-files -u; echo "(end ls-files -u)"
sleep 3; sq status --wait 60000; js
hook post-tool-batch.mjs "$BATCH"
sq why a.test.ts
echo "== 3c. git rebase --continue"
echo "\$ git rebase --continue  [$(ts)]"; git rebase --continue; echo "[exit $?]"; git log --oneline | head -3
sleep 3; sq status --wait 60000; js; sq status --full
hook post-tool-batch.mjs "$BATCH"
sq why a.test.ts
sq why b.test.ts
echo "== 4. later unrelated edit"
echo "\$ edit helper.ts comment  [$(ts)]"; printf '// later\n' >> helper.ts
sleep 3; sq status --wait 60000; js
hook post-tool-batch.mjs "$BATCH"
echo "== stop daemon"; node "$CLI" stop; echo "[exit $?]"
pgrep -f "squeal.mjs daemon $S" || echo "no daemon left"
