#!/bin/sh
# Throwaway (research issue-17, question 2). Does `status --wait <ms> <unit file>`
# wait on browser files that select the unit file through declared inputs?
# usage: named-wait.sh <fixture dir> <node_modules template dir>
# Uses `squeal` from PATH (0.1.199 on the probe host). Starts and stops only the
# fixture's own daemon.
set -u
D=$1; TPL=$2; HERE=$(cd "$(dirname "$0")" && pwd)
# Own runtime dir: the fixture daemon's socket, slow slot and capacity pool stay
# apart from every other Squeal daemon on the host (the host slot is held by
# other worktrees' slow tiers; logs/host-slow-slot.txt).
export XDG_RUNTIME_DIR="$D.run"; mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
q() { node "$HERE/store-query.mjs" "$D/.git/squeal/store.sqlite" "$1"; }
now() { date +%s%3N; }
"$HERE/make-fixture.sh" "$D" "$TPL" 15000
rm -rf "$D.out"; mkdir -p "$D.out"; cd "$D" || exit 2
echo "squeal $(squeal --version)"
squeal start | head -1
echo "--- 1. every file current first (three 15 s browser files, one at a time)"
squeal run --all --wait 300000 | head -1
echo "--- 2. edit the unit test file only"
T0=$(now)
cat >> src/unit.test.ts <<'X'
test("a is still one", () => expect(a).toBe(1));
X
echo "--- 3. squeal status --json --wait 30000 src/unit.test.ts"
squeal status --json --wait 30000 src/unit.test.ts > "$D.out/wait1.json" 2> "$D.out/wait1.err"; code=$?
echo "exit $code after $(( $(now) - T0 )) ms; stderr: $(cat "$D.out/wait1.err")"
node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const w=s.wait;console.log(JSON.stringify({outcome:w.outcome,waitedMs:w.waitedMs,code:w.code,selected:w.testFiles.map(f=>f.path),verdict:w.verdict,runnerPartPending:s.runnerPartPending,slowTier:{pending:s.slowTier.pending,activity:s.slowTier.activity}}))' "$D.out/wait1.json"
echo "--- 4. runs since the edit (ms after the edit)"
q "select revision, test_files, started_at - $T0 as started, ended_at - $T0 as ended, end_state from runs where started_at >= $T0 - 1000 order by started_at"
echo "--- 5. squeal status --wait 120000 src/unit.test.ts (text)"
T1=$(now)
squeal status --wait 120000 src/unit.test.ts > "$D.out/wait2.txt" 2>&1; code=$?
echo "exit $code after $(( $(now) - T1 )) ms (edit + $(( $(now) - T0 )) ms)"
sed -n '1,12p' "$D.out/wait2.txt"
echo "--- 6. runs since the edit, again"
q "select revision, test_files, started_at - $T0 as started, ended_at - $T0 as ended, end_state from runs where started_at >= $T0 - 1000 order by started_at"
echo "--- 7. control: the selection for the browser file's own source, src/a.ts"
squeal status --json --wait 5000 src/a.ts 2>/dev/null | node -e 'let t="";process.stdin.on("data",d=>t+=d).on("end",()=>{const w=JSON.parse(t).wait;console.log(JSON.stringify({outcome:w.outcome,selected:w.testFiles.map(f=>f.path)}))})'
squeal stop | head -1
