#!/usr/bin/env bash
# Throwaway probe for research/mutation-planning.md (row 015-125), question 5.
# In a scratch repository (cwd) with its own isolated Squeal daemon already serving, runs Stryker once and
# records what the daemon did: its CPU (cpu-tree.mjs over the daemon's process tree), the most processes in
# that tree, and the store rows added (revisions, runs, results, transitions, coverage records), read from
# copies of the store taken with -wal and -shm before and after.
# usage: run-q5.sh <label> <inPlace true|false>   (env: SQ = the squeal command, EXTRA = JSON merged into the
# Stryker config; HOME etc. already isolated)
set -euo pipefail
label=$1 inplace=$2
here=$(cd "$(dirname "$0")" && pwd)
out=/tmp/mp125/q5/out; mkdir -p "$out"
pid=$($SQ ps --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const r=j.repositories.find(r=>r.current);console.log(r.daemons[0].pid)})')
snap() { # $1 = name
  local d="$out/$label-$1"; mkdir -p "$d"; cp .git/squeal/store.sqlite* .git/squeal/code.sqlite* "$d/" 2>/dev/null || true
  node -e '
const { DatabaseSync } = require("node:sqlite"); const d = process.argv[1];
const s = new DatabaseSync(d + "/store.sqlite", { readOnly: true }), c = new DatabaseSync(d + "/code.sqlite", { readOnly: true });
const n = (db, t) => db.prepare(`select count(*) n from ${t}`).get().n;
console.log(JSON.stringify({ revisions: n(s, "revisions"), runs: n(s, "runs"), results: n(s, "results"), transitions: n(s, "transitions"), coverage: n(c, "coverage"),
  lastRevisions: s.prepare("select number, trigger, changes from revisions order by number desc limit 12").all().map((r) => [r.number, r.trigger, JSON.parse(r.changes).map((x) => x.path)]),
  lastRuns: s.prepare("select revision, test_files, end_state from runs order by started_at desc limit 12").all(),
  lastTransitions: s.prepare("select revision, kind, from_outcome, to_outcome from transitions order by id desc limit 12").all() }));' "$d"
}
before=$(snap before); cpu0=$(node "$here/cpu-tree.mjs" "$pid"); load0=$(cut -d' ' -f1 /proc/loadavg)
node -e 'const f="stryker.config.json";const c=JSON.parse(require("fs").readFileSync(f,"utf8"));c.inPlace=process.argv[1]==="true";if(process.argv[3])Object.assign(c,JSON.parse(process.argv[3]));require("fs").writeFileSync(process.argv[2],JSON.stringify(c))' "$inplace" "$out/$label.stryker.json" "${EXTRA:-}"
max=0
( nice -n 10 node_modules/.bin/stryker run "$out/$label.stryker.json" > "$out/$label.stryker.log" 2>&1 ) &
st=$!
while kill -0 $st 2>/dev/null; do
  n=$( (ps --ppid "$pid" -o pid= || true) | wc -l); if [ "$n" -gt "$max" ]; then max=$n; fi
  sleep 0.2
done
wait $st || true
cpuS=$(node "$here/cpu-tree.mjs" "$pid")
$SQ status --wait 60000 > "$out/$label.status.txt" 2>&1 || true
cpu1=$(node "$here/cpu-tree.mjs" "$pid"); load1=$(cut -d' ' -f1 /proc/loadavg)
after=$(snap after)
git status --porcelain > "$out/$label.git-status.txt"
echo "{\"label\":\"$label\",\"inPlace\":$inplace,\"daemonCpuDuringStryker\":$(awk "BEGIN{printf \"%.1f\", $cpuS - $cpu0}"),\"daemonCpuToSettle\":$(awk "BEGIN{printf \"%.1f\", $cpu1 - $cpu0}"),\"maxDaemonChildren\":$max,\"load1\":[\"$load0\",\"$load1\"],\"before\":$before,\"after\":$after}" > "$out/$label.json"
node -e 'const j=require(process.argv[1]);const d=k=>j.after[k]-j.before[k];console.log(j.label,"daemon cpu s",j.daemonCpuDuringStryker,"to settle",j.daemonCpuToSettle,"max children",j.maxDaemonChildren,"revisions +",d("revisions"),"runs +",d("runs"),"results +",d("results"),"transitions +",d("transitions"),"coverage +",d("coverage"),"load",j.load1)' "$out/$label.json"
