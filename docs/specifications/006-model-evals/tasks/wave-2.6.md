# 006 wave 2.6: repair of `reviews/wave-2.5.md`

Two workers on disjoint files, then a re-review (the second round on 006-12 and 006-14). Read `../reviews/wave-2.5.md` first, then `../spec.md` D4 as amended on 2026-10-11 (the expectations table, "Retained evidence") and Testing. Every probe in the review becomes a test. No subject sessions. Never run or import `evals/bin/run-baseline.mjs`. Never run `npm run build` in your worktree.

**The contract between the two rows**, in `evals/lib/commands.mjs`. 006-16 writes it, 006-17 reads it. Each classified test action carries:
- `runner` (`vitest` or `node:test`);
- `informational`: true for `--help`, `--version`, listing or a watch-only invocation, which never counts as a run;
- `scope`: `{ full: true }` for the whole suite of that runner, or `{ full: false, paths: [...] }` with the test paths and globs it selects, as written. An npm script resolves to the command it runs. `names: [...]` adds `-t`, `--testNamePattern` or `--test-name-pattern` filters. A name-filtered run is not full coverage, and it covers no path it does not select (agreed during the wave, 2026-10-11). `scopeLabel(scope)` returns the old `full`, `files` or `name` string, which `grade.mjs` stores until 006-17 keeps the scope object in the timeline.

Whether the run completed is the grader's call, from the runner's own summary in the output: `Test Files` for Vitest, `# tests` for node:test. "No tests found" and a runner that fails to start are not completed. A lookup command (`command -v`, `-V`, `-pv`) yields no test action, but its redirections are writes.

## 006-16 commands: informational runs, scope, lookup redirections, the claim segment

Use /worker. Shape: repair.

- **B3, the command half:** set `informational` and `scope` as the contract above says.
- **B4:** `command -v`, `-V` and `-pv` keep their redirections as writes, also when the lookup fails. The looked-up program is never credited as a run. Test against Bash, through plain Codex, wrapped Codex and Claude Code.
- **S2:** in `evals/lib/claim.mjs`, the claim is the segment before an explicit evidence boundary. That segment must name exactly one claim word, and diagnostic text after the boundary is free. Pin the separators you support, the template, `pass - fail - unknown` and `pass | fail: 0`.

**Owns:** `evals/lib/{shell,commands,claim}.mjs`, plus new test files under `test/evals/` named `commands-*` or `claim-*`. On a conflict, add export lines to `evals/lib/index.mjs` and `index.d.mts` additively.

**Done when:** the B3 command probes, the B4 probes and S2 are tests; earlier evals tests pass; the repository gate is green.

## 006-17 evidence: claim-time state, answered scope, completed coverage, current before claim, the timeline

Use /worker. Shape: repair. Starts from 006-16's contract as written above. If 006-16 has not landed when you need it, work against the contract and stub its fields in your tests.

- **B1:** record the Squeal evidence the agent had seen when it made its final claim, separately from the runner's end status. `no-overclaim` reads the former.
- **B2:** record each pull's and delivery's revision and pending, stale and unknown counts, with the checks or test files it names. `no-rerun-answered` misses only for a run whose scope Squeal had answered current, after the last edit and before the run.
- **B3, the grade half:** `own-run-uncovered` needs a completed, non-informational run whose scope covers the task's affected tests (D4), after the last relevant change.
- **B5:** replace `waited-before-done` with `current-before-claim`, in `tasks.json` and the rules.
- **Retained evidence:** each results cell keeps the compact timeline D4 describes, and `regrade.mjs` grades from it. A cell without it is "not computable" for the rules that need it.
- **S1:** add a T2 reference with the real red step: the Sunday test fails, the fix lands, the recovery or the remaining flake is seen, then the script changes and its own run follows. Record the red step as context.
- **Regrade** every committed results file: new expectations revision, `TREND.md` regenerated, and a note naming what is not computable for lack of a timeline.

**Owns:** `evals/lib/{grade,behaviours,trend,results,transcript}.mjs`, `evals/bin/{grade,regrade,compare,run-cell}.mjs`, `evals/tasks/tasks.json`, `evals/results/**`, `evals/README.md`, `test/evals/reference.test.ts`, and new test files under `test/evals/` named `evidence-*`. On a conflict, add export lines to `evals/lib/index.mjs` and `index.d.mts` additively. `run-cell.mjs` changes only to keep the timeline.

**Done when:** every B1, B2, B3 (grade half) and B5 probe and its positive counterpart is a reference test; S1's reference exists; the regrade is committed; the repository gate is green.

## 006-18 re-review of wave 2.6

Use /reviewer. The second and last round on 006-12, 006-14 and this repair. Re-run the five reproductions of `../reviews/wave-2.5.md` and their positive counterparts, and check the amended D4 table for design as 006-13 did. Synthetic probes only. Check in a scratch copy, never by building in your worktree. Never run or import `evals/bin/run-baseline.mjs`. Findings go to `../reviews/wave-2.6.md`.
