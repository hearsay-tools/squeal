# Review: wave 10, 001-85 (task 001-86)

Reviewer task 001-86 for spec 001, 2026-10-07. Range `6d414e5..13d2cb5`: the 001-85 commits (`72a9f19` to `470afce`, dist rebuilt at version 0.1.8), plus the coordinator's test fixes `58fd776` (e2e header parser) and `13d2cb5` (bundled waiter test). I read the range against the 001-85 brief in `tasks/wave-10.md`, D6 and D9 as amended, `lessons.md` defect 14, and the vision's honesty rules.

The question for this review: can any transition now be lost, or delayed past the next prompt or tool boundary?

## Verdict

**PASS at `13d2cb5`.** Counts: 0 blockers, 5 should-fix, 6 nits.

- **Answer to the question.** I found no path where a difference stays in the view diff past the next prompt, tool boundary or Stop. Every difference the waiter does not deliver remains undelivered. `startTurn`, `onToolBoundary` and Stop all deliver it. A blocked Stop, a subagent's Stop, compaction and a wake with no UserPromptSubmit all behave as designed (probes below).
- **One path can lose a transition outright (S1).** It is a narrow race inside UserPromptSubmit's registration branch. The delta is delivered and its return value is dropped.
- **Two paths keep the waiter from waking an idle agent for the result of its own last edit.** In both, that result waits for a prompt that, for an autonomous agent, may never come. The first is a turn state that says idle while the agent is actually in a turn (S2). The second is a Stop that runs before the watcher records the edit (N1).
- **The waited-for set is never pruned (S3),** so an edit made from outside while the agent is idle wakes it if it touches a file that was pending at Stop.
- **The header names the latest revision's changes, not the edit a report is about (S4).** The skill says it names the edit.
- **The 80 ms budget is asserted nowhere for 0.1.8 (S5).** The latency test does not run the silent Stop, the path this row added the most work to.
- The six done-when cases are covered by recorded-hook tests, and mutations of the turn logic fail them (table below).

## Verification

The branch HEAD is `9955043`, one commit past the candidate. That commit changes only `docs/board.md` and `tasks/wave-10.md`, so the code is the candidate's. I ran everything at `9955043`.

```
$ git rev-parse HEAD
995504312edbe2830c8db2a4ce38e2974c09ef77
$ git diff --stat 13d2cb5 HEAD -- . ':!docs'
(empty)
$ npm ci
npm warn install-scripts ... (exit 0)
$ npm run lint
Checked 353 files in 116ms. No fixes applied.
$ npm run typecheck
tsc --noEmit   (no output, exit 0)
$ npm run build
(exit 0)
$ git status --porcelain
(empty: committed bundles match the build)
$ npx vitest run          (load average 15 to 30 on 24 cores)
 Test Files  121 passed (121)
      Tests  915 passed | 7 skipped (922)
   Duration  52.38s
```

The suite's latency test reported but did not assert: load was above 4.

### Mutations

I ran `test/harness/turn.test.ts`, `test/delivery/`, `waiter.test.ts`, `user-prompt-submit.test.ts` and `stop.test.ts` against each mutation, and reverted it before the next.

| Mutation | Fails |
|---|---|
| M1: the waiter's delivery does not start a turn (`delivery.ts:125`) | 2 |
| M2: `waitedFor` accepts every entry while in a turn (`turn.ts:118`) | 0: `select` returns `"silent"` first, so this guard is dead (N5) |
| M3: `endTurn` ignores undelivered entries (`turn.ts`, the `undelivered` loop) | 1 |
| M4: an in-turn consumer's waiter delivers the full delta (`delivery.ts:97`, `"silent"` replaced by `null`) | 5 |

### Probes

Throwaway tests, deleted before commit.

| Probe | Observed |
|---|---|
| A Stop blocked by `blockOnKnownFailures` (current failure, `stop_hook_active` absent) | Blocks; turn stays `in-turn`. The next Stop, with `stop_hook_active: true`, is silent and leaves the consumer `idle`. |
| SubagentStart, then SubagentStop while the main agent is in a turn | SubagentStop is silent; the main agent stays `in-turn`. The row keeps only the main agent's slot. |
| Two sessions on one worktree: A stops while B stays in its turn, then a regression lands | A's waiter wakes (exit 2). B's waiter stays silent (exit 0), and B's PostToolBatch carries the regression. The slots are separate. Read-modify-write runs under `BEGIN IMMEDIATE` (`connection.ts:43`), so no update is lost. |
| P1: a file pending at Stop, its own result quiet (pass to pass), then a later failing result while idle | The waiter wakes for the later `pass-to-fail` (S3). |
| P2: `register`, a result lands, then `startTurn` | `startTurn` returns `pass-to-fail`. The next `onToolBoundary` returns `null` (S1). |
| P3: `endTurn` before the revision of the last edit exists, then that revision fails | Turn `{idle, testFiles: [], newTestFiles: false}`. The waiter returns `null` (N1). |

### Compaction and the 0.1.7 store, by reading

- **Compaction.** `session-start.ts` returns before `register` when the source is `compact` and the main agent is registered, so its turn state is kept. A consumer that expired and is re-registered mid-turn gets `START_IDLE`, which waits for nothing, so it is harmless.
- **A 0.1.7 store opened by 0.1.8.** There is no schema step. A missing `turn:<worktree>` row reads as `START_IDLE`.
- **A 0.1.8 store opened by 0.1.7.** 0.1.7 reads `meta` only by key (`git grep "FROM meta" 6d414e5`: `notes.ts:47` and `store.ts:52`), so the new row is ignored.
- **Mixed versions.** A 0.1.7 daemon's `expireConsumers` leaves an expired consumer's slot behind. The next `writeTurn` prunes it. A 0.1.7 waiter still running after the upgrade speaks mid-turn, as before. No transition is lost either way.

### Hook latency

The latency test held this machine below load 4 nowhere, and it never asserts in CI: `latency.test.ts:127` returns when `process.env.CI` is set. So contrary to the brief's alternative, CI did not assert the budget. `status.md` records load 4.8 for the worker's run. This is S5 and is **unverified**.

I added two cases to a copy of the test: a silent Stop (no transition before the run, so `endTurn` runs) and a silent UserPromptSubmit. Each ran 40 cold runs, 3 times, on the committed `dist`:

| Hook | p50 (ms) | p95 (ms) |
|---|---|---|
| Stop, silent (ends the turn) | 73 to 80 | 85 to 111 |
| Stop, speaking (the suite's case) | 66 to 69 | 85 to 114 |
| UserPromptSubmit, silent | 60 to 65 | 82 to 99 |
| UserPromptSubmit, delivering | 58 to 68 | 66 to 115 |
| PostToolBatch | 63 to 68 | 78 to 95 |
| waiter (Node start baseline) | 36 to 46 | 41 to 68 |

These ran at load 12 to 14, and every hook is inflated: the bare waiter runs 36 to 46 ms. The silent Stop's p50 sits about 8 ms above the speaking Stop's in every run.

## Blockers

None.

## Should-fix

**S1. A result that lands during UserPromptSubmit's registration is delivered and dropped.**
- **Plausible** (the code path is proven; the window is the gap between two transactions).
- `user-prompt-submit.ts:45-46`: `register(consumer)` commits, then `await context.delivery.startTurn(context.consumer)` delivers any delta and writes it into the view, but the hook ignores the return value. P2 shows the delta is non-null when a result lands between the two calls and is never offered again.
- The window is widest right after `ensure` spawned a daemon and `settle` returned, which is exactly when the baseline run starts writing results.
- Fix (one worker, one line plus a test): do the turn write inside `register`'s transaction, or append `startTurn`'s delta to the registration text.

**S2. The turn state can say idle while the agent is in a turn, and only the waiter's own wake corrects it.**
- **Plausible.**
- Squeal's Stop writes `idle` when it is silent (`stop.ts:117`), but it is not the only Stop hook. Claude Code continues the turn when any Stop hook blocks: another plugin's loop hook, or a project hook. Likewise, a UserPromptSubmit that fails (busy timeout, hook killed) leaves the previous `idle`.
- In both cases the agent works while the waiter may speak. That is defect 14 again: the message lands at the next tool boundary, after PostToolBatch has delivered newer news.
- No tool boundary corrects the state: `onToolBoundary` (`post-tool-batch.ts:24`) never writes it.
- Fix: a tool boundary puts an idle consumer in a turn. That is one `meta` write, only when the state is `idle`, inside the delivery transaction. PreToolUse's peek could do the same. Test: a silent Stop, then PostToolBatch, then a waiter around a change to a waited-for file stays silent.

**S3. The waited-for set is never pruned, so an outside edit to a file pending at Stop wakes the agent.**
- **Proven** (P1).
- `endTurn` records test files, and `waitedFor` (`turn.ts:119`) matches any later entry of those files until the next turn. When the file's own result is quiet (pass to pass), the file stays in the set. A later edit by the user, or by another session on the worktree, that breaks it wakes the idle agent.
- This conforms to the literal decision ("only transitions of checks in that recorded set"). It contradicts 001-87's case "an edit made from outside while idle does not wake" whenever that edit touches a file the agent's last edit queued.
- Fix: record, per file, the key or revision it was pending at. Drop the file from the set once a result at or after that point is current, delivered or not. `endTurn` and `waitedFor` live in one file.

**S4. The header names the latest revision's paths; the skill says they name the edit a report is about.**
- **Proven** (by reading).
- `liveness.ts:56` takes `changedPaths` from the header's revision, the worktree's latest. A check that broke at revision 5 (`a.ts`) and is still current at revision 6 (`b.ts`, outside its closure) is reported under `Revision 6 (changed b.ts)`. A current entry carries no provenance line (`format.ts:113-117`).
- D6 as amended says exactly this ("the worktree's current revision and the paths it changed"), so the code conforms. But `SKILL.md:10` ends "so a report says which edit it is about", which teaches the agent to blame `b.ts`. This is the vision's "enough provenance to know which version of the code produced a result", read backwards.
- Fix, either:
  - (a) the skill says the header names what the latest revision changed, not what caused a change; or
  - (b) the header names the paths changed since the revision this consumer was last told about, a union over revisions. That is a D6 change and the coordinator's call.

**S5. The 80 ms p95 has not been asserted for 0.1.8, and the silent Stop is not measured at all.**
- **Unverified.**
- The suite's Stop case (`latency.test.ts`, `before: flip`) always speaks, so `endTurn` never runs under the timer. The worker's own run was at load 4.8, so nothing was asserted, and CI never asserts.
- Fix: add a silent Stop case and a silent UserPromptSubmit case to `CASES`, and have 001-87's attended run record the table on a quiet machine. A silent Stop now runs three store transactions (`onToolBoundary`, `endTurn` with a second `readHeader`). If it misses the budget, fold `endTurn` into the delivery's transaction.

## Nits

- **N1. A Stop that runs before the watcher records the last edit waits for nothing.**
  - **Plausible** (P3 proves the behaviour; the timing is the question).
  - The debounce is 100 ms quiet, 500 ms maximum (D3). A Stop that comes sooner records no pending file, and the regression from the agent's own last edit waits for the next prompt. That is most likely after a Bash command that writes files as it ends, followed by a one-word reply.
  - Possible fix: `endTurn` also records its time, and the waiter accepts entries of a revision created within the debounce maximum of it.
- **N2. Waited-for files include those pending from another session's edits on a shared worktree, so session A can be woken by session B's regressions.**
  - Conforms to D9 ("the test files pending at that moment"). Worth one sentence in D9.
- **N3. HEAD mismatch.** The candidate is `13d2cb5` and HEAD is `9955043`. That commit is docs only, so no code effect.
- **N4. `test/e2e/agree.ts:13`: `\(changed [^)]*\)` stops at the first `)`.** A changed path containing `)` breaks the parser. Use a lazy match anchored on `\): \d+ current`.
- **N5. `turn.ts:118` (`state.turn !== "idle"`) is unreachable from `deliver`,** which returns `"silent"` first (M2 survives). Keep it for direct callers, or drop it.
- **N6. Board drift.** `docs/board.md` marks 001-85 done in `9955043`, outside the range. Nothing to repair here.

## What fits

Don't re-check these:

- **Turn state in `meta`, one JSON row per worktree.**
  - Slots keyed `session\nagent`; every write goes through `writeTurn` inside a `BEGIN IMMEDIATE` transaction.
  - Unregistered slots are pruned on every write.
  - An unreadable row reads as `START_IDLE`.
  - No schema step, and both 0.1.7 and 0.1.8 open each other's store.
- **`register`, `unregister` and `expireConsumers` forget the slot.** SessionStart `compact` keeps it.
- **The waiter.**
  - `deliver({ idle: true })` reads the turn state twice: once read-only, then again under the write lock.
  - It delivers only `restrictPlan(…, waitedFor)`, writing only those view rows.
  - It starts a turn in the same transaction.
  - Liveness stays out of the waiter.
- **`startTurn` delivers the full delta with liveness in one transaction.** On a registered consumer, UserPromptSubmit returns it as context.
- **Stop.**
  - Silent: ends the turn.
  - Speaking or blocking: keeps the turn.
  - `stop_hook_active`: never blocks, so a blocked Stop's continuation ends the turn.
  - SubagentStop: never touches the main slot.
- **`endTurn` collects three sets:**
  - pending checks;
  - keyed pending files (an unkeyed file is never pending, `ledger.ts:240`);
  - undelivered entries.

  It adds `newTestFiles` while the runner part is pending, which admits only first-seen entries.
- **`changedPaths` on every delivered header (cap 3 plus "and N more").** The status header leaves it out, and `header.test.ts` pins that.
- **Coordinator fixes.** The e2e parser accepts the new header. The bundled waiter test ends the turn with a silent Stop first.
- **Dist and version.** `dist` matches the build; version 0.1.8 is in `package.json`, `plugins/claude-code/package.json` and `plugin.json`.

## Inputs for the next wave

- **001-87 (attended check).**
  - For "an edit made from outside while idle does not wake", edit a file whose tests were not pending at Stop, or expect a wake (S3).
  - Record the hook latency table on a quiet machine, with the silent Stop (S5).
  - After an Esc and a prompt, confirm the prompt context arrives before the model's first tool call.
  - If the session has any other Stop hook, note whether the waiter spoke mid-turn (S2).
- **001-88 (skill and primer).**
  - It owns `SKILL.md` and `format.ts`: fold in S4 (a) unless the coordinator picks (b).
  - Its SessionStart primer adds to SessionStart's latency, so measure it with S5's cases.
- **A small fix row before or beside 001-88,** owning `user-prompt-submit.ts`, `post-tool-batch.ts`, `src/core/delivery/turn.ts` and `delivery.ts`, and `latency.test.ts`. It covers S1, S2, S3 and S5, in that order of cost. Ownership must stay disjoint from 001-88: the fix row does not touch `format.ts`, `session-start.ts` or `SKILL.md`.
- **D9 wording for the coordinator.** N2, and S3's per-file pending point if adopted.
