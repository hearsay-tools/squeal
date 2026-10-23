#!/bin/sh
# 011-143 probe. Usage: edit.sh <clone> <scope unit> <file> <label> [comment prefix]
# Appends one comment line to <file>, then samples the daemon until nothing is queued or running.
C=$1; U=$2; F=$3; L=$4; P=${5:-//}
CG=/sys/fs/cgroup/user.slice/user-$(id -u).slice/user@$(id -u).service/app.slice/$U.scope
SQ="/tmp/el143/env.sh node ${SQUEAL_CLI:-/tmp/el143/squeal-q1/plugins/claude-code/dist/cli/squeal.mjs}"
OUT=/tmp/el143/logs/edit-$L.jsonl; : > $OUT
cpu() { awk '/^usage_usec|^user_usec|^system_usec/{printf "%s ", $2}' $CG/cpu.stat; }
dpid=$(pgrep -f "squeal.mjs daemon $C" | head -1)
dcpu() { awk '{print $14+$15}' /proc/$dpid/stat; }
st() { (cd $C && $SQ status --json 2>/dev/null) | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log([j.revision,j.testFileCounts.current,j.testFileCounts.pending,j.testFilesByPhase.running,j.testFilesByPhase.queued,j.runnerPartPending?1:0].join(" "))}catch{console.log("x")}})'; }
r0=$(st | cut -d' ' -f1)
T0=$(date +%s.%N); echo "{\"label\":\"$L\",\"file\":\"$F\",\"t0\":$T0,\"cpu0\":\"$(cpu)\",\"dcpu0\":$(dcpu),\"rev0\":$r0,\"load1\":\"$(cut -d' ' -f1-3 /proc/loadavg)\"}" >> $OUT
printf '\n%s el143 edit %s\n' "$P" "$L" >> $C/$F
idle=0
while :; do
  sleep 2
  s=$(st); t=$(date +%s.%N)
  echo "{\"t\":$(echo "$t - $T0" | bc),\"s\":\"$s\",\"cpu\":\"$(cpu)\",\"load1\":$(cut -d' ' -f1 /proc/loadavg)}" >> $OUT
  set -- $s
  if [ "$1" != "x" ] && [ "$1" -gt "$r0" ] && [ "$3" = 0 ] && [ "$4" = 0 ] && [ "$5" = 0 ] && [ "$6" = 0 ]; then idle=$((idle+1)); else idle=0; fi
  [ $idle -ge 3 ] && break
done
echo "{\"end\":$(echo "$(date +%s.%N) - $T0" | bc),\"cpu1\":\"$(cpu)\",\"dcpu1\":$(dcpu),\"load1\":\"$(cut -d' ' -f1-3 /proc/loadavg)\"}" >> $OUT
tail -1 $OUT; head -1 $OUT
