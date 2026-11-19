#!/bin/bash
# hold.sh <label> [end]: an agent mid-turn, as in the #245 incidents. Feeds
# Claude Code's SessionStart and UserPromptSubmit hook inputs to the plugin's
# own hook entries (0.1.563), so one consumer of this clone is registered "in
# turn" and squeal.config.json's `run-loop` group (`at: pause`) is held. With
# `end`, feeds SessionEnd instead, which removes the consumer. Prints the
# hooks' output and the store's consumer and turn rows.
. "$(dirname "$0")/env.sh"
label=$1; sid="probe-011-400"
feed() { printf '{"session_id":"%s","cwd":"%s","hook_event_name":"%s","source":"startup","prompt":"probe 011-400"}' \
  "$sid" "$SQ_REPO" "$1" | timeout 30 node --disable-warning=ExperimentalWarning "$SQ_PLUGIN/dist/$2.mjs" >> "$OUT/$label.hold.txt" 2>&1
  echo "$1 rc=$?" >> "$OUT/$label.hold.txt"; }
if [ "$2" = end ]; then feed SessionEnd session-end; else feed SessionStart session-start; feed UserPromptSubmit user-prompt-submit; fi
node -e '
const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync(".git/squeal/store.sqlite",{readOnly:true,timeout:5000});
for (const r of db.prepare("select key, value from meta where key like ?").all("%turn%")) console.log("meta", r.key, String(r.value).slice(0,200));
try { console.log("consumers", JSON.stringify(db.prepare("select * from consumers").all()).slice(0,600)); } catch (e) { console.log("consumers?", e.message); }'
