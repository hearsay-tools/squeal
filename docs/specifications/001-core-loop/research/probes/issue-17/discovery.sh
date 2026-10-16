#!/bin/sh
# Throwaway (research issue-17, question 3). While one long test file runs for
# 60 s, does the runner listing of a later edit stay pending, and is a test
# file created then listed without a daemon restart?
# usage: discovery.sh <fixture dir> <node_modules template dir> <lane> <variant>
#   lane fast: the long file is long/long.test.ts, a fast-lane (non-slow) file
#   lane slow: the long files are the three e2e/*.e2e.ts slow files
#   variant plain:  only the edit and the new file
#   variant touch:  first rewrite src/a.ts with its own bytes (a "touch", task 001-159)
#   variant config: first append a comment to vitest.config.ts (a recreate trigger)
# env LONG_MS (default 60000): how long the long file takes once lengthened.
# env TIMEOUT_MS (default 600000, cezarion's): the policy's runner.timeoutMs.
# env MAX_POLL_MS (default 240000); env RESTART=1: when the new file is still
# not listed after polling, stop and start the fixture daemon and poll again.
# Uses `squeal` from PATH (0.1.199 on the probe host); only the fixture's daemon.
set -u
LONG_MS=${LONG_MS:-60000}; TIMEOUT_MS=${TIMEOUT_MS:-600000}; MAX_POLL_MS=${MAX_POLL_MS:-240000}
D=$1; TPL=$2; LANE=$3; V=$4; HERE=$(cd "$(dirname "$0")" && pwd)
export XDG_RUNTIME_DIR="$D.run"; mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
q() { node "$HERE/store-query.mjs" "$D/.git/squeal/store.sqlite" "$1"; }
now() { date +%s%3N; }
"$HERE/make-fixture.sh" "$D" "$TPL" 1000
cd "$D" || exit 2
# A fast-lane file whose duration is set by long/delay.ts, outside src/ so the
# browser files' declared inputs do not hold it.
mkdir long
printf 'export const longMs = 1000;\n' > long/delay.ts
cat > long/long.test.ts <<'X'
import { expect, test } from "vitest";
import { longMs } from "./delay";
test("long", async () => {
  await new Promise((r) => setTimeout(r, longMs));
  expect(1).toBe(1);
}, 900_000);
X
sed -i 's|include: \[|include: ["long/**/*.test.ts", |' vitest.config.ts
sed -i "s|\"timeoutMs\": 600000|\"timeoutMs\": $TIMEOUT_MS|" squeal.config.json
git add -A; git -c user.email=probe@example.invalid -c user.name=probe commit -qm long
echo "squeal $(squeal --version), lane $LANE, variant $V, LONG_MS $LONG_MS, runner.timeoutMs $TIMEOUT_MS"
squeal start | head -1
echo "--- 1. every file current (1 s files)"
squeal run --all --wait 300000 | head -1
if [ "$LANE" = slow ]; then
  echo "--- 2. browser files now take 60 s; run --slow starts them"
  printf 'export const delayMs = 60000;\n' > e2e/delay.ts
  sleep 3
  squeal run --slow | head -2
  like=e2e
else
  echo "--- 2. long/long.test.ts now takes $LONG_MS ms; its edit queues it"
  printf 'export const longMs = %s;\n' "$LONG_MS" > long/delay.ts
  like=long.test
fi
for i in $(seq 1 90); do
  open=$(q "select count(*) as n from runs where ended_at is null and test_files like '%$like%'" | tr -dc 0-9)
  [ "${open:-0}" -gt 0 ] && break; sleep 1
done
echo "long run open: ${open:-0}"
sleep 2
T0=$(now)
case $V in
  touch) cp src/a.ts "$D.a-copy"; cat "$D.a-copy" > src/a.ts; rm "$D.a-copy"; echo "--- 3. rewrote src/a.ts with identical bytes"; sleep 3 ;;
  config) printf '// probe\n' >> vitest.config.ts; echo "--- 3. appended a comment to vitest.config.ts"; sleep 3 ;;
  *) echo "--- 3. no extra step" ;;
esac
cat >> src/unit.test.ts <<'X'
test("a is still one", () => expect(a).toBe(1));
X
cat > src/new.test.ts <<'X'
import { expect, test } from "vitest";
test("new file", () => expect(2).toBe(2));
X
echo "--- 4. edited src/unit.test.ts and created src/new.test.ts at +$(( $(now) - T0 )) ms; polling"
node "$HERE/poll.mjs" "$D" "$T0" "$MAX_POLL_MS" src/new.test.ts
listed=$(q "select count(*) as n from test_file_keys where path = 'src/new.test.ts' and key is not null and pending is null" | tr -dc 0-9)
if [ "${RESTART:-0}" = 1 ] && [ "${listed:-0}" -eq 0 ]; then
  echo "--- 4b. still not listed: restart the fixture daemon at +$(( $(now) - T0 )) ms"
  ps -eo pid,etimes,args | grep -E "vitest|squeal.mjs daemon $D" | grep "$D" | grep -v grep | cut -c1-160
  squeal stop 2>&1 | head -3; echo "stop exit at +$(( $(now) - T0 )) ms"
  squeal start | head -1
  node "$HERE/poll.mjs" "$D" "$T0" "$(( MAX_POLL_MS + 180000 ))" src/new.test.ts
fi
echo "--- 5. runs since step 3 (ms after it)"
q "select revision, test_files, started_at - $T0 as started, ended_at - $T0 as ended, end_state from runs where started_at >= $T0 - 120000 order by started_at"
echo "--- 6. notes"
squeal status 2>&1 | sed -n '/^Notes:/,$p' | head -12
squeal stop | head -1
