# Wave 42

From main after 0.1.325 (`def5dc915`), 2026-10-25. Two rows of the human's triage round 10, on disjoint seams: a load retry that runs after a bounded wait (W1, gh-92), and Stop news that waits for the next boundary (W2, gh-93). Host load is about 40 on 24 CPUs, so the wave holds at two. 011-224 (`src/core/retry/records.ts`) follows W1. 011-209, 011-217, 011-219, 011-221, 011-222 and 011-201 follow.

## W1: 011-213, a load retry runs once after waiting 600 s for the load gate

Use /worker. Shape: slice. Row 011-213 in `docs/board.md` (gh-92).

Outcome: a `squeal retry <file> --reason load` that the load gate keeps from running runs once after 600 s with the load note, and status says how long the gate has been closed while it waits.

Read the row; `docs/triage/2026-10-25-digest.md` section B; `research/issue-92.md`; spec 011 C5 and 004 D3 (`slow.maxDeferMs`).

Seam: `takeRetries` (`src/core/scheduler/retries.ts:41`) and the load guard's deferral in `src/core/scheduler/slow-tier.ts:91-126`. First edit, offered as a lead: keep the time a load retry first met a closed gate, and let `takeRetries` take its run once 600 s have passed. Send one request with your answer to the row's open question (does that run use fewer workers?) and with the status line, before you write them.

Owns `src/core/scheduler/retries.ts`, the load guard's deferral, `src/core/retry/text.ts`, `src/cli/retry.ts`, an additive field in `src/core/retry/records.ts` if the time needs one, the retry lines of the three `plugins/*/skills/squeal/references/commands.md`, and their tests. Not yours: `src/core/delivery/` (W2), the trimming in `records.ts` and `kept.ts` (row 011-224), the board, spec text, `status.md`, bundles, version. No `npm run build`.

Done when the row's four cases pass, and lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted). Run every test command with `env -u PLUGIN_ROOT -u PLUGIN_DATA`. Paste the output.

## W2: 011-215, status-only liveness news at Stop waits for the next boundary

Use /worker. Shape: slice. Row 011-215 in `docs/board.md` (gh-93).

Outcome: in both adapters, a Stop whose only news is a liveness or hold change is silent, and the change goes out at the next tool or prompt boundary.

Read the row; `docs/triage/2026-10-25-digest.md` section C; `docs/specifications/002-codex-adapter/research/issue-93.md`; spec 002 D3, 011 C8, and task 001-224 (the edit line at Stop).

Seam: the Stop path of `src/core/delivery/delivery.ts`, near line 222, where code changes at a Stop are told only beside other news (015 D6, D7). First edit, offered as a lead: the same rule for a liveness or hold change with no test transition, no unmet gate and no action. Keep the Stops the row lists as news: a daemon down with no successor, an overdue handoff that names `squeal start` (`test/status/stopping.test.ts:132-135`), and a handoff that ended short (011-140).

Owns `src/core/delivery/delivery.ts`, `header.ts` if the text changes, `evals/lib/squeal-text.mjs` if the parser needs it, and their tests. Not yours: `src/core/scheduler/`, `src/core/retry/`, `src/cli/retry.ts` (W1), the board, spec text, `status.md`, bundles, version. No `npm run build`.

Done when the row's five cases pass in both adapters. If a header changes, the evals parser gate round-trips it from the real formatters, plain and in hook JSON. Lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted). Run every test command with `env -u PLUGIN_ROOT -u PLUGIN_DATA`. Paste the output.
