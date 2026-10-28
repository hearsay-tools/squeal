#!/usr/bin/env bash
# Which worktree a bind mount shows, project names, and what collides between worktrees.
set -u
. "$(dirname "$0")/lib.sh"
echo "load before: $(load)"
# Two worktrees of one repository with the same basename under different parents, as
# `git worktree add ../x/app` makes, and one with a different basename.
for w in x/app y/app b; do rm -rf "$SCRATCH/$w"; mkdir -p "$(dirname "$SCRATCH/$w")"; cp -r "$PROBE/fixture" "$SCRATCH/$w"; done
sed -i 's/return a + b/return a - b  # worktree b differs/' "$SCRATCH/b/src/app/core.py"
T="python -m pytest -q -p no:cacheprovider -o addopts= tests/test_core.py"
echo "== 1. default project name: compose takes the basename of the project directory"
(cd "$SCRATCH/x/app" && d "docker compose config --format json" | python3 -c 'import json,sys; print("x/app ->", json.load(sys.stdin)["name"])')
(cd "$SCRATCH/y/app" && d "docker compose config --format json" | python3 -c 'import json,sys; print("y/app ->", json.load(sys.stdin)["name"])')
echo "== 2. COMPOSE_FILE inherited from another worktree: run from b, compose file of x/app"
(cd "$SCRATCH/b" && d "env COMPOSE_FILE=$SCRATCH/x/app/compose.yml docker compose -p squeal-probe-tests-in-docker-b config --format json" | python3 -c '
import json,sys; c=json.load(sys.stdin); print("tests mounts:", [v["source"].split("/scratch/")[1] for v in c["services"]["tests"]["volumes"]])')
(cd "$SCRATCH/b" && d "env COMPOSE_FILE=$SCRATCH/x/app/compose.yml docker compose -p squeal-probe-tests-in-docker-b run --rm -T tests $T" 2>/dev/null | tail -1)
echo "   the same from b with its own compose.yml:"
(cd "$SCRATCH/b" && d "docker compose -p squeal-probe-tests-in-docker-b run --rm -T tests $T" 2>/dev/null | tail -1)
echo "== 3. a published fixed port in two projects"
cat > "$SCRATCH/ports.yml" <<'YML'
services:
  db:
    ports: ["127.0.0.1:55432:5432"]
YML
(cd "$SCRATCH/x/app" && d "docker compose -p squeal-probe-tests-in-docker-px -f compose.yml -f $SCRATCH/ports.yml up -d --wait db" 2>&1 | tail -1)
(cd "$SCRATCH/y/app" && d "docker compose -p squeal-probe-tests-in-docker-py -f compose.yml -f $SCRATCH/ports.yml up -d --wait db" 2>&1 | grep -i -o "Bind for.*allocated" | head -1)
d "docker compose -p squeal-probe-tests-in-docker-px down" >/dev/null 2>&1; d "docker compose -p squeal-probe-tests-in-docker-py down" >/dev/null 2>&1
echo "== 4. container_name in two projects"
cat > "$SCRATCH/name.yml" <<'YML'
services:
  db:
    container_name: squeal-probe-tests-in-docker-fixed
YML
(cd "$SCRATCH/x/app" && d "docker compose -p squeal-probe-tests-in-docker-nx -f compose.yml -f $SCRATCH/name.yml up -d --wait db" 2>&1 | tail -1)
(cd "$SCRATCH/y/app" && d "docker compose -p squeal-probe-tests-in-docker-ny -f compose.yml -f $SCRATCH/name.yml up -d --wait db" 2>&1 | grep -i -o "Conflict.*already in use" | cut -c1-110 | head -1)
d "docker compose -p squeal-probe-tests-in-docker-nx down" >/dev/null 2>&1; d "docker compose -p squeal-probe-tests-in-docker-ny down" >/dev/null 2>&1
echo "== 5. two concurrent batches in one project, one test database name (pytest-django without xdist: test_<name>)"
cd "$SCRATCH/x/app"; P=squeal-probe-tests-in-docker-x
d "docker compose -p $P up -d --wait db" >/dev/null 2>&1
DB="python -m pytest -q -p no:cacheprovider -o addopts= tests/db/test_db.py"
d "docker compose -p $P run --rm -T -e PROBE_DB_HOLD=4 tests $DB" > "$SCRATCH/c1.txt" 2>&1 & a=$!
sleep 1.5
d "docker compose -p $P run --rm -T -e PROBE_DB_HOLD=4 tests $DB" > "$SCRATCH/c2.txt" 2>&1 & b=$!
wait $a; ra=$?; wait $b; rb=$?
echo "   batch 1 rc=$ra: $(tail -1 "$SCRATCH/c1.txt")"
echo "   batch 2 rc=$rb: $(grep -o 'DuplicateDatabase.*' "$SCRATCH/c2.txt" | head -1 | cut -c1-90) | $(tail -1 "$SCRATCH/c2.txt")"
echo "== 6. the same with a per-batch suffix (as xdist's gwN), PYTEST_XDIST_WORKER=s1 and s2"
d "docker compose -p $P run --rm -T -e PROBE_DB_HOLD=4 -e PYTEST_XDIST_WORKER=s1 tests $DB" > "$SCRATCH/c1.txt" 2>&1 & a=$!
sleep 1.5
d "docker compose -p $P run --rm -T -e PROBE_DB_HOLD=4 -e PYTEST_XDIST_WORKER=s2 tests $DB" > "$SCRATCH/c2.txt" 2>&1 & b=$!
wait $a; ra=$?; wait $b; rb=$?
echo "   batch 1 rc=$ra: $(tail -1 "$SCRATCH/c1.txt") | batch 2 rc=$rb: $(tail -1 "$SCRATCH/c2.txt")"
d "docker compose -p $P down" >/dev/null 2>&1
echo "load after: $(load)"
