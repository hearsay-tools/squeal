#!/bin/sh
# Throwaway probe for issue 46. Usage: sh run.sh stale|fresh. See README.md.
set -u
MODE=${1:?stale or fresh}
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SQUEAL=${SQUEAL_CLI:-$HOME/.claude/plugins/cache/hearsay/squeal/0.1.223/dist/cli/squeal.mjs}
WORK=$(mktemp -d /tmp/issue46-XXXXXX)
export HOME="$WORK/home"; mkdir -p "$HOME"
sq() { node --disable-warning=ExperimentalWarning "$SQUEAL" "$@"; }
cp -R "$HERE/fixture/." "$WORK/repo"
cd "$WORK/repo"
[ "$MODE" = stale ] && echo 2 > ttl || echo 600 > ttl
git init -q && git add -A && git -c user.email=p@p -c user.name=probe commit -qm fixture
npm install --silent --no-audit --no-fund vitest@4.1.10 >/dev/null 2>&1 || { echo "npm install failed"; exit 2; }
echo "== versions: node $(node -v), vitest $(npx vitest --version), squeal $(sq --version), load $(cut -d' ' -f1-3 /proc/loadavg), cpus $(nproc)"
echo "== mode $MODE, ttl $(cat ttl)s, work $WORK"
sq start > "$WORK/start.out" 2>&1; echo "== squeal start: $(head -1 "$WORK/start.out")"
sq run --all --wait > "$WORK/run-all.out" 2>&1 &
RUN=$!
i=0; until ls .qa/started-* >/dev/null 2>&1 || [ $i -ge 600 ]; do sleep 0.1; i=$((i+1)); done
echo "== slow file started in Squeal's run after $((i/10))s at $(cat .qa/started-*)"
echo "== squeal status while the slow file runs (Slow tier line)"; sq status 2>&1 | grep -i "slow tier"
sleep 3
echo "== manual run: npx vitest run e2e/held.e2e.ts"
npx vitest run e2e/held.e2e.ts > "$WORK/manual.out" 2>&1; echo "manual exit $?"
tail -n 6 "$WORK/manual.out"
wait $RUN; echo "== squeal run --all --wait exit $?"; cat "$WORK/run-all.out"
echo "== env.log"; cat .qa/env.log
echo "== squeal status"; sq status
echo "== status --json known failures"
sq status --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(JSON.stringify({knownFailureCounts:j.knownFailureCounts,knownFailures:j.knownFailures},null,1).slice(0,3000))})'
echo "== squeal why e2e/held.e2e.ts"; sq why e2e/held.e2e.ts 2>&1 | head -30
if [ "$MODE" = stale ]; then
  echo "== squeal retry e2e/held.e2e.ts --reason environment"; sq retry e2e/held.e2e.ts --reason environment
  sq status --wait 60000 e2e/held.e2e.ts > /dev/null 2>&1; sleep 12
  echo "== status after retry"; sq status 2>&1 | head -30
fi
echo "== cleanup"
for p in $(cat .qa/pid 2>/dev/null) $(node -p 'try{require("./.qa/env.json").pid}catch{""}'); do kill "$p" 2>/dev/null; done
sq remove --config 2>&1 | tail -3
cd / && rm -rf "$WORK"
