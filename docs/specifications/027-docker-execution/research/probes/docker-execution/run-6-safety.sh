#!/usr/bin/env bash
# Throwaway (spec 027 research). Socket access, file ownership by run user,
# -v against --mount for a missing source, a killed `docker run` client, reap by label.
set -uo pipefail
: "${SB:?}"
S=$TMPDIR/sq027-safety; mkdir -p "$S"
echo "== 1. socket and groups"
stat -c '%A %U:%G %n' /var/run/docker.sock; id -nG | tr ' ' '\n' | grep -x docker || echo "(not in group docker)"
docker info --format 'rootless={{.SecurityOptions}}' 2>/dev/null | tr ' ' '\n' | grep -i rootless || echo "rootful daemon"
echo "== 2. files written into the mount: default user against --user uid:gid"
cp -r "$SB/packages/workers/content" "$S/src"; find "$S/src" -name __pycache__ -exec rm -rf {} +
docker run --rm -l org.squeal.probe=027 -v "$S/src:/src" squeal-probe-027/workers:a python -c 'import sys;sys.path.insert(0,"/src");import tests' 2>/dev/null
echo "default user:"; find "$S/src" -name '*.pyc' -printf '  %u %p\n' | sed "s#$S#<dir>#" | head -2
docker run --rm -l org.squeal.probe=027 -v "$S/src:/src" squeal-probe-027/workers:a rm -rf /src/__pycache__ /src/tests/__pycache__
docker run --rm -l org.squeal.probe=027 --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$S/src:/src" squeal-probe-027/workers:a python -c 'import sys;sys.path.insert(0,"/src");import tests'
echo "--user $(id -u):$(id -g):"; find "$S/src" -name '*.pyc' -printf '  %u %p\n' | sed "s#$S#<dir>#" | head -2
echo "== 3. a missing bind source: -v against --mount"
docker run --rm -l org.squeal.probe=027 -v "$S/missing-v:/x" squeal-probe-027/workers:a true; echo "  -v rc=$?"; stat -c '  created: %U %F' "$S/missing-v" 2>/dev/null || echo "  not created"
docker run --rm -l org.squeal.probe=027 --mount "type=bind,source=$S/missing-m,target=/x" squeal-probe-027/workers:a true 2>&1 | sed "s#$S#<dir>#;s/^/  /"; stat -c '  created: %U %F' "$S/missing-m" 2>/dev/null || echo "  --mount: not created"
docker run --rm -l org.squeal.probe=027 -v "$S:/s" squeal-probe-027/workers:a rmdir /s/missing-v 2>/dev/null
echo "== 4. docker run --rm --init client SIGKILLed during a 120 s command"
docker run --rm --init -l org.squeal.probe=027 -l org.squeal.run=s4 squeal-probe-027/workers:a sleep 120 >/dev/null 2>&1 & c=$!
sleep 3; kill -9 $c; sleep 3
echo "  containers labelled org.squeal.run=s4 3 s later: $(docker ps -q --filter label=org.squeal.run=s4 | wc -l)"
docker ps -q --filter label=org.squeal.run=s4 | xargs -r docker rm -f >/dev/null
echo "  after docker rm -f by label: $(docker ps -aq --filter label=org.squeal.run=s4 | wc -l)"
rm -rf "$S"
