# 001-416 notes: SubagentStop's unregister and the subagent's cwd

Wave 15 W1. Commit: `7e558b23`. The design is option A, chosen by the coordinator on 2026-10-15 with two conditions:

- the grace derives from the hook timeout;
- any later boundary clears the mark, and the drop stamps a departure.

## Why not "unregister first, then wait"

SubagentStop's closing news is `onToolBoundary(stop)`, after the wait. It reads several things that `drop` deletes:

- the consumer's view;
- its told liveness and revision;
- its registration slot, which attribution's "touches files changed here since this session started" uses;
- its edit state.

Unregistering first would lose the news. Worse, the empty told liveness would make the closing message say "a daemon is validating again" and keep the subagent going for nothing.

Two alternatives were set aside:

- **Computing the news against an in-memory copy of the view and slots:** it duplicates `deliver`'s header, attribution and liveness path.
- **A process-clock deadline with a backstop timer:** it fails when the store is locked (the busy handler blocks the event loop) or when Node's start used up the budget.

## The rule, as proposed for D9 or D10

> **D9, SubagentStop.** Before it ensures the daemon or waits, SubagentStop marks its consumer leaving, as the time of the mark. The mark is a per-consumer `meta` row (`leaving:<worktree>`), like the turn state. A block clears the mark and keeps the registration. A delivery at any later boundary of that consumer also clears it: PostToolBatch, PreToolUse's peek, or UserPromptSubmit, every one except the stopping hook's own. So a subagent that kept working is never dropped. The normal end unregisters as before, and that removes the mark.
>
> **D10, consumer expiry.** At each heartbeat, the daemon drops every consumer of its worktree whose leaving mark is older than `LEAVING_GRACE_MS`. That is five hook timeouts (10 s), long enough that the SubagentStop which wrote it has finished or been killed. The mark is read again in the removing transaction. The drop stamps the worktree's departure, as a SubagentStop's unregister does, so the departure grace and the idle period then apply. A SubagentStop killed at its hook timeout therefore leaves a registration that ends within the grace plus one heartbeat (about 15 s), not at the unused stop (30 min) or the 12 h expiry.

Spec sentences this replaces or qualifies:

- D9: "(a blocking Stop keeps it)". Still true; the block now also clears the mark.
- D10: "a SubagentStop lost to its hook timeout leaves the consumer to this rule". The leaving rule now comes first, and the unused stop remains the backstop for a hook killed before it wrote the mark.
- D9: "Whether Claude Code's SubagentStart `cwd` is the isolated worktree was read from its bundle, not observed (task 001-416)". Now observed; see below.

## Seams

- `src/core/delivery/leaving.ts`: `markLeaving` (clearing writes only when a mark exists) and `leavingMarks`.
- `src/core/delivery/expiry.ts`:
  - `dropLeft(store, worktreeId, now, { locksDir })`, beside `dropGoneHarnesses`;
  - `forget` clears the mark.
- `src/core/daemon/lifecycle.ts`: the heartbeat runs `dropLeft` after the harness check.
- `src/core/delivery/delivery.ts`: `deliver` clears the mark when `heardFrom && !stop`. Stop's own `onToolBoundary(stop)` keeps it, or a SubagentStop killed after its news would leave nothing to drop.
- `src/harness/shared/stop.ts`:
  - `stopTurn` marks a registered subagent right after the fork check and before `ensureIfStale` and the wait;
  - a block clears the mark.
  - Codex's subagent stop runs the same function.
- **Constants:**
  - `HOOK_TIMEOUT_MS` moved to `src/core/types/store-records.ts` beside `LEAVING_GRACE_MS = 5 * HOOK_TIMEOUT_MS`;
  - `src/harness/shared/hook.ts` re-exports it, so its importers are unchanged.
- `WORKTREE_META_ROWS.leaving`, so a removed worktree takes the row with it.

## Tests

- `test/harness/subagent-leaving.test.ts`:
  - **A real SubagentStop, killed:** it runs in a child Node process through `test/harness/child/run-hook.ts` (tsx loader), with a queued file and `stop.waitMs: 1500`. The test SIGKILLs it as soon as the mark appears. The consumer is still registered with the mark. `dropLeft` keeps it at exactly the grace and drops it 1 ms later, stamping the departure.
  - **A SubagentStop that finishes:** it is marked while it waits, then unregistered with no mark.
  - **A block** clears the mark and keeps the registration.
  - **A later tool boundary** clears the mark, so `dropLeft` far in the future keeps the consumer.
  - **The stopping hook's own delivery** (`stop: true`) keeps the mark.
  - **A never-marked consumer** is left to the other rules.
- `test/daemon/leaving-timers.test.ts`, through the real timers with a test clock: a lone subagent marked leaving is kept at the grace, dropped 1 ms after it with the departure stamped, and the daemon then exits `sessions-gone` at the departure grace.

## The cwd probe: observed, not read

- **Setup:** the real `claude` 2.1.300 run as the throwaway `squeal-e2e` user (`probe/cwd-setup.sh`, `probe/cwd-run.sh`, fed through `sudo -u squeal-e2e sh -s`). The credentials were passed by name with `--preserve-env`, never the real HOME. It used a scratch git repo with logging hooks for SessionStart, SubagentStart, PostToolBatch and SubagentStop, and a project agent `iso` with `isolation: worktree`.
- **Run:** `claude -p --model haiku` asked for that agent to run `pwd && git rev-parse --show-toplevel`.

| Event | `cwd` | `agent_id` / `agent_type` |
|---|---|---|
| SessionStart | `…/probe-416/repo` | none |
| SubagentStart | `…/repo/.claude/worktrees/agent-a4e5ab63f6efefa75` | `a4e5ab63f6efefa75` / `iso` |
| PostToolBatch (subagent) | same worktree | same |
| SubagentStop | same worktree | same |
| PostToolBatch (main) | `…/repo` | none |

The subagent's own `pwd` and `git rev-parse --show-toplevel` both printed the worktree.

- **What this confirms:**
  - SubagentStart's `cwd` is the isolated worktree, so 001-415's session root for an isolated subagent is right as built.
  - Every subagent hook carries it as well.
  - The worktree is `agent-<agent_id>`, as 001-415 read from the bundle.
- **One more finding:** after the run, `git worktree list` showed only the main checkout. Claude Code removed the isolated worktree when the subagent ended with no changes. A daemon started in it then loses its root; spec 001 D10 exits it as `not-a-worktree`. The leaving rule covers the consumer either way.
- **Key sets:** SubagentStart's and SubagentStop's keys are exactly the ones 001-415's notes list.

The probe directory `/home/squeal-e2e/probe-416` is left in place under the throwaway user.

## Review 001-423

Repair of cand/0.1.197 on baseline `4e314ec4`.

### B1: a renewed subagent is never dropped by an old mark

A SubagentStop killed after its mark leaves the mark behind. Two paths went on under it:

- `register` replaced the row without clearing the slot;
- PreToolUse on a call that is not a peeked edit (Bash, Read, or any edit with `interrupt.onRegression` off) ran `resumeTurn`, which never cleared it and returned at once for a consumer already in a turn.

Fix (`1e29162d`):

- `register` clears the consumer's mark in its own transaction (`delivery.ts`). A Stop that registers an unregistered consumer has no mark to clear, since `stopTurn` marks only a registered one.
- `resumeTurn` (`turn.ts`) clears the mark in the transaction that resumes the turn, idle or not. It still reads first: a consumer in a turn and not marked takes no write lock (`isLeaving`, `leaving.ts`, a read).
- The stopping hook's own `onToolBoundary(stop: true)` still keeps the mark; the edit's peek already cleared it through `deliver`.

Tests, `test/harness/subagent-renewed.test.ts`, through real hooks with the main agent registered beside the child; the killed Stop is modelled by writing the mark, as the killed-Stop test in `subagent-leaving.test.ts` (kept) shows it is left:

- SubagentStart again, child in a turn and idle: mark cleared, `dropLeft` one past the old mark's grace keeps both consumers.
- PreToolUse Bash and Read, in a turn and idle; an edit with `onRegression` on and off: the same, and the child is in a turn.
- A main agent's PreToolUse leaves the child's mark: the child is still dropped, the main agent kept.
- `resumeTurn` on an unmarked consumer in a turn calls no `store.transaction`.

Without the fix, 7 of the 10 fail (the `onRegression` on case, the drop case and the no-lock case pass both ways).

The rule for D9, amending the proposal above: "A delivery at any later boundary of that consumer also clears it" becomes "its registration, and any later boundary of that consumer, PreToolUse on every tool included, also clears it, in the transaction that registers it or resumes its turn".

### Main run 38784562554: `test/daemon/unused-stop.test.ts:100` (001-415)

The failing line asserted the worktree's daemon record right after `ping` answered. The premise is false: the front desk is a worker thread that binds the socket and answers ping before the main thread's `#register()` commits (`daemon.ts` `start`: `#openDesk`, then `#register`), and that commit waits for the store's write lock under load.

Reproduced with `probe/ping-before-record.test.ts` (copy it to `test/daemon/` to run). It holds `BEGIN IMMEDIATE` on a second connection while a daemon starts:

```text
{"pingAt":226,"answer":true,"rowsWhileLocked":[{... "daemon_socket":null, ...}],"recordAfter":true}
```

Ping answered 226 ms after the spawn with no record; the record appeared once the lock was released. The product already covers this window: a hook tells a daemon it spawned with no heartbeat yet as starting (001-156). So the test premise was fixed, not the product (`246680b5`): the test waits for a record whose socket answers, and checks that it is the computed socket. Three local runs passed. It could not be made to fail on demand without holding the lock the hook itself needs.

### N1: the test pause is out of the shipped CLI

`pauseAt` (`src/core/daemon/test-pause.ts`) now publishes the point on the `squeal:test-pause` diagnostics channel and does nothing without a subscriber (`28a24ef1`). The SIGSTOP lives in `test/daemon/pause-preload.mjs`, which `testPause(point)` (`test/e2e/restart-evidence.ts`) loads with `NODE_OPTIONS=--import=<file URL>` beside `SQUEAL_TEST_PAUSE`. The spawned daemon inherits both: `ensure` spawns with the hook's environment, and `childEnv`'s scrub of `NODE_OPTIONS` happens before the overrides are added.

- Stopping at a point still needs code loaded into the process; `NODE_OPTIONS` already allows that, so the channel opens nothing new.
- The subscriber runs synchronously inside `publish`, so the stop is at the same instruction as before and does not race.
- `test/daemon/test-pause.test.ts` is the reviewer's probe as a regression: a plain child with only `SQUEAL_TEST_PAUSE=stop-gap` runs on and exits 0 (it hung until the timeout with the old pause), and with the preload it stops (`T`) and runs on after SIGCONT.
- The handover-gap and e2e stop-gap tests keep their stopped-process, socket and lock-holder assertions.
- `src/core/daemon` is guarded: key format 10 is re-pinned in place (`1c427b27`), unreleased.

The committed bundles still carry wave 15's env pause until the coordinator rebuilds them.
