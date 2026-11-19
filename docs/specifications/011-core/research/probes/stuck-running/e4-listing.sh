#!/bin/sh
# E4 (shape 2) on the real cezar fixture: one edit to a central module re-keys most test
# files; measures how long the revision stays unlisted (refined < revision) and what focused
# requests for a known test file say meanwhile. Stops the daemon once listed, before the
# re-keyed tiers load the machine. Usage: e4-listing.sh <fixture> <out-dir> <central-file> <known-test>.
. "$(dirname "$0")/env.sh"; . $W/lib.sh
FIXT=$1; OUT=$2; CENTRAL=$3; KNOWN=$4; mkdir -p "$OUT"; cd "$FIXT"
node $W/observe.mjs "$FIXT/.git" "$OUT/observe.jsonl" 1800 2000 & OBS=$!
trap 'kill $OBS 2>/dev/null; git checkout -q -- "$CENTRAL"; timeout 90 sq stop --until-start >/dev/null 2>&1' EXIT
log "load $(cat /proc/loadavg)"
sqt 60 start start
sqt 900 startup status --wait 600000
sqt 30 known0 status --json "$KNOWN"; pick "$OUT/known0.out" >> "$OUT/picks.jsonl"
listed() { node -e '
const {DatabaseSync}=require("node:sqlite"); const db=new DatabaseSync(process.argv[1]+"/squeal/store.sqlite",{readOnly:true});
const w=db.prepare("SELECT id FROM worktrees").get().id; const r=db.prepare("SELECT max(number) n FROM revisions WHERE worktree_id=?").get(w).n;
const m=db.prepare("SELECT value v FROM meta WHERE key LIKE ? AND key LIKE ?").get("%refined%","%"+w+"%");
console.log(r+" "+(m?m.v:"null"))' "$FIXT/.git"; }
log "before edit: revision/refined $(listed)"
printf '\n// probe 011-394\n' >> "$CENTRAL"; T0=$(date +%s); log "edited $CENTRAL"
sleep 5
i=0; while [ $i -lt 120 ]; do
  RR=$(listed); log "t+$(( $(date +%s) - T0 )) s revision/refined $RR"
  sqt 30 k-$i status --json "$KNOWN"; pick "$OUT/k-$i.out" | sed "s/^/{\"i\":$i,\"t\":\"$(ts)\",\"p\":/;s/\$/}/" >> "$OUT/picks.jsonl"
  [ $i -eq 1 ] && sqt 90 run-known run tests "$KNOWN" --wait 60000
  [ $i -eq 2 ] && sqt 90 wait-known status --wait 60000 "$KNOWN"
  set -- $RR; [ "$1" = "$2" ] && break
  sleep 10; i=$((i + 1))
done
log "listed at t+$(( $(date +%s) - T0 )) s ($(listed)); load $(cat /proc/loadavg)"
sqt 30 counts status
log "done"
