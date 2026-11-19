#!/bin/bash
# wait-idle.sh <max s>: return when this clone's store shows no open run and no
# queued or running test file outside the manual e2e project (squawk runs it
# only on request, so it stays queued) for 30 s in a row, or after <max s>.
. "$(dirname "$0")/env.sh"
end=$(( $(date +%s) + $1 )); calm=0
while [ "$(date +%s)" -lt "$end" ]; do
  n=$(node -e '
const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync(".git/squeal/store.sqlite",{readOnly:true,timeout:2000});
const a=db.prepare("select count(*) n from runs where ended_at is null").get().n;
const b=db.prepare("select count(*) n from test_file_keys where pending is not null and project != ?").get("e2e").n;
console.log(a+b)' 2>/dev/null || echo busy)
  if [ "$n" = "0" ]; then calm=$((calm+10)); else calm=0; fi
  [ $calm -ge 30 ] && { echo "idle at $(date -u +%FT%TZ)"; exit 0; }
  sleep 10
done
echo "not idle after $1 s ($n pending)"; exit 1
