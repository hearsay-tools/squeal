# Wave 44

From main after 0.1.329 (`93e66377e`), 2026-10-26. Four rows on disjoint seams. W1 closes 0.1.325's known limit (the human's decision card c63f05ef). W2 is the human's triage round 10, W group C. W3 and W4 are repo-local test rows. Host load is about 17 on 24 CPUs. Verification follows `docs/process.md`, "Test runs on a shared host" (2026-10-25): no `squeal run --all` and no local full suite.

## W1: 011-224, the request history writes the fact of each request it drops

Use /worker. Shape: slice. Row 011-224 in `docs/board.md`.

Outcome: a named wait never asks a second run at a key whose earlier request the history trimmed, whoever stored that request.

Read the row; `reviews/0.1.322-r2.md` B2 and its repair scope; 011 C15's 011-207 amendment and its known-limit sentence; `tasks/011-207/notes.md`, "Review 0.1.322 repairs".

Seam: `writeRetries` (`src/core/retry/records.ts:96`) and `keptRetries` (`src/core/retry/kept.ts:86`). First edit, offered as a lead: in `writeRetries`' transaction, before the trim, write the `retries-asked` fact of each request it drops and of each kept request it reads, in one batch. Keep the 4,096 bound. No new column (C7). Before you write it, send one request with the rule for a request that an older Squeal stores and drops before a new Squeal sees it. Say whether a user can see the effect.

Owns `src/core/retry/records.ts`, `kept.ts` and their tests. Not yours: `src/core/scheduler/`, `src/core/status/`, `src/cli/` (W2), `src/core/daemon/` (W3, W4), the board, spec text, `status.md`, bundles, version. No `npm run build`.

Done when the row's legacy-origin tests fail before the fix and pass after it. Requests are stored by the released 0.1.323 writer, then trimmed by both trims. Run lint and typecheck, then `squeal status --wait 60000 <changed paths>`. Run every test command with `env -u PLUGIN_ROOT -u PLUGIN_DATA`. Paste the output.

## W2: 011-209, a wait shows the work in flight

Use /worker. Shape: slice. Row 011-209 (gh-91, gh-87).

Outcome: during and after a queue yield, a named wait says what was cut, when and why. It also says how many files of the running tier have ended.

Read the row; `research/issue-91.md` F1 to F5 and its open questions (the row answers both); 011 C6, C15; row 011-51 (the `yields` JSON).

Seam: `NOT_INTERRUPTED` (`src/core/status/next-step.ts:57`), which the running line uses whatever the yield standing, against the queued line's `yields` read (`src/core/status/standing.ts:219-224`), F1. `TierYields.ended` (`src/core/scheduler/yields.ts:206`) drops the standing (F2). `Tier.ended` (`src/core/scheduler/tiers.ts:79`) is F4. First edit, offered as a lead: the running line reads the same standing as the queued line. Send one request with the new line texts before you write them.

Owns `src/core/scheduler/yields.ts`, `tiers.ts` (read only, unless the ended count needs an accessor), `src/core/status/next-step.ts`, `standing.ts`, `src/core/types/standing.ts`, `src/cli/named-file-lines.ts`, `evals/lib/squeal-text.mjs` if the parser needs it, and their tests. Not yours: `src/core/retry/` (W1), `src/core/daemon/` (W3, W4), the board, spec text, `status.md`, bundles, version. No `npm run build`.

Done when `issue-91.md`'s F1 to F4 cases fail first and then pass. Also add one case for the unlisted line, and one that shows no yield after a restart, with a line that says so. If a header changes, the evals parser gate round-trips it from the real formatters. Run lint and typecheck, then `squeal status --wait 60000 <changed paths>`, with `env -u PLUGIN_ROOT -u PLUGIN_DATA`. Paste the output.

## W3: 011-225, the vacant waiter's lost-lock case under load

Use /worker. Shape: repair. Row 011-225.

Outcome: the cause of the case's one failure is named with evidence and fixed.

Read the row; commit `febcbce2a` (the waiter decides once more); `test/daemon/vacant-wait.test.ts:161`.

Seam: the waiter's second read in `src/core/daemon/open.ts`, as 0.1.329 left it. First step, offered as a lead: find the order of events in which the case gets a ready daemon instead of `{ reason: "lost-lock" }`. Decide from that whether the test or the product is wrong. If the product is wrong, send one request before you change `open.ts`.

Owns `test/daemon/vacant-wait.test.ts`; `src/core/daemon/open.ts` only on the waiter's path, after the request. Not yours: `slow-instance.ts` and its test (W4), `src/core/retry/` (W1), `src/core/status/` and `src/core/scheduler/` (W2), the board, spec text, `status.md`, bundles, version. No `npm run build`.

Done when the fix's test fails without it, or the case waits for the state it asserts. The case must pass 20 of 20 alone at the host's load, with the load stated. Then lint, typecheck and `squeal status --wait 60000 <changed paths>`, with `env -u PLUGIN_ROOT -u PLUGIN_DATA`. Paste the output.

## W4: 011-228, a test reaches `drop()`'s second catch

Use /worker. Shape: slice. Row 011-228.

Outcome: a test fails if the catch at `src/core/daemon/slow-instance.ts:41` is removed.

Read the row and `test/daemon/slow-instance.test.ts` (row 011-211's B4 test is the pattern).

Seam: `drop()` in `withSlowInstance`. First edit, offered as a lead: in a test, an earlier instance's close rejects. Then a later slow instance opens, and the daemon's close still closes it once and resolves.

Owns `test/daemon/slow-instance.test.ts`. Not yours: product code, `vacant-wait.test.ts` (W3), the board, spec text, `status.md`, bundles, version. No `npm run build`.

Done when the test fails with the catch removed and passes with it in place. Show both, then restore the source. Lint, typecheck and `squeal status --wait 60000 test/daemon/slow-instance.test.ts src/core/daemon/slow-instance.ts`, with `env -u PLUGIN_ROOT -u PLUGIN_DATA`. If the tree's code checks run, they name no uncovered line in `slow-instance.ts`. Paste the output.
