# Probes for research/loaded-modules.md

Throwaway. Written 2026-11-14 for `../../loaded-modules.md` (row 022-01). Nothing here is product code or maintained.

## Rules these probes keep

- Stores are read only from copies made with `VACUUM INTO` through a read-only `node:sqlite` connection, into `$TMPDIR/stores/<repo>/` (squeal and cezar main checkouts, taken 2026-11-14 11:56Z). No live store, daemon socket or `squeal` command was used.
- No test suite, build or benchmark of either repository ran. The replays use recorded durations. Fixture runs (subfolders) stayed under `$TMPDIR`, one run at a time, with the one-minute load beside each timing.

## Files

| File | What it does |
|---|---|
| `lib.mjs` | Opens a store read-only; `loadedPaths(record)`: every path a coverage record holds (a part manifest's `unread` list, or a full record's sources and unread paths) |
| `peek.mjs <store> <code>` | Prints three coverage records with their results and stored import walk (format check) |
| `replay.mjs <store> <code> <squeal.config.json> <since-ms> <out.json>` | Chain replay: each test file's consecutive runs in one worktree, the union of changed paths of the revisions between them (only when every revision is stored), and the record of the previous run's result key. Classifies each changed path and decides S1 and S2 |
| `summarize.mjs <out.json>` | Prints the chain replay's runs, seconds, skips, new failures skipped, path kinds |
| `population.mjs <store> <code> <config> <out.json>` | Population replay: each test file's newest record and newest stored closure against every stored revision's changed paths; re-keyed recorded seconds (median `duration_ms`) under today's rule, S1 and S2, and why today's rule ran what S1 skips |
| `vitest/` | Vitest 5.0.3 fixtures: soundness cases, recording through `evaluatedModules`, isolation, cost. Own README |
| `node-pytest/` | node:test and pytest recording options, mixing, cost, misses. Own README |
| `kody/` | Kody's CI module maps against an emulated import closure of the same tree; replay over 50 commits. Own README |

S1 is the pure rule: run a test file when it changed or a path in its last run's record changed (a path the record cannot hold because `coverage.exclude` names it counts as loaded). S2 narrows only the import-graph part of today's closure to the record; setup and config files, observed reads, child-process modules, declared inputs, listings and non-module closure paths keep re-running.

## Re-running

```sh
cd $TMPDIR && P=<this directory>
# copies: node -e 'new (require("node:sqlite").DatabaseSync)(SRC,{readOnly:true}).exec("VACUUM INTO \x27DST\x27")'
nice -n 10 node $P/replay.mjs stores/squeal/store.sqlite stores/squeal/code.sqlite <squeal>/squeal.config.json 1794206806713 out-squeal.json
nice -n 10 node $P/replay.mjs stores/cezar/store.sqlite stores/cezar/code.sqlite cezar-config.json 1794213142177 out-cezar.json
node $P/summarize.mjs out-squeal.json; node $P/summarize.mjs out-cezar.json
nice -n 10 node $P/population.mjs stores/squeal/store.sqlite stores/squeal/code.sqlite <squeal>/squeal.config.json pop-squeal.json
nice -n 10 node $P/population.mjs stores/cezar/store.sqlite stores/cezar/code.sqlite cezar-config.json pop-cezar.json
```

`cezar-config.json` is `git -C ~/projects/cezar show HEAD:squeal.config.json` (cezar `cc34d00d6`). The `since` values are the first coverage record of each store. Chain replay: 10 to 25 s; population replay: 1 to 3 min, at nice 10. Clean up: `rm -rf $TMPDIR/stores $TMPDIR/out-* $TMPDIR/pop-*`.

## Known limits

- Chain replay: only worktrees whose revisions are still stored (squeal 19, cezar 12 since coverage began); 4,355 and 1,127 run pairs. Most pairs have a gap (pruned revisions of destroyed worktrees).
- Population replay: one record and one closure per test file, the newest of each, applied to every stored revision, as `edit-reach.md` did. The two can come from different branches (the store is shared): 82 squeal test files have a newest record that loads `src/cli/wait/status.ts`, a file of another branch. This is most of "S1 adds".
- Without a stored import walk (node:test, older keys) the import part is the flat closure's module paths less declared globs.
- Seconds are medians recorded on this loaded host; shares are robust to that, absolute seconds read high.
