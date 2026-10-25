# Wave 40

From main after wave 39's candidate went to review (cand/0.1.318), 2026-10-25. Three rows on disjoint seams, so they run in parallel: a busy store at `retry` (W1), `squeal start` under load (W2), and the runtime-gone fixture race (W3). The host's load is about 10 on 24 CPUs. 011-207 and 011-213, which share `src/cli/retry.ts` with W1, wait for it.

## W1: 011-212, `retry` retries a busy store write within a bound

Use /worker. Shape: slice. Row 011-212 in `docs/board.md` (gh-86).

Outcome: `squeal retry` under a store another process holds queues its request once within 10 s, or says how long it waited and that another process holds the store, with a non-zero exit and no stack trace.

Read the row; `docs/triage/2026-10-25-digest.md` section B; `research/issue-86.md`; spec 011 C13, and C5's status-read busy sentence (011-01, 011-113) for the wording.

The bound is 10 s for the whole command, my choice under the human's approval of the row: each try is the whole `askRetry` or `askNoResultRun` transaction, with `busyBackoffMs` between tries (`src/core/store/busy.ts`).

Seam: `src/cli/retry.ts`, the `askRetry` call at line 222 and `askNoResultRun` at 200. First edit, offered as a lead: one helper that runs a transaction again while the store is busy and returns the answer or the time it waited.

Owns `src/cli/retry.ts` and `test/cli/retry*.test.ts`. Not yours: `src/cli/retry-unlisted.ts`, `start.ts`, `src/core/`, the board, spec text, `status.md`, bundles, version. No `npm run build`.

Done when the row's four tests pass; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted). Run every test command with `env -u PLUGIN_ROOT -u PLUGIN_DATA`. Paste the output.

## W2: 011-214, `squeal start` waits 30 s and tells a starting daemon from a failed one

Use /worker. Shape: slice. Row 011-214 in `docs/board.md` (gh-94).

Outcome: `squeal start` exits 0 once the daemon answers and is recorded within 30 s, 3 with "still starting" and `squeal status` when the process lives past the bound, and 1 when it ended without an answer.

Read the row; `docs/triage/2026-10-25-digest.md` section C; `research/issue-94.md`; spec 011 C9.

Seam: `src/cli/start.ts:26` (`SPAWN_WAIT_MS`) and `served` at `:232`. First edit, offered as a lead: `ensureDaemon` (`src/core/daemon/ensure.ts:186-197`) also returns the spawned pid, additively, so `start` can ask whether the process lives.

Owns `src/cli/start.ts`, `src/core/daemon/ensure.ts`, the `start` lines of the three `plugins/*/skills/squeal/references/commands.md` copies, their tests. Not yours: hook behaviour (unchanged), `squeal stop` (001-436), `retry.ts` (W1), the board, spec text, `status.md`, bundles, version. No `npm run build`.

Done when the row's three cases pass with a fake clock or a stub process, not a 30 s sleep; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted). Run every test command with `env -u PLUGIN_ROOT -u PLUGIN_DATA`. Paste the output.

## W3: 011-216, the runtime-gone case waits for the queued states before it deletes the runtime

Use /worker. Shape: repair. Row 011-216 in `docs/board.md`.

Outcome: `test/daemon/runtime-gone.test.ts:169-177` writes `SHARED`, waits until its six files read queued, then deletes the runtime directory and waits for the exit.

Read the row; row 011-106's case in the test file.

Owns `test/daemon/runtime-gone.test.ts`. No `src/` change. Not yours: everything else, the board, spec text, `status.md`, bundles, version. No `npm run build`.

Done when the case passes 20 of 20 alone at the host's load, and fails with a deliberate break that starts a tier after the deletion and with one that loses the queued states (revert both breaks; name them in the final message); lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted). Run every test command with `env -u PLUGIN_ROOT -u PLUGIN_DATA`. Paste the output.
