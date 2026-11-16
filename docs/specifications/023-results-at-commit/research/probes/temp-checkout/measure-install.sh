#!/usr/bin/env bash
# Throwaway probe (research 023-01). Times one detached worktree plus one frozen install.
# Usage: measure-install.sh <label> <clone-dir> <commit> <pnpm|npm> <warm|cold> <scratch-dir>
# Writes nothing outside <scratch-dir> except the user's warm package cache on a warm run.
set -u
label=$1 clone=$2 sha=$3 pm=$4 cache=$5 scratch=$6
wt=$scratch/wt-$label
rx() { awk '/eth0:/{print $2}' /proc/net/dev; }
now() { date +%s.%N; }
load() { cut -d' ' -f1 /proc/loadavg; }
echo "label=$label commit=$sha pm=$pm cache=$cache"
# background network rate over 15 s before the run
b0=$(rx); sleep 15; b1=$(rx); echo "bg_rx_15s_bytes=$((b1-b0))"
echo "load_before=$(load)"
t0=$(now)
git -C "$clone" worktree add --quiet --detach "$wt" "$sha" || exit 1
t1=$(now)
echo "worktree_add_s=$(echo "$t1 - $t0" | bc)"
echo "checkout_files=$(git -C "$wt" ls-files | wc -l)"
echo "checkout_kb=$(du -sk --exclude=.git "$wt" | cut -f1)"
r0=$(rx); t2=$(now)
if [ "$pm" = pnpm ]; then
  if [ "$cache" = cold ]; then
    extra=(--store-dir "$scratch/store-cold-$label"); export XDG_CACHE_HOME="$scratch/cache-cold-$label"
  else extra=(); fi
  ( cd "$wt" && timeout 900 pnpm install --frozen-lockfile --reporter=append-only "${extra[@]}" ) > "$scratch/install-$label.log" 2>&1
  rc=$?
else
  if [ "$cache" = cold ]; then extra=(--cache "$scratch/cache-cold-$label"); else extra=(); fi
  ( cd "$wt" && timeout 900 npm ci --no-audit --no-fund "${extra[@]}" ) > "$scratch/install-$label.log" 2>&1
  rc=$?
fi
t3=$(now); r1=$(rx)
echo "install_rc=$rc"
echo "install_s=$(echo "$t3 - $t2" | bc)"
echo "load_after=$(load)"
echo "install_rx_bytes=$((r1-r0))"
nm=$(find "$wt" -name node_modules -prune -type d | wc -l)
echo "node_modules_dirs=$nm"
# bytes only this checkout holds (link count 1) and bytes shared with the store (hard links)
find "$wt" -path '*/node_modules/*' -type f -links 1 -printf '%s\n' | awk '{s+=$1} END{printf "nm_unique_bytes=%d\n", s}'
find "$wt" -path '*/node_modules/*' -type f -links +1 -printf '%s\n' | awk '{s+=$1} END{printf "nm_hardlinked_bytes=%d\n", s}'
find "$wt" -path '*/node_modules/*' \( -type f -o -type l \) | wc -l | sed 's/^/nm_entries=/'
[ "$cache" = cold ] && du -sk "$scratch/store-cold-$label" "$scratch/cache-cold-$label" 2>/dev/null | sed 's/^/cold_cache_kb /'
grep -E 'Packages:|reused|downloaded|added [0-9]+' "$scratch/install-$label.log" | tail -3
echo "wt=$wt"
