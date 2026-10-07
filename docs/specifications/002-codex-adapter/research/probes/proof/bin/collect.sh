#!/usr/bin/env bash
# Throwaway: copy trimmed evidence from /tmp/p16 into ../logs. Rollout
# timelines drop the system and skills preamble and cut the encrypted
# spawn_agent message; no config beyond the hooks.state table is copied.
set -e; B="$(cd "$(dirname "$0")" && pwd)"; O="$B/../logs"; L=/tmp/p16/logs; S=/tmp/p16/codex/sessions/2026/10/07
mkdir -p "$O"
cp $L/install.txt "$O/install.txt"
diff $L/config-before-trust.toml $L/config-before-loghook.toml | sed -n '/hooks.state/,$p' > "$O/trust-tui-hooks-state.diff" || true
jq -r '.data[0].hooks[] | select(.source=="plugin") | "\(.key) \(.currentHash) \(.trustStatus)"' $L/hl3.json 2>/dev/null > "$O/hooks-list-plugin.txt" || \
  jq -r '.data[0].hooks[] | select(.source=="plugin") | "\(.key) \(.currentHash) \(.trustStatus)"' $L/hl2.json > "$O/hooks-list-plugin.txt"
cp $L/symlink-node-modules.txt "$O/symlink-node-modules.status.txt"
tl() { node "$B/timeline.mjs" "$1" "$2" | awk '/skills_instructions/{skip=1} /^\+[0-9]+ms (developer|user): <(multi|env|perm|coll)/{next} skip&&/^\+/{skip=0} !skip' | sed -E 's/"message":"gAAAA[^"]*"/"message":"<encrypted>"/'; }
store() { jq -c --argjson t0 "$(cat $L/$1.t0)" 'if .error then {dt: (.t-$t0), error} else {dt: (.t-$t0), rev: .revision, consumers: [.consumers[] | "\(.session_id)/\(.agent_id) delivered@\(.last_delivered_at // 0 | if . > 0 then . - $t0 else "never" end)"], transitions: [.transitions[] | "\(.name) \(.from_outcome)->\(.to_outcome) r\(.revision) @\(.at-$t0)"], not_pass: [.views[] | select(test("pass$")|not)]} end' $L/$1.store.jsonl > "$O/$1.store.jsonl"; }
hooks() { jq -c --argjson t0 "$(cat $L/$1.t0)" 'select(.msg.method=="hook/completed") | .msg.params as $p | {dt: (.t-$t0), thread: $p.threadId, turn: $p.turnId, source: $p.run.source, event: $p.run.eventName, status: $p.run.status, ms: $p.run.durationMs, entries: $p.run.entries}' $L/$1.as.jsonl > "$O/$1.hooks.jsonl"; }
# exec run
store exec1; cp $L/exec1.stderr.txt "$O/exec1.stderr.txt"
jq -r 'select(.item.type=="agent_message") | .item.text' $L/exec1.events.jsonl > "$O/exec1.final.txt"
tl $S/*01a1183d-1c24-73b3-a9d2-c6100a82b808.jsonl "$(cat $L/exec1.t0)" > "$O/exec1.main.timeline.txt"
tl $S/*01a1183d-bdae-7aa3-8df9-5e06ccd27097.jsonl "$(cat $L/exec1.t0)" > "$O/exec1.subagent.timeline.txt"
# app-server threads
for r in as1 as2 n4inline nd-r9 nd-r5 nd-r6; do store $r; hooks $r; cp $L/$r.out.txt "$O/$r.out.txt"; done
tl $S/*01a11840-2dea-79c3-90e1-ed2eaf90eb57.jsonl "$(cat $L/as1.t0)" > "$O/as1.main.timeline.txt"
tl $S/*01a11840-8e60-7c11-809e-9d18c0695472.jsonl "$(cat $L/as1.t0)" > "$O/as1.subagent.timeline.txt"
tl $S/*01a11840-f30b-7820-ab9c-8c3a380edd4a.jsonl "$(cat $L/as1.t0)" > "$O/as1.review.timeline.txt"
tl $S/*01a11849-ed21-7a00-a829-eaaec6b40757.jsonl "$(cat $L/as2.t0)" > "$O/as2.main.timeline.txt"
tl $S/*01a11843-9015-7ff1-87cb-c9954f55236d.jsonl "$(cat $L/n4inline.t0)" > "$O/n4inline.main.timeline.txt"
tl $S/*01a11843-c375-70b1-aedb-8be359068163.jsonl "$(cat $L/n4inline.t0)" > "$O/n4inline.review.timeline.txt"
jq -c --argjson t0 "$(cat $L/n4inline.t0)" '{dt: (.t-$t0), event: .stdin.hook_event_name, session_id: .stdin.session_id, agent_id: .stdin.agent_id, turn_id: .stdin.turn_id, tool: .stdin.tool_name, transcript: (.stdin.transcript_path // "" | split("/") | last)}' $L/n4inline.stdin.jsonl > "$O/n4inline.stdin.jsonl"
cp $L/n4detached.out.txt "$O/n4detached.out.txt"
node "$B/hook-stats.mjs" $L/as1.as.jsonl $L/as2.as.jsonl $L/n4inline.as.jsonl $L/nd-r9.as.jsonl $L/nd-r5.as.jsonl $L/nd-r6.as.jsonl > "$O/hook-durations-all.txt"
for f in $L/latency-*.txt; do [ -f "$f" ] && grep -v '^$' "$f" > "$O/$(basename "$f")"; done
