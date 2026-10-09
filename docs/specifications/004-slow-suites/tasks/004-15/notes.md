# 004-15 notes: the slow-tier line, the failure line, the primer and `stop.requireSlowSuite`

Seam map left for whoever continues.

- `readHeader` (`src/core/state/header.ts`) now reads the worktree's policy itself, from the root in its `worktrees` row (`worktreeSlowView`, `src/core/state/slow.ts`), so every caller, `src/cli/status-wait.ts` included, gets `slowPending` and `slowTier` with no new parameter. Without a `worktrees` row or a slow glob both stay absent, so headers of repositories without a slow tier are unchanged. A caller's `isSlow` still wins for `slowPending` (Stop's poll passes it, sparing a policy read per poll).
- The line's states come from the store (`classifySlowFiles`: a slow file is `pending`, `current` when every check is current, else `notRun`) plus the daemon's published activity (`src/core/slow/state.ts`, meta key `slow-tier:<worktreeId>`). The activity is a reason only: it is read only while a slow file is pending and left out when no daemon is validating.
- `currentAt` is the oldest observation among current slow results; "sources changed since" is any revision after it changing a path the slow files' declared input globs do not match.
- `slowTierText` (`src/core/state/slow-text.ts`) is the one renderer: delivered headers and registrations (`headerLines` in `src/core/delivery/format.ts`), Stop's status text, `squeal status`. HH:MM is local time.
- `SlowTier` publishes in five places (`src/core/scheduler/slow-tier.ts`, `#publish`): empty slow queue clears; fast work pending; no trigger (waiting for the agent to pause); slot missed; the load guard's `sleep`; selection (running, with the ledger's last `durationMs`). Nothing is published at a run's end: the next `next()` call does it. 004-18 moving slow runs to their own lane should keep a call to `#publish` at selection and at the empty queue.
- Slow failures: `attribute()` sets `TransitionEntry.slowArtifact` from the declared input globs of the file (all of them, fixtures included: what the run was declared to read), and drops `changesInClosure`.
- Primer: `primer(command, nodeTest, slow)`; Claude Code vs Codex is told by `command === SQUEAL_COMMAND` (Codex always names the CLI by its path). `primerVariants` feeds Codex's `capContext`.
- Not done: `references/reports.md`, `commands.md` and `policy.md` of the skill do not yet describe the slow-tier line, `run --slow` or `stop.requireSlowSuite`; only both `SKILL.md` do, as the brief scoped.

- 2026-10-09, 004-23: a run's activity is now retired when the run is recorded, discarded or re-queued (review wave 2 B1); the line above about nothing being published at a run's end no longer holds.
