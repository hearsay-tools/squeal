#!/bin/sh
# 011-223 probe: /tmp/fsc223/clones/<name> = <repo> at <commit>, installed (both repos' configs are lookup-only already),
# with a plain copy (same pages, not vacuumed) of the store copy, daemon columns cleared.
# usage: mkclone.sh <name> <repo dir> <commit> <store copy dir>
set -e; S=/tmp/fsc223; name=$1; repo=$2; commit=$3; stores=$4
d=$S/clones/$name; mkdir -p $S/clones
git clone -q --no-local --no-checkout $repo/.git $d
git -C $d fetch -q --upload-pack="git -c uploadpack.allowAnySHA1InWant=true upload-pack" $repo/.git $(git -C $repo rev-parse $commit) && git -C $d checkout -q -b probe-$name FETCH_HEAD
if [ -f $d/pnpm-lock.yaml ]; then (cd $d && $S/envrun.sh corepack pnpm install --frozen-lockfile --reporter=silent >/dev/null 2>&1)
else (cd $d && $S/envrun.sh npm ci --no-audit --no-fund --loglevel=error >/dev/null 2>&1); fi
mkdir -p $d/.git/squeal; cp $repo/.git/squeal/repository-id $d/.git/squeal/
cp $stores/store.sqlite $stores/store.sqlite-wal $stores/store.sqlite-shm $d/.git/squeal/
node -e '
const {DatabaseSync}=require("node:sqlite"); const db=new DatabaseSync(process.argv[1]);
db.exec("UPDATE worktrees SET daemon_socket=NULL, daemon_started_at=NULL, daemon_heartbeat_at=NULL, daemon_heartbeat_interval_ms=NULL, daemon_version=NULL"); db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); db.close();' $d/.git/squeal/store.sqlite
echo "$name $(git -C $d log -1 --format='%h %s' | cut -c1-70)"
