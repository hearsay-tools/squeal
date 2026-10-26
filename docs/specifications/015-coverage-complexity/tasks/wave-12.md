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
