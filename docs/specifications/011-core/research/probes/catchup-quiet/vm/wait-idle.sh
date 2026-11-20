#!/bin/bash
# wait-idle.sh <max s>: return when this clone's store shows no open run and no
# queued or running test file outside the manual e2e project (squawk runs it
# only on request, so it stays queued) for 30 s in a row, or after <max s>.
# With HELD=1 the files of squawk's `run-loop` group (`at: pause`; its globs
# from squeal.config.json) are left out too: hold.sh keeps them queued.
. "$(dirname "$0")/env.sh"
end=$(( $(date +%s) + $1 )); calm=0
while [ "$(date +%s)" -lt "$end" ]; do
  n=$(HELD="${HELD:-0}" node -e '
const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync(".git/squeal/store.sqlite",{readOnly:true,timeout:2000});
const runLoop=/^packages\/cezar\/src\/(.*\/)?([^/]*parity[^/]*|worker-[^/]*)\.test\.ts$/;
const a=db.prepare("select count(*) n from runs where ended_at is null").get().n;
const rows=db.prepare("select path from test_file_keys where pending is not null and project != ?").all("e2e");
const b=rows.filter(r=>process.env.HELD!=="1"||!runLoop.test(r.path)).length;
console.log(a+b)' 2>/dev/null || echo busy)
  if [ "$n" = "0" ]; then calm=$((calm+10)); else calm=0; fi
  [ $calm -ge 30 ] && { echo "idle at $(date -u +%FT%TZ)"; exit 0; }
  sleep 10
done
echo "not idle after $1 s ($n pending)"; exit 1
