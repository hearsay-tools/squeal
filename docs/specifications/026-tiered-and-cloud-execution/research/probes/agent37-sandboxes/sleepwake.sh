#!/bin/sh
# Throwaway (026 agent37-sandboxes). Starts a marker process, sleeps <id> with POST /sleep,
# polls status until sleeping and `slept_at` is set, waits <settle> s more, then times the
# first exec (or, with WAKE=ssh, a new ssh connection; ssh_config from sshcmd.sh), which wakes it, and reports whether the marker process survived.
ID=$1; SETTLE=${2:-45}; D=$(cd "$(dirname "$0")" && pwd)
st() { "$D/a37.sh" GET "/v1/instances/$ID" 2>/dev/null | node -pe 'const j=JSON.parse(require("fs").readFileSync(0)); j.status + " " + (j.slept_at ?? "-")'; }
PID=$(A37_PLANE=sandbox "$D/a37.sh" POST "/v1/instances/$ID/exec" '{"command":"sleep 100000","background":true}' 2>/dev/null | node -pe 'JSON.parse(require("fs").readFileSync(0)).pid')
echo "marker pid $PID"
s=$(date +%s%N)
"$D/a37.sh" POST "/v1/instances/$ID/sleep" 2>&1 | tail -2 | tr '\n' ' '; echo
while :; do x=$(st); case $x in sleeping*) break;; esac; sleep 1; done
echo "status sleeping after $(( ($(date +%s%N) - s) / 1000000 )) ms ($x)"
sleep "$SETTLE"
echo "status before wake: $(st)"
s=$(date +%s%N)
if [ "${WAKE:-exec}" = ssh ]; then
  r=$(ssh -F "$A37_HOME/ssh_config" -o ControlMaster=no -o ControlPath=none "node@$ID.agent37.app" "kill -0 $PID && echo marker-alive || echo marker-gone; cat /proc/uptime" < /dev/null 2>&1)
else
  r=$(A37_PLANE=sandbox "$D/a37.sh" POST "/v1/instances/$ID/exec" "{\"command\":\"kill -0 $PID && echo marker-alive || echo marker-gone; cat /proc/uptime\"}" 2>&1)
fi
echo "wake ${WAKE:-exec} $(( ($(date +%s%N) - s) / 1000000 )) ms: $(echo "$r" | tr '\n' ' ' | cut -c1-200)"
echo "status after wake: $(st)"
