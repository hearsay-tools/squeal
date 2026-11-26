#!/usr/bin/env bash
# Throwaway (spec 027 research). Concurrent pytest batches of the saas-boilerplate
# copy on the host against one probe Postgres and Redis: shared names against
# per-slot names (TOX_PARALLEL_ENV for Django, a database per slot for workers,
# a Redis database number per slot).
set -uo pipefail
: "${SB:?}" "${DBPORT:?}" "${REDISPORT:?}"
DB=squeal-probe-027-deps-db-1
psql() { docker exec "$DB" psql -U backend -d backend -Atc "$1"; }
A=(apps/users/tests/test_models.py common/tests/test_emails.py apps/users/tests/test_services.py)
B=(apps/backup/tests/test_tasks.py common/tests/test_tasks.py apps/multitenancy/tests/test_tasks.py)
C=(apps/multitenancy/tests/test_models.py apps/notifications/tests/test_schema/test_all_notifications.py)
D=(apps/users/tests/test_schema.py)
R=(common/ratelimiting/tests/test_ratelimiting.py)
be() { # be <tag> <slot-env...> -- files
  local tag=$1; shift; local envs=(); while [ "$1" != -- ]; do envs+=("$1"); shift; done; shift
  local s e; s=$(date +%s%N)
  (cd "$SB/packages/backend" && env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
    DATABASE_URL="postgres://backend:backend@127.0.0.1:$DBPORT/backend" REDIS_CONNECTION="redis://127.0.0.1:$REDISPORT" \
    PYTHONPYCACHEPREFIX=/tmp/sq027-pyc "${envs[@]}" \
    .venv/bin/python -m pytest -p no:cacheprovider --no-cov -q -W ignore --tb=line -o env_override_existing_values=0 "$@") >"/tmp/sq027-par-$tag.log" 2>&1
  e=$(date +%s%N)
  echo "  $tag $(( (e-s)/1000000 )) ms: $(tail -1 /tmp/sq027-par-$tag.log | tr -d =) | $(grep -m1 -oE '(DuplicateDatabase|ObjectInUse|already exists|is being accessed by other users|does not exist|UniqueViolation|IntegrityError)[^|]{0,80}' /tmp/sq027-par-$tag.log)"
}
wk() { # wk <tag> <dbname>
  local s e; s=$(date +%s%N)
  (cd "$SB/packages/workers" && env -u HTTP_PROXY -u HTTPS_PROXY \
    DB_CONNECTION="{\"engine\":\"postgresql\",\"conndbname\":\"backend\",\"dbname\":\"$2\",\"username\":\"backend\",\"password\":\"backend\",\"host\":\"127.0.0.1\",\"port\":$DBPORT}" \
    PYTHONPYCACHEPREFIX=/tmp/sq027-pyc .venv/bin/python -m pytest -p no:cacheprovider --no-cov -q -W ignore --tb=line -o env_override_existing_values=0 content/tests/test_sync.py) >"/tmp/sq027-par-$1.log" 2>&1
  e=$(date +%s%N)
  echo "  $1 $(( (e-s)/1000000 )) ms: $(tail -1 /tmp/sq027-par-$1.log | tr -d =) | $(grep -m1 -oE '(DuplicateTable|UniqueViolation|does not exist|already exists|InFailedSqlTransaction|deadlock)[^|]{0,80}' /tmp/sq027-par-$1.log)"
}
load() { echo "  (load $(cut -d' ' -f1 /proc/loadavg))"; }

echo "== 1. backend, shared test_backend, cold (dropped), 3 batches at once"; load
psql "DROP DATABASE IF EXISTS test_backend"
be a1 X=1 -- "${A[@]}" & be b1 X=1 -- "${B[@]}" & be c1 X=1 -- "${C[@]}" & wait
echo "== 2. backend, shared test_backend, warm, 4 batches at once, 3 rounds"; load
be warm X=1 -- "${A[@]}" >/dev/null
for r in 1 2 3; do be a2$r X=1 -- "${A[@]}" & be b2$r X=1 -- "${B[@]}" & be c2$r X=1 -- "${C[@]}" & be d2$r X=1 -- "${D[@]}" & wait; done
echo "== 3. backend, one slot each (TOX_PARALLEL_ENV=sN), cold, 4 batches at once"; load
for n in 1 2 3 4; do psql "DROP DATABASE IF EXISTS test_backend_s$n"; done
be a3 TOX_PARALLEL_ENV=s1 -- "${A[@]}" & be b3 TOX_PARALLEL_ENV=s2 -- "${B[@]}" & be c3 TOX_PARALLEL_ENV=s3 -- "${C[@]}" & be d3 TOX_PARALLEL_ENV=s4 -- "${D[@]}" & wait
psql "SELECT string_agg(datname, ' ' ORDER BY datname) FROM pg_database WHERE datname LIKE 'test_backend%'"
echo "== 4. same slots, warm (databases kept by --reuse-db)"; load
be a4 TOX_PARALLEL_ENV=s1 -- "${A[@]}" & be b4 TOX_PARALLEL_ENV=s2 -- "${B[@]}" & be c4 TOX_PARALLEL_ENV=s3 -- "${C[@]}" & be d4 TOX_PARALLEL_ENV=s4 -- "${D[@]}" & wait
echo "== 5. backend rate-limit tests (cache.clear() on Redis), 3 batches at once, shared Redis db 0, 2 rounds"; load
for r in 1 2; do be r1$r TOX_PARALLEL_ENV=s1 -- "${R[@]}" & be r2$r TOX_PARALLEL_ENV=s2 -- "${R[@]}" & be r3$r TOX_PARALLEL_ENV=s3 -- "${R[@]}" & wait; done
echo "== 6. same, one Redis database number per slot (REDIS_CONNECTION=.../N), 2 rounds"; load
for r in 1 2; do
  be r4$r TOX_PARALLEL_ENV=s1 REDIS_CONNECTION="redis://127.0.0.1:$REDISPORT/1" -- "${R[@]}" &
  be r5$r TOX_PARALLEL_ENV=s2 REDIS_CONNECTION="redis://127.0.0.1:$REDISPORT/2" -- "${R[@]}" &
  be r6$r TOX_PARALLEL_ENV=s3 REDIS_CONNECTION="redis://127.0.0.1:$REDISPORT/3" -- "${R[@]}" & wait
done
echo "== 7. workers, one database workers_test, 3 batches at once, 3 rounds"; load
for r in 1 2 3; do wk w1$r workers_test & wk w2$r workers_test & wk w3$r workers_test & wait; done
echo "== 8. workers, one database per slot, 3 batches at once, 3 rounds"; load
for n in 1 2 3; do psql "DROP DATABASE IF EXISTS workers_test_s$n" >/dev/null; psql "CREATE DATABASE workers_test_s$n" >/dev/null; done
for r in 1 2 3; do wk w4$r workers_test_s1 & wk w5$r workers_test_s2 & wk w6$r workers_test_s3 & wait; done
