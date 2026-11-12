# Throwaway: print remote-lane notes as they change, for N seconds. Usage: . env.sh; sh note-watch.sh <seconds>
end=$(( $(date +%s) + $1 )); last=""
while [ $(date +%s) -lt $end ]; do
  n=$(node $T/clone/plugins/claude-code/dist/cli/squeal.mjs status --notes 2>&1 | grep "remote boat-trial" | tail -1)
  [ "$n" != "$last" ] && echo "$(date -u +%T) $n" && last=$n
  [ -n "${2:-}" ] && echo "$n" | grep -q "$2" && break
  sleep 1
done
