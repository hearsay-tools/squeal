# Wave 14: the cezar session's feedback (2026-10-15)

The human picked these rows on 2026-10-15. All of them come from cezar session 74366d0f's feedback; its points are quoted in each board row. At most three workers run at once (host policy), so W4 waits for W1 to land: both touch `src/cli/run.ts` and the header's revision line. Leave `docs/board.md`, key pins and `plugins/*/dist` to the coordinator. Verify with `npm run lint`, `npm run typecheck` and `squeal run --all --wait`, and paste that output.

## W1: 001-403 and 001-404, a gap is named and a failure says how old it is

Use /worker. Shape: slice. Read the two board rows and spec 001's D5, D6, D7 and D12.

Outcome:
- An abandoned checkpoint and an `unknown` test file name the file and its reason, plus a few sample paths for a first-seen growth.
- A file whose run passed but recorded no result is named "ran, nothing recorded".
- Every known-failure line in a registration and in `status` carries its age and the host load at its run.

Seams:
- `src/cli/run.ts:155` (the abandoned text).
- `src/cli/verdict.ts`.
- The `markUnknown` callers in `src/core/scheduler/{ledger,failures,environment-growth,install}.ts`.
- `src/core/status/*`.
- `formatRegistration` in `src/core/delivery/format.ts`.

Lead: `failed-run-loads` (`src/core/retry/load.ts`) already keeps the load per CPU of each failing run, by run id. Join it on the result's `provenance.runId` and `recordedAt` rather than adding a store column.

Owns those files and their tests. Leave `awaitingInstallSentence` alone; W2 owns it.

Done when:
- The 001-403 test passes: a file that reads a new path each run ends the checkpoint with its path, its reason and sample paths, in both `run --all --wait` and `status`.
- A "ran, nothing recorded" test passes.
- Format tests pass: an old failure shows its age and load, and a fresh one reads "just now".

## W2: 001-405 and 001-410, hooks stay on the start root, and the no-install note says what an install gains

Use /worker. Shape: slice. Read both board rows and spec 001's D9.

Outcome:
- Every hook of a session uses the root its SessionStart resolved. A `cd` into another worktree starts no daemon and changes no header.
- The no-install note names the install command for the lockfile it finds, keeps the missing-workspaces form, and says what installing gains.

Seams:
- `src/harness/claude-code/run.ts:37`, `src/harness/codex/run.ts:35`, `src/harness/pi/{run,session}.ts` and the OpenCode harness.
- `src/harness/shared/*`, for where a session's root is stored.
- `awaitingInstallSentence` in `src/core/delivery/format.ts`, and `AWAITING_INSTALL_NOTE` in `src/core/scheduler/install.ts`.

Leave alone:
- `installSentences` in `src/core/delivery/provenance.ts`; 007-40 owns it.
- `formatRegistration` and the failure lines; W1 owns them.

Done when:
- Hook tests pass in each harness: a tool call whose cwd is another worktree starts no daemon there and reports the session's own root.
- Note tests pass for each lockfile kind and for the workspaces form, and the scheduler's note matches the header.

## W3: 001-409 and 001-411, `squeal failures` and duration stats in `why`

Use /worker. Shape: slice. Read both board rows and spec 001's D7 and D8.

Outcome:
- `squeal failures [--all-worktrees] [--since <duration>] [--json]` is a read-only command and starts no daemon. Rows come newest first and are capped.
- `why` gains a durations line for a single check, and a short line beside each candidate when a name matches several checks.

Seams:
- A new `src/cli/failures.ts`, beside `why`'s wiring in `src/cli/main.ts`.
- `src/core/status/why.ts` and `format-why.ts`.
- `src/core/status/open.ts`, for opening the store read-only.

Leave the load range out: it comes after W1 lands.

Owns those files, the `main.ts` usage lines and their tests.

Done when tests pass for:
- Failures from two worktrees.
- `--since`.
- The cap.
- The `--json` schema.
- Stats for one check, for several candidates, and for a check with a single result.

## W4 (after W1 lands): 004-61 and 001-406

Use /worker. Shape: slice. Read the two board rows, spec 004's D2, and spec 001's D2, D7 and D11.

Outcome:
- `--fast` and `--slow` select lanes, and a one-lane run is not a full-suite checkpoint.
- Under host pressure, fast files are granted first.
- The revision is shown as `revision N · <sha> + K`, with a dirty marker.

Seams:
- `src/cli/run.ts`, `src/cli/run-slow.ts` and `src/core/state/header.ts` (`fullSuiteText`).
- The pool's grant order (D11).
- `headerLine` in `src/core/delivery/format.ts`, plus `status` and `why`.

Done when the tests in both board rows pass.

## W2b: 001-405 for subagents, and 001-415's idle stop (the human, 2026-10-15)

Use /worker. Shape: repair plus slice. Baseline is W2's work (`refs/keep/w14-w2`, d54d553f); commit on top of it. Read the 001-405 and 001-415 board rows, spec 001's D9 and D10, `src/harness/shared/session-root.ts`, and W2's notes in `tasks/001-405/notes.md`.

Outcome:
- **A subagent's root:** at SubagentStart it comes from the subagent's own `cwd`, and that subagent's hooks keep it. A subagent in its parent's worktree is unchanged. A main agent's later `cd` is still ignored.
- **A subagent's registration:** it ends at SubagentStop, so its worktree's daemon stops after the existing idle grace once nothing else is registered there. First check what Claude Code's SubagentStart and SubagentStop hook inputs carry (an agent id, its `cwd`), and write that in notes. If they don't identify the subagent, say so and rely on the idle stop below.
- **Idle stop (D10):** a daemon with no edit, no tier running, no wait and no request for a set time stops, even while consumers stay registered. A hook starts it again on the next call. Pick the default (a lead: 30 minutes), and say whether user config can change it. Write the rule into D10, with a status.md line.

Seams:
- `src/harness/shared/session-root.ts`, `src/harness/claude-code/run.ts` and its subagent hooks.
- The daemon's lifecycle and idle-grace code under `src/core/daemon/`.

Done when tests pass for:
- An isolated subagent's tool call validates in its own worktree.
- That subagent's end lets its daemon stop.
- An idle daemon with a consumer still registered stops at the bound and restarts on the next hook.
- W2's existing session-root tests.
