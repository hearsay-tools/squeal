# Probes for research/edit-reach.md

Throwaway. Written 2026-11-07 for `../../edit-reach.md`. Nothing here is product code or maintained.

## Rules these probes keep

- Read only. Repositories are `git clone`s under `/tmp/er015` at a named commit (cezar `d6fed8685`, squeal `bc58ad12f`); `~/projects/cezar` is never edited.
- Stores are read only from copies taken with their `-wal` and `-shm` (`store.sqlite`, and squeal's `code.sqlite`), opened with `node:sqlite` `readOnly`. Run reports are copied (`report.json` only) before reading. No live store or daemon socket is opened.
- No test, build or benchmark runs. The probes transform source files with esbuild in memory (no output written) and read stored durations.
- `squeal stop --until-start` ran in the researcher's own worktree first.

## Files

| File | What it does |
|---|---|
| `reach.mjs <spec.json> <out.json>` | Per source file: test files an edit re-keys (stored closure plus the project's setup and config closure), their recorded seconds (median `fileDurations`), and the path kind of each pair; real edits from watch revisions; with `code` in the spec, each pair's coverage (called / loaded only / not loaded); the "cut" of the 40 busiest gateway files. Prints a summary |
| `paths.mjs <out.json> <target>...` | How automatic test files reach a target by value imports: grouped by the test file's own first import, with one shortest chain each |
| `cut.mjs <out.json> "A>B,C>*"...` | What-if: remove import edges and count the pair-seconds that no longer hold, every source once and by real edits |
| `table.mjs <out.json> [n]` | The Markdown tables: top n by reach, top 12 by real edits × reach, spread |
| `spec-cezar.json`, `spec-squeal.json` | The inputs used (setup and config files per Vitest project, aliases, the manual group, the helper pattern) |
| `tables-*.md`, `summary-*.json` | The outputs used in the report (the summaries leave out the graph and per-file rows) |

## Re-running

```sh
S=/tmp/er015; mkdir -p $S/stores/{cezar,squeal}
for p in cezar squeal; do C=$(git -C ~/projects/$p rev-parse --path-format=absolute --git-common-dir)/squeal
  cp $C/store.sqlite* $S/stores/$p/; mkdir -p $S/runs-$p
  (cd $C/runs && find . -maxdepth 2 -name report.json -print0 | tar cf - --null -T -) | tar xf - -C $S/runs-$p; done
cp ~/projects/squeal/.git/squeal/code.sqlite* $S/stores/squeal/
git clone -q ~/projects/cezar $S/cezar && git -C $S/cezar checkout -q d6fed8685
git clone -q ~/projects/squeal $S/squeal && git -C $S/squeal checkout -q bc58ad12f
# point "modules" in each spec at a node_modules with esbuild and es-module-lexer (a squeal checkout's)
node reach.mjs spec-cezar.json $S/out-cezar.json; node reach.mjs spec-squeal.json $S/out-squeal.json
node table.mjs $S/out-cezar.json; node paths.mjs $S/out-cezar.json packages/cezar/src/workflows/run.ts
node cut.mjs $S/out-cezar.json "packages/cezar/src/core/runner-factory.ts>*"
```

Each `reach.mjs` run took 20 to 60 s at nice 10. Clean up: `rm -rf /tmp/er015`.

## Known limits

- The value graph is emulated: esbuild's TS transform with `verbatimModuleSyntax` where the package sets it, imports read with es-module-lexer, and relative, `@/` and workspace-package specifiers resolved. Squeal uses Vite's own transform graph. Squeal's coverage agrees for value pairs (86 to 96% loaded) and for the others (0% loaded).
- A pair gets one kind, the strongest; a helper or barrel kind means no path without one exists.
- `cut.mjs` counts value pairs only, and an edge removal can only lower reach; it does not check that the code still works.
