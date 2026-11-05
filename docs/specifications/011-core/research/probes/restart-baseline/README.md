# Probes for 011-298: why a restarted daemon re-runs what its predecessor stored

Throwaway. Written for `research/restart-baseline.md`, 2026-11-05. Nothing here is product code, and nothing here is maintained.

## Rules these probes keep

- A store is read only from a copy: `store.sqlite` with its `-wal` and `-shm`, copied with `cp` under `$TMPDIR/rb/stores/`. No live store, daemon socket or permit pool is opened. Run logs (`report.json`) are read in place, read only.
- Fixture runs happen only in a fresh repository under `$TMPDIR/rb/x/fx` (and its own `git worktree`, `fxb`), through `env.sh`: `env -i` with `HOME`, `XDG_*` (`XDG_RUNTIME_DIR` too, so sockets and the permit pool are private), `TMPDIR` and package-manager homes under `$TMPDIR/rb/x`. 4 host slots (`capacity.hostSlots`), nice 10. Squeal is this worktree's committed `plugins/claude-code/dist/cli/squeal.mjs` (0.1.405). `node_modules` is a symlink to an installed squeal checkout; nothing installs.
- No test runs in a cezar or squeal worktree, no `squeal run --all`, no script under `evals/bin/` or `tasks/*/probe/`.

## Files

| File | What it gives | Question |
|---|---|---|
| `classify.cjs <store copy> <from> <to>` | one JSON line per file a restart baseline listed: whether it ran, its recorded seconds, the key and commit the restart stored, and the worktree's newest earlier run of the file with what it left in `results` | 1 |
| `causes.cjs <store copy> <classify output>` | the miss class of each file run, with seconds, files and baselines; the split by project; the merged classes of the report's table | 1 |
| `predecessors.cjs <store copy> <classify output>` | for class 1: the predecessor's life, its baseline's end state, whether it ran anything, the gap from its last run to the restart | 1, 3 |
| `exits.cjs <store copy> <classify output>` | the predecessor's "daemon stopped" note, where the worktree's last 20 notes still hold it | 1, 3 |
| `verdicts.cjs <store copy> <classify output>` | restart-baseline file runs that stored a FAIL | 3 |
| `same-closure.cjs <store copy> [project]` | live worktrees whose closure files hash the same but whose stored key differs (exploratory; lockfiles differ between worktree ages, so it is not used in the report) | 1 |
| `agg.cjs <classify output> [detail]` | the first, coarser split (own run, key moved, no own run) | 1 |
| `env.sh` | the isolated environment; `NODE_BIN` picks the Node that starts the daemon | 2 |
| `fixture.sh` | the fixture repository: 8 Vitest files of about 1 s, two importing `child_process`, `baseline.onStart: "lookup-then-run-missing"` | 2 |
| `cycle.sh <label>` | one daemon life: `squeal start`, wait until no file runs or waits (two quiet polls), `squeal stop`; then `fx-count.cjs` on a store copy | 2 |
| `fx-count.cjs <store copy>` | every baseline checkpoint: files listed, files its runs held, end state; each worktree's current keys | 2 |
| `observed-fixture.sh` | E8: `test/r.test.ts`, whose `src/r.ts` reads `data/extra.json` only when an untracked `flag` exists, and the worktree `fxb` | 2 |

## Fixture results (2026-11-05, 22:09Z to 22:20Z, load1 20 to 37)

| Run | Change before the start | Listed, ran |
|---|---|---|
| E0 first and second | none; the first `cycle.sh` stopped mid-baseline (its wait ended early), the second re-ran all 8 | 8, 8 then 8, 8 |
| E0 unchanged, twice | none | 0, 0 and 0, 0 |
| E1 | `git commit --allow-empty` | 0, 0 |
| E2 | `touch` of every source and test file | 0, 0 |
| E3 | daemon on Node 22.19.0 (stopped before a run: the old wait ended early), 24.22.1, 22.19.0 (stopped early again), 22.19.0 (full baseline), 24.22.1, 22.19.0, 24.21.0 | 8, 0; 0, 0; 8, 0; 8, 8; 0, 0; 0, 0; 8, 8 |
| E8 step 1, 2 | `r.test.ts` added and committed; worktree `fxb` added | A: 1, 2 (first run stored nothing); B: 0, 0 |
| E8 step 3 | `flag` created in A only | A: 1, 1 (the run read `data/extra.json`; observed set now `["data/extra.json","flag"]`) |
| E8 step 4 | nothing in B | B: 1, 1 |
| E9 | `src/a.ts` edited and committed with `lookup-only`, then `lookup-then-run-missing` | 1, 0 (abandoned); 1, 1 |

## Re-running

```sh
P=<this folder>; SQ=<squeal checkout with node_modules>; export X=$TMPDIR/rb/x SQ
mkdir -p $TMPDIR/rb/stores/cezar $TMPDIR/rb/out && cp ~/projects/cezar/.git/squeal/store.sqlite* $TMPDIR/rb/stores/cezar/
cd $TMPDIR/rb; S=stores/cezar/store.sqlite
nice -n 10 node $P/classify.cjs $S 2026-11-02T16:50:00Z 2026-11-05T16:50:00Z > out/cls.jsonl   # about 12 s
nice -n 10 node $P/causes.cjs $S out/cls.jsonl
nice -n 10 node $P/predecessors.cjs $S out/cls.jsonl
nice -n 10 node $P/exits.cjs $S out/cls.jsonl
nice -n 10 node $P/verdicts.cjs $S out/cls.jsonl
# fixture
$P/env.sh env X=$X SQ=$SQ sh $P/fixture.sh
$P/cycle.sh E0-first; $P/cycle.sh E0-unchanged
$P/env.sh git -C $X/fx commit -q --allow-empty -m empty; $P/cycle.sh E1
(cd $X/fx && find src test vitest.config.ts -type f -exec touch {} +); $P/cycle.sh E2
NODE_BIN=~/.nvm/versions/node/v22.19.0/bin $P/cycle.sh E3-node22; $P/cycle.sh E3-node24
$P/env.sh env X=$X sh $P/observed-fixture.sh; $P/cycle.sh E8-1; FX=$X/fxb $P/cycle.sh E8-2
echo 1 > $X/fx/flag; $P/cycle.sh E8-3; FX=$X/fxb $P/cycle.sh E8-4
```

`cycle.sh` runs every Squeal command at nice 10 and stops its daemon before it returns. Clean up: `pgrep -af "$X"` must list nothing, then `rm -rf $TMPDIR/rb`. Done on 2026-11-05: the store copy, outputs and fixture are removed.
