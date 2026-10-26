#!/bin/sh
# Throwaway probe (016-35). Run as squeal-e2e with HOME=/home/squeal-e2e.
# Usage: run-omp.sh <name> <script.json> <omp args...>
# Starts the fake model on 127.0.0.1:18435 with <script.json>, runs one OMP
# session in ~/ht035/repo with the event-log extension and <omp args>, then
# stops the fake model. With HT_RPC=1 the session is `omp --mode rpc` driven by
# rpc-wake.mjs. Logs go to ~/ht035/logs/<name>.{model,events,frames}.jsonl and
# <name>.out.txt. stdin is /dev/null: an open stdin makes omp wait for a prompt.
set -u
name=$1 script=$2
shift 2
logs=$HOME/ht035/logs
probe=$HOME/ht035/probe
rm -f "$logs/$name".*
node "$probe/fake-openai.mjs" 18435 "$script" "$logs/$name.model.jsonl" &
fake=$!
sleep 1
cd "$HOME/ht035/repo"
export HT_SQUEAL_EXT=${HT_SQUEAL_EXT:-$HOME/ht035/squeal/plugins/pi/dist/extension.mjs} SQUEAL_HOOK_DEBUG=1 HT_EVENT_LOG=$logs/$name.events.jsonl
if [ "${HT_RPC:-}" = 1 ]; then
  timeout "${HT_TIMEOUT:-120}" node "$probe/rpc-wake.mjs" "$logs/$name.frames.jsonl" \
    --model fake/fake-gpt -e "$probe/omp-event-log.js" "$@" </dev/null >"$logs/$name.out.txt" 2>&1
else
  timeout "${HT_TIMEOUT:-120}" \
    omp --model fake/fake-gpt -e "$probe/omp-event-log.js" "$@" </dev/null >"$logs/$name.out.txt" 2>&1
fi
echo "exit $?" >>"$logs/$name.out.txt"
kill "$fake"
