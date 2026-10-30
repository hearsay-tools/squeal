# Wave 60: rows 011-271 and 011-272 (the first approved rows of 2026-10-30), research 011-273 and the CI diagnosis

Coordinator 339e9539, 2026-10-31. The human approved these rows on 2026-10-30 (board, Triage rows gh-119, gh-114, gh-110, gh-116, gh-123, gh-125, gh-127 and 011-266 S2). W1 and W2 land as one candidate, version 0.1.380. gh-113 needs no work: its repair shipped in 0.1.370.

Host policy for every task here (2026-10-25): no local full suite, no `squeal run --all`; every test command with `env -u PLUGIN_ROOT -u PLUGIN_DATA`; private `/tmp` fixtures only; never make CPU load on purpose; no real cezar runs. No `pnpm run build`. Not yours: the board, `spec.md`, `status.md`, bundles, version. Read affected results with `squeal status --wait 60000 <paths>`.

## W1: row 011-271 (gh-119: `run --slow --wait` waits through delayed acceptance)

Use /worker. Shape: repair, one commit.

Outcome: `squeal run --slow --wait <ms>` never exits 1 only because the scheduler took the request after 10 s; it waits within its one budget.

Read: board row 011-271; `research/issue-119.md` and its probe `research/probes/issue-119/`; spec 011 C4, C6, C15; spec 004 D2, D8, D9.

Seam and lead: `taken()` in `src/cli/run-slow.ts` uses `RECORD_WAIT_MS` and ignores `wait.waitMs`. Give it the caller's deadline when `--wait` is set, and subtract the time it used from the budget passed to `statusWaitCommand`. A budget that ends while the request is pending exits 3 with one line that names the request and `squeal status --wait`. Without `--wait`, a pending request after 10 s prints the receipt and exits 0: it was accepted, it did not fail. Update the docstring and the `run --slow` help lines in `src/cli/main.ts`.

Owns: `src/cli/run-slow.ts`, the `run --slow` help lines in `src/cli/main.ts`, `test/cli/run-slow*.test.ts`, `tasks/011-271/notes.md`. Leave alone: `src/cli/retry.ts`, `src/core/retry/`, the retry help lines (W2), the scheduler.

Done when: tests, red before: delayed acceptance past 10 s with `--wait` reaches its verdict; a budget that ends pending exits 3 with the pending line; without `--wait` a pending request exits 0. Kept: prompt acceptance, no daemon (1), a failed or unsupported request (1), a failing slow result, a hold. Lint and typecheck pass.

Stop and report instead of widening when the fix needs a scheduler or daemon change, or a new exit code.

## W2: row 011-272 (gh-114: a retry receipt says queued)

Use /worker. Shape: repair, one commit.

Outcome: a retry receipt and a pending retry in status say the retry is queued and what holds it; they never say it runs now when it does not.

Read: board row 011-272; `research/issue-114.md` and its probe `research/probes/issue-114/`; spec 011 C5, C6, C10, C15; spec 004 D2, D8; spec 005 D6.

Seam and lead: `src/cli/retry.ts:243` ("runs once more now"), `src/core/retry/text.ts:56` ("runs at once") and the low-load branch of `loadRetryWhenText` there; `src/core/status/outstanding-text.ts:229` renders the pending group. The receipt says "queued"; status names a known blocker from recorded state (fast work, the slow slot, load) or says it is unknown, and says "running" once the run started. Check where the skill or primer repeats the old words.

Owns: `src/cli/retry.ts`, `src/core/retry/`, `src/core/status/outstanding-text.ts` and `outstanding.ts`, the retry help lines in `src/cli/main.ts`, their tests, `tasks/011-272/notes.md`. Leave alone: `src/cli/run-slow.ts` (W1), the scheduler and its order.

Done when: tests, red before: receipt and pending status for a slow retry behind fast work, behind an occupied slot, while running, after it completed, and with no blocker evidence; text and JSON agree; the failure stays counted until a pass. Lint and typecheck pass.

Stop and report instead of widening when the blocker cannot be read without a new scheduler field; then the words say "queued" and "blocker unknown" only.

## R1: row 011-273 (research: one rule for named waits)

Use /researcher. Shape: research. No product code.

Outcome: one rule for named waits that the human can approve: what a wait owns, for how long, across a daemon handover, and what it may overtake. Each open wait issue is a case of the rule, not a patch.

Read: board rows gh-110, gh-116, gh-123, gh-125, gh-127, 011-265 to 011-269; `research/issue-110.md` in spec 004, `research/issue-116.md`, `issue-123.md`, `issue-125.md`, `issue-127.md`, `named-wait-batches.md`, `issue-79-gate.md`; `reviews/0.1.377.md`, `0.1.377-r2.md`, `0.1.378.md`, `0.1.378-r2.md` (what failed, and why twice); spec 011 C4 steps 4 and 5, C9, C10, C15 and the `status.md` lines of 2026-10-28 to 2026-10-30; `docs/process.md` step 6.

Seam: `src/core/scheduler/` (`promoted-tier.ts`, `tiers.ts`, `queue.ts`, `yields.ts`, `retries.ts`), the named wait in `src/cli/status-wait.ts`, the daemon handover. Cheap replays may reuse `research/probes/011-267/` and `research/probes/issue-79/`.

Answer: (1) the rule in five sentences or fewer; (2) per item (gh-110, gh-116, gh-123, gh-125, gh-127, 011-266 S2): what it gives today and under the rule; (3) two or three options, each with the effect a user sees, one example and its cost (code size, risk, what gets slower); (4) which current rules and code it replaces; (5) the C4/C15 sentences it changes; (6) a first slice's done-when as tests.

Done when: `research/named-wait-rule.md` is committed with an evidence tag on every finding; probes under `research/probes/011-273/`.

Stop when the six items cannot share one rule: then say which split is needed and why.

## R2: board row `ci-40592034593` (diagnosis of intermittent CI failures)

Use /researcher. Shape: research, a diagnosis. No product code; no repair.

Outcome: the cause of each intermittent CI failure the row names, or the evidence still missing.

Read: the board row under "Repository coordination"; CI runs 40592034593, 40774288680 and 40853153243 (`gh run view <id> --log-failed`); `.github/workflows/ci.yml`.

Failures: `test/harness/codex/runtime-update/lock-process.test.ts` (one of three real processes, PID got 0; twice); `test/daemon/step-down.test.ts` (equal/newer daemon untouched, empty alive list); `test/scheduler/runs.test.ts` "runs a file again when a batch during its crashed run gave it a new key" (timed out at 240 s on a docs-only push).

Method: read each test and the code it drives; name the race or timing it depends on. Run a single file at most ten times, alone, below the CPU count, never with added load.

Done when: `research/ci-intermittent.md` is committed with, per failure, the cause and its evidence tag, how often it fails, and a proposed repair row's scope and done-when.

Stop after about 90 minutes with what is known.
