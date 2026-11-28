#!/usr/bin/env bash
# Throwaway probe, row 011-440: N runs of every test/cli/proof*.test.ts at once (load like a shard), instrumented.
cd /home/user/squeal && exec bash /home/user/probe/why-loop.sh "$1" "$2" $(ls test/cli/proof*.test.ts)
