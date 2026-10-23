#!/bin/sh
# 011-143 probe (throwaway). Usage: burst.sh <clone> <scope unit> <label> <cpu list e.g. 0-7> <paths file>
# Appends one comment line to each path of <paths file> (one per line), one every 30 s, and samples
# every 5 s until the daemon is idle after the last edit (at most 40 min): the scope's CPU, the host's
# one-minute load, the pinned CPUs' busy share from /proc/stat and the runnable tasks last on them.
C=$1; U=$2; L=$3; CPUS=$4; PATHS=$5
LO=${CPUS%-*}; HI=${CPUS#*-}
CG=/sys/fs/cgroup/user.slice/user-$(id -u).slice/user@$(id -u).service/app.slice/$U.scope
SQ="/tmp/el143/env.sh node ${SQUEAL_CLI:-/tmp/el143/squeal-q1/plugins/claude-code/dist/cli/squeal.mjs}"
OUT=/tmp/el143/logs/burst-$L.jsonl; : > $OUT
pin() { awk -v lo=$LO -v hi=$HI '$1 ~ /^cpu[0-9]+$/ { n = substr($1, 4) + 0; if (n >= lo && n <= hi) { b += $2+$3+$4+$7+$8; t += $2+$3+$4+$5+$6+$7+$8 } } END { print b, t }' /proc/stat; }
runq() { ps -eLo stat=,psr= | awk -v lo=$LO -v hi=$HI '$1 ~ /^R/ && $2 >= lo && $2 <= hi' | wc -l; }
st() { (cd $C && $SQ status --json 2>/dev/null) | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log([j.revision,j.testFileCounts.current,j.testFileCounts.pending,j.testFilesByPhase.running,j.testFilesByPhase.queued,j.runnerPartPending?1:0].join(" "))}catch{console.log("x")}})'; }
T0=$(date +%s.%N); r0=$(st | cut -d' ' -f1)
echo "{\"label\":\"$L\",\"t0\":$T0,\"rev0\":\"$r0\",\"cpus\":\"$CPUS\"}" >> $OUT
i=0; next=0; idle=0; set -- $(pin); pb=$1; pt=$2
while :; do
  now=$(echo "$(date +%s.%N) - $T0" | bc)
  if [ $i -lt $(wc -l < $PATHS) ] && [ $(echo "$now >= $next" | bc) = 1 ]; then
    i=$((i+1)); p=$(sed -n "${i}p" $PATHS); c='//'; case $p in *.py) c='#';; esac
    printf '\n%s el143 burst %s %s\n' "$c" "$L" "$i" >> $C/$p
    echo "{\"edit\":$i,\"t\":$now,\"path\":\"$p\"}" >> $OUT; next=$((next+30))
  fi
  s=$(st); set -- $(pin); db=$(( $1 - pb )); dt=$(( $2 - pt )); pb=$1; pt=$2
  echo "{\"t\":$now,\"s\":\"$s\",\"cpu\":$(awk '/^usage_usec/{print $2}' $CG/cpu.stat),\"load1\":$(cut -d' ' -f1 /proc/loadavg),\"pinBusy\":$( [ $dt -gt 0 ] && echo "scale=3; $db / $dt" | bc || echo 0),\"pinRunq\":$(runq)}" >> $OUT
  if [ $i -ge $(wc -l < $PATHS) ]; then
    set -- $s
    if [ "$1" != "x" ] && [ "$3" = 0 ] && [ "$4" = 0 ] && [ "$5" = 0 ] && [ "$6" = 0 ]; then idle=$((idle+1)); else idle=0; fi
    [ $idle -ge 3 ] && break
    [ $(echo "$now > 2400" | bc) = 1 ] && { echo '{"capped":true}' >> $OUT; break; }
  fi
  sleep 5
done
echo "{\"end\":$(echo "$(date +%s.%N) - $T0" | bc)}" >> $OUT
