#!/usr/bin/env bash
# Environment identity: image ID, repo digests, compose config hashes, a rebuild.
set -u
. "$(dirname "$0")/lib.sh"
WT="$SCRATCH/wt-a"; P=squeal-probe-tests-in-docker-a; IMG=squeal-probe-tests-in-docker/tests:latest
cd "$WT"
echo "load before: $(load)"
id() { d "docker image inspect --format '{{.Id}}' $IMG"; }
echo "image ID:        $(id)"
echo "RepoDigests:     $(d "docker image inspect --format '{{json .RepoDigests}}' $IMG")   (a local build has none)"
echo "image Env:       $(d "docker image inspect --format '{{json .Config.Env}}' $IMG")"
echo "inspect cost:    $(ms d "docker image inspect --format '{{.Id}}' $IMG") ms"
echo "config --hash:   $(d "docker compose -p $P config --hash tests,db")"
echo "config cost:     $(ms d "docker compose -p $P config --hash tests") ms"
echo "running container's image ID: $(d "docker inspect --format '{{.Image}}' $P-tests-1" 2>/dev/null)"
echo "== rebuild with no change"
d "docker compose -p $P build -q tests" >/dev/null 2>&1; echo "image ID:        $(id)"
echo "== rebuild after a Dockerfile change (an extra ENV line)"
cp Dockerfile Dockerfile.orig; echo "ENV PROBE_REBUILD=1" >> Dockerfile
d "docker compose -p $P build -q tests" >/dev/null 2>&1; echo "image ID:        $(id)"
echo "config --hash:   $(d "docker compose -p $P config --hash tests")   (the hash covers the service config, not the image content)"
echo "running container's image ID, still the old one: $(d "docker inspect --format '{{.Image}}' $P-tests-1" 2>/dev/null)"
echo "compose up -d tests now: $(d "docker compose -p $P up -d tests" 2>&1 | grep -o 'Recreate[d]*' | head -1)"
echo "running container's image ID: $(d "docker inspect --format '{{.Image}}' $P-tests-1" 2>/dev/null)"
mv Dockerfile.orig Dockerfile
echo "== a service config change: an extra environment variable"
echo "config --hash before: $(d "docker compose -p $P config --hash tests")"
echo "config --hash after:  $(d "env PROBE_EXTRA=1 docker compose -p $P -f compose.yml -f /dev/stdin config --hash tests" <<'YML'
services:
  tests:
    environment:
      PROBE_EXTRA: "1"
YML
)"
echo "== installed set inside the image, asked from a throwaway container"
echo "cost: $(ms d "docker run --rm $IMG python -c 'import importlib.metadata as m; print(sorted(d.metadata[\"Name\"] for d in m.distributions()))'") ms"
d "docker run --rm $IMG python -c 'import importlib.metadata as m, sys; print(sys.version.split()[0], sorted(d.metadata[\"Name\"]+\"==\"+d.version for d in m.distributions()))'" | cut -c1-200
echo "load after: $(load)"
