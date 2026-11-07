# Probes for research/edit-reach-refactor.md

Throwaway. Written 2026-11-07 for `../../edit-reach-refactor.md` (row 015-112). Nothing here is product code or maintained.

## Rules these probes keep

The rules of `../edit-reach/README.md`. Read only; checkouts are `git clone`s under `/tmp/er112` at a named commit. The store is read only from copies with their `-wal` and `-shm` (`store.sqlite`, `code.sqlite`), and the copies of the run reports hold `report.json` only. No test, build or benchmark runs. Every run is at nice 10.

## Files

| File | What it does |
|---|---|
| `reach.mjs <spec.json> <out.json>` | A copy of `../edit-reach/reach.mjs` with `mode`, `compare` and `base` added. `mode: "static"`: a test file's import part is the emulated value graph of the checkout, with only observed reads (`meta observed.`), child-process imports (`observedModules.`) and declared inputs from the store and policy. `compare: true` also computes the stored-closure reach and prints the pair-seconds that only one method holds. `base: <commit>`: the coverage of a source file the base commit lacks counts as "no record", not "not loaded" |
| `compare.mjs <before.json> <after.json>` | Before and after tables: pair-seconds, called pair-seconds and the called share, every source once and by real edits, by path kind, over all sources and over the sources both commits hold |
| `spec-main.json` | Phase 1 inputs: origin/main `6db9fcb7b`, static mode, compare on, `test/e2e/**` as not run on edit |
| `summary-main.json` | The phase 1 output without the graph and per-file rows |
| `rows-main.json` | The phase 1 per-source rows (seconds, edits, kinds, coverage), so phase 2 can compare without a re-run |
| `spec-cand.json`, `summary-cand.json`, `rows-cand.json` | The same for phase 2: the candidate `963aff844` (`cand/0.1.414`), `base` `6db9fcb7b`, compare off |
| `compare-main-cand.md` | The output of `compare.mjs` for main against the candidate |
| `removed.mjs`, `added.mjs` | Value pairs main holds and the candidate does not, by their kind at main; and the other way round. Both read the two `reach.mjs` outputs (absolute paths under `/tmp/er112`) |
| `lostcalled.mjs` | Called pairs at main whose import path the candidate lost, with the functions that ran (from the store's coverage records) |
| `observed-bound.mjs` | The bound on the observed-read carry-over: observed reads of files that leave the bundle entries' value closure at the candidate |

## Re-running

```sh
S=/tmp/er112; C=~/projects/squeal/.git/squeal; mkdir -p $S/stores $S/runs
cp $C/store.sqlite* $C/code.sqlite* $S/stores/
(cd $C/runs && find . -maxdepth 2 -name report.json -print0 | tar cf - --null -T -) | tar xf - -C $S/runs
git clone -q ~/projects/squeal $S/main && git -C $S/main checkout -q 6db9fcb7b
# "modules" in the spec points at a node_modules with esbuild and es-module-lexer
nice -n 10 node reach.mjs spec-main.json $S/out-main-static.json
# phase 2: a clone at the candidate SHA, a spec with "repo" there and "base": "6db9fcb7b", then
nice -n 10 node compare.mjs $S/out-main-static.json $S/out-cand-static.json
```

One `reach.mjs` run took 43 s (main) and 119 s (candidate) at nice 10. Clean up: `rm -rf /tmp/er112`.

## Known limits

The limits of `../edit-reach/README.md`, and these:

- The observed reads, child-process imports and coverage records were recorded at older commits, at the latest before 13:27Z on 2026-11-07. For the candidate they are carried over per test file and per (source, test file) pair.
- `compare.mjs` reads per-source rows rounded to whole seconds: 68 of 3,118,924 pair-seconds at main.
