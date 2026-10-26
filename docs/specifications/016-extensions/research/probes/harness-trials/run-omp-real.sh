#!/bin/sh
# Throwaway probe (016-35). Run as squeal-e2e with HOME=/home/squeal-e2e.
# Usage: HT_PROMPT=<prompt> run-omp-real.sh <name> [omp args...]
# One real-model OMP session in RPC mode (rpc-wake.mjs, no outside edit) in
# ~/ht035/repo: model openai-codex/gpt-6-luna, thinking low, the event log and
# omp-shim.js with the boundary through tool_result, Squeal's Node-routed probe
# copy (HT_SQUEAL_EXT, HT_NODE). The session is stored in
# ~/ht035/sessions/<name>. While it runs, `ps` is sampled every 2 s into
# <name>.ps.txt (only processes under ~/ht035 or named omp). No fake model.
set -u
name=$1
shift
logs=$HOME/ht035/logs
probe=$HOME/ht035/probe
rm -f "$logs/$name".*
mkdir -p "$HOME/ht035/sessions/$name"
cd "$HOME/ht035/repo"
export HT_SQUEAL_EXT=$HOME/ht035/squeal-node/plugins/pi/dist/extension.mjs HT_NODE=/opt/squeal-e2e/node24/bin/node \
  HT_BOUNDARY=tool_result HT_NO_OUTSIDE=1 SQUEAL_HOOK_DEBUG=1 HT_EVENT_LOG=$logs/$name.events.jsonl
( while :; do date +%T; ps -u "$(id -u)" -o pid,ppid,etime,args | grep -e ht035 -e omp | grep -v -e grep -e 'ps -u' | cut -c1-200; sleep 2; done ) >"$logs/$name.ps.txt" 2>&1 &
sampler=$!
timeout "${HT_TIMEOUT:-300}" node "$probe/rpc-wake.mjs" "$logs/$name.frames.jsonl" \
  --model openai-codex/gpt-6-luna --thinking low --session-dir "$HOME/ht035/sessions/$name" \
  -e "$probe/omp-event-log.js" -e "$probe/omp-shim.js" "$@" </dev/null >"$logs/$name.out.txt" 2>&1
echo "exit $?" >>"$logs/$name.out.txt"
kill "$sampler"
exit 0
