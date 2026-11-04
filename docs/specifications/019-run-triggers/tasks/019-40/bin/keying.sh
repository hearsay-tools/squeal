#!/bin/sh
# Throwaway probe for 019-40, as squeal-e2e in the cezarion clone right after s1c, with s1c's daemon
# still running (019-17's as-e2e.mjs). No model.
#   sh keying.sh <seconds>
# Does a second commit re-key every lint file as s1c's commit did (lint-keying seq 2, mode
# `config`, 33 s after the commit)? Prints the lint keying, cursor and commit report, then
# commits a comment in packages/contract/src/effort.ts and prints each change of the three, and
# of the status commit line, with its time from the commit, for <seconds>.
set -eu
secs=${1:-90}
read_meta() {
  node -e '
const { DatabaseSync } = require("node:sqlite");
const lint = new DatabaseSync(".git/squeal/lint.sqlite", { readOnly: true });
const store = new DatabaseSync(".git/squeal/store.sqlite", { readOnly: true });
const get = (db, like) => db.prepare("SELECT key, value FROM meta WHERE key LIKE ?").all(like).map((r) => `${r.key.split(":")[0]}=${r.value.slice(0, 160)}`);
const reports = store.prepare("SELECT value FROM meta WHERE key LIKE ?").all("commit-reports%").map((r) => JSON.parse(r.value).reports.map((x) => `${x.commit.slice(0, 7)} at ${x.at} lint ${JSON.stringify(x.lint)}${x.updated ? " updated" : ""}`).join("; "));
console.log([...get(lint, "lint-keying%"), ...get(lint, "lint-cursor%"), ...reports].join(" | "));
'
}
echo "before: $(read_meta)"
printf '\n// probe 019-40: a second commit\n' >> packages/contract/src/effort.ts
git add packages/contract/src/effort.ts && git commit -q -m "probe 019-40: second commit"
t0=$(date +%s%N)
echo "committed $(git rev-parse --short=7 HEAD) at $(date -u +%T.%N | cut -c1-12)Z"
last=
for i in $(seq 1 "$secs"); do
  now="$(read_meta) || $(squeal status | grep -E '^(Commit|Lint:)' | tr '\n' '|' || true)"
  if [ "$now" != "$last" ]; then echo "$(( ($(date +%s%N) - t0) / 1000000 )) ms: $now"; last=$now; fi
  sleep 1
done
