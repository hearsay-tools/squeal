#!/bin/sh
# Throwaway (row 020-42). The gate and the daemon on the fixture, released Squeal 0.1.457
# copied from the plugin cache to /tmp/cds/squeal. Every Squeal call runs under env -i with
# HOME and TMPDIR under /tmp/cds, nice 10. Usage: squeal.sh <worktree> <out-dir> <step>.
set -u
W=$1; OUT=$2; STEP=$3; P=$(cd "$(dirname "$0")" && pwd)
NODEBIN=$(dirname "$(command -v node)")
S() { env -i HOME=/tmp/cds/home TMPDIR=/tmp/cds/tmp PATH="$NODEBIN:/usr/bin:/bin" nice -n 10 node /tmp/cds/squeal/dist/cli/squeal.mjs "$@"; }
repo() { # fresh committed copy of the fixture
  R=/tmp/cds/$1; rm -rf "$R"; cp -a "$P/fixture" "$R"; ln -s "$W/node_modules" "$R/node_modules"
  printf 'node_modules\n' > "$R/.gitignore"
  git -C "$R" init -q && git -C "$R" add -A && git -C "$R" -c user.name=p -c user.email=p@x commit -qm base
}
case $STEP in
  gate) # gate after a shard-only sequencer edit, and a control edit of src/marked.ts
    for e in shard control; do
      repo gate-$e; cd /tmp/cds/gate-$e
      if [ $e = shard ]; then node "$P/edits.mjs" . shard; else sed -i '2s/__MARK__$/__MARK__ + ""/' src/marked.ts; fi
      git diff --stat > "$OUT/gate-$e.diff"
      S code --base HEAD --json > "$OUT/gate-$e.json" 2> "$OUT/gate-$e.err"; echo "exit $?" >> "$OUT/gate-$e.err"
    done ;;
  daemon) # daemon: full run, then the same shard-only edit
    repo daemon; cd /tmp/cds/daemon
    S start > "$OUT/daemon-start.out" 2>&1
    S run --all --wait 300000 > "$OUT/daemon-0.out" 2>&1
    S status --json > "$OUT/daemon-0.json" 2>&1
    node "$P/edits.mjs" . shard
    sleep 3
    S status --json > "$OUT/daemon-1.json" 2>&1
    S why 'test/plain-1.test.ts > plain 1' > "$OUT/daemon-why.out" 2>&1
    S status --wait 300000 > "$OUT/daemon-2.out" 2>&1
    S status --json > "$OUT/daemon-2.json" 2>&1
    S stop > "$OUT/daemon-stop.out" 2>&1 ;;
esac
