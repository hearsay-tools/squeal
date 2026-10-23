#!/bin/sh
# 011-152 probe: /tmp/ms152/clones/<name> at <commit>, npm ci, lookup-only baseline, a scrubbed copy of the squeal store copy.
set -e; S=/tmp/ms152; name=$1; commit=$2; store=${3:-$S/stores/squeal/store.sqlite}
d=$S/clones/$name; mkdir -p $S/clones
git clone -q --no-local --no-checkout /home/agent/projects/squeal/.git $d
git -C $d fetch -q --upload-pack="git -c uploadpack.allowAnySHA1InWant=true upload-pack" /home/agent/projects/squeal/.git $(git -C /home/agent/projects/squeal rev-parse $commit) && git -C $d checkout -q -b probe-$name FETCH_HEAD
(cd $d && $S/envrun.sh npm ci --no-audit --no-fund --loglevel=error >/dev/null 2>&1)
node -e 'const f=process.argv[1]; const c=JSON.parse(require("fs").readFileSync(f,"utf8")); c.baseline={onStart:"lookup-only"}; require("fs").writeFileSync(f, JSON.stringify(c,null,2)+"\n")' $d/squeal.config.json
mkdir -p $d/.git/squeal; cp /home/agent/projects/squeal/.git/squeal/repository-id $d/.git/squeal/
node -e '
const {DatabaseSync}=require("node:sqlite"); const src=new DatabaseSync(process.argv[1],{readOnly:true}); src.exec("VACUUM INTO '"'"'"+process.argv[2]+"'"'"'"); src.close();
const db=new DatabaseSync(process.argv[2]); db.exec("UPDATE worktrees SET daemon_socket=NULL, daemon_started_at=NULL, daemon_heartbeat_at=NULL, daemon_heartbeat_interval_ms=NULL, daemon_version=NULL"); db.close();' $store $d/.git/squeal/store.sqlite
echo "$name $(git -C $d log -1 --format='%h %s' | cut -c1-70)"
