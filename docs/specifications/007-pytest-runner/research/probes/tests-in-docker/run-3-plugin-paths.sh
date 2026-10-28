#!/usr/bin/env bash
# Squeal's reporting plugin and sitecustomize inside the container: PYTHONPATH,
# events paths, file ownership in the bind mount, and --user.
set -u
. "$(dirname "$0")/lib.sh"
WT="$SCRATCH/wt-a"; P=squeal-probe-tests-in-docker-a
RUNTIME=$(git -C "$PROBE" rev-parse --show-toplevel)/src/runners/pytest/runtime
[ -f "$RUNTIME/squeal_pytest.py" ] || { echo "no runtime at $RUNTIME" >&2; exit 1; }
EV="$SCRATCH/events-a"; rm -rf "$EV"; mkdir -p "$EV"
cd "$WT"
echo "load before: $(load)"
d "docker compose -p $P up -d --wait db tests" >/dev/null 2>&1
ARGS="python -m pytest -q -p squeal_pytest -p no:cacheprovider tests/test_core.py tests/test_spawn.py"
MNT="-v $RUNTIME:/squeal:ro -v $EV:/squeal-out"
SQ="-e SQUEAL_PYTEST_EVENTS=/squeal-out/events.jsonl -e SQUEAL_PYTEST_ROOT=/work"
echo "== 1. PYTHONPATH=/squeal replaces the image's /deps:/work/src"
d "docker compose -p $P run --rm -T $MNT $SQ -e PYTHONPATH=/squeal tests $ARGS" 2>&1 | tail -2
echo "== 2. PYTHONPATH=<image's>:/squeal, as root (the image default)"
IMGPP=$(d "docker compose -p $P config --format json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["tests"]["environment"]["PYTHONPATH"])')
echo "service PYTHONPATH read from compose config: $IMGPP"
d "docker compose -p $P run --rm -T $MNT $SQ -e PYTHONPATH=$IMGPP:/squeal tests $ARGS" 2>&1 | tail -1
python3 - "$EV/events.jsonl" <<'PY'
import json, sys
recs = [json.loads(l) for l in open(sys.argv[1])]
kinds = {}
for r in recs: kinds[r.get("type")] = kinds.get(r.get("type"), 0) + 1
print("record kinds:", kinds)
for r in recs:
    if r.get("type") in ("collected", "import", "spawned"):
        print(" ", json.dumps(r)[:220])
    if r.get("type") == "phase" and r.get("outcome") == "failed":
        print("  failed phase location:", r.get("location"), "| longrepr head:", str(r.get("longrepr", ""))[:120].replace("\n", " / "))
PY
echo "== 3. who owns what the container wrote into the worktree and the events dir"
find "$WT" "$EV" -user 0 -printf '%u %p\n' | sed "s|$SCRATCH|<scratch>|" | head
echo "== 4. the same run with --user $(id -u):$(id -g) and HOME=/tmp"
d "docker compose -p $P run --rm -T --user $(id -u):$(id -g) -e HOME=/tmp $MNT $SQ -e SQUEAL_PYTEST_EVENTS=/squeal-out/events-user.jsonl -e PYTHONPATH=$IMGPP:/squeal tests $ARGS" 2>&1 | tail -1
ls -ln "$EV" | sed "s|$SCRATCH|<scratch>|"
echo "load after: $(load)"
