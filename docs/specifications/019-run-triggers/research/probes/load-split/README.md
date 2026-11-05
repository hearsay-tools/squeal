# Probes for 019-46: where Squeal's test CPU goes now, by trigger

Throwaway. Written for `research/load-split.md`, 2026-11-05. Nothing here is product code, and nothing here is maintained.

## Rules these probes keep

- A store is read only from a copy: `store.sqlite` with its `-wal` and `-shm`, copied with `cp` into `/tmp/ls019/stores/<repo>/`. No live store, daemon socket or permit pool is opened. Run logs (`report.json`) are read in place, read only.
- Transcripts (`~/.claude/projects/**.jsonl`, `~/.codex/sessions/**.jsonl`) are read only.
- No test run, no `squeal run --all`, no script under `evals/bin/` or `tasks/*/probe/`. Every probe runs at `nice -n 10`.

## Files

| File | What it gives | Question |
|---|---|---|
| `../../../../011-core/research/probes/edit-load/work.mjs` (unchanged) | the 2026-10-23 classification, run again so the two dates compare | 1 |
| `turns.mjs <since ISO> <out.json>` | per Squeal worktree id (sha256 of the root, first 16 hex): Stop times, turn starts, Edit/Write and apply_patch edits, from Claude Code and Codex transcripts | 4b |
| `split.mjs <store copy> <squeal.config.json> <turns.json> <from> <to> [slow regex]` | the 019-46 split: exact classes where the store kept the worktree's revisions (declared inputs included), run shape elsewhere; end causes; catch-up per edit; catch-up against Stop and commit; per-file seconds | 1 to 4 |
| `cover.cjs <store copy> <turns.json>` | how many worktrees with runs still have revisions in the store, and a transcript | 1 |
| `edit-cover.cjs <store copy> <turns.json>` | transcript edits against the store's watch revisions (why transcripts cannot replace lost revisions) | 1 |
| `shape.cjs <store copy>` | run sizes and checkpoint kinds in the window | 1 |
| `baseline.cjs <store copy>` | baseline checkpoints: a worktree's first in the store or a later daemon start | 1, 5 |
| `fates.cjs <split output>` | seconds that kept no result, by cause and run shape | 2 |
| `groups.cjs <split output> <regex>...` | recorded seconds of candidate groups | 4a |
| `trans.cjs`, `fails.cjs <store copy> <regex>...` | transitions (live worktrees only) and stored FAIL results (all worktrees) per candidate group | 4a, 5 |
| `twt.cjs <store copy>` | whether transitions and revisions survive a removed worktree | 1, 5 |

## Re-running

```sh
S=/tmp/ls019; P=<this folder>; W=$P/../../../../011-core/research/probes/edit-load/work.mjs
mkdir -p $S/stores/{squeal,cezar,toolkit} $S/out
for p in squeal:squeal cezar:cezar toolkit-dev:toolkit; do cp ~/projects/${p%%:*}/.git/squeal/store.sqlite* $S/stores/${p##*:}/; done
FROM=2026-11-02T16:50:00Z; TO=2026-11-05T16:50:00Z   # 72 h ending at the copy
cd $S
nice -n 10 node $W stores/squeal/store.sqlite - 72 4 > out/old-squeal.json      # same method as 2026-10-23
nice -n 10 node $W stores/cezar/store.sqlite - 72 4 'packages/web/e2e/' > out/old-cezar.json
nice -n 10 node $W stores/toolkit/store.sqlite - 72 4 > out/old-toolkit.json
nice -n 10 node $P/turns.mjs 2026-11-02T14:00:00Z out/turns.json
nice -n 10 node $P/split.mjs stores/squeal/store.sqlite ~/projects/squeal/squeal.config.json out/turns.json $FROM $TO > out/new-squeal.json
nice -n 10 node $P/split.mjs stores/cezar/store.sqlite ~/projects/cezar/squeal.config.json out/turns.json $FROM $TO 'packages/web/e2e/' > out/new-cezar.json
nice -n 10 node $P/split.mjs stores/toolkit/store.sqlite ~/projects/toolkit-dev/squeal.config.json out/turns.json $FROM $TO > out/new-toolkit.json
node $P/fates.cjs out/new-cezar.json
node $P/groups.cjs out/new-cezar.json 'packages/web/e2e/' '-parity\.test\.ts$' '^root:test:unit '
node $P/groups.cjs out/new-squeal.json 'test/harness/' 'test/harness/(codex|opencode|pi)/' 'test/integration/' 'test/daemon/' 'test/scheduler/'
node $P/fails.cjs stores/cezar/store.sqlite '-parity\.test\.ts$' 'packages/web/e2e/'
node $P/baseline.cjs stores/cezar/store.sqlite
```

`split.mjs` takes the window as arguments. The `.cjs` scripts hold it as two constants (2026-11-02T16:50Z to 2026-11-05T16:50Z); change them for another window. `cezar`'s `split.mjs` takes about two minutes (24,889 runs, each `report.json` read once).

Clean up: `rm -rf /tmp/ls019`. Done on 2026-11-05: the store copies and outputs are removed after the report was written.
