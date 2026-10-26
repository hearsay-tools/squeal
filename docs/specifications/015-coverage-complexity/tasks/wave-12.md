# 015 wave 12: switches for the coverage checks, and lines that say what Squeal saw

Briefed by coordinator 52e58f23 on 2026-10-26, from the human's decisions of that day (`status.md`). Two workers on disjoint seams; W2 depends on no type from W1.

## W1: 015-64

Use /worker. Shape: slice. Starts from main. Outcome: `coverage.untested`, `crap.enabled` and `coverage.exclude` work as D1 says, and `complexity.enabled` and `coverage.enabled` default to on.
- Read `spec.md` D1 (the settings table and the paragraph after it, amended 2026-10-26), D6 **A summary** and **Status**, D9, the 2026-10-26 lines in `status.md`, and board row 015-64.
- **Lead.** `src/core/types/policy.ts` (the `coverage` key, its default at about line 321) and `src/core/daemon/config-file.ts` for the keys; `src/core/daemon/policy-code.ts` for a policy change; `src/core/code/crap/**` writes no `crap` or `untested` state for a check switched off or an excluded file.
- **Defaults on.** Flip them, then read which tests change. Test helpers that build a policy or a config keep the code features off unless the test is about them (the coordinator's choice); the product default is on.
- **Owns.** `src/core/types/policy.ts`, `src/core/daemon/config-file.ts`, `src/core/daemon/policy-code.ts`, `src/core/code/**`, `src/cli/code*.ts` (its texts too: `untested` for `uncovered`, and `coverage not checked (coverage.exclude)` for an excluded file), `src/core/status/code-status.ts`, `squeal.config.json` (add `"exclude": ["test/**"]` under `coverage`), the docs that list these keys, and their tests. Leave `src/core/delivery/**` and `evals/**` alone (W2). Ask me before a store change; never raise `user_version` or a result key.
- **Done when.** The row's done-when, red first. Notes in `tasks/015-64/notes.md`. Lint and typecheck pass, and `squeal status --wait 60000 <changed-path>...` gives the verdict; paste both, and name pending or unknown checks. No full suite. Do not build bundles or raise the version.

## W2: 015-65

Use /worker. Shape: slice. Starts from main. Outcome: the agent's coverage lines lead with their reason, say `untested`, and share one block per function as D6 and D9 say.
- Read `spec.md` D6 (**A change**, **One function, several changes**), D9 **Delivery** (amended 2026-10-26), the 2026-10-26 lines in `status.md`, `research/validity-harness-uncovered.md`, and board row 015-65.
- **Lead.** `src/core/delivery/code-coverage.ts` (`coverageEntryLine`, `NOT_REACHED`) and `code-format.ts` (`codeEntryLine`). A first edit: group a delivery's entries by function before formatting. "A test file that loads the source can start a process": find the cheapest signal Squeal already holds (the loaders' closures or imports); ask me if it needs a new store read.
- **Evals.** `evals/lib/behaviours.mjs`, `judge.mjs`, `rubric.mjs`, `regrade.mjs` and `evals/atomic/atomic.json` read these lines. They must read both the old and the new lines, so past results regrade unchanged; round-trip the real formatters, as the parser gates do. Run no eval.
- **Owns.** `src/core/delivery/**`, the evals files above, and their tests. Leave `src/core/code/**`, `src/cli/**`, `src/core/status/**` and the policy files alone (W1). No store or record change.
- **Done when.** The row's done-when, red first. Notes in `tasks/015-65/notes.md`. Lint and typecheck pass, and `squeal status --wait 60000 <changed-path>...` gives the verdict; paste both, and name pending or unknown checks. No full suite. Do not build bundles or raise the version.

**Agreement for W1 and W2 (2026-10-26, W1's request `a3056400`, option (a)).** W1 adds the summary of a coverage policy change in one standalone delivery commit: `codeStep` in `code-deliver.ts` tells it once and re-seeds the view by count, as `crapRecount` does; `code-format.ts` gets `coverageChangeLine` and one entry in `codeLines`; `CodeNews` and `CodeStatus` get one optional field each. The line, with only the parts that apply: `Coverage checks changed: CRAP off (crap.enabled); untested off (coverage.untested); 12 files no longer checked (coverage.exclude).` W2 keeps the shape of `codeLines` and the recount part of `codeStep`; the coordinator merges the two. The CLI stops importing `NOT_REACHED` from delivery.

**Agreement for W2 (2026-10-26, W2's request `68616271`).** The loader count reads `testFiles.list()` once, behind one function, only on a delivery that lists an untested FAIL or STILL FAIL; D9's loaders are closures. The child-process sentence appears when at least one test file loads the source and no function of it ran in any test (every function of the file's evidence has 0 test files), not from an import scan. No store or record change.

**Agreement for W1 (2026-10-26, W1 request `5f3cdd7e`).** `CodeStateRepo.removeMeasure(worktreeId, measure, paths?)` takes an optional path list, chunked as the other path filters are, in its own store commit with a store test; without paths it behaves as before. No table, column, index, `user_version` or key change.

## 015-66: review of candidate 0.1.337 (wave 12)

Use /reviewer. Candidate `cand/0.1.337`, pinned to the SHA in the spawn, on main 0.1.336: W1's eight commits (015-64), W2's four (015-65), and four coordinator commits. The first makes the D6 told line and Stop's reason say `untested` and removes `NOT_REACHED`. The second holds this repository's `coverage.exclude` line until a release reads it. The third adds a hook-context round trip to `test/evals/code-lines.test.ts`. The fourth is the version and bundles. Write `reviews/0.1.337.md` in this spec and commit it on your branch.

Read rows 015-64 and 015-65, W1, W2 and the agreements above, both rows' `notes.md`, spec D1, D6 and D9, and the 2026-10-26 lines in `status.md`.

Check, with proof where you can:
1. **Switches.** A check switched off loses only its states, with no transition and one summary line. An excluded file keeps complexity and has no `crap` or `untested` state. Switched back on, the first judgement tells nothing.
2. **Keys.** `user_version`, result keys and `compare-refs` are unchanged.
3. **Lines.** One block per function for two or more changes, one line for one; D9's texts; the process sentence and the exclude pointer only where D9 says.
4. **Merge.** `codeLines` keeps the change line and the blocks.
5. **Helpers.** `CODE_OFF` reaches no test about complexity or coverage.

Checks (`docs/process.md`): lint, typecheck, Squeal's affected results or targeted `npx vitest run` of files you name. No full suite; name the candidate's CI result or say it is pending. Label findings proven, plausible or unverified. Verdict PASS or FAIL; only a proven break blocks.

## R14: repair of review 0.1.337 (015-64, round 1 FAIL)

Use /worker, resumed (worker d211a86b). Shape: repair. Starts from your branch `cez/d211a86b`. Read `reviews/0.1.337.md`, B1 with its probe.
- **B1.** With `coverage.exclude` unchanged, `applyChecks` returns early (`src/core/code/crap/checks.ts:96`), and `states.move` (`src/core/code/store/states.ts:169`) carries every measure. So a function moved into a file the exclude already matches keeps its `crap` and `uncovered` states. Give the rule one owner: either the move carries complexity only into an excluded file, or each step removes coverage states under the excluded files it saw change. Say which and why in your notes. No step may scan every state of the worktree.
- **Regression.** The review's probe, red first, through the normal edit path and the staged one (`partFiles` small). Assert only complexity at the destination, no coverage transition, no coverage view, and no summary line. The move's identity and complexity mark stay.
- **Owns.** `src/core/code/**` and its tests. No store, schema, key or text change.
- **Done when.** The regression passes, with the existing `checks.test.ts` summary and seed tests. Notes appended to `tasks/015-64/notes.md`. Lint and typecheck pass, and `squeal status --wait 60000 <changed-path>...` gives the verdict; paste both. No full suite. Do not build bundles or raise the version.

## 015-66 round 2: re-review of candidate 0.1.337 after R14

Use /reviewer, resumed (reviewer 9a6bbcb7), pinned to the SHA in the message. Read R14's commits and notes. Check that B1 is closed through both edit paths, that the summary and seed contracts hold, and that nothing in round 1's "What fits" broke. The same checks rules as round 1. Write `reviews/0.1.341.md` and commit it. This is the last round. (The candidate was rebased onto main 0.1.339 and renumbered 0.1.341 by the agreed order: `cand/0.1.341`.)
