#!/bin/sh
# Throwaway probe (row 025-14): runs remote.sh on a fresh boat.dev sandbox
# (Node 24.21, this branch's sources, the committed hook bundles of the
# release tags) and copies ./results back to $1. Deletes the sandbox.
# Usage: sh boat.sh <resultsDir> [remote script, default remote.sh]   (from the repository root, probes committed)
set -eu
OUT=$1
REMOTE=${2:-remote.sh}
P=docs/specifications/025-performance/research/probes/hook-latency/bundles
TOP=$(mktemp -d /tmp/hl-025-14.XXXXXX)
PAY=$TOP/payload
mkdir -p "$PAY" "$TOP/up"
git archive HEAD src test plugins/claude-code package.json pnpm-lock.yaml pnpm-workspace.yaml \
  tsconfig.json tsconfig.build.json vitest.config.ts $P | tar x -C "$PAY"
for t in squeal--v0.1.364 squeal--v0.1.409 squeal--v0.1.450 squeal--v0.1.568 squeal--v0.1.600 792ee0ccb; do
  mkdir -p "$PAY/tags/$t/dist"
  for h in pre-tool-use stop; do git show "$t:plugins/claude-code/dist/$h.mjs" > "$PAY/tags/$t/dist/$h.mjs"; done
done
retry() { for _ in 1 2 3 4 5; do "$@" && return 0; sleep 20; done; return 1; }
ID=$(retry boat new --no-env --ttl 10800 --name hook-bundles-025-14 --json | tail -1 | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).id')
echo "sandbox $ID"
trap 'boat delete "$ID" --yes >/dev/null 2>&1 || true; rm -rf "$TOP"' EXIT
# One file: a directory pushes file by file, which took minutes for ~40 MB.
tar czf "$TOP/up/payload.tgz" -C "$TOP" payload
for _ in 1 2 3 4 5; do
  boat ssh "$ID" -- "test -f /home/user/payload/$P/remote.sh" >/dev/null 2>&1 && break
  sleep 10
  boat push "$ID" "$TOP/up" --to /home/user/up >/dev/null || true
  boat ssh "$ID" -- "cd /home/user && tar xzf up/payload.tgz" >/dev/null 2>&1 || true
done
# Node 24.21 as on the developer host, first on PATH (the image has another 24.x in /usr/local).
NODE_PATH_SET='export PATH=$HOME/node24/bin:$PATH'
retry boat ssh "$ID" -- "set -e; mkdir -p \$HOME/node24; curl -fsSL https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-x64.tar.xz | tar xJ -C \$HOME/node24 --strip-components=1; $NODE_PATH_SET; node --version"
retry boat ssh "$ID" -- "set -e; cd /home/user/payload; $NODE_PATH_SET; npm i -g --prefix \$HOME/node24 pnpm@12.15.0 >/dev/null 2>&1; pnpm --version; pnpm install --frozen-lockfile > install.log 2>&1 || { tail -30 install.log; exit 1; }"
boat ssh "$ID" -- "cd /home/user/payload && $NODE_PATH_SET && { [ -e started ] || (touch started; setsid nohup sh $P/$REMOTE > remote.out 2>&1 < /dev/null &); }"
until boat ssh "$ID" -- 'test -f /home/user/payload/results/done' >/dev/null 2>&1; do
  sleep 60
  boat ssh "$ID" -- 'tail -1 /home/user/payload/results/run.log' 2>/dev/null || true
done
retry boat ssh "$ID" -- 'cd /home/user/payload && tar czf /tmp/results.tgz results remote.out' >/dev/null
mkdir -p "$OUT"
retry boat scp "$ID:/tmp/results.tgz" "$OUT/results.tgz" >/dev/null
tar xzf "$OUT/results.tgz" -C "$OUT" && rm "$OUT/results.tgz"
echo "results in $OUT"
