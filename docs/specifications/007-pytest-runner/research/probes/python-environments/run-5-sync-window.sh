#!/usr/bin/env bash
# Q3: while `uv sync` installs, is the environment locked, and can a reader tell?
set -u; source "$(dirname "$0")/lib.sh"
R=$S/w/main; mkrepo $R; cd $R; uv sync -q --python 3.13
uv cache clean -q numpy 2>/dev/null || true
sed -i 's/dependencies = \["lib"\]/dependencies = ["lib", "numpy", "pandas"]/' pyproject.toml; uv lock -q
( uv sync -q 2>&1; echo "sync exit $?" ) & pid=$!
held=0 free=0
while kill -0 $pid 2>/dev/null; do
  if flock -n .venv/.lock true 2>/dev/null; then free=$((free+1)); else held=$((held+1)); fi
  sleep 0.02
done; wait $pid
echo "polls with .venv/.lock held: $held, free: $free"
echo "-- uv pip install also takes it?"
( uv pip install -q -p .venv/bin/python 'requests' 2>&1 ) & pid=$!; held=0 free=0
while kill -0 $pid 2>/dev/null; do if flock -n .venv/.lock true 2>/dev/null; then free=$((free+1)); else held=$((held+1)); fi; sleep 0.01; done; wait $pid
echo "polls with .venv/.lock held: $held, free: $free"
echo "-- does uv sync wait while another process holds the lock?"
flock .venv/.lock sleep 3 & sleep 0.2; s=$(date +%s%N); uv sync -q 2>&1; echo "uv sync took $(( ($(date +%s%N)-s)/1000000 )) ms while the lock was held for 3 s"; wait
echo "-- fingerprint cost at this size"; node $P/envprint.mjs .venv | sed "s#$S#<S>#g"
