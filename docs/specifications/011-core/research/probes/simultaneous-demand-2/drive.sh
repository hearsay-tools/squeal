#!/bin/bash
# drive.sh: the whole VM round of row 011-423 in one detached job, started as
#   bash probe/bg.sh drive 36000 bash ~/work/0d5248b3/probe/drive.sh
# (expand ~ before bg.sh). The warm-up with the base bundle and the store
# snapshots, then 30 two-daemon runs (011-400's S2 shape) in ten blocks of
# three, alternating base q qc and qc q base, so each arm takes each position
# in a block equally often and run position does not stand in for the arm.
# Each run restores both copies' stores from the snapshots first (q4.sh,
# RESET=1) and waits for a quiet VM (run-all.sh's gate).
d=$(cd "$(dirname "$0")" && pwd)
bash "$d/warm.sh" > "$OUT/warm.log" 2>&1 || { echo "warm failed" >> "$OUT/gate.log"; exit 1; }
bash "$d/run-all.sh" q4 S-base-1:base S-q-1:q S-qc-1:qc S-qc-2:qc S-q-2:q S-base-2:base S-base-3:base S-q-3:q S-qc-3:qc S-qc-4:qc S-q-4:q S-base-4:base S-base-5:base S-q-5:q S-qc-5:qc S-qc-6:qc S-q-6:q S-base-6:base S-base-7:base S-q-7:q S-qc-7:qc S-qc-8:qc S-q-8:q S-base-8:base S-base-9:base S-q-9:q S-qc-9:qc S-qc-10:qc S-q-10:q S-base-10:base
# Then two base runs that keep the store the run before left (RESET=0): if they are faster
# than the reset runs, the store carried between runs explains 011-420's first-run slowness.
RESET=0 bash "$d/run-all.sh" q4 S-keep-1:base S-keep-2:base
