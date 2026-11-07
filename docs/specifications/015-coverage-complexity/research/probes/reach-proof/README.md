# Probes for row 015-114: `squeal reach` on squeal and cezar

Throwaway. Written 2026-11-07 for `lessons.md` "Edit reach, round 1". Nothing here is product code or maintained.

## Rules these probes keep

- The real stores, `~/projects/squeal` and `~/projects/cezar` are only read. The stores were copied with their `-wal` and `-shm` files. Every write went to a copy inside a scratch clone under `/tmp/r114`.
- No daemon ran in a real checkout. Each scratch daemon is the candidate's (0.1.415, `f70cedb92`), pinned at `/tmp/r114/cand`, and runs at nice 10 under `baseline.onStart: lookup-only`. No test ran: each clone's store has 0 runs and 0 results of its own worktree (`runs.mjs`).
- Two scripts edit a store copy, and only a copy: `drop-closures.mjs` deletes `test_files` so the daemon walks every closure, and `strip-backslash.mjs` removes the backslash paths of issue #166 from the `observed.` maps. The coordinator approved the second.

## Files

| File | What it does |
|---|---|
| `qc.mjs <db>...` | `PRAGMA quick_check` of each copy |
| `commits.mjs <store> [days]` | Commits ranked by the test files with a clean stored result: how the clone commits were chosen |
| `edges.mjs <store>` | Rows of the three 015-108 tables, the scratch worktree, its own closures and keys |
| `drop-closures.mjs <store copy>` | Deletes every `test_files` row, so the next daemon start walks every closure (phase B) |
| `backslash.mjs <store>` | The `observed.` entries with backslashes, and the daemon exits they caused (issue #166) |
| `strip-backslash.mjs <store copy>` | Removes those paths from the copy |
| `norecord.mjs <store> <code> <root>` | The listed test files with no coverage record at their current key, with seconds |
| `runs.mjs <store> <root>` | Runs, results and revisions of the scratch worktree: proof that no test ran |
| `aggregate.mjs <reach.json> [<regex>] [--block <store> <root file>]` | Pools a `--json` answer into the research's pair-seconds, by path kind and coverage, every source once and by real edits; `--block` keeps the files a root file reaches by stored edges |
| `lookup.mjs <reach.json> <path or /regex/>...` | Rank, edit-cost rank, coverage, kinds, gateway and suggestion of named files |
| `suggestions.mjs <reach.json> <root> [n]` | Counts defects 3, 4 and 5 of the lessons in the first n entries |
| `unrecorded.mjs <store> <root>` | Walked files with no stored edges at their bytes: the cause of `path not recorded yet` after a full walk |
| `report-*.txt` | The text answers: `squeal-A`, `cezar-A` (store as copied), `squeal-B`, `cezar-B` (every closure walked), `cezar-off` (coverage off), `cezar-named` (5 named paths; the 6,479 test-file lines are filtered out) |
| `summary-*.json` | The `--json` answers' top-level fields, proposals and first 30 entries of each part (the full answers are 0.4 to 3.3 MB) |

## Re-running

```sh
R=/tmp/r114; S=$R/cand/claude-code/dist/cli/squeal.mjs; mkdir -p $R/out
mkdir -p $R/stores/{squeal,cezar}
for p in squeal cezar; do C=$(git -C ~/projects/$p rev-parse --path-format=absolute --git-common-dir)/squeal
  for f in store code lint; do [ -f $C/$f.sqlite ] && cp $C/$f.sqlite* $R/stores/$p/; done; cp $C/repository-id $R/stores/$p/; done
node qc.mjs $R/stores/*/store.sqlite $R/stores/*/code.sqlite
git clone -q --no-checkout ~/projects/squeal $R/squeal && git -C $R/squeal checkout -q --detach e36b8d509
git clone -q --no-checkout ~/projects/cezar $R/cezar && git -C $R/cezar checkout -q --detach 5f7c94cf3
for p in squeal cezar; do (cd $R/$p && pnpm install --frozen-lockfile --offline)
  mkdir -p $R/$p/.git/squeal && cp $R/stores/$p/* $R/$p/.git/squeal/; done
node strip-backslash.mjs $R/cezar/.git/squeal/store.sqlite   # issue #166
# phase A: start, wait, report; then phase B:
for p in squeal cezar; do node $S stop $R/$p; node drop-closures.mjs $R/$p/.git/squeal/store.sqlite
  (cd $R/$p && SQUEAL_CLI=$S nice -n 10 node $S start $R/$p && node $S status --wait 900000 && node $S reach --json > $R/out/$p-B.json); done
node $S stop $R/squeal; node $S stop $R/cezar
```

The coverage-off clone is a third clone of cezar at the same commit with `"coverage": { "enabled": false }` in its `squeal.config.json`, a fresh copy of the cezar store, and the same two copy edits.

**On a repaired build (B1 to B3).** Pin the repaired plugin at `$R/cand2` and point `S` at it. Run `drop-closures.mjs` on each clone's store again, because a B2 repair can change the stored edges. Start each daemon, wait, then read the setup and config cases: `squeal reach vitest.config.ts .github/scripts/ci-test-sequencer.mjs packages/cezar/vitest.setup.ts packages/contract/src/waits.ts` in cezar, and `squeal reach vitest.config.ts test/global-teardown.ts test/daemon/strays.ts` in squeal. Stop each daemon with `node $S stop <root>` when done. Clean up: `rm -rf /tmp/r114`.

## Known limits

- The `/tmp/r114` copies are of 15:03Z. Edits after that time are not in the window.
- Real edits in `aggregate.mjs` weight a group by its summed `editSeconds`, with the group's pooled kind and coverage shares.
- `unrecorded.mjs` reads bytes by stored hash without the stat check. That is valid only while the clone is unchanged since its daemon hashed it.
