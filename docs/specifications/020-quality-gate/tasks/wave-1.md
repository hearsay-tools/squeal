# Spec 020 wave 1: the first slice of `squeal code --base`

Approved by the human 2026-11-09: name `squeal code --base <ref>`, build the first slice, and code Squeal cannot measure yet goes in `coverage.exclude` and reads `skipped`. Rows 020-01 to 020-04 run in parallel on disjoint files. 020-05 starts after 020-01 to 020-03 land on the candidate branch.

The contract between 020-01, 020-02 and 020-03 is `src/core/code/gate/types.ts`, written by the coordinator. No worker edits it. If you need a change, ask the coordinator with the exact change and why. The coordinator decides and relays the change to every sibling.

Every row: read `docs/specifications/020-quality-gate/spec.md` whole first. The research is `docs/specifications/015-coverage-complexity/research/quality-gate.md`; its probes under `research/probes/quality-gate/` show each part working (`one-shot.mts`, `changed.mts`, `cases.mts`). Do not run `pnpm run build`. Do not run a full suite. Before you finish, read `squeal status --wait 60000 <changed paths>`, and run `pnpm run lint` and `pnpm run typecheck`.

## 020-01 the evaluator and the versioned report

Use /worker. Shape: slice.

Outcome: `evaluate(changed: ChangedSet, evidence: Evidence, policy: GatePolicy, versions)` returns the D7 report. It is pure: no I/O and no clock (`createdAt` and durations are passed in).

Read: spec D5, D6, D7; `src/core/code/crap/{join,score,file}.ts`; 015 spec D9 ("pass proven early").

Starting seam: `src/core/code/gate/evaluate.ts` (new). A first failing golden test: one function at CC 20 and CRAP exactly 30 is pass; at 21, a violation with no coverage needed. Reuse `joinCoverage` and `crapScore`; do not write another join or score. `coverage.exclude` uses `createInputMatcher`, as `src/core/code/crap/checks.ts` does.

Owns: `src/core/code/gate/evaluate.ts`, `src/core/code/gate/report.ts`, `test/code/gate/evaluate*.test.ts`.

Leave alone: `types.ts`, `changed.ts`, `collect.ts`, `src/core/code/crap/join.ts` (020-04), `src/cli/`.

Done when: the spec's Testing list for 020-01 holds. That covers every gap, skipped functions under and over the CC limit, a subset pass, a violation that needs every loader, a failed test, verdict precedence, and the same input twice giving an equal report.

## 020-02 changed functions against a base

Use /worker. Shape: slice.

Outcome: `changedFunctions(cwd, ref, policy)` returns the D2 `ChangedSet` for the working tree against `git merge-base <ref> HEAD`.

Read: spec D2, D6 (reading `squeal.config.json` at the base commit: `git show <base>:squeal.config.json`, defaults when absent); 015 D2 and D3; `research/probes/quality-gate/changed.mts`.

Starting seam: `src/core/code/gate/changed.ts` (new). A first failing test: a temporary git repository where one function is edited, one is moved to another file, and one test callback only shifts its occurrence. Only the edited function is returned. Count with `countFile`; do not write another counter. Export a `readBasePolicy(cwd, baseCommit): GatePolicy` from `src/core/code/gate/policy.ts` for 020-05.

Owns: `src/core/code/gate/changed.ts`, `src/core/code/gate/policy.ts`, `test/code/gate/changed*.test.ts`, `test/code/gate/policy*.test.ts`.

Leave alone: `types.ts`, `evaluate.ts`, `collect.ts`, `src/core/code/count/`, `src/cli/`.

Done when: fixture repositories cover edited, added, moved, shifted, moved-and-edited, removed, over `maxFileBytes`, a parse error, untracked and test-file functions. A branch config that differs from the base does not change the policy read.

## 020-03 the one-shot collector

Use /worker. Shape: slice.

Outcome: `collectEvidence(cwd, changed: ChangedSet, opts: { tests, budgetSeconds })` runs the selected test files under Vitest and node:test with Squeal's coverage provider, with no daemon and no store, and returns `Evidence`.

Read: spec D3; 015 D8; `research/probes/quality-gate/one-shot.mts` (records must be mapped before `adapter.close()`); `src/runners/vitest/adapter.ts` (`affected`, `closure`), `src/runners/node-test/adapter.ts`, `src/cli/ci-export.ts` (`daemonVitest`, an adapter built with no daemon).

Starting seam: `src/core/code/gate/collect.ts` (new). A first failing test: a fixture project where one test file loads the changed source and one does not. Only the first is selected, and its record holds the source. Then a deterministic short-budget fixture: two files, one sleeps past `budgetSeconds`. The fast file keeps its record, the slow one reads `completed: false`, and `timedOut` is true. Never lower a project's `testTimeout`. Temporary files go under `$TMPDIR` and are removed; nothing is written to the project.

Owns: `src/core/code/gate/collect.ts`, any small export the adapters need to run with no daemon (name it in your final message), `test/code/gate/collect*.test.ts`, `test/fixtures/code/gate/`.

Leave alone: `types.ts`, `evaluate.ts`, `changed.ts`, `src/core/code/crap/`, `src/cli/`.

Done when: the spec's Testing list for 020-03 holds (`vi.mock` factories, node:test `.ts`, mixed Vitest and node:test, a file no test loads, the short budget), and the adapters' existing tests still pass.

## 020-04 join the three missing arrow shapes

Use /worker. Shape: repair.

Outcome: the join matches `x => (expr as T).field`, the inner arrow of a curried call chain, and the innermost of three arrow stages. Every function joined today joins to the same range as before.

Read: spec D4; `research/quality-gate.md` Q5; `research/probes/quality-gate/cases.mts` and `cases.out.json`.

Starting seam: `src/core/code/crap/join.ts`, `END_SLACK` and the end-column match. A first failing test: the three shapes from `cases.mts` as records and counts in `test/code/crap/join.test.ts`. Lead: among V8 functions that share an end, match by start and nesting depth; match a cast-expression arrow by its start. A function that cannot be matched stays `ran: null`. Never match it to a wrong range.

Owns: `src/core/code/crap/join.ts`, `test/code/crap/join*.test.ts`.

Leave alone: `src/core/code/gate/`, `src/core/code/count/`, the coverage provider.

Done when: the three shapes join with the right `ran` and coverage. A regression test shows that the joins of this repository's own records for at least 20 source files are unchanged. Build them in the test from fixtures, not from a live store.

## 020-05 `squeal code --base`: CLI, exit codes, docs (after 020-01 to 020-03)

The coordinator writes this brief when the three land, against their final exports.
