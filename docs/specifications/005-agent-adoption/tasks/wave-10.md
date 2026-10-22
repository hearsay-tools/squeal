# 005 wave 10: what a toolkit-dev setup check missed

From the review of toolkit-dev session c92fddaf (2026-10-22). Its user asked whether anything was left to configure so that every test runs. On 0.1.258, `squeal setup --plan` printed `Runners: Vitest` while the daemon built no Vitest, hid the refused `test:node` script, and printed `Warm-up: runs all 88 test files, -55 without a current result`. Coordinator: session 7c21a5ae. 005-78 (the skill text) is the coordinator's commit on your baseline. No board edit; no `npm run build`; the coordinator raises the version at integration. The verdict is `squeal run --all --wait`.

## 005-79 and 005-80, one worker

Use /worker. Shape: slice. Outcome: the plan and the daemon agree on which runners run, and the plan names what the config leaves out or runs twice, each with its fix.

Read: 005 D3 step 2 and 003 D7, both as amended 2026-10-22; 003 D1 (the seed's exact form); 007 D1.

Fixture, shaped like toolkit-dev: a root `package.json` with scripts only (`"test:node": "node --test .github/scripts/*.test.js && npm --prefix tools/generator run test"`); `tools/generator/package.json` with `vitest` in `devDependencies` and its own `vitest.config.ts`; a root `pyproject.toml` with `testpaths = ["tests", "plugin-tools"]`; `plugin-tools/a/pyproject.toml` with its own tests; a config with `"nodeTest": []` and both pytest projects.

Seam: `src/cli/setup/plan.ts` (`readRunners`, `nodeTestProjects`), `format.ts`, `repo.ts` (`listTestFiles` dedupes paths but counts current results per project), `src/core/daemon/runner.ts` (`vitestDetected`) and its call in `daemon.ts`. First edit: a plan test on the fixture, red until `Runners:` leaves out Vitest. Setup and the daemon use one detection rule from one source. The daemon computes its note once at start, off the hook path.

Owns: `src/cli/setup/**`, `src/core/daemon/runner.ts`, the Vitest-runner block of `daemon.ts`, their tests, the setup skill's text where it names plan lines. Leave alone: the files of cand/0.1.261 (`plugins/*/bin/squeal-launcher`, `src/cli/start.ts`, `src/core/delivery/**`, `src/core/status/**`, `src/harness/shared/ensure.ts`, `src/core/daemon/open.ts`, `daemon.ts#register`) and the primer.

Done when:
1. On the fixture, `Runners:` has no Vitest, and one line names `tools/generator` as a Vitest Squeal does not run, why, and the fix. A repository with root Vitest prints as before.
2. The daemon on the fixture writes that note once. With root Vitest, it writes none.
3. The refused `test:node` shows the seed's note and template while the config declares no node:test project. A declared project hides it.
4. One line names the overlapping test files' count and both pytest projects.
5. The warm-up counts per project and file and is never negative.
6. `--check` exit status is unchanged; `--json` carries the new facts.
7. lint, typecheck, `squeal run --all --wait`.

Final message: the decisions the spec did not settle, and any type change.

## Review of cand/0.1.263

Use /reviewer. Shape: review. Pinned to the `cand/0.1.263` SHA named in the spawn; the range is from the base named there to that SHA. It holds 005-78 (one coordinator commit), 005-79 and 005-80 (five commits of worker 96897428, cherry-picked with `-x`) and the release commit (0.1.263 and the bundles). Read rows 005-78 to 005-80, this file, 005 D3 step 2 and 003 D7 as amended 2026-10-22, both `status.md` lines of 2026-10-22, and `wave-10-toolkit-dev-plan.txt` (the plan on the repository that showed the defects). Check that:
- no copy of the skill's `policy.md` says a runner has not landed, and the three copies stay identical;
- setup and the daemon decide Vitest by 003 D7's one rule. With Vitest only below the root, the plan lists no Vitest runner and prints one `not run:` line, and the daemon writes one note (topic `vitest:below-root`); both name the directories, the reason and the fix. With root Vitest, both behave as before. The daemon's manifest read stays off the hook path, and with root Vitest it costs one directory read;
- with no node:test project declared, a `--test` script the seed refuses shows its note and template, and a declared project hides it;
- each `run twice:` count uses Squeal's own matcher, and its suggested `exclude` removes exactly those files from the outer project;
- the warm-up counts one run per project and file and is never negative; `--check`'s exit status is unchanged; `--json` (schema 1, additive) carries the new facts;
- the side effects the worker named are right: with Vitest only below the root, the managed block no longer names Vitest, and setup no longer proposes `vitest.exclude`. Also judge the repeated wording "not run: Vitest in X is not run".

Run `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4` once in the candidate tree, and name each file that fails loaded and passes alone. The coordinator's gate on 91e45c9a9: 882 files passed, 2 skipped; `test/scheduler/backlog-slots-overhead.test.ts` test 3 failed at load 17 to 23 on 24 CPUs (20,858 ms against a 20,277 ms bound) and passed alone (row 011-99). Write `reviews/0.1.263.md` with a PASS or FAIL verdict and commit it.

## Re-review after the coordinator repair (2026-10-22)

Use /reviewer. Shape: review, narrow. Pinned to the repaired `cand/0.1.263` SHA named in the resume; the delta is `f1c272cc0..` that SHA: the repair of `reviews/0.1.263.md` B1 and N1 (`bcf0d2c75`), the bundles (`605532f0c`) and two more B1 tests (`e6133649b`). Check that:
- B1 is closed: the plan offers a directory exclude only when the nested project selects every file the outer one selects there. Apply each offered fix to your two subset fixtures (a narrower nested `include`, a nested `exclude`), and compare the pytest adapter's selections before and after: no test path lost, each shared file run once;
- N1 is closed: the plan line reads `not run: Vitest in X: ...`, and the daemon note keeps its full sentence;
- the rebuilt bundles match `npm run build`.

Run the deferred locked full suite once in the candidate tree. Also run `test/e2e/slow-node-test.test.ts` alone: on CI run 39766470453 (at `f1c272cc0`), its claude-code case "reports the fast tests first, runs the slow files on idle and on run --slow" also re-ran `packages/demo/test/unit/math.test.ts` after Stop. That file passed 3 of 3 runs at `605532f0c` here, and no other run among the last 25 failed CI runs shows it. Judge whether the daemon's new start-time manifest read can cause it. Append a "Re-review" section to `reviews/0.1.263.md` with PASS or FAIL and commit it. Do not widen the review past this delta.
