# Probes for research/function-selection.md

Throwaway. Written 2026-11-21 for `../../function-selection.md` (row 022-07). Nothing here is product code or maintained.

## Rules these probes keep

- Stores are read only from copies made with `VACUUM INTO` through a read-only `node:sqlite` connection, into `$TMPDIR/stores/<repo>/` (squeal and cezar main checkouts, taken 2026-11-21 19:44Z to 19:47Z). Cezar's git objects were read from an `rsync` copy of its `.git` (without `.git/squeal`) in `$TMPDIR/cezar.git`; its HEAD was `c11e4edf0`. No live store, daemon socket or `squeal` command was used.
- No test suite of either repository ran. The replays use recorded durations. Fixture runs stayed under `$TMPDIR`, one Vitest instance at a time, one worker, each under `timeout`.
- Parser: TypeScript 6.0.3's classic API from this repository's pnpm store (`node_modules/.pnpm/typescript@6.0.3`); the installed `typescript` 7.0.2 has no parser API.

## Files

| File | What it does |
|---|---|
| `structure.mjs` | Rule A's comparison of one changed file: tokens without trivia; the module skeleton (every function body replaced); each function with a body by qualified name and its own body tokens (nested bodies replaced); which functions the record shows entered (`entered`); `judge(path, old, new, recordSource)` gives the verdicts `entered`, `unmapped`, `skeleton`, `parse` and the changed functions |
| `lib.mjs` | Store copy reader: coverage records (manifest and parts, `src/core/code/coverage/parts.ts`), git blobs through `git cat-file --batch`, median |
| `replay.mjs`, `summarize.mjs` | Chain replay: each test file's consecutive runs in one worktree whose key changed, every revision between stored; rule A against the record of the previous run's key. Mostly spans across commits (51,057 of 51,173 pairs on Squeal) |
| `population.mjs`, `popsum.mjs` | Per edit revision (Q1): every `watch` revision without a HEAD move in the coverage window × every test file whose known closure holds a changed path. Strict condition 1: the test file's latest own result in that worktree before the revision, with a record. Relaxed condition 1 (when strict fails): the newest record of the file before the revision, any worktree, whose blobs equal the old contents on every changed path it holds. `POP_COMMITS=<file>` replays commits instead |
| `commits.mjs` | First-parent commits of a branch in a window, as edits for `population.mjs` |
| `ruleb.mjs` | Q5: recorded new failures (a failed test or file after a passing run in the same worktree), rule B's set and an emulation of `editWork` (`src/core/scheduler/edit-cut.ts`, tier size 4, `namesakesOf` imported from the product) |
| `fixtures-cases.mjs`, `fixtures.mjs` | Q2 and Q4: 33 fixture cases with real Vitest 5.0.3, Squeal's `provider.mjs`, `sourceEntry` (`record.ts`) and `recorder.cjs`. Each edit is judged before it is written; the test file then runs anyway as the oracle. `FSEL_STEPWISE=1` judges each edit against the previous edit's bytes instead of the record's |
| `rulebsum.mjs` | Totals of `ruleb.mjs` output per failing file and per edit |
| `pathverdicts.mjs` | Per (edit, changed path, test file): the structural verdict counts (`results/path-verdicts.txt`) |
| `scan.mjs` | Q3 (a), (b): text scan of test files, snapshots and sources |
| `tostring/probe.mjs`, `tostring/subject.mjs` | Q3 (a): a `Function.prototype.toString` wrapper beside an inspector coverage session: what it sees, how it locates functions, its cost |
| `stability.mjs` | Q3 (c): records of one test file with byte-identical sources, compared by entered functions; a sample of 300 test files |
| `cost.mjs` | Q6: structure and comparison time per file of `src/` |
| `results/` | The outputs the findings quote |

## Re-running

```sh
P=<this directory>; W=<repository root>; cd $TMPDIR
# store copies: node -e 'new (require("node:sqlite").DatabaseSync)(SRC,{readOnly:true}).exec("VACUUM INTO \x27DST\x27")'
# since: the first coverage record of each store copy (squeal 1794439952000, cezar 1794213271000)
nice -n 10 node --max-old-space-size=12000 $P/population.mjs stores/squeal/store.sqlite stores/squeal/code.sqlite ~/projects/squeal/.git 1794439952000 $W/squeal.config.json pop-squeal.json
nice -n 10 node --max-old-space-size=12000 $P/population.mjs stores/cezar/store.sqlite stores/cezar/code.sqlite cezar.git 1794213271000 cezar-config.json pop-cezar.json
node $P/popsum.mjs pop-squeal.json > popsum-squeal.json   # and cezar
node $P/commits.mjs ~/projects/squeal/.git origin/main 2026-11-12T00:00:00Z 2026-11-21T00:30:00Z commits-squeal.json
node $P/commits.mjs cezar.git HEAD 2026-11-09T09:00:00Z 2026-11-20T23:30:00Z commits-cezar.json
POP_COMMITS=commits-squeal.json node ... $P/population.mjs ... popc-squeal.json   # and cezar
RULEB_ALL=1 node --import $W/node_modules/tsx/dist/esm/index.mjs $P/ruleb.mjs <store> <code> <git-dir> <since> <config> ruleb-<repo>.json
timeout 900 node --import $W/node_modules/tsx/dist/esm/index.mjs $P/fixtures.mjs fixtures.json
SETUP_PATHS=scripts/test-sandbox.mjs node $P/stability.mjs stores/cezar/store.sqlite stores/cezar/code.sqlite 300 7 stab-cezar.json
node $P/cost.mjs $W
node $P/scan.mjs $W '^(test|src)/(?!fixtures/|e2e/).*\.test\.(ts|tsx|mts|mjs)$' '^src/.*\.(ts|tsx|mts|mjs|cjs|js)$'
```

`cezar-config.json` is `git --git-dir=cezar.git show HEAD:squeal.config.json`. Population replays take 40 s to 4 min at nice 10; the relaxed search decodes up to 30 records per pair. Clean up: `rm -rf $TMPDIR/stores $TMPDIR/cezar.git $TMPDIR/cezar-src $TMPDIR/*.json`.

## Known limits

- The known closure is the newest stored one per test file (import walk, environment walk, flat closure, observed sets, declared inputs, listings), not the closure at each revision. A path it misses drops out of a pair; a pair whose key moved through a path outside it is not counted.
- Strict condition 1 sees only results a worktree recorded itself. A worktree that reused another worktree's result at an equal key has no row, so cezar's strict funnel loses 92% of pairs at condition 1. The relaxed reading checks bytes only on the changed paths, not the whole key.
- Squeal's `coverage.exclude` holds `test/**`: its records never hold a test helper, so every helper edit fails condition 2 as "script not loaded".
- `entered` maps record spans to parsed functions by start line and end line. A record entry that maps to two functions counts as entered for both (a class field initializer and its arrow field share a span).
- Seconds are medians of recorded file durations on this loaded host; shares are robust to that.
