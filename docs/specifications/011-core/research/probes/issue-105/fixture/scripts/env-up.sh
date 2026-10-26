#!/bin/sh
# Stand-in for test-env-up.sh: a new descriptor at each boot (pid, start time), and a
# build mirror whose bytes depend only on the sources.
set -eu
mkdir -p .ai/qa/build
printf '{"status":"running","app":{"pid":%s},"startedAt":"%s"}\n' "$$" "$(date -u +%FT%T.%NZ)" > .ai/qa/test-env.json
cat src/app.txt > .ai/qa/build/out.txt
