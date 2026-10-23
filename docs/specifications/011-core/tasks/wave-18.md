# Wave 18 of spec 011

Four planned rows the coordinator chose on 2026-10-23 under the human's standing instruction ("If you are done with it before morning - grab the next piece yourself", 2026-10-22), from main with 0.1.270. W1 is spec 005's, W3 spec 006's; the coordinator runs both. Their files are disjoint, so they run in parallel. `src/core/scheduler/tiers.ts` is 3b94ca98's (row 011-120); no row here edits it. The candidate is 0.1.271 unless another lands first.

## W1: 005-81, a Codex hook spawns its daemon from the kept copy

Use /worker. Shape: slice.

Outcome: a Codex hook other than SessionStart that spawns a daemon before its version's copy exists spawns it from the kept copy, so Codex's next upgrade does not delete that daemon's runtime.

Read board row 005-81; `005-agent-adoption/tasks/005-77/notes.md` line 25; spec 005 D3 as amended 2026-10-21 (rows 005-73, 005-77).

Seam: `runMain` (`src/harness/codex/main.ts:13`), which falls back to the cache's CLI when `keptCodexCli` is `null`. A lead: `keptCacheCli` (`src/harness/shared/version-copies.ts:134`) or `keepCodexVersion` (`src/harness/codex/kept.ts:33`) only on the path that ensures the daemon, so a hook that spawns nothing copies nothing.

Owns: `src/harness/codex/` (`main.ts`, `kept.ts`, `handlers.ts`), `src/harness/shared/version-copies.ts`, their tests, notes under `005-agent-adoption/tasks/005-81/`. Not yours: `src/cli/start.ts`, `src/core/`, the board, spec text, bundles, version. No `npm run build`.

Done when: a test shows a PostToolUse and a Stop hook, run before any SessionStart of their version, spawn from the copy; a hook that spawns nothing makes no copy; SessionStart and `squeal start` are unchanged; the notes say whether a D3 sentence changes; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted), their output in your summary.

## W2: 011-67, a failure recorded under load names its load retry

Use /worker. Shape: slice.

Outcome: a known failure recorded at or above the load threshold, with no retry asked, names `squeal retry <file> --reason load` beside its recorded load. It stays counted, and nothing is queued (gh-52).

Read board rows 011-67 and gh-52; `011-core/research/issue-52.md` (Answers and Recommendation); spec 011 C5 (001-348, 001-368) and C6.

Seam: `recordedText` (`src/core/retry/text.ts:85`), read by `format-status.ts` and `delivery/format.ts`, and the load line of `squeal failures` and `why` (`src/core/status/replaced-failures.ts:212`). A lead: the threshold C5's load gate uses (`loadAllows`, `src/core/retry/load.ts:26`), read from there, never a second constant.

Owns: `src/core/retry/text.ts`, `recorded.ts`, the load line in `replaced-failures.ts`, their tests, notes under `011-core/tasks/011-67/`. Not yours: `src/core/scheduler/`, `src/core/daemon/`, `src/harness/`, the board, spec text, bundles, version. No `npm run build`.

Done when: the status, the registration report and `why` print the command for a failure at or above the threshold, not below it, and not when a retry was asked; the counts and the queue are unchanged by test; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted), their output in your summary.

## W3: 006-95, the run-cell S2 teardown test names the pid it finds alive

Use /worker. Shape: repair.

Outcome: `test/evals/run-cell.test.ts` "tears down the session, the daemon and the scratch when the runner is terminated (S2)" passes 10 of 10 runs beside a full suite, and a failure names the pid and its process group.

Read board row 006-95; 006 `status.md`, the S2 line (2026-10-11); CI 39774152045, job Node 22 (3/3).

Seam: the assertion at `test/evals/run-cell.test.ts:148` and `killRunning` (`evals/lib/session.mjs:167`). A lead: name which of `pids(f, "harness")` and `pids(f, "daemons")` stays alive first, then judge whether the teardown waits for the fake daemons (`test/evals/fake-cell.ts:165`).

Owns: `test/evals/run-cell.test.ts`, `test/evals/fake-cell.ts`, `evals/lib/session.mjs` (the teardown only), `evals/bin/run-cell.mjs` (the teardown only), notes under `006-model-evals/tasks/006-95/`. Not yours: the rest of `evals/`, `src/`, the board, spec text, bundles, version. Run the test file only; never run a script under `evals/bin/` yourself, `--help` included: it starts a real run.

Done when: the test passes 10 of 10 single-file runs while one full suite runs beside them (the full suite under `flock /run/user/$(id -u)/squeal-full-run.lock`, the loop outside it); the notes name the pid that stayed alive, or say why it could not be shown, and the cause; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted), their output in your summary.

## W4: 011-55, a promoted file under another worktree's claim makes no tier yield

Use /worker. Shape: slice.

Outcome: a promoted file whose key another worktree has claimed leaves the running tier in its lane alone, and its wait names the claim.

Read board row 011-55; `011-core/tasks/011-51/notes.md`, "Open for later rows"; spec 011 C15 and C7 (claims).

Seam: `queue.hasPromoted(inLane)` in the yield rule (`src/core/scheduler/yields.ts:250`, `queue.ts:309`), and the hold through a claim (`promotions.ts:33`). A lead: a regression first, a promoted file under a foreign claim beside a running tier, which yields today.

Owns: `src/core/scheduler/yields.ts`, `queue.ts` (`hasPromoted`), `promotions.ts`, their tests, notes under `011-core/tasks/011-55/`. Not yours: `tiers.ts` (3b94ca98's), `src/core/retry/` (W2), `src/core/status/` (W2 and the wait text: ask first), the board, spec text, bundles, version. No `npm run build`.

Done when: the regression fails before and passes after; a promoted file with no foreign claim still makes the tier yield; the wait names the claim; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted), their output in your summary.
