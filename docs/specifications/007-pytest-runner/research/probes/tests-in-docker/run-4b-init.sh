#!/usr/bin/env bash
# compose run --rm against a service with `init: true`: SIGTERM, then SIGKILL, to the client.
set -u
. "$(dirname "$0")/lib.sh"
WT="$SCRATCH/wt-a"; P=squeal-probe-tests-in-docker-a
cd "$WT"
echo "load before: $(load)"
T="python -m pytest -q -p no:cacheprovider tests/test_sleep.py"
for sig in TERM KILL; do
  setsid sg docker -c "docker compose -p $P run --rm -T -l org.squeal.case=init-$sig -e PROBE_SLEEP=120 tests-init $T" >/dev/null 2>&1 & pid=$!
  sleep 6; kill -$sig -- -$pid; wait $pid 2>/dev/null; echo "-- init / SIG$sig: client rc=$?"
  sleep 3; echo "   3 s later: $(d "docker ps -a --filter label=org.squeal.case=init-$sig --format '{{.Names}} {{.Status}}'" || true)"
done
echo "load after: $(load)"
