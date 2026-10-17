# 004-65 step 2: notes

Worker, 2026-10-17, against D7 and D8 as amended and accepted by the human that day (`amendment.md`). Decisions 1 to 5 below were sent to the coordinator as defaults and confirmed; 6 (Stop) was put in this slice by the coordinator.

## Seam map

- Policy: `SlowPrecondition` in `src/core/types/policy.ts`, on `SlowPolicy.precondition` and `NodeTestProject.precondition` (both optional, additive). Loader rule `slowPrecondition` in `src/core/daemon/policy-precondition.ts`, its own file so `policy-slow.ts` and `policy-node-test.ts` do not import each other.
- Check: `src/core/slow/precondition.ts`: `preconditionFor` (a node:test project's own replaces `slow.precondition`), `checkPrecondition` (exists first, then the command), `touchesPrecondition` (re-check rule), `argvText`.
- Scheduler: `src/core/scheduler/slow-skip.ts` (`SlowSkips`), owned by `SlowTier`. `SlowTier.next()` calls `gate` after the candidates and before the load guard. `Scheduler.#pass` calls `SlowTier.revised(paths)` after `preempt()` on each applied revision.
- Activity: `SlowTierActivity` gains `{ kind: "skipped", reason, since }` (additive). `liveActivity` shows it while no slow file is pending. `skippedReason(tier)` in `src/core/state/slow-text.ts` is the one reader every surface uses: the `Slow tier:` line, `slowTierState` (delivery, told once), `slowWaitCode` and `waitLine`, `skippedLaneVerdict` (`run --all`), and both Stop entries.

## Decisions the spec left open

1. **Where it is checked:** in `SlowTier.next()`, before the load guard, so a skip never waits out `slow.maxDeferMs`. Every queued slow file whose resolved precondition has the same source leaves the queue (`ledger.dequeue`, no result stored), and `checkpoints.failed(ref)` makes its checkpoint end `abandoned`.
2. **Re-check:** skipped files are queued again by `SlowSkips.revised` at a revision: any revision for a command, one whose paths an `exists` glob selects otherwise, and any revision whose policy no longer declares the same rule. `run --slow` and `run --all` queue them as any file not current. A met check is cached for its revision and rule, so a pass of several one-at-a-time tiers runs a command once.
3. **exists:** a literal path is `existsSync` (a directory counts). A glob walks from its literal prefix, stops at the first match, and skips `.git` and `node_modules` unless the glob names them.
4. **command:** `spawn` without a shell, cwd the worktree root, stdio ignored, `lowerProcess` (nice 10) on the child, SIGKILL at `timeoutMs` (default 10000). Reasons: `<argv> exited N`, `did not exit within N ms`, `was killed by SIG`, `could not start: <error>`, each followed by `(<source>.command)`. Per project the source is `nodeTest "<name>" precondition`.
5. **run --all:** an abandoned checkpoint with a skip says `has no verdict: its slow lane was skipped, <reason>, so it is not a full suite; its fast lane at revision N: <failures or why none>`, exit 1 on the fast lane's known failures, otherwise 3 (`src/cli/run-skipped.ts`).
6. **Stop:** the waiting entry counts a skip as over at once and blocks with `slowSkippedReason` (`src/harness/shared/text.ts`). The 2 s entry and SubagentStop (`stop.ts` `decide`) use the same reason in place of `slowSuiteReason`. "Once" is the existing `stop_hook_active` rule.
7. **D5's no-artifact note:** left out for a slow file whose precondition has not been met in this daemon (`SlowSkips.unmet`), so it gives way to the skip. Once the precondition is met, the note is written as before.
8. **Line wording:** `N not run at revision R, skipped: <reason>. Squeal runs them once the precondition holds[, and Stop holds the agent once naming it]; the next revision or \`squeal run --slow\` checks it again.`

## Remaining

- `squeal setup --check` listing a command precondition (D7, vision principle 8): the coordinator's own row.
- Bundles and the version: the coordinator's, at integration. `test/harness/plugin.test.ts` and `test/harness/codex/plugin.test.ts` fail on bundle drift until then.
- KEY_FORMAT_VERSION 11 re-pinned in place twice (ed37062d, 9875c347). 011-14 re-pins the same entry, so integration must re-pin once more after both land.
