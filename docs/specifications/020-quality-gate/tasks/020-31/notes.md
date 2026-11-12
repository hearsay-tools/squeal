# 020-31 worker notes (2026-11-12)

What the slice built for #193, the text the spec can take, and what a next
worker needs.

## Flow after the change

1. `createNodeTestAdapter` takes a new optional `closures` callback
   (`src/runners/node-test/adapter.ts`). When it is given, `openProject`
   (`adapter-project.ts`, `notes()`) gives it `graph.incompleteClosures()`,
   every test file with its reasons, at open and after each batch, and
   writes no closure note. When it is absent (the daemon, the store keyer's
   `daemonAdapters`), the note is as before.
2. `openRunners` (`src/core/code/gate/runners.ts`) passes a per-project
   callback; `collectEvidence` (`collect.ts`) keeps the latest list per
   project in a `Map`.
3. After `select`, the stored lookup and the D14.4 pre-run print
   (`tellSelection`), and before the D17.1 estimate, `tellClosures`
   (`select-closures.ts`) writes one line per project through the gate's
   note sink and returns the evidence's `incompleteClosures`.
4. `evaluate` copies `Evidence.incompleteClosures` into the report, after
   `runs`. The verdict and the exit code do not read it.

## For the spec (D7 and D14.4)

D7, a new optional field, after `runs`:

- `incompleteClosures`: per node:test project with at least one test file
  whose static closure is incomplete, by project name:
  `{ runner: "node-test", project, files }`. `files` holds every such file
  of the project, by path, selected or not: `{ path, reasons, selected }`.
  `reasons` are the graph's texts (`import() with a computed specifier at
  <file>:<line>:<column>`, `require() with a computed specifier at ...`,
  `<file> does not parse as a module: ...`, `` import(`<glob>`) in <file>
  has no static glob ``). `selected` is true when the selection chose the
  file and the scope runs it: this check ran it here or read its evidence
  from the stores or the parts. A file the scope leaves out (D14.2) reads
  `false`. The field is absent when no project has such a file, so such a
  report is byte for byte as before. `QUALITY_POLICY_VERSION` is unchanged.

D14.4, one more pre-run line, after the others and before the estimate:
per node:test project with such files, how many are in this check, the
first three of them by path ("and N more" after), what that means for the
others, and where the full list is. Example:

    squeal code: node-test project "unit": 4 of 5 test files with an incomplete static closure are in this check: test/unit/a.test.mjs, test/unit/b.test.mjs, test/unit/c.test.mjs and 1 more. The gate selects test files by their static imports, so the other one does not run for a changed path it loads only through a computed import() or require(). The --json report lists all 5 in incompleteClosures.

With none selected: "0 of 19 test files with an incomplete static
closure are in this check. ... the other 19 do not run ...". With every
file selected, the middle sentence is left out. In the gate, this line
replaces the adapter's own closure note, so each project has one closure
line and one module-hook note per run.

The hint of three node:test notes (module hooks, async loader, a run that
loaded nothing) is one text, `INPUTS_HINT` in
`src/runners/node-test/graph/preload-notes.ts`:

    declare it in the top-level "inputs" of squeal.config.json (a list of globs for every test file, or a map from a test-file glob to globs)

## Decisions the brief did not settle

- "In this check" is the selection the scope runs (`Picked.run`), stored
  and parts evidence included; a left-out file is not in it.
- The line names selected files only, without reasons; the reasons are in
  the JSON. The adapter's old note named the first three files of the
  project with reasons, selected or not.
- The `inputs` hint changed in all three node:test notes that said
  "declare it in inputs", not only the module-hook one, so they stay one
  text.
- `src/runners/pytest/adapter.ts` is unchanged: the gate opens only Vitest
  and node:test (`GATE_RUNNERS`), so pytest's closure note never reaches
  it. The daemon's pytest note keeps its text.
- Extra files, approved by the coordinator (request fe760be9):
  `adapter-project.ts`, `gate/runners.ts`, `gate/types.ts`,
  `gate/evaluate.ts`. `test/version-sensitive.txt` gained the new CLI test,
  which runs real `node --test`.
- The skill reference `commands.md` (the three identical copies under
  `plugins/claude-code`, `plugins/codex-runtime` and `plugins/pi`) names
  `incompleteClosures` in the JSON field list and gives the closure line a
  paragraph, agreed with the coordinator (request 5876dfce).
  `plugins/codex/seed` is an older copy, left alone.

## Type changes (all additive)

- `NodeTestAdapterOptions.closures?` (`src/runners/node-test/adapter.ts`).
- `GateAdapters.nodeTest` options `closures` and `openRunners`' `closures`
  (`src/core/code/gate/runners.ts`).
- `Evidence.incompleteClosures?` (`src/core/code/gate/types.ts`).
- `GateReport.incompleteClosures?` (`src/core/code/gate/report.ts`).
- New: `IncompleteClosure`, `ClosureGapFile`, `ClosureGaps`, `closureGaps`,
  `closureLine`, `tellClosures` (`src/core/code/gate/select-closures.ts`);
  `INPUTS_HINT` (`preload-notes.ts`).

## Found while testing

- Research open question Q5 is now seen in a run: a change to a path with
  no counted function (`src/extra.mjs`: `export const one = 2 - 1`) that
  only a computed `import()` loads selects no test and reads `pass`, exit
  0, with nothing run. A changed function there reads `incomplete`
  (`no-loader`), exit 3, as research case `dynamic-only` said. Input for
  row 020-33.
- A test file whose run loads what its static key lacks (here, through a
  computed `import()`) is never kept in the stores by the gate, so a
  second run runs it again; a plain file beside it is read from the stores.
  `test/cli/code-gate-closures.test.ts` relies on the plain file for its
  stored case. Not changed: `keep.ts` is row 021-20's.
- The Pi and OpenCode bundle tests (`test/harness/pi/package.test.ts`,
  `test/harness/opencode/package.test.ts`) fail until the bundles are
  built again; this row does not own them.

## Tests

- `test/code/gate/select-closures.test.ts`: the list, the line (none,
  one, more than three, all, a single file) and the one line per project.
- `test/runners/node-test/adapter.test.ts`: with `closures`, the adapter
  tells the list at open and after a batch and writes no closure note.
- `test/cli/code-gate-closures.test.ts`: two node:test projects whose
  preload imports `node:module`; `--json` with four of five gap files
  selected (more than three); plain with none selected; a changed function
  only a computed import loads (exit 3, as before); a second run that reads
  a file from the stores. Each run: one module-hook note and one closure
  line per project, stdout one JSON object.
- `adapter-loader.test.ts`, `adapter-attribution.test.ts`,
  `test/daemon/bare-note-inputs.test.ts`: the new hint.

## Checks run (2026-11-12, host load 24 to 78 on 24 CPUs)

- `pnpm run lint`, `pnpm run typecheck`: pass.
- Squeal at revision 25: the new and edited tests pass, 274 of the 438
  affected files current with no failure from this change. Five fail on
  drift only, because the bundles and the Codex runtime manifest are not
  built: `test/harness/pi/package.test.ts`,
  `test/harness/opencode/package.test.ts`,
  `test/harness/codex/packaging/runtime.test.ts` (two cases),
  `test/harness/codex/runtime-release/limits.test.ts` (the sha256 of
  `commands.md` in `runtime.json`). `pnpm run build` clears them.
- The daemon held no test slot for over 30 minutes, so seven queued gate
  tests ran directly: `pnpm exec vitest run --maxWorkers=2
  test/cli/code-gate.test.ts test/cli/code-gate-json-stdout.test.ts
  test/cli/code-gate-stored.test.ts test/code/gate/collect-prepare.test.ts
  test/cli/code-gate-prepare.test.ts test/code/gate/collect-budget.test.ts
  test/code/gate/collect-order.test.ts`: 7 files, 30 tests pass.
- About 160 affected files were still queued for CPU at the end, among
  them `code-gate-keep*.test.ts`, `code-gate-parts-*.test.ts` and
  `code-gate-args.test.ts`; none has a node:test fixture with a computed
  import, so none can see the new line or field. Not run.
