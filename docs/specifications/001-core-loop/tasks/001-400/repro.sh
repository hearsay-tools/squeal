#!/bin/bash
# Reproduction for 001-400: escaped.test's "detached sleeper" test with the fork holding a heap of
# $3 MB, so its kernel-side exit lasts long, on 2 CPUs beside 2 busy loops. One line per run.
# Usage: repro.sh <worktree> <runs> <heap MB> [log dir]. Writes test/daemon/escaped-heap.repro.ts,
# outside the suite's include, and removes it on exit; a failing run's output is kept in the log dir.
# With SQ400_NOTES set, the copy appends each stop's note, and the fork's pid, to that file.
cd "$1" || exit 2
runs=$2 mb=$3 logs=${4:-$(mktemp -d)}
mkdir -p "$logs"
copy=test/daemon/escaped-heap.repro.ts config=$(mktemp --suffix=.config.mjs)
trap 'kill $h1 $h2 2>/dev/null; rm -f "$copy" "$config"' EXIT
# The fixture's test holds the heap, touched, until its fork exits.
sed "s|^it(\"leaves two sleepers behind\", async () => {|globalThis.heap = Buffer.alloc($mb * 1048576, 1);\n&|" \
  test/daemon/escaped.test.ts > "$copy"
grep -q "globalThis.heap" "$copy" || { echo "the fixture edit no longer applies"; exit 2; }
if [ -n "$SQ400_NOTES" ]; then
  sed -i "s|^      const note = record?.text ?? \"\";|&\n      (await import(\"node:fs\")).appendFileSync(\"$SQ400_NOTES\", \`fork \${spawner}: \${note}\\\\n\`);|" "$copy"
  grep -q "appendFileSync" "$copy" || { echo "the note edit no longer applies"; exit 2; }
fi
printf 'export default { test: { root: %s, include: ["%s"], globalSetup: ["test/global-teardown.ts"] } };\n' \
  "\"$PWD\"" "$copy" > "$config"
taskset -c 0-1 node -e 'for(;;){}' >/dev/null 2>&1 & h1=$!
taskset -c 0-1 node -e 'for(;;){}' >/dev/null 2>&1 & h2=$!
for i in $(seq "$runs"); do
  log=$(mktemp)
  if taskset -c 0-1 env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 \
    timeout 240 npx vitest run --config "$config" "$copy" -t "detached sleeper" >"$log" 2>&1; then r=pass; else r=FAIL; fi
  why=$(grep -m1 -E "not met|Error|expected|timed out" "$log" | cut -c1-200)
  echo "run $i $r ${why:+:: $why} (load $(cut -d' ' -f1 /proc/loadavg))"
  if [ $r = FAIL ]; then mv "$log" "$logs/run-$i.log"; else rm -f "$log"; fi
done
