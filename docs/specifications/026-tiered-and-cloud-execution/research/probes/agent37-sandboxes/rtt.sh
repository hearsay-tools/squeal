#!/bin/sh
# Throwaway (026 agent37-sandboxes). From this host: N exec calls of `true` and N control-plane
# GETs of the instance, through the proxy; prints the times (curl time_total) sorted.
ID=$1; N=${2:-10}; D=$(cd "$(dirname "$0")" && pwd)
e=""; g=""
for i in $(seq $N); do
  e="$e $(A37_PLANE=sandbox "$D/a37.sh" POST /v1/instances/$ID/exec '{"command":"true"}' 2>&1 >/dev/null | awk '{printf "%d", $3*1000}')"
  g="$g $(  "$D/a37.sh" GET /v1/instances/$ID 2>&1 >/dev/null | awk '{printf "%d", $3*1000}')"
done
echo "$ID exec ms:$(echo $e | tr ' ' '\n' | sort -n | tr '\n' ' ')"
echo "$ID get ms:$(echo $g | tr ' ' '\n' | sort -n | tr '\n' ' ')"
echo "this host load: $(cut -d' ' -f1-3 /proc/loadavg)"
