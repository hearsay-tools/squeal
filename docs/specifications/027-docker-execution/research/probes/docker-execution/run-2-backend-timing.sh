#!/usr/bin/env bash
# Throwaway (spec 027 research). Wall time of one backend pytest batch, 1 file and
# 5 files, five runs per way: host .venv, docker run --rm, compose run --rm -T
# --no-deps, docker exec -i into a long-lived container. Prints load per way.
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
: "${SB:?}" "${RT:?}" "${EV:?}" "${DBPORT:?}" "${REDISPORT:?}"
export COMPOSE_PROJECT_NAME=squeal-probe-027-deps
ONE=(apps/users/tests/test_models.py)
FIVE=(apps/users/tests/test_models.py common/tests/test_emails.py apps/users/tests/test_services.py apps/backup/tests/test_tasks.py common/tests/test_tasks.py)
PYARGS=(-m pytest -c setup.cfg -p squeal_pytest --continue-on-collection-errors --maxfail=0 --no-cov -p no:cacheprovider -q -W ignore)
ms() { local s e; s=$(date +%s%N); "$@" >/tmp/sq027-last.log 2>&1; local rc=$?; e=$(date +%s%N); echo "$(( (e-s)/1000000 )) rc=$rc $(tail -1 /tmp/sq027-last.log | tr -d '=')"; }
host() { (cd "$SB/packages/backend" && env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
  DATABASE_URL="postgres://backend:backend@127.0.0.1:$DBPORT/backend" REDIS_CONNECTION="redis://127.0.0.1:$REDISPORT" \
  PYTHONPATH="$RT" SQUEAL_PYTEST_ROOT="$SB/packages/backend" SQUEAL_PYTEST_EVENTS="$EV/host.jsonl" PYTHONPYCACHEPREFIX=/tmp/sq027-pyc \
  .venv/bin/python "${PYARGS[@]}" -o env_override_existing_values=0 "$@"); }
drun() { "$here/run-1-backend-container.sh" drun.jsonl "$@"; }
crun() { docker compose -f "$here/deps.compose.yml" -f "$here/test.compose.yml" run --rm -T --no-deps \
  -l org.squeal.run=crun -e SQUEAL_PYTEST_EVENTS=/ev/crun.jsonl backend python "${PYARGS[@]}" "$@"; }
dexec() { docker exec -i -e SQUEAL_PYTEST_EVENTS=/ev/dexec.jsonl sq027-long python "${PYARGS[@]}" "$@"; }
docker run -d --name sq027-long --init --user "$(id -u):$(id -g)" -l org.squeal.probe=027 \
  --network squeal-probe-027-deps_default -v "$SB/packages/backend:/app" -v "$RT:/squeal:ro" -v "$EV:/ev" \
  -e HOME=/tmp -e PYTHONPYCACHEPREFIX=/tmp/pycache -e PYTHONPATH=/pkgs/.venv/lib/python3.11/site-packages:/squeal \
  -e SQUEAL_PYTEST_ROOT=/app -w /app squeal-probe-027/backend:a sleep infinity >/dev/null
for way in host drun crun dexec; do
  for set in ONE FIVE; do
    declare -n files=$set
    echo "== $way $set load $(cut -d' ' -f1 /proc/loadavg)"
    for i in 1 2 3 4 5; do ms $way "${files[@]}"; done
  done
done
echo "== overhead alone (true), load $(cut -d' ' -f1 /proc/loadavg)"
for i in 1 2 3; do ms docker run --rm -l org.squeal.probe=027 squeal-probe-027/backend:a true; done
for i in 1 2 3; do ms docker compose -f "$here/deps.compose.yml" -f "$here/test.compose.yml" run --rm -T --no-deps backend true; done
for i in 1 2 3; do ms docker exec -i sq027-long true; done
docker rm -f sq027-long >/dev/null
