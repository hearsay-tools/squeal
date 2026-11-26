#!/usr/bin/env bash
# Throwaway (spec 027 research). Worktree mount identity and image identity:
# a run without the source mount tests baked code; dev/inode of the mounted
# root inside against outside; costs of `image inspect`, `compose config`,
# `docker inspect` mounts; what `docker events` reports for a rebuild.
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
: "${SB:?}" "${RT:?}" "${EV:?}"
export COMPOSE_PROJECT_NAME=squeal-probe-027-deps
F=apps/users/tests/test_models.py
ms() { local s e; s=$(date +%s%N); "$@" >/tmp/sq027-id.log 2>&1; local rc=$?; e=$(date +%s%N); echo "$(( (e-s)/1000000 )) ms rc=$rc"; }
echo "== 1. break a test in the worktree copy, then run it with and without the source mount"
cp "$SB/packages/backend/$F" /tmp/sq027-orig.py
sed -i '0,/assert /s//assert False and /' "$SB/packages/backend/$F"
echo "-- with the worktree mounted at /app:"
"$here/run-1-backend-container.sh" id-mounted.jsonl "$F" 2>&1 | tail -1
echo "-- without a mount (image's COPY . /app, as base docker-compose.yml runs backend):"
docker run --rm --init --user "$(id -u):$(id -g)" -l org.squeal.probe=027 --network squeal-probe-027-deps_default \
  -e HOME=/tmp -e PYTHONPYCACHEPREFIX=/tmp/pycache -w /app squeal-probe-027/backend:a \
  python -m pytest -p no:cacheprovider --no-cov -q -W ignore "$F" 2>&1 | tail -1
cp /tmp/sq027-orig.py "$SB/packages/backend/$F"
echo "== 2. dev:inode of the root, outside and inside"
echo "host:              $(stat -c '%d:%i' "$SB/packages/backend")"
echo "mounted:           $(docker run --rm -l org.squeal.probe=027 -v "$SB/packages/backend:/app" squeal-probe-027/backend:a python -c 'import os;s=os.stat("/app");print(f"{s.st_dev}:{s.st_ino}")')"
echo "other dir mounted: $(docker run --rm -l org.squeal.probe=027 -v "$SB/packages/workers:/app" squeal-probe-027/backend:a python -c 'import os;s=os.stat("/app");print(f"{s.st_dev}:{s.st_ino}")')"
echo "baked (no mount):  $(docker run --rm -l org.squeal.probe=027 squeal-probe-027/backend:a python -c 'import os;s=os.stat("/app");print(f"{s.st_dev}:{s.st_ino}")')"
echo "== 3. costs, 10 runs each (load $(cut -d' ' -f1 /proc/loadavg))"
for i in $(seq 10); do ms docker image inspect --format '{{.Id}}' squeal-probe-027/backend:a; done | sort -n | sed -n '1p;5p;10p' | tr '\n' ' '; echo " <- docker image inspect (min, median, max)"
for i in $(seq 10); do ms docker compose -f "$here/deps.compose.yml" -f "$here/test.compose.yml" config --hash backend; done | sort -n | sed -n '1p;5p;10p' | tr '\n' ' '; echo " <- compose config --hash backend"
for i in $(seq 10); do ms docker compose -f "$here/deps.compose.yml" -f "$here/test.compose.yml" config --format json; done | sort -n | sed -n '1p;5p;10p' | tr '\n' ' '; echo " <- compose config --format json (mounts resolved)"
docker run -d --name sq027-id -l org.squeal.probe=027 -v "$SB/packages/backend:/app" squeal-probe-027/backend:a sleep infinity >/dev/null
for i in $(seq 10); do ms docker inspect --format '{{json .Mounts}} {{.Image}}' sq027-id; done | sort -n | sed -n '1p;5p;10p' | tr '\n' ' '; echo " <- docker inspect container mounts + image"
echo "== 4. docker events during a rebuild of a tag, and the running container's image"
docker events --filter type=image --format '{{.Action}} {{.Actor.ID}} {{index .Actor.Attributes "name"}}' > /tmp/sq027-events.log 2>&1 & ev=$!
sleep 1
before=$(docker image inspect --format '{{.Id}}' squeal-probe-027/backend:c)
mkdir -p /tmp/sq027-rebuild && printf 'FROM squeal-probe-027/backend:c\nLABEL org.squeal.probe=027\nRUN echo changed > /tmp/changed\n' > /tmp/sq027-rebuild/Dockerfile
docker build -q -t squeal-probe-027/backend:c /tmp/sq027-rebuild >/dev/null
after=$(docker image inspect --format '{{.Id}}' squeal-probe-027/backend:c)
sleep 1; kill $ev
echo "tag :c before ${before:7:12} after ${after:7:12}"; sed 's/sha256:\([0-9a-f]\{12\}\)[0-9a-f]*/\1/g' /tmp/sq027-events.log
docker rm -f sq027-id >/dev/null; rm -rf /tmp/sq027-rebuild /tmp/sq027-events.log /tmp/sq027-orig.py
