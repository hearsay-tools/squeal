#!/bin/sh
# Throwaway (issue 10 research). At fixture $1 with Squeal CLI $2 (a squeal.mjs):
# the reporter's edit ($3, "full" or empty), then, once the daemon reports a
# test file running, one same-bytes rewrite of packages/server/dist (rebuild.sh
# 1), then an exact-file wait on the edited unit test and the store's view.
set -u
dir=$1; cli=$2; edit=${3:-}
here=$(cd "$(dirname "$0")" && pwd)
sq() { node --disable-warning=ExperimentalWarning "$cli" "$@"; }
cd "$dir"
"$here/move-helper.sh" . $edit
echo "edit at $(date +%T.%N | cut -c1-12)"
i=0
while [ $i -lt 200 ]; do
  running=$(sq status --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const b=j.breakdown;console.log(b.testFilesWithoutChecksRunning+b.fileLevelByPhase.running+b.pendingByPhase.running)})')
  [ "$running" -gt 0 ] && break
  i=$((i + 1)); sleep 0.1
done
echo "running seen at $(date +%T.%N | cut -c1-12) after $i polls; rewriting dist"
"$here/rebuild.sh" . 1
sq status --wait 60000 packages/web/src/lib/nav-contract.test.ts
echo "wait exit $?"
