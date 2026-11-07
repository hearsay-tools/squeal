# Probes for research/edit-relevance.md

Throwaway. Written 2026-11-07 for `../../edit-relevance.md`. Nothing here is product code or maintained.

## Rules these probes keep

- Read only. Store copies (`store.sqlite` and `code.sqlite`, each with `-wal` and `-shm`) and `report.json` copies were taken at 2026-11-07 13:25Z into the task's scratch folder and opened with `node:sqlite` `readOnly`. No live store or daemon socket was opened.
- Clones at named commits for the static import graph: squeal `31e9dd7bd`, cezar `84e1fd9c9` (both main at the copy).
- Blobs are read with `git cat-file` from each repository's common `.git`, one at a time, at nice 10. Nothing is written to a repository.
- No test, build or benchmark ran. `squeal stop --until-start` ran in the researcher's worktree first.

## Files

| File | What it does |
|---|---|
| `graph.mjs` | The static value-import graph of a clone (esbuild TS transform, es-module-lexer, relative, alias and workspace specifiers), as 015's `probes/edit-reach/reach.mjs` builds it. Fix against that copy: the installed lexer reports `specifier`, `importStart`, `importEnd`, `type`, so the fields are mapped |
| `order.mjs <spec> <out>` | Q1 and Q2. Replays each agent edit under five run orders (T today, A Change 1 as stated, B today's cut then catch-up by coverage, C a capped A, P today's cut then catch-up by import kind) and places each new failure the store recorded |
| `summary.mjs <out>` | Q1 and Q2 numbers from `order.mjs` output: work ahead per order, edit-work sizes, coverage classes, proxy precision and recall |
| `failures.mjs <out>` | Every new failure by revision, with its class and work ahead under each order |
| `strip.mjs <spec> <out>` | Q3. Transforms the old and new blob of each changed TypeScript path with Vite 8.3.2's `transformWithOxc` and esbuild 0.28.2; counts equal output and the seconds a stripped-output key would keep |
| `spec-*.json` | Inputs. `-any`: every revision, a file without a record at the revision takes its first later record. Plain: only revisions after the first coverage record, records at or before the revision. `-strip`: for `strip.mjs` |
| `summary-*.json`, `strip-summary-*.json`, `failures-*.txt` | The outputs the report uses |

## Re-running

```sh
S=<scratch>; mkdir -p $S/stores/{cezar,squeal}
for p in cezar squeal; do C=$(git -C ~/projects/$p rev-parse --path-format=absolute --git-common-dir)/squeal
  cp $C/store.sqlite* $C/code.sqlite* $S/stores/$p/; mkdir -p $S/runs-$p
  (cd $C/runs && find . -maxdepth 2 -name report.json -print0 | tar cf - --null -T -) | tar xf - -C $S/runs-$p; done
git clone -q ~/projects/squeal $S/squeal && git -C $S/squeal checkout -q 31e9dd7bd
git clone -q ~/projects/cezar $S/cezar && git -C $S/cezar checkout -q 84e1fd9c9
# edit the paths in spec-*.json, then:
for f in squeal-any squeal cezar-any cezar; do nice -n 10 node --max-old-space-size=8192 order.mjs spec-$f.json $S/order-$f.json; node summary.mjs $S/order-$f.json > summary-$f.json; done
for p in squeal cezar; do nice -n 10 node strip.mjs spec-$p-strip.json $S/strip-$p.json > strip-summary-$p.json; node failures.mjs $S/order-$p-any.json > failures-$p.txt; done
```

Each run took 15 to 50 s. Clean up: delete the scratch folder.

## Known limits

- Closures are the warm closures at the copy, not the closure at each revision (as in 011-143 and 011-149).
- The cut is emulated from `editWork` with the static graph standing in for the runner's `affected`; the failing class of the queue is left out (it ranks the same in every order).
- Work ahead is recorded seconds of one queue run in order. Wall time is shorter by the number of parallel workers, and catch-up also waits for the 20 s quiet.
- A failure is a transition to FAIL (not FAIL to FAIL) in the edit's worktree before the next revision that changes a path the file holds, within 2 hours. Flakes are not removed.
