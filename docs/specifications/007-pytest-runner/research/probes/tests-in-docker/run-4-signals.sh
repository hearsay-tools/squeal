#!/usr/bin/env bash
# What a killed client leaves: SIGTERM and SIGKILL to the process group of
# `compose run --rm`, `compose exec` and `docker run --rm`, as Squeal's deadline does (007 D6).
set -u
. "$(dirname "$0")/lib.sh"
WT="$SCRATCH/wt-a"; P=squeal-probe-tests-in-docker-a
cd "$WT"
echo "load before: $(load)"
d "docker compose -p $P up -d --wait db tests" >/dev/null 2>&1
T="python -m pytest -q -p no:cacheprovider tests/test_sleep.py"
running() { d "docker ps --filter label=com.docker.compose.project=$P --format '{{.Names}} {{.Status}}'" | grep -v -e '-db-1 ' -e '-tests-1 ' || echo "(no run containers)"; }
sleepers() { d "docker compose -p $P exec -T tests sh -c 'for p in /proc/[0-9]*; do tr \"\\\\0\" \" \" < \$p/cmdline 2>/dev/null; echo; done'" | grep -c "test_sleep" ; }
case_one() { # $1 label, $2 signal, $3 command
  setsid bash -c "$3" >/dev/null 2>&1 & local pid=$!
  sleep 6
  kill -"$2" -- -"$pid"; local s=$(date +%s%N)
  wait "$pid" 2>/dev/null; local rc=$?
  echo "-- $1 / SIG$2: client exited rc=$rc after $(( ($(date +%s%N) - s) / 1000000 )) ms"
  sleep 3; echo "   3 s later, run containers:"; running | sed 's/^/     /'
  echo "   pytest processes left in the tests service: $(sleepers)"
}
case_one "compose run --rm" TERM "sg docker -c 'docker compose -p $P run --rm -T -e PROBE_SLEEP=120 tests $T'"
case_one "compose run --rm" KILL "sg docker -c 'docker compose -p $P run --rm -T -e PROBE_SLEEP=120 tests $T'"
case_one "compose run --rm -l org.squeal.run=r1" KILL "sg docker -c 'docker compose -p $P run --rm -T -l org.squeal.run=r1 -e PROBE_SLEEP=120 tests $T'"
echo "   by label org.squeal.run=r1: $(d "docker ps -q --filter label=org.squeal.run=r1" | wc -l) container(s); removing them:"
d "docker rm -f \$(docker ps -q --filter label=org.squeal.run=r1)" | sed 's/^/     /'
case_one "compose exec" TERM "sg docker -c 'docker compose -p $P exec -T -e PROBE_SLEEP=120 tests $T'"
case_one "compose exec" KILL "sg docker -c 'docker compose -p $P exec -T -e PROBE_SLEEP=120 tests $T'"
case_one "docker run --rm" TERM "sg docker -c 'docker run --rm --name squeal-probe-tests-in-docker-dr -v $WT:/work -w /work -e PROBE_SLEEP=120 squeal-probe-tests-in-docker/tests:latest $T'"
echo "   docker run container: $(d "docker ps -a --filter name=squeal-probe-tests-in-docker-dr --format '{{.Status}}'")"
d "docker rm -f squeal-probe-tests-in-docker-dr" >/dev/null 2>&1
case_one "docker run --rm --init" TERM "sg docker -c 'docker run --rm --init --name squeal-probe-tests-in-docker-dr -v $WT:/work -w /work -e PROBE_SLEEP=120 squeal-probe-tests-in-docker/tests:latest $T'"
echo "   docker run --init container: $(d "docker ps -a --filter name=squeal-probe-tests-in-docker-dr --format '{{.Status}}'")"
d "docker rm -f squeal-probe-tests-in-docker-dr" >/dev/null 2>&1
echo "== after the cases, every container of the project:"
d "docker ps -a --filter label=com.docker.compose.project=$P --format '{{.Names}} {{.Status}}'"
echo "load after: $(load)"
