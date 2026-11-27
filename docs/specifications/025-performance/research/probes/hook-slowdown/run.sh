#!/usr/bin/env bash
# Throwaway (row 025-26). Runs profile.mjs for each plugin, alternating the order per round,
# on one installed p500 template. Run only in a boat.dev sandbox:
#   bash run.sh <bench dir> <probe dir> <out dir> <rounds> <plugin dir>...
set -u
bench=$(realpath "$1"); probe=$(realpath "$2"); out=$3; rounds=$4; shift 4
mkdir -p "$out"; out=$(realpath "$out")
tpl=$out/template
{ node -v; lscpu | grep -E "Model name|^CPU\(s\)"; cat /proc/loadavg; } > "$out/machine.txt"
if [ ! -d "$tpl/node_modules" ]; then
  node "$bench/gen-project.mjs" "$tpl" 500 --cases 6 --functions 0
  (cd "$tpl" && pnpm install --silent && git init -q -b main && git add -A \
    && GIT_AUTHOR_NAME=b GIT_AUTHOR_EMAIL=b@example.invalid GIT_COMMITTER_NAME=b GIT_COMMITTER_EMAIL=b@example.invalid git commit -qm "bench project")
fi
plugins=(); for p in "$@"; do plugins+=("$(realpath "$p")"); done
for r in $(seq "$rounds"); do
  order=("${plugins[@]}")
  if [ $((r % 2)) = 0 ]; then order=(); for ((i=${#plugins[@]}-1; i>=0; i--)); do order+=("${plugins[$i]}"); done; fi
  for p in "${order[@]}"; do
    v=$(node -p "require('$p/package.json').version")
    node "$probe/profile.mjs" --bench "$bench" --plugin "$p" --template "$tpl" --out "$out/$v-r$r" > "$out/$v-r$r.log" 2>&1
    echo "$v-r$r exit=$?" >> "$out/exits.txt"
    rm -rf "$out/$v-r$r/work" "$out/$v-r$r/home"
  done
done
cat /proc/loadavg >> "$out/machine.txt"
touch "$out/DONE"
