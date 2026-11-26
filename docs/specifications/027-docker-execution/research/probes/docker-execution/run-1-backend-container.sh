#!/usr/bin/env bash
# Throwaway (spec 027 research). One pytest batch of the saas-boilerplate backend
# copy inside the image built from packages/backend/Dockerfile, with Squeal's
# pytest runtime mounted read-only and appended to the image's PYTHONPATH.
# Usage: run-1-backend-container.sh <events-file-name> <test files...>
set -euo pipefail
SB=${SB:?copy of saas-boilerplate}            # $TMPDIR/p027
RT=${RT:?squeal src/runners/pytest/runtime}
EV=${EV:?host events dir}
NET=${NET:-squeal-probe-027-deps_default}
IMG=${IMG:-squeal-probe-027/backend:a}
name=$1; shift
mkdir -p "$EV"
exec docker run --rm -i --init --user "$(id -u):$(id -g)" \
  -l org.squeal.probe=027 -l org.squeal.run="${RUN_ID:-r1}" \
  --network "$NET" \
  -v "$SB/packages/backend:/app" -v "$RT:/squeal:ro" -v "$EV:/ev" \
  -e HOME=/tmp -e PYTHONPYCACHEPREFIX=/tmp/pycache \
  -e PYTHONPATH=/pkgs/.venv/lib/python3.11/site-packages:/squeal \
  -e SQUEAL_PYTEST_ROOT=/app -e SQUEAL_PYTEST_EVENTS="/ev/$name" \
  ${EXTRA_ENV:-} -w /app "$IMG" \
  python -m pytest -c setup.cfg -p squeal_pytest --continue-on-collection-errors \
  --maxfail=0 --no-cov -o cache_dir=/tmp/pytest-cache -p no:cacheprovider -q -W ignore --tb=line "$@"
