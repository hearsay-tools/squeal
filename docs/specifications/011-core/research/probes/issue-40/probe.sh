#!/usr/bin/env bash
# Throwaway probe for ../../issue-40.md. Usage: probe.sh <squeal.mjs> <vitest node_modules> <backlogTierSize>
# A git repo under a fresh /tmp dir (HOME and XDG_* inside it) with 24 background files
# (tests/bg, 2 s each), 3 fast files (tests/fast) and one slow file (tests/slow, slow.include),
# baseline.onStart "lookup-only" so nothing runs at start. `run --all` queues everything as
# the backlog; a named wait on the three fast files and the slow file follows at once. Each
# test appends "<ms> <name>" to $T/order.log when it runs, so the start order is read, not
# inferred. A 1.5 s named wait times out first, to show its per-file reasons. Prints status mid-way, the named wait's verdict, and the order log.
set -u
CLI=$1 NM=$2 BTS=$3
T=$(mktemp -d /tmp/issue40.XXXX)
export HOME=$T/home XDG_RUNTIME_DIR=$T/home/.run XDG_CONFIG_HOME=$T/home/.config \
  XDG_STATE_HOME=$T/home/.state XDG_CACHE_HOME=$T/home/.cache XDG_DATA_HOME=$T/home/.data
unset CLAUDE_SESSION_ID CODEX_THREAD_ID PI_SESSION_ID SQUEAL_SESSION_ID
mkdir -p "$XDG_RUNTIME_DIR" "$T/repo/tests/bg" "$T/repo/tests/fast" "$T/repo/tests/slow" && chmod 700 "$XDG_RUNTIME_DIR"
cd "$T/repo"
sq() { echo "\$ squeal $*"; timeout 150 node --disable-warning=ExperimentalWarning "$CLI" "$@"; echo "(exit $?)"; }
commit() { git add -A && git -c user.email=p@x -c user.name=p commit -qm "$1"; }
ln -s "$NM" node_modules
printf 'node_modules\n' > .gitignore
echo '{"name":"issue40","private":true,"type":"module"}' > package.json
echo 'export default { test: { include: ["tests/**/*.test.ts"] } };' > vitest.config.ts
mk() { # name sleep-ms
  cat > "tests/$1.test.ts" <<T
import { appendFileSync } from "node:fs";
import { test } from "vitest";
test("$1", async () => {
  appendFileSync("$T/order.log", Date.now() + " $1\n");
  await new Promise((r) => setTimeout(r, $2));
});
T
}
for i in $(seq -w 1 24); do mk "bg/b$i" 2000; done
for i in 1 2 3; do mk "fast/f$i" 10; done
mk slow/s1 10
git init -q && commit fixture
echo "== $(node "$CLI" --version) at $(cut -d' ' -f1 /proc/loadavg) load, $(nproc) CPUs, backlogTierSize $BTS, root $T/repo"
sq init >/dev/null
node -e '
const fs=require("fs"); const c=JSON.parse(fs.readFileSync("squeal.config.json","utf8"));
c.baseline={onStart:"lookup-only"}; c.runner={...(c.runner??{}),backlogTierSize:Number(process.argv[1])};
c.slow={include:["tests/slow/**/*.test.ts"]};
fs.writeFileSync("squeal.config.json", JSON.stringify(c,null,2)+"\n");' "$BTS"
echo "\$ cat squeal.config.json"; cat squeal.config.json
commit init
sq start
sleep 4
sq status --wait 20000
sq run --all
start=$(date +%s%3N); echo "run --all at $start"
( sleep 3; echo; echo "--- status 3 s into the wait"; sq status | grep -E "^(Revision|Known|Affected|Discovery|Slow|Checks|Queued|Running)" ) &
sq status --wait 1500 tests/fast/f1.test.ts tests/fast/f2.test.ts tests/fast/f3.test.ts tests/slow/s1.test.ts | sed -n '/^Selected/,$p'
sq status --wait 15000 tests/fast/f1.test.ts tests/fast/f2.test.ts tests/fast/f3.test.ts tests/slow/s1.test.ts | sed -n '/^Selected/,$p'
wait
echo "--- order.log, ms after run --all"
awk -v s="$start" '{ printf "%6d %s\n", $1 - s, $2 }' "$T/order.log" 2>/dev/null
sq status --wait 90000 tests/fast/f1.test.ts tests/slow/s1.test.ts | tail -3
echo "--- order.log after the second wait"
awk -v s="$start" '{ printf "%6d %s\n", $1 - s, $2 }' "$T/order.log" 2>/dev/null | tail -8
sq stop
echo "== end load $(cut -d' ' -f1 /proc/loadavg); probe root $T"
