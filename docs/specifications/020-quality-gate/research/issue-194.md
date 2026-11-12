# Issue 194: code that only a project-specific suite loads (packaged CLI tests)

Researcher, 2026-11-12. Squeal **0.1.443** (released, `~/.claude/plugins/cache/hearsay/squeal/0.1.443/dist/cli/squeal.mjs`), with the reported **0.1.440** for case 1. Worktree at `4d758d722`. Node v26.13.0. One-minute load 3.32 at start, 2.69 at end, on 24 CPUs (limit: the CPU count), so the live probes ran. All evidence is from a **synthetic** fixture (`probes/issue-194/`). The original cezarion task (cezarion#3212, PR cezarion#3297) was not replayed.

## Answers

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Do changed functions in code that only a project-specific suite loads, outside all runner listings, read `no-loader`, and is `--test` on that suite's file refused, on current Squeal? | **Yes, reproduced (synthetic).** 0.1.443 and 0.1.440: exit 3, both changed functions `incomplete`/`no-loader`, while `npm run test:package` exits 0. `--test test/e2e/release.test.mjs` exits 2: "no Vitest or node:test project lists it as a test file". This is the D3.1 and D5 contract, not a measurement defect. | verified by experiment (0.1.443, 0.1.440) |
| 2 | Does an existing `nodeTest` entry with `prepare` (D15) plus `coverage.children` (D12) resolve a minimal supported case? | **Yes, when the packaged test file is selected.** With the entry and `prepare` at the base and `coverage.children: true`, a child-only `publish()` reads `pass` (7/7 lines, CRAP 5), exit 0, when the test file changed (case 2) or is given with `--test` (cases 5, 7). **No, when only the child-only script changed** (case 6): import-graph selection does not pick the test, and `publish()` stays `no-loader`, exit 3. Without `coverage.children` the child-only script stays `no-loader` (case 3). An in-process import needs no `children` and is selected by the import graph (case 4). | verified by experiment (0.1.443) |
| 3 | Is the reported 0.1.440 behaviour different from 0.1.443? | No difference in case 1: same exit codes and stderr text. | verified by experiment |
| 4 | Does the D14.4 pre-run hint name the unloaded path? | Yes with only a unit entry (cases 1, 3, 8). **No** when a second node:test entry exists and no file is selected (cases 6, 9, with or without `prepare`): stderr has only "node:test: no test file to run", and the path still reads `no-loader`. Cause not determined (see Open questions). | verified by experiment; cause not determined |
| 5 | Does the setup apply to cezarion's real suite? | Not determined, because the original suite was not run. The issue says the failing test is `release.test.ts` (TypeScript) and the suite is `scripts/test-package.mjs`. Whether it splits into a build step plus a plain `node --test` run, as `research/build-wrapper.md` found for #174's wrapper, and whether `scripts/release.mjs` runs unbundled in the child (D12.7 reads bundled children `unread`), is not checked. | inferred |

## Findings

**Case 1, #194's shape (reported symptom reproduced, synthetic).** Config: one `unit` node:test entry, `coverage.enabled`. Head edits `publish()` in `scripts/release.mjs` and the test callback in `test/e2e/release.test.mjs`.

```
== 1a project's own suite: npm run test:package exit 0
== 1b-gate: exit 3
verdict incomplete {"pass":0,"violation":0,"incomplete":2,...}
  scripts/release.mjs publish incomplete no-loader ... loaders {"expected":[],"measured":[]}
  test/e2e/release.test.mjs <test> incomplete no-loader ...
  squeal code: no test Squeal runs loads scripts/release.mjs: no Vitest or node:test project lists it, and no listed test file imports it. Its 1 changed function will read incomplete (no-loader). To measure it, give it to a runner (a nodeTest entry, with prepare when it needs a build); to skip its coverage, name it in coverage.exclude at the base.
== 1c --test test/e2e/release.test.mjs: exit 2
squeal code: --test test/e2e/release.test.mjs: no Vitest or node:test project lists it as a test file
```

The reported text in #194 ("no Vitest or node:test project lists it") matches 1c. The reported counts (251 pass, 6 `no-loader`) are cezarion's and were not reproduced.

**Cases 2 to 7, the supported path (D15 + D12).** Config adds `{ "name": "package", "include": ["test/e2e/*.test.mjs"], "prepare": { "command": ["node", "scripts/build.mjs"] } }`, at the base and the head.

| Case | children | test loads release.mjs | changed | selection | result |
|---|---|---|---|---|---|
| 2 | true | child process | both | changed test | exit 0, both `pass`; `runs[].children {"read":1}`, `prepare` exit 0, 55 ms |
| 3 | false | child process | both | changed test | exit 3: test `pass`, `publish` `no-loader` |
| 4 | true | import | both | changed test | exit 0, both `pass`; `children {"read":0}` |
| 5 | true | child process | both | `--test` | exit 0, both `pass` |
| 6 | true | child process | `publish` only | none | exit 3, `publish` `no-loader`, no hint line |
| 7 | true | child process | `publish` only | `--test` | exit 0, `publish` `pass` |

Each gate took 0.4 to 0.8 s wall. In case 2 the loader of `publish()` comes from the child record after the run (`expected` and `measured` both name the test). This fits D12.6: the gate keeps import-graph selection and `--test`, so a child-only script selects nothing by itself (read in `spec.md` D12.6, verified by cases 6 and 7). Cases 2, 5 and 7 also print the existing note that the test "loaded nothing beyond themselves ... declare it in inputs", about the daemon's key, not the gate verdict.

**What #194 asks against what exists.** The issue asks for (a) a configurable runner with a command and owned test globs, or (b) a gap reason that names the uncovered suite. For (a): D15 already gives a node:test entry with a `prepare` command and owned `include` globs; an arbitrary opaque command was rejected in `research/build-wrapper.md` ("Not chosen"). For (b): D14.4's pre-run line names the path and the ways out, but not the project's own command, which Squeal does not know. Both read in `spec.md` and verified by case 1.

## Relation to other issues

- **#174** (closed 2026-11-11, row 020-16, D15 shipped in 0.1.432): same shape, a changed function in a package e2e file that only a build wrapper runs, read `no-loader`. #194 is reported on 0.1.440, after D15 shipped; case 1 shows the gate behaves as #174 reported because the repository declares no entry. #194 is a duplicate in substance of #174, with one extra part: a child-only source script (`scripts/release.mjs`), which needs D12 and `--test` or a changed test (inferred from cases 2, 6, 7).
- **#144** (open): child-only execution reads untested. D12 (`coverage.children`) covers coverage of children; case 6 shows the remaining selection part: an edit to a child-only script alone selects no test in the gate.
- **#122** (closed 2026-10-31, 0.1.381): packaged tests outside coverage; resolved with `coverage.exclude` guidance (D6), which still applies as the skip path.

## Recommendation for Squeal

The coordinator triages #194 as answered by existing D15 and D12 configuration for cezarion, plus two items the evidence leaves open: selection of a test for an edit to a child-only script alone (case 6, overlaps #144), and the missing pre-run hint in case 6. A cezarion trial like 020-08c (a `package` node:test entry with `prepare`, `coverage.children`) would confirm question 5. No design is proposed here.

## Open questions

1. Why the D14.4 hint is absent in cases 6 and 9. `unloadedPaths` in `src/core/code/gate/prerun.ts:176` should return the path when no file is selected; the difference from case 8 is only the second node:test entry. Not determined, because the 15-minute budget ended before the code path was traced.
2. Whether cezarion's `test-package.mjs` splits into build plus `node --test` with `.ts` test files, and whether `release.mjs` runs unbundled in the child (question 5).

## Sources

- Issue: https://github.com/hearsay-tools/squeal/issues/194 (read with `gh issue view 194`); #174, #144, #122 states read with `gh issue view`.
- `docs/specifications/020-quality-gate/spec.md` D1, D3, D5, D7, D12, D14, D15; `status.md` lines 35 to 43; `research/issue-174.md`; `research/build-wrapper.md`.
- `src/cli/code-gate-prerun.ts:56`, `src/core/code/gate/prerun.ts:100-190` at `4d758d722`.
- Probe: `probes/issue-194/run.sh`, `probes/issue-194/fixture/`, output `probes/issue-194/run.out.txt`. Command:
  `sh run.sh $C/0.1.443/dist/cli/squeal.mjs $C/0.1.440/dist/cli/squeal.mjs` with `C=~/.claude/plugins/cache/hearsay/squeal`.
