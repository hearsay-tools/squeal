#!/bin/sh
# Throwaway (026 agent37-sandboxes). Forks <id>, polls until running, then times the first
# exec that answers. Prints the new id and the timings; the raw objects go to $A37_HOME.
SRC=$1; NAME=$2; D=$(cd "$(dirname "$0")" && pwd)
s=$(date +%s%N)
"$D/a37.sh" POST "/v1/instances/$SRC/fork" "{\"name\":\"$NAME\"}" > "$A37_HOME/fork-$NAME.json" 2> "$A37_HOME/fork-$NAME.err"
r=$(( ($(date +%s%N) - s) / 1000000 ))
ID=$(node -pe 'JSON.parse(require("fs").readFileSync(process.argv[1])).id' "$A37_HOME/fork-$NAME.json")
ST=$(node -pe 'JSON.parse(require("fs").readFileSync(process.argv[1])).status' "$A37_HOME/fork-$NAME.json")
echo "fork $NAME: $ID $(cat "$A37_HOME/fork-$NAME.err") returned $r ms status $ST"
while [ "$ST" != running ]; do sleep 1; ST=$("$D/a37.sh" GET "/v1/instances/$ID" 2>/dev/null | node -pe 'JSON.parse(require("fs").readFileSync(0)).status'); done
echo "running at $(( ($(date +%s%N) - s) / 1000000 )) ms"
until A37_PLANE=sandbox "$D/a37.sh" POST "/v1/instances/$ID/exec" '{"command":"test -d ~/squeal/node_modules && echo ready"}' 2>/dev/null | grep -q ready; do sleep 0.5; done
echo "first exec with ~/squeal/node_modules at $(( ($(date +%s%N) - s) / 1000000 )) ms"
