#!/bin/bash
# Alternates nice 10 and nice 0 runs of the escaped test on 2 contended CPUs; one line per run.
# Needs the test to append "NOTE395 spawner=<pid> <note>" to /tmp/sq395-notes.log before its pattern checks, a temporary edit not committed.
cd "$1"
trap 'kill $h1 $h2 2>/dev/null; sed -i -E "s/export const TEST_NICE = [0-9]+;/export const TEST_NICE = 10;/" src/core/daemon/low-priority.ts' EXIT
taskset -c 0-1 node -e 'for(;;){}' >/dev/null 2>&1 & h1=$!
taskset -c 0-1 node -e 'for(;;){}' >/dev/null 2>&1 & h2=$!
for i in $(seq 40); do
  if [ $((i % 2)) -eq 1 ]; then n=10; else n=0; fi
  sed -i -E "s/export const TEST_NICE = [0-9]+;/export const TEST_NICE = $n;/" src/core/daemon/low-priority.ts
  log=/tmp/sq395f-$i.log; : > /tmp/sq395-notes.log
  if taskset -c 0-1 env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 timeout 120 npx vitest run test/daemon/escaped.test.ts -t "detached sleeper" > $log 2>&1; then r=pass; else r=FAIL; fi
  line=$(grep -m1 -E "NOTE395|DIAG395" /tmp/sq395-notes.log | cut -c1-900)
  echo "nice $n $r :: $(echo "$line" | grep -oE 'spawner=[0-9]+|spawner [0-9]+|stopped [0-9] process(es)?|\(parent [^)]*\)' | sed -E 's/, run [^)]*//' | tr '\n' ' ')"
done
kill $h1 $h2
sed -i -E "s/export const TEST_NICE = [0-9]+;/export const TEST_NICE = 10;/" src/core/daemon/low-priority.ts
echo done
