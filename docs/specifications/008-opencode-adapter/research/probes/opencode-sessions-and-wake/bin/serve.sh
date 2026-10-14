#!/bin/sh
# Throwaway. One `opencode serve` on 127.0.0.1:4298 as squeal-e2e, driven with curl the way Cezar
# drives it (POST /session, POST /session/:id/prompt_async), then SIGTERM like Cezar's teardown.
# Steps: s1 prompt -> plugin wakes the idle session after 3 s -> an outside process (curl) wakes it
# again -> TUI endpoints with no TUI attached -> DELETE a second session -> SIGTERM.
set -u
. "$(dirname "$0")/env.sh"
label=${1:-s1}
cd $W/repo
export PROBE_LABEL=$label PROBE_WAKE=delay:3000 PROBE_SPAWN=1
U=http://127.0.0.1:4298
mark() { echo "{\"label\":\"$label\",\"kind\":\"$1\",\"at\":$(date +%s%3N)$2}" >> $PROBE_LOG; }
idles() { grep "\"label\":\"$label\"" $PROBE_LOG | grep -c '"type":"session.idle"'; }
wait_idles() { n=0; while [ "$(idles)" -lt "$1" ] && [ $n -lt 240 ]; do sleep 0.5; n=$((n+1)); done; }
opencode serve --hostname 127.0.0.1 --port 4298 </dev/null > $W/log/$label.serve.out 2> $W/log/$label.serve.err &
SP=$!
n=0; until curl -s -o /dev/null $U/session || [ $n -gt 60 ]; do sleep 0.5; n=$((n+1)); done
mark serve.ready ",\"pid\":$SP"
SID=$(curl -s -X POST $U/session -H 'content-type: application/json' -d '{"title":"probe s1"}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).id))')
mark session.posted ",\"sid\":\"$SID\""
body() { node -e 'console.log(JSON.stringify({model:{providerID:"cliproxy",modelID:"gpt-6-luna"},parts:[{type:"text",text:process.argv[1]}]}))' "$1"; }
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST $U/session/$SID/prompt_async -H 'content-type: application/json' -d "$(body "Run this shell command exactly: env | grep -E '^(OPENCODE|PROBE_SESSION)' | sort > $W/log/$label-main.env and reply DONE")")
mark prompt.posted ",\"code\":$code"
# 1st idle: the turn; 2nd: the plugin's wake turn (3 s after the 1st).
wait_idles 2
mark outside.wake.post ""
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST $U/session/$SID/prompt_async -H 'content-type: application/json' -d "$(body "Squeal (outside process): tests/add.test.js FAIL -> PASS at revision 4. Reply with exactly OUTSIDE-OK.")")
mark outside.wake.posted ",\"code\":$code"
wait_idles 3
for ep in append-prompt submit-prompt; do
  d='{}'; [ $ep = append-prompt ] && d='{"text":"Squeal via TUI endpoint. Reply TUI-OK."}'
  r=$(curl -s -m 8 -w ' http=%{http_code}' -X POST $U/tui/$ep -H 'content-type: application/json' -d "$d"); mark tui.$ep ",\"response\":$(node -e 'console.log(JSON.stringify(process.argv[1]))' "$r")"
done
S2=$(curl -s -X POST $U/session -H 'content-type: application/json' -d '{"title":"probe s1 delete"}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).id))')
code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE $U/session/$S2); mark session.deleted.http ",\"code\":$code,\"sid\":\"$S2\""
sleep 2
curl -s $U/session/$SID/message > $W/log/$label.messages.json
mark sigterm ""
kill -TERM $SP
n=0; while kill -0 $SP 2>/dev/null && [ $n -lt 40 ]; do sleep 0.25; n=$((n+1)); done
mark serve.exited ",\"alive\":$(kill -0 $SP 2>/dev/null && echo true || echo false)"
sleep 2
for p in $(node -e 'const p=JSON.parse(require("fs").readFileSync(process.argv[1]));console.log(p.detached,p.attached)' $PROBE_LOG.pids); do
  if kill -0 $p 2>/dev/null; then mark child.alive ",\"pid\":$p,\"pgid\":$(ps -o pgid= -p $p)"; kill $p; else mark child.gone ",\"pid\":$p"; fi
done
echo done
