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

## D1: triage digest for gh-64, gh-75, gh-76 and gh-77

Use /worker. Shape: survey, docs only.

Outcome: `docs/triage/2026-10-23-digest.md` lets the human decide the four proposed friction rows in one round.

Read `docs/process.md` "Issue triage"; the board's Triage rows gh-64, gh-75, gh-76 and gh-77; their research files (`011-core/research/issue-64.md`, `issue-75.md` to `issue-77.md`, and `running-tier-yields.md` for gh-64's hold); the GitHub issues (`gh issue view <n> --comments`); `docs/triage/2026-10-22-digest.md` as the model.

Write the digest: group the rows by theme (gh-75 and gh-77 share the daemon handover), name overlaps with shipped and planned rows (for example 011-30 to 011-34, 011-110 in 0.1.264, 011-113 in 0.1.266, 011-111 in 0.1.270, 011-122, #1), and say for each issue which reported versions predate which fix. Give one recommendation per group with what it costs and a cheaper option. Commit that one file. No board, spec or code edits, and no reproduction runs.

## R1: review of cand/0.1.271

Use /reviewer. Shape: review. Pinned to `cand/0.1.271` at 70bd5840f959e706f84a89bc82ad6487778f065f; the range is `origin/main..70bd5840f` (`origin/main` at 5a7d78971): W2's three commits (011-67, worker 9bc1c8e9), W4's two (011-55, worker d0d65d20), W1's two (005-81, worker 3e274f1c), one docs commit (005 D3, 011 C5 and C15, `status.md`), W3's three (006-95, worker 7f2b05cc), the 006 `status.md` commit and the release commit (0.1.271, bundles).

Read `docs/specifications/011-core/tasks/wave-18.md` (W1 to W4), the notes under `005-agent-adoption/tasks/005-81/`, `011-core/tasks/011-67/`, `011-core/tasks/011-55/` and `006-model-evals/tasks/006-95/`, board rows 005-81, 011-67, 011-55 and 006-95, the amended 005 D3, 011 C5 and C15 sentences, and the four new `status.md` lines. Check that:
- 005-81: every Codex hook but SessionStart spawns from the kept copy when no copy exists yet and no daemon answers; a hook that spawns nothing, or finds a daemon, copies nothing; a successor after a handoff spawns from the copy; a hook with no `PLUGIN_ROOT` or `PLUGIN_DATA` spawns from the cache as before; SessionStart and `squeal start` are unchanged; the extra probe costs nothing on a hook that finds a daemon;
- 011-67: the load retry command shows in status, the registration report and `why` only at or above one load per CPU and only with no retry asked; the threshold is `loadAllows`'s; the counts and the queue are unchanged; the command is the surface's own (the hook's command, the CLI name), with the path from the reader's cwd where the surface uses one; `why --json`'s `recorded` is additive (approved in requests 9b4a5a91 and f5fff724, which widened W2 to `format-status.ts`, `delivery/format.ts`, `why.ts`, `format-why.ts`, `types/status.ts` and `src/cli/main.ts`'s `why()`);
- 011-55: a promoted file under another worktree's live claim makes no tier yield, and selection's own claim test is the one used; a promoted file with no claim, or that is work an edit caused, still makes the tier yield; `hasPromoted`'s reordered filter keeps its result;
- 006-95: the `alive()` order fix is right for a zombie and for a reaped pid; a failure names the pid; the 300 ms fake daemon stop proves the teardown waits; no `evals/` file changed;
- `test/keys/key-format.test.ts` passes with `KEY_FORMAT_VERSION` unchanged; the version is 0.1.271 in all eight places; the bundles match the tree; the four launchers are byte-identical.

Run `npm ci`, then the test files W1 to W4 added or changed, directly. Never run a script under `evals/bin/` yourself, `--help` included. The full suite is CI on the candidate and the coordinator's locked gate (`.ai/cezar/t/04a258b0/logs/gate-w18.log`); a gate log names only failing files. Row 011-122 is a known flake. Write `reviews/0.1.271.md` under `docs/specifications/011-core/` with a PASS or FAIL verdict and commit it alone.
