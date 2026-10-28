#!/usr/bin/env bash
# Start cost of one pytest batch: host, compose run --rm, compose exec, docker run --rm.
set -u
. "$(dirname "$0")/lib.sh"
WT="$SCRATCH/wt-a"; P=squeal-probe-tests-in-docker-a
cd "$WT"
if [ ! -x "$SCRATCH/hostvenv/bin/python" ]; then
  uv venv -q --python 3.11 "$SCRATCH/hostvenv" && uv pip install -q --python "$SCRATCH/hostvenv/bin/python" pytest==8.4.2
fi
echo "load before: $(load) on $(nproc) CPUs"
d "docker compose -p $P up -d --wait db tests" >/dev/null 2>&1
NET=$(d "docker network ls --filter label=com.docker.compose.project=$P --format '{{.Name}}'")
T="python -m pytest -q -p no:cacheprovider tests/test_core.py"
for i in 1 2 3 4 5; do
  echo "host        $(ms env PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 "$SCRATCH/hostvenv/bin/python" -m pytest -q -p no:cacheprovider tests/test_core.py)"
  echo "run --rm    $(ms d "docker compose -p $P run --rm -T -e PYTHONDONTWRITEBYTECODE=1 tests $T")"
  echo "exec        $(ms d "docker compose -p $P exec -T -e PYTHONDONTWRITEBYTECODE=1 tests $T")"
  echo "docker run  $(ms d "docker run --rm --network $NET -v $WT:/work -w /work -e PYTHONPATH=/deps:/work/src -e PYTHONDONTWRITEBYTECODE=1 squeal-probe-tests-in-docker/tests:latest $T")"
  echo "run true    $(ms d "docker compose -p $P run --rm -T tests true")"
  echo "exec true   $(ms d "docker compose -p $P exec -T tests true")"
  echo "sg true     $(ms d true)"
done
d "docker compose -p $P down" >/dev/null 2>&1
for i in 1 2 3; do
  echo "cold run    $(ms d "docker compose -p $P run --rm -T -e PYTHONDONTWRITEBYTECODE=1 tests $T")"
  d "docker compose -p $P down" >/dev/null 2>&1
done
echo "load after: $(load)"
