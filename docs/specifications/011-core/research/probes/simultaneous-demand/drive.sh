#!/bin/bash
# drive.sh: the whole VM round of row 011-420 in one detached job, started as
#   bash probe/bg.sh drive 14400 bash probe/drive.sh
# The warm-up with the base bundle, then the two-daemon runs (011-400's S2
# shape), then the one-daemon runs (H0 shape), in an interleaved order; each
# timed run waits for a quiet VM (run-all.sh's gate).
d=$(cd "$(dirname "$0")" && pwd)
bash "$d/warm.sh" > "$OUT/warm.log" 2>&1 || { echo "warm failed" >> "$OUT/gate.log"; exit 1; }
bash "$d/run-all.sh" q4 S-base-1:base S-q-1:q S-qc-1:qc S-qc-2:qc S-q-2:q S-base-2:base || exit 1
bash "$d/run-all.sh" one O-base-1:base O-q-1:q O-qc-1:qc O-qc-2:qc O-q-2:q O-base-2:base
