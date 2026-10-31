# Wave 62: row 011-283 (the named-wait rule, option B) and row 011-281 (CI trace)

Coordinator dd7baf7f, 2026-10-31. The human chose option B of `triage/2026-10-31-digest-wait-rule.md` on 2026-10-31 (board rows 011-273, gh-116, gh-123, gh-127). One candidate, version 0.1.384.

Host policy, as in `wave-60.md`: no local full suite, no `squeal run --all`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on every test command; private `/tmp` fixtures; never make CPU load on purpose; no `pnpm run build`. Not yours: the board, `spec.md`, `status.md`, bundles, version. Read affected results with `squeal status --wait 60000 <paths>`.

## W1: row 011-283 (one owner for named-wait order: waits only, saved to disk)

Use /worker. Shape: slice, one or two commits.

Outcome: a named wait keeps its place when its file is queued after the wait started and across a daemon update, and a wait on more than 20 files finishes; nothing else about order, selection or verdicts changes.

The rule (the reviewer checks against it; it is the single owner of named-wait order):
1. A named wait (`status --wait <ms> <paths>`, with or without `--check`) puts its files in one group; groups keep arrival order.
2. A group goes ahead of unrequested work only between runs; it never stops a running test; an edit's own tests still run beside it. A focused tier of a group is that group's tier; the backlog's turn follows it (review 0.1.378-r2 N1).
3. A group lasts until each file has a current result at its key, its key moved, or it left the queue. The store holds it; a newer daemon takes over each group whose files it re-queues at the same key, in order, before its own groups, and republishes it. No age bound: the same-key rule is the bound. A file queued after the wait started, before its deadline, joins the group.
4. It never changes which tests run, at which keys, or any verdict, and never passes a claim, the load gate, a hold, the pool grant or a step-down.
5. Retries and named slow files keep today's order; status says why they wait (for example "retry: normal priority, behind N tiers"; "slow: behind the fast backlog").

Read: `research/named-wait-rule.md` (rule, F1 to F7, "First slice"), probe `research/probes/011-273/`; spec 011 C4 step 5, C5 (focused row), C15; reviews `reviews/0.1.377.md`, `0.1.378.md`, `0.1.378-r2.md`.

Seam and lead: `Promotions.add` (`src/core/scheduler/promotions.ts:97`) drops a wait with no open file; keep it until its deadline. Then the successor import beside `publishedBatches` (same file) in `bootstrap.ts`/`handover.ts`; then `writeFocused` (`focused-row.ts:113`) keeps an open wait's files past `FOCUSED_FILES`. Row 011-207's re-send in `src/cli/status-wait-paths.ts:308-324` should become unnecessary: remove it. Any other special case for named-wait order you find: route it through `Promotions` or remove it, never a parallel path. List each in the notes.

Owns: `promotions.ts`, `focused-row.ts`, `handover.ts`, `bootstrap.ts`, `promoted-tier.ts`, the N1 boundary in `queue.ts`/`tiers.ts` only, `src/cli/status-wait-paths.ts`, the pending-reason text in `src/cli/named-file-lines.ts`, new tests under `test/scheduler/` and `test/cli/`, `tasks/011-283/notes.md`. Leave alone: `test/scheduler/runs.test.ts` and `test/scheduler/helpers.ts` (W2), `retries.ts`, `slow-tier.ts`, keys.

Done when: the six "First slice" tests of the research, each red before, plus a status test for the retry and slow reasons, text and JSON; existing promotion, batch and focused tests pass; lint and typecheck pass.

Stop and report when the rule needs a change to tier selection beyond N1, to retry or slow order, or to key meaning.

## W2: row 011-281 (trace the crash/re-key test's stalled phase)

Use /worker. Shape: survey, then repair only on proof. Repository tests only.

Outcome: the next CI stall of `test/scheduler/runs.test.ts:118` names its phase, and any stall a trace or code reading proves is bounded.

Read: board row 011-281; `research/ci-intermittent.md` section 3 and `probes/ci-intermittent/`.

Seam and lead: add phase entry and exit marks (baseline, child rewrite, child exit, `runner.run`, refinement, idle, cleanup) in the test and `test/scheduler/helpers.ts:64-173`; on timeout, print the last phase and keep the run logs and store under the test's tmp dir, named in the failure. Bound the unbounded idle waits with a clear failure message.

Owns: `test/scheduler/runs.test.ts`, `test/scheduler/helpers.ts`, `tasks/011-281/notes.md`. Leave alone: all of `src/` (report a proven product stall; do not repair it), W1's files.

Done when: a forced stall in each phase (a test-only hook) fails within its bound and names the phase; the test passes 5 of 5 runs alone; lint and typecheck pass. No timeout raise or shard retry.

Stop and report when the trace points to `src/` or to Vitest.
