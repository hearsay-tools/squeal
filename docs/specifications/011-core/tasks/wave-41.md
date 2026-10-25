# Wave 41

From main after 0.1.319 (`533929e94`), 2026-10-25. Two rows from the human's triage round 10 with the most sightings, on disjoint seams: a named wait that asks for the run it waits on (W1, gh-82), and a slow instance that frees its environment when its lane stops (W2, gh-78 with six sightings, and gh-90). Host load is about 42 on 24 CPUs, so the wave holds at two. 011-213 (`retry.ts`, after W1), 011-215, 011-209, 011-217 and 011-219 follow.

## W1: 011-207, a named wait asks one run of each stale or unknown file named by its own path

Use /worker. Shape: slice. Row 011-207 in `docs/board.md` (gh-82).

Outcome: `squeal status --wait <ms> <test file>` on a listed test file that is stale or unknown with nothing queued asks one run of it, as `squeal retry` with no reason does, and waits for that run, so one command gives the verdict.

Read the row; `docs/triage/2026-10-25-digest-waits.md` section B; `research/issue-82.md`; spec 011 C15 (a named wait, and the 011-206 amendment), 005 D2; the human's hold of 2026-10-20 in 011 `status.md` (files nobody named stay lookup-only).

Seam: `src/cli/status-wait-paths.ts`, at the named wait's first decided read, and `askNoResultRun` (`src/core/retry/records.ts:156`), which `retry` already sends. First edit, offered as a lead: one function that, from that read, returns the test files named by their own path to ask for, and asks them through the transaction `retry` uses, with 011-212's busy retry (`whileBusy`, `src/cli/retry.ts`).

Owns `src/cli/status-wait-paths.ts`, `named-selection.ts`, `src/core/retry/records.ts` if the ask needs a field, moving `whileBusy` to a shared module if you reuse it, the wait lines of the three `plugins/*/skills/squeal/references/commands.md`, their tests. Not yours: `src/core/scheduler/`, `src/core/delivery/` (W2), the board, spec text, `status.md`, bundles, version. No `schemaVersion` raise. Send one request with the line the wait prints when it asks, before you write it. No `npm run build`.

Done when the row's four cases pass, and a fifth: a wait that times out before the run ends says the run was asked and is pending; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted). Run every test command with `env -u PLUGIN_ROOT -u PLUGIN_DATA`. Paste the output.

## W2: 011-211, the slow instance frees its environment when its lane stops

Use /worker. Shape: slice. Row 011-211 in `docs/board.md` (gh-78, gh-90).

Outcome: the slow Vitest instance closes when a hold begins and after 60 s in which no slow tier could start, so a project's `globalSetup` teardown frees what it holds; the stop line names `squeal hold -- <command>`.

Read the row; `docs/triage/2026-10-25-digest.md` section A; `research/issue-78.md`, `issue-90.md`; spec 004 D2, 013 V1, 011 C9 (*Holds*), 011-163's drain bound in 011 `status.md`; `test/scheduler/model-scheduler.test.ts` (row 011-195).

Seam: `#releaseIfDrained` (`src/core/scheduler/scheduler.ts:1019`) and `src/core/daemon/slow-instance.ts`. First edit, offered as a lead: one close path for the slow instance that the hold's start and a 60 s timer from the last slow tier that could not start both call; a drained lane keeps today's path.

Owns those two files for the slow instance's life and the hold path, the stop line in `src/core/delivery/header.ts`, `src/core/status/status-detail.ts` and `outstanding-text.ts`, the hold paragraph of the three `commands.md` copies, `evals/lib/squeal-text.mjs` if the text needs it, their tests. Not yours: `src/cli/status-wait*.ts`, `src/core/retry/` (W1), the board, spec text, `status.md`, bundles, version. No `npm run build`.

Done when the row's done-when holds with a `globalSetup` mark fixture; the model test passes and gains an invariant if the scheduler's states change; the evals parser gate round-trips the changed header, plain and hook JSON; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted). Run every test command with `env -u PLUGIN_ROOT -u PLUGIN_DATA`. Paste the output.
