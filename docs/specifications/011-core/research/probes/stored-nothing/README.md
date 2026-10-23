# Probes for 011-148: why test work stores nothing, and when catch-up should start

Throwaway. Written for `research/stored-nothing.md`, 2026-10-23. Nothing here is product code, and nothing here is maintained.

## Rules these probes keep

- Every number is read from copies: the three host stores (`store.sqlite` with `-wal` and `-shm`) and a snapshot of each `<common-dir>/squeal/runs` directory, copied back to back at 13:25:32Z to 13:25:36Z. The live daemons prune runs and their logs: cezar's 72-hour window held 2,513 runs in a first copy at 13:18Z and 2,326 in the second at 13:25Z, and reports read in place went missing between two passes. So a store copy is read only with a log snapshot taken with it.
- No probe starts a daemon, a test or a Squeal command; no live store, socket or permit pool is opened. Transcripts (`~/.claude/projects/*`, `~/.codex/sessions/2026/10/*`) are read in place, read only, for their turn-end timestamps alone.
- Every script runs at nice 10 under `/tmp/sn148`. `PLUGIN_ROOT` and `PLUGIN_DATA` are never set.

## Files

| File | Measures | Question |
|---|---|---|
| `q.mjs <store> <sql>...` | ad hoc read-only queries | all |
| `fate.mjs <store> <hours> <out.jsonl> [slow regex] [log snapshot]` | one line per file a run held: its recorded seconds, whether it ended and stored, the rule that kept it out (inferred from the report and revisions), the result at the same key afterwards, its cause class | 1, 3, 5 |
| `sum.mjs <fate.jsonl> [all\|live\|removed\|cls=<class>]` | the fate groups as a table, the result-at-key columns, and the classes | 1, 5 |
| `bounds.mjs <store> <fate.jsonl>` | the same groups with a tighter bound for a file cut mid-run: `min(wall, 2 × its usual duration)` | 1 |
| `pruned.mjs <store>` | whether the results of removed worktrees that remain all sit under a live key (prune evidence) | 1 |
| `timeouts.mjs`, `timeouts2.mjs` | each timed-out run: files in flight and their usual durations, the load (`sadf -d -- -q`), the planned work against what completed, repeats | 2 |
| `dup.mjs <store> <fate.jsonl>` | for each stored result a later run at the same key replaced, why the later run ran | 3 |
| `ck.mjs <store> <fate.jsonl>` | checkpoint work (baseline and `run --all`) by what else would have run it | 5 |
| `miss.mjs <store> <fate.jsonl>` | baseline file runs: was the file stored at the same clean commit by another worktree before | 3, 5 |
| `turns.mjs <out.json> <root>...` | agent turn ends per worktree: Claude Code `stop_hook_summary` entries, Codex `task_complete` events | 4 |
| `catchup.mjs <store> <fate.jsonl> <turns.json> <class prefix>` | replays catch-up under a quiet of 20, 60, 120, 300 s and under the turn end: modelled recorded seconds, cut work, the delay of each to-FAIL run | 4 |
| `results/*.txt` | the outputs `stored-nothing.md` quotes | all |

## Re-running

```sh
S=/tmp/sn148; P=<this folder>; mkdir -p $S/{stores/{squeal,cezar,toolkit},runs/{squeal,cezar,toolkit},an}
for r in squeal cezar toolkit-dev; do n=${r%-dev}; cp ~/projects/$r/.git/squeal/store.sqlite* $S/stores/$n/; done
for r in squeal cezar toolkit-dev; do n=${r%-dev}; cp -a ~/projects/$r/.git/squeal/runs/. $S/runs/$n/; done   # right after the store copy
for d in 20 21 22 23; do sadf -d /var/log/sysstat/sa$d -- -q | grep -v '^#'; done > $S/an/load.csv
cd $S
nice -n 10 node $P/fate.mjs stores/squeal/store.sqlite 72 an/fate-squeal.jsonl '' runs/squeal
nice -n 10 node $P/fate.mjs stores/cezar/store.sqlite 72 an/fate-cezar.jsonl 'packages/web/e2e/' runs/cezar
nice -n 10 node $P/fate.mjs stores/toolkit/store.sqlite 72 an/fate-toolkit.jsonl '' runs/toolkit
node $P/sum.mjs an/fate-squeal.jsonl live          # question 1 (also: all, removed, cls=checkpoint-run-all)
node $P/bounds.mjs stores/squeal/store.sqlite an/fate-squeal.jsonl
node $P/pruned.mjs stores/squeal/store.sqlite
node $P/timeouts.mjs stores/squeal/store.sqlite an/fate-squeal.jsonl an/load.csv runs/squeal   # question 2
node $P/timeouts2.mjs stores/squeal/store.sqlite an/fate-squeal.jsonl
node $P/dup.mjs stores/cezar/store.sqlite an/fate-cezar.jsonl                                # question 3
node $P/ck.mjs stores/squeal/store.sqlite an/fate-squeal.jsonl                               # question 5
node $P/q.mjs stores/squeal/store.sqlite "SELECT id, root FROM worktrees" > an/wt-squeal.txt   # question 4
node $P/turns.mjs an/turns-squeal.json $(node -e 'for (const l of require("fs").readFileSync("an/wt-squeal.txt","utf8").trim().split("\n")) console.log(JSON.parse(l).root)')
node $P/catchup.mjs stores/squeal/store.sqlite an/fate-squeal.jsonl an/turns-squeal.json catchup-edit
```

Clean up: `rm -rf /tmp/sn148`. Done on 2026-10-23 after the commit: no process was started, and `/tmp/sn148` (store copies, log snapshots, `an/`) is removed.
