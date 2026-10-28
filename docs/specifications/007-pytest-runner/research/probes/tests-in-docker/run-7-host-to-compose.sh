#!/usr/bin/env bash
# Tests on the host, only Postgres in compose: through a published port and through the
# container's bridge IP (no published port, as the dashboard's worktree overlay leaves it).
set -u
. "$(dirname "$0")/lib.sh"
WT="$SCRATCH/x/app"; P=squeal-probe-tests-in-docker-h
cd "$WT"
echo "load before: $(load)"
uv pip install -q --python "$SCRATCH/hostvenv/bin/python" "psycopg[binary]==3.2.10"
PY="$SCRATCH/hostvenv/bin/python"
T="-m pytest -q -p no:cacheprovider -o addopts= tests/db/test_db.py tests/test_core.py"
d "docker compose -p $P -f compose.yml -f $SCRATCH/ports.yml up -d --wait db" >/dev/null 2>&1
echo "== published 127.0.0.1:55432"
env PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 PROBE_DSN=postgresql://probe:probe@127.0.0.1:55432/probe "$PY" $T | tail -1
echo "   cost: $(ms env PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 PROBE_DSN=postgresql://probe:probe@127.0.0.1:55432/probe "$PY" $T)"
d "docker compose -p $P down" >/dev/null 2>&1
d "docker compose -p $P up -d --wait db" >/dev/null 2>&1
IP=$(d "docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' $P-db-1")
echo "== no published port, bridge IP $IP"
env PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 PROBE_DSN=postgresql://probe:probe@$IP:5432/probe "$PY" $T | tail -1
echo "   cost: $(ms env PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 PROBE_DSN=postgresql://probe:probe@$IP:5432/probe "$PY" $T)"
echo "== the service name 'db' from the host"
env PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 PROBE_DSN=postgresql://probe:probe@db:5432/probe "$PY" $T 2>&1 | grep -o "failed to resolve host 'db'[^:]*\|1 failed.*\|[0-9] passed.*" | head -2
d "docker compose -p $P down" >/dev/null 2>&1
echo "load after: $(load)"
