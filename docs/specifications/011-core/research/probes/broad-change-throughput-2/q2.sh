#!/bin/bash
# q2.sh <broad path> <single test file> <mid path> <new test source>: question 2.
# Starts the clone's daemon under `node --cpu-prof` (the runner hosts inherit
# its execArgv; Vitest's forks get their own empty execArgv) in scope sq-q2,
# holds the run-loop group (hold.sh), then makes six revisions one after the
# other, each once the previous one's runner part ended (the store's refined
# revision reached it, refined-wait.mjs; at most 300 s):
#   b1 broad edit (fresh daemon), b2 the same file again (warm), t1 one test
#   file, m1 a mid-reach module, a1 a new test file (a copy of <new test
#   source>: a listing), d1 its delete (a listing).
# Writes $OUT/q2.edits.tsv (epoch ms, label, path, revision, epoch ms it was
# seen refined, first run at it or later, queued files 3 s after), $OUT/q2.clock (epoch ms and
# CLOCK_MONOTONIC us at one instant, to place the profiles), the samplers,
# then stops the daemon so the profiles are written to $OUT/prof-q2/.
d=$(cd "$(dirname "$0")" && pwd)
. "$d/env.sh"
export HELD=1
broad=$1; single=$2; mid=$3; src=$4
sq stop >/dev/null 2>&1; sleep 3
git checkout -q squeal.config.json; echo '{}' > "$XDG_CONFIG_HOME/squeal/config.json"
mkdir -p "$OUT/prof-q2"
out=$(bash "$d/start-daemon.sh" sq-q2 --cpu-prof --cpu-prof-dir="$OUT/prof-q2" --cpu-prof-interval=2000); echo "$out" > "$OUT/q2.daemon.txt"
dpid=$(echo "$out" | awk '/^pid=/ && / daemon /{sub("pid=","",$1); print $1; exit}')
[ -z "$dpid" ] && { echo "no daemon pid"; cat "$OUT/q2.daemon.txt"; exit 1; }
bash "$d/wait-idle.sh" 1800
bash "$d/hold.sh" q2 > "$OUT/q2.hold.store.txt" 2>&1; sleep 5
node -e 'console.log(Date.now(), String(process.hrtime.bigint() / 1000n))' > "$OUT/q2.clock"
ps -eo pid,ppid,args | grep -E "squeal.mjs (daemon|runner-host)" | grep -v grep > "$OUT/q2.procs.txt"
cg=/sys/fs/cgroup/user.slice/user-$(id -u).slice/user@$(id -u).service/app.slice/sq-q2.scope
bash "$d/bg.sh" q2-sampler 3000 bash "$d/sample.sh" "$OUT/q2.tsv" 2800 "$cg" "$dpid"
bash "$d/bg.sh" q2-workers 3000 node "$d/workers.mjs" "$OUT/q2.workers.tsv" 2800 "$cg"
date +%s%3N > "$OUT/q2.t0"
# one revision, then wait for its runner part: a run at its revision or later starts
step() { # <label> <path> <action: edit|add|rm>
  local label=$1 path=$2 act=$3 t r q end run
  t=$(date +%s%3N)
  case $act in
    edit) echo "// probe 011-400 $label $(date +%s%N)" >> "$path" ;;
    add) cp "$src" "$path" ;;
    rm) rm -f "$path" ;;
  esac
  read r end run q < <(node "$d/refined-wait.mjs" .git/squeal/store.sqlite "$t" 300)
  printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\n" "$t" "$label" "$path" "$r" "$end" "$run" "$q" >> "$OUT/q2.edits.tsv"
  echo "$label rev=$r runner part end=$end queued=$q ($(( (${end/-/$t} - t) / 1000 )) s)"
}
step b1 "$broad" edit; sleep 30
step b2 "$broad" edit; sleep 30
step t1 "$single" edit; sleep 20
step m1 "$mid" edit; sleep 30
new="$(dirname "$src")/probe-011-400.test.ts"
step a1 "$new" add; sleep 20
step d1 "$new" rm; sleep 20
date +%s%3N > "$OUT/q2.t1"
cp .git/squeal/logs/* "$OUT/" 2>/dev/null; ls .git/squeal/logs > "$OUT/q2.logs.txt"
sq stop; sleep 10
kill "$(cat "$OUT/q2-sampler.pid")" "$(cat "$OUT/q2-workers.pid")" 2>/dev/null
ls -la "$OUT/prof-q2"
echo "q2 done $(date -u +%FT%TZ)"
