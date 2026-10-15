# 007 wave 5: the last repairs

Read wave 4's preamble and docs/process.md "Test runs on a shared host" first. Product changes reach main only through a reviewed `cand/<version>`. Workers do not build and do not re-pin.

## 007-42 a live norecursedirs edit relists (wave 4 review S1)

Outcome: changing `norecursedirs`, `python_files` or `testpaths` in a project's existing pytest config changes the listed test files without restarting the daemon, in both directions.

Shape: repair, test first. Seam: `invalidate` in `src/runners/pytest/adapter.ts`, near line 218. It relists only when a path is not a `change`, or when nothing is built. Relist also when `reread` reports `rebuild`, or when a changed path is the project's config file. If `sameSettings` does not compare the listing inputs, make it, or compare them separately in `adapter-files.ts`. Additions and removals reach the graph through `built.graph.setTestFiles`, as they do now. `reviews/wave-4.md` S1 holds the reviewer's probe.

Owns: `src/runners/pytest/adapter.ts` (the listing seam only), `adapter-files.ts`, `environment/config-values.ts` if needed, and their tests.

Done when: one live adapter goes through allow, disallow and re-allow of `tests/build/test_a.py` by editing `pytest.ini` as a `change`, and lists, drops and lists the file again, with no reopen between edits. The regression fails on main and passes after. A no-environment project still lists from the config. Full-suite verdict: `squeal run --all --wait`; expect bundle and key-format drift.

Use /worker.

## Review of cand/0.1.191 (007-42)

Outcome: a PASS or FAIL verdict on `cand/0.1.191` at `41979b98`, which is main 0.1.190 plus 007-42 (`382d253e` picked), a key re-pin and the build. The verdict decides whether it may land.

Shape: review. Scope:
- 007-42's change to `invalidate` in `src/runners/pytest/adapter.ts`, against `reviews/wave-4.md` S1 and this file's 007-42 brief. Re-run the S1 probe (allow, disallow, re-allow on one live adapter).
- Check that a relist on every config change neither drops a file's results needlessly nor re-keys it.
- Check that a config moving to another file (a `pytest.ini` created over `pyproject.toml`) still relists.
- The worker reports that the listing reads `norecursedirs` and `python_files` but not `testpaths`. Say whether that leaves a gap D5 cares about.

Owns: `reviews/wave-5.md` only, which you commit. Your locked full run (`flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4`) is also the landing gate, so name every failing test and say whether it fails alone.

Done when: every finding has a file and line, a failure scenario and a severity, and the verdict names `41979b98`.

Use /reviewer.

## 007-40 a pytest failure is never told "No dependencies are installed" (defect 6)

Narrowed by the human on 2026-10-15 (option (a)): this row is defect 6 only. Defects 10 (setup's Codex trust lines) and 12 (the skill trigger) are 005's rows 005-65 and 005-66.

Outcome: the sentence "No dependencies are installed in this worktree; failures that cannot find a package are expected until an install." appears only beside a failure of a Node runner (Vitest or node:test) in a worktree with no installed Node lockfile. It never appears beside a pytest failure.

Why that is the contract: a pytest check runs only in an admitted environment (D2: without one, every check of the project is `unknown` and nothing is stored). So a pytest failure always ran with its dependencies installed, and the sentence, which reads only Node's installed lockfiles, can only be false beside it.

Shape: repair, test first. Seams:
- `withDependencies` and `dependenciesInstalled` in `src/core/delivery/attribution.ts`, near line 224;
- their callers, which decide `failing`.
The narrowest lead: the header carries `dependenciesInstalled` only when a failing check in the delivery belongs to a Node runner. Find how a check's runner is known at that point. This is core delivery: say in the report what changed, because the coordinator tells 001.

Owns: `src/core/delivery/attribution.ts`, its callers' `failing` argument, and their tests. Leave `key-format.ts`, `plugins/*/dist` and `package.json` alone, and do not build.

Done when (each test fails on main and passes after):
- a pytest-only worktree with an admitted environment and one pytest failure gets no such sentence, in a delivery or at start;
- a Node worktree with no install and one Vitest failure still gets it, as today;
- a mixed worktree (Node not installed, pytest admitted) gets it beside a Vitest failure and not when only a pytest file fails.
Full-suite verdict: `squeal run --all --wait`; expect bundle and key-format drift.

Use /worker.

## 007-44 the no-environment note tells the agent what installing buys

The human decided OQ1 on 2026-10-15: no lock-to-environment record. Instead, the agent is told that its dependencies are missing, and that installing them brings the results other worktrees recorded. So it installs, rather than having to work that out.

Outcome: D2's no-environment note (`environmentState` and `create` in `src/runners/pytest/environment/states.ts`) reads, for a project with a lockfile:

> pytest project "app": no Python environment (looked at .venv), so Squeal runs none of its tests and inherits none of their results. Run `uv sync` in . to create one: Squeal then inherits the results other worktrees recorded for the same code and environment, and runs the rest.

The no-lockfile and requirements cases from 007-39 keep their own install advice in the same two-sentence shape. The editable-outside note and the sync note are unchanged.

Shape: repair, text. Owns: `states.ts` and the tests that pin the text (`states.test.ts`, `adapter-notes.test.ts`, `test/e2e/pytest.test.ts`). Do not touch core; 001 words the Node sentence to match. Leave `key-format.ts`, `plugins/*/dist` and `package.json` alone, and do not build.

Done when: a text test covers each case (uv.lock, poetry.lock, requirements, none), and every test that pinned the old text pins the new one. Full-suite verdict: `squeal run --all --wait`.

Use /worker.

## Review of cand/0.1.195 (007-40 and 007-44)

Outcome: a PASS or FAIL verdict on `cand/0.1.195` at `fa444c86`, which is main 0.1.194 plus 007-40 (`0d2fa0c6`), 007-44 (`bf27a21d`), a key re-pin and the build. The verdict decides whether it may land.

Shape: review. Scope:
- 007-40 changes core delivery: `withDependencies` now takes the failing check ids and adds the "No dependencies are installed" flag only when one belongs to a non-pytest project, read from the worktree's policy. Check:
  - that a pytest failure can never get the sentence, in a delivery or at start;
  - that a Node failure without an install still gets it in every path that used to (deltas, registration, status);
  - what happens when the policy cannot be read, or the worktree row is missing;
  - that reading the policy per failing delivery costs nothing that matters.
- 007-44's note text in `states.ts`, against the brief and spec 007's open question 1 as decided: honest about what installing brings (inherited failures are held per 001 D6), and correct for each lockfile case.
Not in scope: the rest of spec 007.

Owns: `reviews/wave-5.5.md` only, which you commit. Your locked full run (`flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4`) is also the landing gate, so name every failing test and say whether it fails alone.

Done when: every finding has a file and line, a failure scenario and a severity, and the verdict names `fa444c86`.

Use /reviewer.

## Re-review of cand/0.1.195 (the B1 repair)

Outcome: a PASS or FAIL verdict on `cand/0.1.195` at `adc26b1d`, which is `fa444c86` with the coordinator's B1 repair `998f0dfc`, followed by the same re-pin and the rebuild. The verdict decides whether it may land.

Shape: narrow re-review, against `reviews/wave-5.5.md` B1. Scope:
- `nodeFailing` in `src/core/delivery/attribution.ts`. Runner ownership now comes only from a policy that loaded without problems, or from no policy file at all; with problems, or with no worktree row, the sentence is not said.
- A Python test file is never counted as Node's. The file is used only to withhold the sentence, never to claim a check is Node's. The reviewer's instruction "do not guess runner ownership solely from a filename extension" is answered that way; judge whether it holds.
- The case the file covers alone: a pytest failure stored before its project left a valid or missing policy.
- Known residual: a pytest failure in a non-`.py` file (a doctest glob) after the policy was deleted or stopped declaring its project still gets the sentence. Say whether that residual is acceptable.
- Re-run your probe for valid, malformed, missing and unreadable policies, with a Node control, on both callers.
Not in scope: 007-44 and the rest of 007-40, which passed.

Owns: `reviews/wave-5.75.md` only, which you commit. Your locked full run (`flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4`) is the landing gate, so name every failing test and say whether it fails alone.

Done when: B1 has a verdict backed by your probe, and the verdict names `adc26b1d`.

Use /reviewer.

## Third narrow re-review of cand/0.1.195 at 3ed0dae4 (wave 5.875)

The human approved one more round (option (a)), 2026-10-15. Use /reviewer.

- **Outcome:** a PASS or FAIL verdict on `3ed0dae477ff908debdf31d7ef33c6a1349b2bc6` for the wave-5.75 blocker only, written to `docs/specifications/007-pytest-runner/reviews/wave-5.875.md` and committed (that file only).
- **Read:** `reviews/wave-5.5.md` and `reviews/wave-5.75.md` (B1), spec 007 D2, and `status.md` from 2026-10-15.
- **Scope:** repair `8527f236`. `nodeFailing` in `src/core/delivery/attribution.ts` now counts a failing check as a Node runner's only when its project is no pytest project of a cleanly loaded policy (or of no policy file) and its test file is JavaScript or TypeScript (`/\.[cm]?[jt]sx?$/`). The rest is the reviewed 007-40/007-44 rebased onto main, whose new commits touch only `evals/` and `test/evals/`. Key 10 is unchanged (`793e7117…`).
- **Done when:**
  - The wave-5.75 doctest residual (a text doctest after the policy is missing, is a directory, or drops the project) no longer gets the sentence in either caller, the delta and the registration.
  - A Vitest or node:test failure still gets it with no Node install, both with no policy file and with a clean policy.
  - `test/delivery/dependencies-runner.test.ts` proves both.
  - `npm ci`, lint, typecheck, and `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4`; that locked run is the landing gate. Name any file that fails under load but passes alone.
  - No `npm run build`. New findings outside B1 are reported as should-fix, not blockers, unless proven breaks.
