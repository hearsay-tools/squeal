#!/bin/sh
# 011-223 probe: one fresh start in a clone. Puts a fresh copy of the store copy in place (no row for this
# worktree yet), runs `squeal start` with the step-logging bundle, waits until the status is listed,
# prints the status, stops the daemon. Steps go to /tmp/fsc223/an/steps.log.
# usage: runstart.sh <clone name> <store copy dir> <label>
S=/tmp/fsc223; name=$1; stores=$2; label=$3; d=$S/clones/$name; B=$S/bundle/dist/cli/squeal.mjs
rm -f $d/.git/squeal/store.sqlite*; cp $stores/store.sqlite $stores/store.sqlite-wal $stores/store.sqlite-shm $d/.git/squeal/
node -e '
const {DatabaseSync}=require("node:sqlite"); const db=new DatabaseSync(process.argv[1]);
db.exec("UPDATE worktrees SET daemon_socket=NULL, daemon_started_at=NULL, daemon_heartbeat_at=NULL, daemon_heartbeat_interval_ms=NULL, daemon_version=NULL"); db.close();' $d/.git/squeal/store.sqlite
echo "$(date +%s%3N) 0 0 run-begin $label $name load=$(cut -d' ' -f1 /proc/loadavg)" >> $S/an/steps.log
cd $d && $S/envrun.sh node $B start $d > $S/an/start-$label.txt 2>&1
echo "$(date +%s%3N) 0 0 start-returned $label exit=$?" >> $S/an/steps.log
i=0; while [ $i -lt 240 ]; do
  out=$($S/envrun.sh node $B status 2>&1); case "$out" in *"not listed"*|*"has not listed"*) sleep 1; i=$((i+1));; *) break;; esac
done
echo "$(date +%s%3N) 0 0 status-listed $label load=$(cut -d' ' -f1 /proc/loadavg)" >> $S/an/steps.log
echo "$out" > $S/an/status-$label.txt
$S/envrun.sh node $B stop $d >> $S/an/start-$label.txt 2>&1
echo "$(date +%s%3N) 0 0 stopped $label" >> $S/an/steps.log
# Keep this start's keys and listing before the next run replaces the store.
node -e '
const {DatabaseSync}=require("node:sqlite"); const db=new DatabaseSync(process.argv[1],{readOnly:true});
const w=db.prepare("select id from worktrees where root=?").get(process.argv[2]);
const keys=db.prepare("select project, path, key from test_file_keys where worktree_id=? order by project, path").all(w.id);
require("fs").writeFileSync(process.argv[3], JSON.stringify({worktree:w.id, keys}));' $d/.git/squeal/store.sqlite $d $S/an/keys-$label.json
