#!/bin/bash
# plainw.sh <label> <prefix> <maxWorkers>: question 3's long run. The Vitest
# files of <prefix>.vitest.txt in one plain `vitest run` at --maxWorkers
# <maxWorkers>: one Vitest instance, one run, files handed to whichever worker
# frees first (Vitest 4.1.10 `Pool.schedule`), no tier barrier. No coverage,
# no Squeal; no daemon may run tests meanwhile. Samples load and busy cores
# every 5 s and live fork workers every 1 s (its own cgroup: a systemd scope).
. "$(dirname "$0")/env.sh"
d=$(cd "$(dirname "$0")" && pwd)
label=$1; prefix=$2; w=$3
mapfile -t vfiles < <(cut -d' ' -f2- "$prefix.vitest.txt" | grep .)
projects=$(cut -d' ' -f1 "$prefix.vitest.txt" | sort -u | grep . | sed 's/^/--project /' | tr '\n' ' ')
printf '%s\n' "${vfiles[@]}" > "$OUT/$label.files.txt"
cat > "$OUT/$label.cmd.sh" <<EOS
cd '$SQ_REPO'
exec /usr/bin/time -f "cpu_s=%U+%S wall=%e" -o '$OUT/$label.vitest.time' timeout 3600 node_modules/.bin/vitest run $projects --maxWorkers=$w --reporter=dot --passWithNoTests \$(cat '$OUT/$label.files.txt') > '$OUT/$label.vitest.log' 2>&1
EOS
U="XDG_RUNTIME_DIR=/run/user/$(id -u)"
cg=/sys/fs/cgroup/user.slice/user-$(id -u).slice/user@$(id -u).service/app.slice/sq-$label.scope
date +%s%3N > "$OUT/$label.t0"
env $U systemd-run --user --scope --unit="sq-$label" --quiet bash "$OUT/$label.cmd.sh" &
run=$!; sleep 1
bash "$d/bg.sh" "$label-sampler" 4000 bash "$d/sample.sh" "$OUT/$label.tsv" 3900 "$cg" "$run"
bash "$d/bg.sh" "$label-workers" 4000 node "$d/workers.mjs" "$OUT/$label.workers.tsv" 3900 "$cg"
wait $run; rc=$?
date +%s%3N > "$OUT/$label.t1"
kill "$(cat "$OUT/$label-sampler.pid")" "$(cat "$OUT/$label-workers.pid")" 2>/dev/null
echo "vitest rc=$rc $(tail -1 "$OUT/$label.vitest.time") files=${#vfiles[@]} workers=$w"
tail -6 "$OUT/$label.vitest.log"
