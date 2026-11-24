#!/bin/sh
# Throwaway (026 agent37-sandboxes). Runs a local script on an instance through exec
# (sandbox.agent37.app, through the proxy): rx.sh <id> <script> [args...]
# The script travels base64 inside the command (1 MB body cap). With RX_BG=1 the run is
# detached and its output goes to /tmp/rx-<script name>.log on the instance.
# Prints stdout, then stderr, then "exit <code>"; timing on stderr as "HTTP <code> <s>".
ID=$1; S=$2; shift 2
D=$(cd "$(dirname "$0")" && pwd)
B=$(base64 -w0 < "$S")
N=$(basename "$S")
if [ "${RX_BG:-0}" = 1 ]; then
  C="echo $B | base64 -d > /tmp/rx-$N && cd ~ && setsid nohup sh /tmp/rx-$N $* > /tmp/rx-$N.log 2>&1 < /dev/null &"
  BODY=$(node -e 'console.log(JSON.stringify({command: process.argv[1], background: true}))' "$C")
else
  C="echo $B | base64 -d > /tmp/rx-$N && cd ~ && sh /tmp/rx-$N $*"
  BODY=$(node -e 'console.log(JSON.stringify({command: process.argv[1]}))' "$C")
fi
A37_PLANE=sandbox "$D/a37.sh" POST "/v1/instances/$ID/exec" "$BODY" | node -e '
let s=""; process.stdin.on("data", c => s += c).on("end", () => {
  try { const j = JSON.parse(s);
    if (j.stdout !== undefined) { process.stdout.write(j.stdout); if (j.stderr) process.stdout.write("[stderr] " + j.stderr); console.log("exit " + j.exit_code + (j.truncated ? " (truncated)" : "")); }
    else console.log(JSON.stringify(j));
  } catch { console.log(s.slice(0, 2000)); } });'
