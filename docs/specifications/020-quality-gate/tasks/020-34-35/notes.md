# 020-34 and 020-35 worker notes (2026-11-12)

What the slice built for #194's two gate gaps, the choices the spec left
open, and what a next worker needs. Brief: `../wave-13.md`, "020-34 and
020-35". Research: `../../research/issue-194-gaps.md` (Q1, Q2, G1 to G7).

## Flow after the change

1. `loadBasePolicy` (`src/core/code/gate/policy.ts`, edited by agreement
   with the coordinator, 2026-11-12) keeps the base's top-level `inputs` as
   the optional `BasePolicy.inputs`, absent when the base declares none.
2. `codeGateCommand` passes it to the collector as `CollectOptions.inputs`
   (`fromBase` in `src/cli/code-gate.ts`, which also carries `children`
   and `prepares`; the helper keeps `gate` at CC 19).
3. `select` (`src/core/code/gate/collect.ts`) builds
   `createDeclaredInputs(inputs, changed.paths)` once, the daemon's own
   rules (`src/core/keys/closure.ts`, read only), and adds every listed
   test file whose `for(path)` is not empty. The files nothing else chose
   (not `affected()`, not a changed test file, not `--test`) are the
   pick's `byInputs`. The scope split (D14.2) runs after, so a file of a
   left-out group is not run and not named.
4. `summarize` (`prerun.ts`) gives each runner's `byInputs`: the in-scope
   selected files that only inputs chose, by path; absent when none.
   `runnerLine` (`src/cli/code-gate-prerun.ts`) appends
   `; N by declared inputs at the base, not by imports: a, b, c and M more`.
5. 020-34: `tellSelection` no longer treats every path as excluded with
   `coverage.children`. `summarize` computes `unloaded` as without
   children; then `withChildren` moves them to the new `childMayLoad` when
   some runner has a selected in-scope file (`files > 0`, run or read).
   With none, `unloaded` stays and today's line prints. `preRunText`
   prints `childMayLoadLine` for each `childMayLoad` path.

## Decisions the spec did not settle

- **Changed paths matched, not the worktree's files.** The daemon builds
  `createDeclaredInputs` over every file it knows; the gate builds it over
  `changed.paths` (after path narrowing, removed paths included). A test
  file is selected when one of its declared inputs is a changed path. Same
  rule, smaller file set.
- **"Chosen this way" = chosen only by inputs.** A file that `affected()`,
  the changed-test rule or `--test` also chose is not named in the line.
  The list form names the files the imports did not choose (all of them
  but the importers), up to three by path, then a count.
- **"No selected file runs" counts the files read from the stores or the
  parts as running.** A stored or parts record can hold a child's
  coverage, so with any in-scope selected file (`RunnerSelection.files >
  0`) the weaker line prints. Only with no in-scope selected file at all
  does today's line print. A left-out file does not count.
- **Declared inputs do not count as loading a path for the hint.** With
  children off, a path only a declared test reaches still gets today's
  line (no static closure loads it, and its child is not measured). With
  children on, it gets the weaker line, which fits: the declared test's
  child is what may load it.
- **Weaker line wording** (`src/cli/code-gate-prerun.ts`,
  `childMayLoadLine`): `no selected test file imports <path>. With
  coverage.children, it is measured only if a process one of them starts
  loads it; else its N changed functions will read incomplete
  (no-loader). To select a test that starts it, give the test with --test
  or declare the path for it in inputs at the base; to skip its coverage,
  name it in coverage.exclude at the base.`
- **`QUALITY_POLICY_VERSION` stays 4.** No state rule of D5, D6 or D8
  changed: selection (D3.1) only adds evidence, which the same rules
  judge, and the hint is text. A wrong declaration's extra run can fail
  and block (D5.5), as any selected test's failure always could.
- **No D7 report field** for the files inputs chose. The brief asks for
  the selection line only.

## Type changes (all additive, all optional)

- `BasePolicy.inputs?: PolicyInputs` (`policy.ts`).
- `CollectOptions.inputs?: PolicyInputs` (`collect.ts`).
- `Picked.byInputs?: readonly TestFileRef[]` (`prerun.ts`).
- `RunnerSelection.byInputs?: readonly RelativePath[]` (`prerun.ts`).
- `SelectionSummary.childMayLoad?: readonly RelativePath[]`
  (`prerun.ts`). `SelectionSummary.unloaded` keeps its type; its doc now
  says that with children it holds paths only when no selected file runs
  or is read.

## Key validity (the coordinator asked)

The base policy read is not on the key path. `loadBasePolicy` is called
only by `src/cli/code-gate.ts` (and gate tests). The gate's stored lookup
and keeper key files with the worktree's own policy, as its daemon reads
it (`stored.ts:49`: "its keys take the head's `inputs`"), through
`src/core/scheduler/keying.ts`. So the base `inputs` only select; no key,
no `KEY_FORMAT_VERSION` and no validity case changes.

## Tests

- `test/code/gate/collect-inputs.test.ts` (fake adapters, fast): map form,
  list form, a file the imports also chose is not named, no declaration or
  another glob selects nothing, the scope still leaves a declared file out;
  with children: no-run keeps `unloaded`, some-run gives `childMayLoad`,
  a declared test plus children, nothing told when every path loads.
- `test/cli/code-gate-inputs.test.ts` (real node:test, two entries, a
  `prepare`, children on, as G4): the map form selects
  `test/e2e/release.test.mjs`, `publish` passes from the child's record,
  exit 0; a wrong declaration runs `test/unit/ok.test.mjs` and leaves
  `publish` `no-loader`, exit 3.
- `test/cli/code-gate-children.test.ts`: the some-run case now pins the
  weaker line (it pinned an empty hint, 020-15b); a new no-run case pins
  today's line with children on (G2's shape on Vitest).
- `test/code/gate/policy.test.ts`: the base's `inputs` of both forms, and
  not a branch's.
- `test/version-sensitive.txt` (shared list): `code-gate-inputs.test.ts`
  is an entry (real `node --test`); `code-gate-children.test.ts` is
  exempted in the header, since it runs Vitest only and is flagged only
  because the expected hint text names a `nodeTest` entry.

## For a next worker

- `collect.ts` is at about 297 lines. A next change to selection should
  move `select` and `byPath` into their own file first.
- The node:test adapter's "loaded nothing beyond themselves ... declare it
  in inputs" note (`src/runners/node-test/adapter-project.ts`) now leads
  somewhere in the gate too. Its text was not changed (not this row's
  files).
- Row 020-36 (node:test child reads in the daemon) is separate; with it,
  the daemon keys the child's script for node:test, and the gate's
  selection by inputs stays the deterministic route for CI.
