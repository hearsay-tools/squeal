#!/usr/bin/env bash
# Throwaway (spec 027 research). Runner host inside container sq027-host over
# `docker exec -i`, rooted at /hang: one test that starts `sleep 300` and then
# sleeps 120 s. For each ending, the processes left in the container 4 s later.
# Control: plain `docker exec -i python -m pytest`, client SIGKILLed.
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
left() {
  sleep 4; echo "--- left in container 4 s later:"
  docker top sq027-host -o pid,pgid,args | grep -v "sleep infinity\|docker-init\|PGID" || echo "(nothing but the container's own sleep)"
  # The image has no pkill: kill leftovers by host pid (same uid).
  docker top sq027-host -o pid,args | grep -v "sleep infinity\|docker-init\|PID" | awk '{print $1}' | xargs -r kill -9
}
for ending in wait-start cancel eof kill; do
  echo "=== $ending"
  docker exec sq027-host sh -c 'rm -rf /tmp/sqlogs/r1; mkdir -p /tmp/sqlogs/r1'
  [ "$ending" = wait-start ] && { echo "(processes 4 s into the run, nothing ended)"; e=kill; } || e=$ending
  node "$here/drive-host.mjs" "$e" test_hang.py -- docker exec -i sq027-host \
    /opt/sqnode/node --disable-warning=ExperimentalWarning /sq/cli/squeal.mjs runner-host /hang --runner pytest 2>&1 \
    | grep -v '"ev":"note"' | cut -c1-300 &
  if [ "$ending" = wait-start ]; then sleep 4; docker top sq027-host -o pid,pgid,args | grep -v "sleep infinity\|docker-init"; fi
  wait
  left
done
echo "=== control: docker exec -i python -m pytest, client SIGKILL after 5 s"
docker exec -i -w /hang -e PYTHONPATH=/pkgs/.venv/lib/python3.11/site-packages sq027-host python -m pytest -q -p no:cacheprovider test_hang.py >/dev/null 2>&1 &
c=$!; sleep 5; kill -9 $c; wait $c 2>/dev/null
left
