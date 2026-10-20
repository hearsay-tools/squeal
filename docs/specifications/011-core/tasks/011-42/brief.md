# 011-42: a wait reads only what decides it, once a second

Use /worker. Shape: slice.

**Outcome.** A waiting `status --wait` (with or without paths) or `run --all|--fast|--slow --wait` costs almost no CPU. It polls once a second, and a poll that cannot end the wait reads no known state the wait does not hold for. Read C6 as amended 2026-10-20 (its last paragraph).

**Evidence.** On a copy of cezar's store (19,452 of 410,780 known states are main's), one poll of `ended()` in `src/cli/run.ts` cost about 430 ms of CPU. That's the unfiltered `knownStates.list` query (~343 ms), `readVerdict`'s grouping, which copies the array once per check (~81 ms; the largest file has 613 checks), and ~7 ms for the rest. At a 250 ms sleep, the waiting process held about 55% of a core.

**Seams and leads.**
- `src/cli/run.ts` `ended()`: read the checkpoint row and `revisions.latest` each poll. Call `readVerdict` only when the checkpoint has ended or at the deadline. `STORE_POLL_MS` becomes 1 s.
- `src/cli/status-wait.ts` (around line 245) and `status-wait-paths.ts`: poll at 1 s. Read the held files' states through `knownStates.list(worktreeId, files)`, which already exists, not every state.
- `src/cli/verdict.ts` `readVerdict`: read only `files`' states when they're given, and group in linear time.

**Ownership.** You own `src/cli/run.ts`, `run-slow.ts`, `status-wait*.ts`, `verdict.ts`, `wait-*.ts`, and their tests.
- Stay out of `src/core/store`, `src/core/state` and `src/core/scheduler`. The key-format guard covers them, and a change there re-keys every check at release.
- `src/cli` is exempt, so this row ships without a re-key. Note in the handoff any read that can't be served without leaving it.
- 011-26 and 011-27, both planned, touch `verdict.ts` and `status-wait-paths.ts`. This row lands first, and they rebase onto it.
- Leave `docs/board.md`, `spec.md`, `status.md`, versions and `KEY_FORMAT_VERSION` alone.

**Done when.**
- Tests show that each wait polls at 1 s.
- A `run --all --wait` poll on an open checkpoint, and a `status --wait` poll with nothing changed for its files, make no unfiltered `knownStates.list` call. Use a counting store.
- Every existing wait test passes.
- The handoff gives CPU per poll before and after on a cezar-sized store copy. Use the SQLite backup API; never the live store.
