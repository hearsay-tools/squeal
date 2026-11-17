# 005 wave 27: one registration sequence; presence decides each state once; store-check leftovers

Rows 005-117, 005-118 and 011-392, from the quality scan `quality/2026-11.md`. The human chose them on 2026-11-17. Coordinator: session 4d2ecbfc. Three workers, disjoint. No behaviour change in any of them: these are unifications.

Baseline: the candidate `cand/0.1.554` (main 0.1.553 plus rows 005-114, 005-115, 005-116, in review). The line numbers in the quality file are from before 0.1.551: find each place by name.

Rules for all: no `pnpm run build` in your worktree, no version raise, no full suite. Read Squeal's verdict on your changed paths before you report, but do not wait longer than 20 minutes for a queue under host load: then run the test files of the directories you changed directly, one at a time, `timeout 900`, and say which you ran. The bundle tests fail on drift until the coordinator builds, which is expected. Grep `test/`, `test/e2e/**` and `evals/**` for anything you rename. Write `~`, never a `/home/<user>/` path. Never run a script under `evals/bin`.

Scope for each worker: its board row in `docs/board.md` and the row of the same content in `quality/2026-11.md` ("Board rows"). Read both in full; they name the files, the functions and the done-when. The points below only add what changed since the scan.

## W1: 005-117, one helper registers, starts the daemon and hands the text over

Use /worker. Shape: slice. Quality row `proposed-register-one-sequence`. The contract of the "registration text sent" rule is decision C of row 005-98 with its repairs (`reviews/0.1.541.md`, `reviews/0.1.546.md`, `reviews/0.1.546-r2.md`; `tasks/005-98/notes.md`, `tasks/005-107/notes.md`): the text reaches the session once; twice only when a start was killed between its output and its mark; never zero times. Every existing test of that rule passes unchanged (`test/harness/register-first*.test.ts`, `registration-owed*.test.ts`, `register-fails.test.ts`, the Pi and OpenCode e2e files run directly). The unverified point in the quality row (a Pi or OpenCode session that registers at a boundary may get the primer twice): write the test first; if it is true, fix it inside the helper and say so; that one is a behaviour change the coordinator accepts.

Owns: `src/harness/shared/{session,prompt,deliver,owed}.ts`, `src/harness/pi/{session,run}.ts`, `src/harness/opencode/bridge.ts`, their tests. Leave alone: `src/core/**`, `src/harness/shared/stop*.ts`.

## W2: 005-118, presence decides each state once

Use /worker. Shape: slice. Quality row `proposed-presence-one-decision`, parts (a) to (d). Since the scan, row 005-111 added the stopped start (`startStopped`, `withStartState`, the note `start stopped`) and its review repair (a stopped start is said over a quiet rest, `views.ts` `newsChange`), and row 005-115 changed `readLiveHeader` to an options object: keep all of that as it is. Prove equality with the `test/presence` row table before and after; `test/presence/reads.test.ts` (review 0.1.403-r2 B2), `test/harness/starting-*.test.ts` and `test/harness/rowless-start-readers.test.ts` pass unchanged.

Owns: `src/core/presence/**`, `src/core/delivery/liveness.ts` (the short-late-heartbeat rule only), their tests. Leave alone: `src/core/delivery/{header,format}.ts` (row 005-119 follows you), `src/harness/**`.

## W3: 011-392, no code or comment describes the start-time store check

Use /worker. Shape: slice. Quality row `proposed-store-check-leftovers`, parts (a) to the end. The two spec paragraphs it names: propose the new wording in `tasks/011-392/notes.md` (under `docs/specifications/011-core/`); the coordinator lands spec text. The part about a mark cut short reported as a full-check fault: if it needs a behaviour change, describe it and stop there.

Owns: `src/core/store/{mark,open}.ts`, `src/core/daemon/{open,full-check}.ts` (comments and the option only), `src/core/status/open.ts` and `src/core/types/store.ts` (comments), `test/store/**`, `test/daemon/{open,open-recovery,store-fault,resumed-after-signal}.test.ts`. Leave alone: everything else.

Final message, each worker: the commit, what moved or went away with file names, any behaviour change found, check results with their commands.

## Review brief: candidate 0.1.557

Use /reviewer. Candidate `cand/0.1.557`, three unification rows from the quality scan, built on top of `cand/0.1.556` (rows 005-114, 005-115, 005-116, reviewed and passed as candidate 0.1.554: do not review its commits). Review only the range your task names; its last commit is the version raise with the built bundles and two amendment lines in the 001 and 011 specs (CI checks the bundles against the build: do not review bundle text). Contracts: sections W1 to W3 above, the board rows 005-117, 005-118 and 011-392, and the rows of the same content in `quality/2026-11.md`.

The claim of each row is "no behaviour change", with one stated exception. Your main task is to find a behaviour change.
- **005-117** (`registerAndHandOver`, `src/harness/shared/owed.ts`; `HookDeps.registrationPrimer`). The rule it must keep is decision C of row 005-98 with its repairs (`reviews/0.1.541.md`, `reviews/0.1.546.md`, `reviews/0.1.546-r2.md`): the registration text reaches the session once; twice only when a start was killed between its output and its mark; never zero times; a registration that fails still starts the daemon (row 005-102); register first, then start (row 005-98). Check each of the five callers against its code before the row, in each harness (Claude Code, Codex, Pi session and run, OpenCode). The stated exception: Pi's tool boundary and OpenCode's tool result and prompt registrations no longer carry the primer beside the system prompt's copy; confirm no path now has zero primers. What the worker left: `handing?` optional, the `{ primer }` type defined twice in `src/core`.
- **005-118** (`src/core/presence/**`, the short-late-heartbeat rule moved out of `src/core/delivery/liveness.ts`). The worker changed expected values in the presence row table: three rows where the removed `presenceState` and `toldOf` disagreed, and three 12 s late-heartbeat rows that now expect no news at the presence level (the rule ran one step later before). For each, show that what a hook, Stop and `squeal status` say is the same as on the base. Rows 005-111 (stopped start, said over a quiet rest) and 005-115 (`readLiveHeader` options) must hold; review 0.1.403-r2 B2 (`test/presence/reads.test.ts`).
- **011-392** (`markStore` moved to a test fixture; `checkIntegrity` became `recoverFaults`; comments). Part (d) of the row was not done and is not in this candidate.

Test policy: no full suite. Read CI for `cand/0.1.557` for the full-suite result. Run single test files directly where you need them, one at a time, with `timeout 900` (the Pi and OpenCode e2e files are outside Squeal's coverage). Never run a script under `evals/bin`. No artificial load.

Write `docs/specifications/005-agent-adoption/reviews/0.1.557.md`: PASS or FAIL first, then blocking findings (B), should-fix (S) and notes (N), each with file and line and a failing scenario.

### Re-review after the repair of B1

The first review (`reviews/0.1.556.md`, written when this candidate had the number 0.1.556) failed at `8d5e92042` on B1: Pi lost every primer when the store appeared after `before_agent_start`. The repair is the commit "fix(005-117)" after the helper's test commit: the Pi extension records whether this run's `before_agent_start` set the primer section and sends `primed` on the boundary request; `toolBoundary` leaves the primer out only then. OpenCode needed no change; a late-store test covers it. Bounded re-review: B1 is closed in both orders (store before the session start, store after it), never zero primers and never two; the repair breaks nothing the first review passed; rows 005-118 and 011-392 are unchanged from the first review. Write `reviews/0.1.557-r2.md`: PASS or FAIL first.
