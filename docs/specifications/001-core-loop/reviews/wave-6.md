# Wave 6 review

Reviewer task 001-49 for spec 001, 2026-10-06. Range `e442e04..1f1a372` (8 commits). It covers task 001-48 (forked-agent SubagentStop, defect 9), task 001-47 (interactive consumer liveness and the re-armed waiter, defects 8 and 10), the bundle rebuild and the D9/D10 amendment. I read it against D9 and D10 as amended in `status.md` (the 2026-10-06 wave 6 line). The contract is `tasks/wave-6.md` and `lessons.md` (re-run: Interactive, Surprise 6, Defects 8 to 10).

## Verdict

Defects 8, 9 and 10 are gone in the cases `lessons.md` recorded. I re-ran them with Claude Code 2.1.291, attended, on a scratch fixture:

- **Defect 8.** Claude Code still runs no SessionEnd after a typed prompt (5 of 5 exits here). Every consumer sampled was expired by the daemon between 10 min 4 s and 10 min 47 s after it was last heard from, and its lock file was removed. Each fixture daemon then idled out 5 minutes later (re-run table below).
- **Defect 10.** After a waiter wake and an Esc, a waiter was armed: Claude Code runs UserPromptSubmit for the turn a waiter wakes, so the turn's own UserPromptSubmit re-armed it before the interrupt. That is better than the brief assumed: the session does not wait for the user's next prompt.
- **Defect 9.** No fork registered a consumer or was blocked in a session without `--agent`.

Lint, typecheck, build and tests are green. The committed bundles match a fresh build. The core does not import from the harness.

Two gaps remain, both outside the cases the lessons recorded:

- **S1.** UserPromptSubmit registers silently unless known failures exist. This takes the registration header away from every attended session that starts in a repository without a store: seen in A8, whose transcript has no `SQUEAL` header. After a waiterless expiry it can also seed away a recovery the agent was never told.
- **S2.** Under `claude --agent <name>` the fork is not detected. With `stop.blockOnKnownFailures` on, its SubagentStop is blocked on every attended turn: defect 9, reproduced here twice in one session. A SubagentStop for an agent id that was never registered is a sound signal for this case, and the review recommends using it.

Counts: 0 blockers, 2 should-fix, 5 nits.

## Verification

```
$ npm ci
npm warn install-scripts 2 packages have install scripts not yet covered by allowScripts:
npm warn install-scripts   @parcel/watcher@2.6.0 (install: node scripts/build-from-source.js)
npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)

$ npm run lint
Checked 323 files in 76ms. No fixes applied.

$ npm run typecheck
tsc --noEmit   (no output, exit 0)

$ npm run build
tsc -p tsconfig.build.json && npm run build:plugin   (exit 0)
$ git status --porcelain
(empty: committed plugins/claude-code/dist/ is byte-identical to the fresh build)

$ npx vitest run                                   (load average 3.1 at start, 5.7 at end)
 Test Files  102 passed (102)
      Tests  805 passed | 5 skipped (810)
   Duration  47.12s
```

The 5 skips are the @parcel/watcher tests that run only on darwin. A second run before committing, at load average 8 to 13, gave 804 passed | 6 skipped (lint, typecheck and build unchanged). The extra skip was a latency-budget test that skips itself above load 8 (`test/runners/vitest/run.test.ts`, warm-instance budget).

### Probes

All scratch lived under `/tmp/sq6`, outside every checkout. The plugin was a `git archive 1f1a372 plugins/claude-code` copy loaded with `--plugin-dir`. The fixture is the lessons fixture (4 modules, 4 test files, 24 checks), with a fresh `git init`, `squeal init` from that plugin, and `.claude/settings.json` deleted so the marketplace copy could not load beside it. Policy: `stop.blockOnKnownFailures: true`, `stop.waitMs: 1500`, `daemon.idleExitMinutes: 5`. The idle period was shortened in policy, not in product code, so the idle exit could be seen in this task. `fix2` and `fix3` are copies with their own store and daemon. Claude Code 2.1.291, `claude-sonnet-5-5`, `CLAUDE*` and `CEZ_*` variables removed, `--debug hooks`. A logger read the consumers, the lock files (held or free, by a lock attempt) and the waiter processes every 30 s.

**Hook latency** (seam 4). Cold runs of the bundles against `fix3`'s store (24 checks, daemon alive, one consumer registered), 40 runs per round, best of 3 rounds, load average 2.2 to 2.9:

| Hook | p50 / p95 ms | p95 of each round |
| --- | --- | --- |
| post-tool-batch, quiet | 62 / 67 | 82, 72, 67 |
| user-prompt-submit, registered (touch, a write) | 64 / 70 | 89, 70, 71 |
| user-prompt-submit, `-p`, registered | 61 / 65 | 65, 94, 68 |
| user-prompt-submit, attended, re-registers | 66 / 76 | 76, 110, 85 |
| waiter, `-p` guard | 59 / 65 | 73, 67, 65 |
| `node -e 0` | 52 / 56 | 59, 89, 56 |

UserPromptSubmit costs about what a quiet PostToolBatch costs: within the 80 ms p95 that D9 sets for PostToolBatch, which is the only hook budget D9 states. Not measured on this repository's 885-check store; the registered path is one row read and one row write, so it should not grow with the store, but registration does (18 ms more than a quiet PostToolBatch at 885 checks in `lessons.md`).

**`-p`** (seam 4). One `-p` session on `fix3` (`--include-hook-events`): both UserPromptSubmit hooks started and returned exit 0 with no output, PostToolBatch and Stop ran, the session ended in 4.2 s, and SessionEnd removed its consumer.

**Lock probe against a starting waiter** (seam 1). A throwaway copy of `lock()` from `src/core/waiter-lock/waiter-lock.ts`: one process probing as `waiterLockState` does, in a tight loop, against another acquiring and releasing as a starting waiter does.

```
alone:        acquires 534, refused 0
beside probe: acquires 21933, refused 21641
probe:        21497 probes, mean 139.2 us held
```

A waiter that starts while the daemon's probe holds the lock is refused and exits silently. The daemon probes only consumers idle for more than 10 minutes with a free lock file, once a minute per consumer per daemon, so the window per pass is about 0.14 ms (N1).

**`--agent` fork** (seam 3). `fix3` with `.claude/agents/helper.md`, `src/money.ts` broken (5 failures current at revision 1), `claude --agent helper`, one typed question. Debug log: the main agent's Stop blocked, as the policy says. Then the `prompt_suggestion` fork's SubagentStop was blocked (`Hook SubagentStop (SubagentStop) success: {"decision":"block","reason":"Squeal policy stop.blockOnKnownFailures is on and 5 known failures exist at revision 1: ...`). The fork made a second `source=prompt_suggestion` request. The same happened after the continued main turn: 2 forks, 2 blocks, 4 fork requests. Neither fork had a consumer row before its SubagentStop. Both rows were gone after the session, because a second, silent SubagentStop unregistered them (S2).

## Blockers

None.

## Should-fix

### S1. UserPromptSubmit registers silently, so an attended agent can miss its header and a recovery

- **Where:** `src/harness/claude-code/hooks/user-prompt-submit.ts:30-38`. D9, SessionStart bullet: "In a repository that has no store yet, SessionStart only spawns the daemon and the first PostToolBatch registers and injects the header". D9, UserPromptSubmit bullet: "in an interactive session whose consumer expired while idle, ... register again, speaking only when the registration carries known failures".
- **What is wrong:** the hook registers any unregistered consumer of an attended session, not only one that expired, and it applies the Stop rule to it. The Stop rule exists because "any Stop context starts another model turn". UserPromptSubmit context starts no turn: it rides on the prompt the user just sent. So nothing is saved by the silence.
- **Failure scenario 1, observed (A8):** fresh store. SessionStart only spawned the daemon: no consumer, no waiter. The user typed a question. UserPromptSubmit registered the consumer at 15:14:14 with no output, and the waiter armed beside it. Every later PostToolBatch found the consumer registered with an empty delta. The session transcript contains no `SQUEAL` header, only the skill listing. Before this wave the first PostToolBatch registered and injected the header. So the agent never learned the revision, the pending counts or that a daemon was validating. This is the first session after `squeal init`, which is the first impression Squeal makes.
- **Failure scenario 2, inferred from the code:** an agent was told `PASS -> FAIL` for check X. The session sits idle: the waiter times out at 59 minutes and touches the consumer. Someone else's edit then fixes X. 10 minutes later the daemon expires the consumer (the view goes with it). The user types; UserPromptSubmit registers, and `register` seeds X as passing. `knownFailures` is empty, so nothing is said. The agent's last word on X is still FAIL, and no later hook will contradict it. Failures still current are restated in the header, which is the header's job, not a repeat.
- **Suggested fix:** when UserPromptSubmit registers, inject `formatRegistration(registration)` always, as SessionStart and PostToolBatch do. Keep the registered path silent. Tests: a fresh store's UserPromptSubmit injects the header; an expired consumer with an untold recovery gets the header with 0 known failures; `-p` still registers nothing. Amend D9 (sentence below).

### S2. Forks under `claude --agent <name>` are still blocked; use "never registered" as a second fork signal

- **Where:** `src/harness/claude-code/hooks/stop.ts:71` (only `isFork` routes to `forkStop`), `stop.ts:135-140` (`newsText` registers an unknown subagent), `src/harness/claude-code/fork.ts:20-29`. D9: "Under `claude --agent <name>` a fork reports `<name>` like a real subagent of that type and is not told apart."
- **What is wrong:** under `--agent`, each attended turn's `prompt_suggestion` fork goes through the real-subagent path. Stop registers it, then blocks it when the policy is on and a failure is current. With the default policy and known failures, Stop returns the registration as SubagentStop context instead. Whether Claude Code feeds that to the fork was not tested.
- **Failure scenario, observed (`--agent` probe):** 2 attended turns gave 2 fork blocks and 2 extra fork API requests. That is defect 9 as `lessons.md` recorded it, for every user of `--agent` with the policy on.
- **Judgement on the signal:** use it. A real subagent is registered by SubagentStart. If that hook failed (killed at its 2 s timeout under load, or no store yet), its first PostToolBatch registers it. A subagent that reaches SubagentStop with no consumer row therefore ran no tool and edited nothing. A block or a registration header gives it nothing to act on. Forks send no SubagentStart and, on 2.1.291, no other hook, so they always arrive unregistered. The empty `agent_type` rule can stay as the first check.
- **Suggested fix:** in `stop.ts`, a SubagentStop whose consumer has no registration goes to `forkStop`'s behaviour: no registration, no block, no output. Test: `subagent-stop.json` with `agent_type: "helper"` and no SubagentStart, policy on, one failure current: no block, no row. The existing "a subagent without an agent type is still blocked" test registers first, so it still holds. Amend D9 (sentence below).

## Nits

- **N1. The daemon's lock probe can refuse a starting waiter, and a waiter can take the lock between the probe and the expiry transaction.** `src/core/waiter-lock/waiter-lock.ts:67-74` probes with `busy_timeout = 0` (`:80`), and so does `acquireWaiterLock` (`:28-31`). Probe above: a waiter starting inside the 139 µs hold is refused and exits silently, so no waiter runs until the next Stop or prompt. Separately, `expireConsumers` (`src/core/delivery/delivery.ts:209-217`) releases the probe and then opens the transaction. A waiter that takes the lock in that gap, before its UserPromptSubmit sibling touches the consumer, has its consumer expired under it. It then exits as "unregistered" and removes its lock file, while UserPromptSubmit registers the consumer again, which leaves no waiter. The in-transaction staleness re-check covers a hook's touch, not a lock taken in the gap. Both windows are under a millisecond, once a minute, and only for consumers idle for 10 minutes with a free lock file. Fix: hold the probe's lock across the transaction and the unlink, as `removeWaiterLock` already does for the unlink. Give `acquireWaiterLock` alone a `busy_timeout` of about 20 ms, so it waits out a probe and still exits fast beside a live waiter.
- **N2. The in-transaction re-check has no test.** `delivery.ts:211-213` is the only guard against expiring a consumer a hook touched after `idleSince`. `test/delivery/expiry.test.ts` never touches between the two. A store whose `consumers.idleSince` returns a stale snapshot is enough to test it.
- **N3. D9's idle-waiter paragraph was not amended.** `spec.md:141`: "started by SessionStart and Stop", "the next Stop re-arms it". UserPromptSubmit arms it too, Claude Code runs UserPromptSubmit for a waiter-woken turn (this review), and a timed-out waiter touches its consumer. The waiter's own comment (`hooks/waiter.ts:9-13`) and the README already say so.
- **N4. PostToolBatch and PreToolUse do not check `isFork`.** `hooks/post-tool-batch.ts:16` registers any unknown agent id. Forks fired neither hook on 2.1.291, and a fork that did would be unregistered by `forkStop` at its SubagentStop, so the cost is bounded. With S2 the guard is needed less. Add it only if a later Claude Code version gives forks tools.
- **N5. Every daemon of a store runs the waiterless pass over every worktree's consumers.** `consumers.ts` `idleSince` has no worktree filter, like `expire` before it. Two daemons probing one lock can each read "held" from the other's probe and skip a pass, which is harmless. Scoping the pass to the daemon's own worktree would halve the probes and the N1 window with two worktrees. Optional.

## What fits

So that later work does not re-check these:

- **The shared lock (seam 1).** `src/core/waiter-lock/` holds the path, acquire, remove and the three-state probe. The harness re-exports it (`src/harness/claude-code/waiter-lock.ts`). Nothing under `src/core` imports from `src/harness`. The probe never keeps the lock. `removeWaiterLock` unlinks only under a fresh lock, so the daemon never deletes a held file. Expiry applies the 12 h rule first and removes those consumers' free lock files. It then expires waiterless consumers one transaction each, re-reading the record, and removes the lock file only after the row is gone. Subagents and `-p` sessions have no lock file and keep the 12 h rule. Tests cover held, absent, 9 minutes, 11 minutes, the exact boundary, a delivery as heard from, and the real daemon timer.
- **Waiter timeout and the trade (seam 2).** `waiter.ts:61-63` touches only on its own deadline (`outcome === null`), not after a wake or an unregistered exit. The alternative the brief offered, a timed-out waiter removing its lock file, would have put that session back on the 12 h rule. A session idle past 59 minutes and then closed would leak for 12 hours. With the touch, the same session expires 10 minutes after the timeout. The cost is a re-registration at the next prompt for a user idle more than about 69 minutes, which is cheap once S1 makes it speak. Nothing is told twice: `register` seeds the new view, and the old view went with the old row. Only S1's silence loses anything. The right trade.
- **UserPromptSubmit (seam 4).** It touches a registered consumer (one write, p95 70 ms) and arms the waiter beside it; a second waiter exits on the lock (`test/harness/waiter.test.ts:140`). In `-p` it registers nothing, and the waiter guard returns before opening anything. It does not interact with the SessionStart sweep: the sweep runs at `startup` and `resume` before any prompt, and `register` is one transaction. After SessionEnd no prompt can come. After `/clear`, the new session id is registered by its own SessionStart.
- **Forks (seam 3).** `input.ts` keeps an empty `agent_type`. A missing one is a real subagent. SubagentStart of a fork does nothing, not even an ensure. `forkStop` unregisters only a row an older build left. The waiter refuses any `agent_id`. Session-start, stop, waiter and user-prompt-submit cannot register a fork without `--agent`. Post-tool-batch and pre-tool-use could only if a fork ran a tool (N4). Recorded fixtures: the SubagentStop one is from a real session; the SubagentStart one is synthetic, which `recorded/README.md` says.
- **Spec D10 as amended matches the code**, including "has not been delivered to or heard from for 10 minutes" (`idle()` reads both columns) and "its lock file removed".
- **Bundles.** Rebuilt once after both rows, byte-identical to `npm run build`. `hooks.json` has the UserPromptSubmit pair, and `test/harness/plugin.test.ts` asserts it.

## Re-run (attended)

| Id | Fixture | Steps (UTC) | SessionEnd | Waiter | Consumer gone after last heard from | Lock file | Squeal said |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A8 | `fix`, no store before it | one typed question at 15:14:14, `/exit` at 15:16:31 | none | armed by UserPromptSubmit, killed at exit (137) | yes: 10 min 47 s after 15:14:18 | removed with the row | nothing: no `SQUEAL` header (S1) |
| A6 | `fix` | one typed edit (`double` in `src/money.ts`), `/exit` at 15:17:10 | none | SessionStart's, killed at exit (137) | yes: 10 min 4 s after 15:17:01 | removed with the row | the SessionStart header |
| A11 | `fix` | one typed question, Ctrl-C twice at 15:17:10 | none | SessionStart's, killed at exit (137) | yes: 10 min 4 s after 15:17:01 | removed with the row | the SessionStart header |
| E1 | `fix2` | one typed question; `src/money.ts` broken from outside (wake 1, 5 `PASS -> FAIL` at 15:17:52), then restored (wake 2, 5 `FAIL -> PASS` at 15:18:18); Esc 1.5 s into the woken turn; `/exit` at 15:18:44 | none | armed after the Esc: the woken turn's UserPromptSubmit started one 39 ms after wake 2; it ran until the exit killed it (137) | yes: 10 min 19 s after 15:18:18 | removed with the row | both wakes, as UserPromptSubmit blocking errors |
| G1 | `fix3`, `claude --agent helper`, 5 failures current | one typed question, `/exit` at 15:23:42 | none | SessionStart's, killed at exit (137) | not sampled; at 15:38:15 the store had no consumer and no waiter lock file | gone | the header; main Stop blocked once; both forks' SubagentStop blocked (S2) |

The logger sampled every 30 s, which bounds each expiry to a 30 s window (A8 10 min 17 s to 10 min 56 s, A6 and A11 10 min 0 s to 10 min 13 s, E1 10 min 0 s to 10 min 31 s). The exact figures come from the daemon's idle exit: it checks every 5 s, its expiry pass runs in the same tick, and it stops 5 minutes after the last tick that saw a consumer. Each store's last write is that stop (`fix` 15:32:00.7, `fix2` 15:33:32.0, `fix3` 15:38:14.6), so the last expiry of each fixture ran about 4 min 55 s earlier. The expiry pass runs every 60 s, so A8's was the pass 2 minutes before A6's, the first after 15:24:18.

## Inputs for the next wave

1. S1 and S2 are each one worker-sized change in `src/harness/claude-code/hooks/`, with no type change. They can run in one row, since `user-prompt-submit.ts` and `stop.ts` are disjoint.
2. Proposed spec sentences:
   - D9, UserPromptSubmit bullet: "`UserPromptSubmit`: re-arm the idle waiter, because an interrupted turn runs no Stop; Claude Code 2.1.291 also runs it for a turn the waiter wakes. Record a registered consumer as heard from. In an interactive session with no registration (a store created after SessionStart, or a consumer expired while idle), ensure the daemon, register, and inject the registration: context on a prompt starts no extra turn."
   - D9, SessionStart bullet, replace the no-store sentence: "In a repository that has no store yet, SessionStart only spawns the daemon, and the first UserPromptSubmit (interactive) or PostToolBatch registers and injects the header."
   - D9, SubagentStart and SubagentStop bullet, replace the last sentence: "A SubagentStop whose consumer was never registered is treated the same way: a real subagent is registered by SubagentStart or its first PostToolBatch, so one that arrives unregistered ran no tool, and under `claude --agent <name>` a fork reports `<name>` and is caught only by this rule."
   - D9, idle-waiter paragraph: "started by SessionStart, UserPromptSubmit and Stop ... Its `timeout` is explicit and long; expiry is silent, records the consumer as heard from (D10), and the next prompt or Stop re-arms it."
3. `lessons.md` gets this re-run as a dated section.
