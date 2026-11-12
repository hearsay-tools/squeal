# Issue 194: the two gaps left open (row 020-33)

Researcher, 2026-11-12. Brief: "020-33" in `../tasks/wave-11.md`. Squeal **0.1.448** (this worktree's `plugins/claude-code/dist/cli/squeal.mjs`, source at `472a13730`). Node v26.13.0. One-minute load 19.27 at the start of the probe and 21.54 at its end, on 24 CPUs (limit: below 24). All evidence comes from the synthetic fixture of `probes/issue-194/`, run by `probes/issue-194/gaps.sh` (output `gaps.out.txt`). The original cezarion suite was not run.

## Answers

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Why is the D14.4 pre-run hint missing when a second node:test entry exists and no file is selected? | **`coverage.children: true` suppresses it, not the second entry.** `tellSelection` treats every path as excluded when the key is on, so `unloaded` is always empty. Two entries with children off print the hint (G1); one entry with children on prints none (G2). `issue-194.md` cases 6 and 9 had children on. The suppression was a deliberate implementation choice of row 020-15b (commit `a6a382c1d`), not stated in D14.4. | verified by experiment (0.1.448); read in source code (`472a13730`) |
| 2a | What evidence could name the test for an edit to a script that only a child process runs? | Four candidates. (1) Declared `inputs` (a test-glob map): the gate ignores them today (G4). (2) The daemon's observed reads: for node:test they do **not** hold a child's module loads (G6), and the daemon never opens an entry with `prepare` (D15.6). (3) Kept coverage records from earlier runs. (4) A static scan of test sources for the script path. Only (1) is deterministic, needs no store and works for #194's shape. | (1), (2) verified by experiment; (3), (4) inferred |
| 2b | What does it cost? | One run of each extra selected test file, plus its `prepare`. In the fixture, the selected run took 0.82 s wall against 0.49 s without it (G5 against G4). Matching `inputs` globs to changed paths is a glob test per test file, no I/O beyond the listing the gate already reads. | verified by experiment (fixture only); inferred for the matching cost |
| 2c | What does it risk? | No false pass from coverage: a test that does not run the script leaves its functions `no-loader`, and child coverage is a lower bound (D12.4). The risk is an outcome one: a pass while an unselected test that also starts the script fails, as `--test` risks today. A list-form `inputs` (every test file) would select every file on such an edit. | inferred from G4, G5 and D5, D12.4 |

## Findings

**Q1: the cause** (read in source code, `src/core/code/gate/prerun.ts:94-96` at `472a13730`):

```ts
// D12: with children, a path no closure holds may still be run and measured.
const looked = context.children === true ? () => true : excluded;
```

`summarize` then drops every candidate, so `unloadedPaths` gets none. The `SelectionSummary.unloaded` doc says "None with `coverage.children`: a process a test starts may run any path". The commit that added the line (`a6a382c1d`, row 020-15b) says "with coverage.children none does, since a child process may run it", and `test/cli/code-gate-children.test.ts:96` pins an empty hint. Spec D14.4 says only "each changed path that no runner can load". The rationale holds only when some selected file runs; in G2 and in `issue-194.md` case 6 **no** file runs, and the function still reads `no-loader`.

Verified by experiment (`gaps.out.txt`, 0.1.448), head edits only `publish()` in `scripts/release.mjs`:

| Case | nodeTest entries | children | hint line | result |
|---|---|---|---|---|
| G1 | unit + package (`prepare`) | false | **printed** | exit 3, `publish` `no-loader` |
| G2 | unit | true | **absent** | exit 3, `publish` `no-loader` |
| G3 | unit | false | printed | exit 3, `publish` `no-loader` (case 8 control) |

`issue-194.md` attributed the difference to the second entry because cases 6 and 9 changed the entries and kept `children: true`; case 8 had children off. That Open question 1 is now answered.

**Q2: what selects today, and what does not** (verified by experiment, 0.1.448):

| Case | Setup | selected | result |
|---|---|---|---|
| G4 | case 6 (two entries, `prepare`, children on) plus `"inputs": { "test/e2e/*.test.mjs": ["scripts/*.mjs"] }` at base and head | none | exit 3, `publish` `no-loader`, no hint |
| G5 | G4 with `--test test/e2e/release.test.mjs` | the test | exit 0, `publish` `pass`, `loaders.expected` and `measured` name the test, `children {"read":1}` |
| G6 | package entry without `prepare` (so the daemon opens it), children on, `run --all --wait` on a real daemon | — | both files pass. The daemon notes "node-test project "package": 1 test file(s) loaded nothing beyond themselves … what they reach through a spawned process … enters no key; declare it in inputs". `squeal reach scripts/release.mjs --json`: `testFiles: 0`, `routes: []` |
| G7 | the gate on G6's repository after the daemon stopped, `publish()` edited | none | exit 3, `publish` `no-loader` |

Source behind it (read in source code, `472a13730`):

- The gate's selection is `adapter.affected(paths)` plus listed changed test files plus `--test` (`src/core/code/gate/collect.ts:219-253`). The node:test adapter's `affected()` and `closure()` read only its static import graph (`src/runners/node-test/adapter-project.ts:117-123`). Declared `inputs` reach the node:test adapter only for its "loaded nothing" note (`adapter-project.ts:170`, `declaresInputs`).
- The daemon keys a test file with its declared inputs (spec 001 D3; `src/core/keys/closure.ts:10`, "static imports plus declared inputs"; `src/core/scheduler/keying.ts`). So in the daemon an edit to a declared input re-runs the test; in the gate it does not. The adapter's own note tells the user to "declare it in inputs", and the gate then ignores the declaration.
- The node:test module recorder goes into argv `--require`, which reaches no child. It is in `NODE_OPTIONS` only when `childEnv` or the warm-up puts it there (`src/runners/node-test/run/run.ts:228-231`). D12.6's amendment ("A child inherits `NODE_OPTIONS`, so the runtime-input recorder sees its reads") was measured with Vitest only: `test/code/crap/children-daemon.test.ts` writes a Vitest fixture (`import { expect, it } from "vitest"`, line 44). G6 shows that for node:test the daemon's observed set does not hold the child's script.

**Q2: the candidate evidence compared**

| Evidence | Names the test in #194's shape? | Same answer locally and in CI? | Cost | Main risk |
|---|---|---|---|---|
| Declared `inputs`, test-glob map, read at the base | Yes, once declared | Yes | runs of the matched files | list-form `inputs` selects every file; over-wide globs select many |
| Daemon observed reads (`closureFor`, `reach`'s "child process") | No: node:test children are not observed (G6), and a `prepare` entry is never opened by the daemon (D15.6) | No: CI has no daemon store | one store read (already open in D11.7) | verdict depends on local history |
| Kept coverage records (D17.3) whose sources include the path | Only after an earlier run with `--test` | No | a store query | stale; 015-75 rejected records as loaders for the same instability |
| Static scan of test text for the script path | Yes for a literal path (the fixture's `"scripts/release.mjs"`) | Yes | a text scan per test file | misses computed paths (`join(root, "scripts", …)`); a heuristic the user cannot see |

Not determined: whether the gate's kept runs (D17.3) write a child-reading node:test file at all. `Keeper` drops a file whose run read beyond its key (`keep.ts`, `observedGrowth`), and the child's read is not observed for node:test, so the answer depends on code not traced here.

## Proposed rows (no spec text)

1. **Hint under `coverage.children` (repair of 020-15b, D14.4).** Keep the unloaded-path line when `coverage.children` is on. When no selected file of any runner runs, print today's line. When some run, print a weaker form: the path is measured only if a selected test starts it as a child process; else `--test <file>` or `inputs`. Owns `src/core/code/gate/prerun.ts`, `src/cli/code-gate-prerun.ts`, `test/cli/code-gate-children.test.ts`, `test/cli/code-gate-prerun.test.ts`. Done when G2 and case 6 print a line and the children-pass case keeps its stderr or the weaker form.
2. **The gate selects by declared `inputs` (D3.1 amendment; needs the human's approval, it changes selection).** Add the test files whose test-glob `inputs` entry, read at the base, matches a changed path. Lead: limit it to the map form and to changed paths that no static closure loads, so a list-form `inputs` does not select the whole suite. Expected loaders stay static; the child record completes the function as in G5. Cost per edit: the matched files' runs and their `prepare`. Done when G4 selects the test and passes like G5, and a list-form `inputs` selects nothing new.
3. **node:test child observation in the daemon (D12.6 parity; separate decision).** Either put the module recorder in `NODE_OPTIONS` for node:test runs with `coverage.children`, or amend D12.6 to say its observed-set loader holds for Vitest only. G6 is the test. Not needed for #194's shape, because the daemon does not open `prepare` entries.

Not proposed: selection from daemon stores or kept records (CI and local differ), and a static scan (hidden heuristic).

## Open questions

1. Whether row 2 should also read `inputs` list form when the list is short, or only the map. A coordinator or human choice.
2. Whether the gate's kept node:test runs (D17.3) store a file whose child read a script (see above).
3. Carried from `issue-194.md` question 5: cezarion's real suite shape; row 020-32 checks it.

## Sources

- Brief: `docs/specifications/020-quality-gate/tasks/wave-11.md`, "020-33". Prior findings: `research/issue-194.md`, `../015-coverage-complexity/research/issue-144.md`, `research/child-coverage.md`, `tasks/020-10b/notes.md`.
- Spec: `spec.md` D3.1, D12.4, D12.6, D14.4, D15.6, D17.3 at `472a13730`.
- Source at `472a13730`: `src/core/code/gate/prerun.ts:80-131,176-190`, `src/core/code/gate/collect.ts:212-253`, `src/runners/node-test/adapter-project.ts:117-123,170,295`, `src/runners/node-test/run/run.ts:228-231`, `src/runners/node-test/run/reads.ts:12-24`, `src/core/keys/closure.ts:10,50-105`, `src/core/reach/pairs.ts:166`, `test/code/crap/children-daemon.test.ts:44`, `test/cli/code-gate-children.test.ts:96`. Commit `a6a382c1d` (row 020-15b) message.
- Probe: `probes/issue-194/gaps.sh`, output `probes/issue-194/gaps.out.txt`. Command, from the worktree root: `sh docs/specifications/020-quality-gate/research/probes/issue-194/gaps.sh $PWD/plugins/claude-code/dist/cli/squeal.mjs`. The run left no process; its `/tmp` directory was removed after reading.
