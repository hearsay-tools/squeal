# 011-397: `run <group> <path>` moves a known queued file ahead (gh-181)

Wave 122 W2, shape repair. Evidence: `../../research/stuck-running.md` E1, E1b and shape 2 (b). One item was added by the coordinator from W3: the "listing" holder (section 3).

## 1. What changed

**Promotion (C15 batch).** `narrowRequest`'s stage (`src/core/scheduler/narrow-run.ts`) now calls `promoteNarrow` after `queueNarrow`. It promotes the group's selected files with `RunQueue.promote`, the same call a named wait's `promoteRequest` makes, with `answeredOf` facts. The selected files that are queued or running and in no batch form a batch after the others. A current file is not queued, so it joins no batch and does not run again (unchanged: `queueNarrow` skips current files). The request's wake rule is now `{ lane: group, checkYields: true }`, so a tier in flight may yield to the batch as C4 step 5 lets it for a named wait. `WakeRule`'s `lane` variant got an optional `checkYields` (`request-intake-types.ts`), and `RequestIntake.#wake` calls `checkYields` after `wakeLane` when it is set (`request-intake.ts`).

**The batch's deadline.** A narrow run has no wait deadline in its request. The batch uses `NARROW_PROMOTION_MS` = 10 s, the CLI's bound to see the request taken without `--wait`. The deadline only decides whether a selected file that is queued after the request joins the batch. The narrow run queues its files in the same stage, so all of them are members, and a member stays in its batch past the deadline until it is current or leaves the queue (C15 Lifetime). I chose this over a new `withinMs` in the `run-group-paths` request, which would touch the protocol, the desk messages and the CLI for no change in order.

**Receipt.** `NarrowRun.promoted?: number` (additive, `src/core/types/scheduler.ts`): the selected files in a batch once the request was taken (`RunQueue.isPromoted`). Absent from an older daemon. `narrowText` (`src/cli/run-group-narrow.ts`) says `2 queued, promoted ahead of the other queued files, which run now.`, or `2 queued, 1 of them promoted ahead of the other queued files, ...` when only some are. With no `promoted` field, the old text is kept.

## 2. Tests

- `test/scheduler/narrow-run-promotes.test.ts` (new): 801 files, an edit queues all of them, the edit's first tier is held. `requestGroupPaths("tests", [target])`, where the target is the longest file and so the last of the queue. Before the change, 800 files ran before it (red, as on 0.1.563). After: fewer than 20 (the held edit tier and the tier beside it). The answer has `promoted: 1`. A second case: a current file is not run again, `queued: 0`, `promoted: 0`.
- `test/cli/run-group-narrow.test.ts`: one case for the two receipt texts.
- `test/daemon/run-group-listing.test.ts` (new): see section 3.

The done-when names `--wait 60000`. The CLI's `--wait` path (`waitForGroup` on the selected files) did not change; the scheduler test shows the order, and the existing `run-group-narrow.test.ts` `--wait` cases show the verdict of the selected files.

## 3. Added from W3: the "listing" holder

During a listing's runner phase the scheduler's lock is free, so a pending `run-group` request read "what holds it is unknown" (shape 2 (d)).

- `GroupHolder` (`src/core/types/daemon.ts`) and `HeldBy` (`src/core/daemon/run-group.ts`) have a new kind `listing` with `revision`. Additive.
- `Scheduler.listing?(): RevisionNumber | null` (additive, `src/core/types/scheduler.ts`), implemented in `src/core/scheduler/scheduler.ts` next to `watchLock` (one method, about line 803): the ledger's newest revision while `RunnerWork.refining` is true, else `null`. It reads only the public `refining` getter; `runner-work.ts` (W1's) is not touched.
- Where it is recorded: `requestGroup` in `src/core/daemon/run-group.ts` (new `watchHolder`). It is the one place a pending request hears holders; `daemon.ts` `#requestGroup` (lines about 1191-1202) calls it unchanged. While the lock is free, `watchHolder` reads `listing()` at each lock change and every `LISTING_CHECK_MS` (500 ms), and tells each holder once. The poll is needed because a refinement's runner phase starts and ends with no lock change. The timer is `unref`ed and stops with the watch.
- `heldText` (`src/cli/group-pending.ts`): `it waits while Squeal lists revision N`.
- The revision is the worktree's newest, not the one in flight: the request waits for all runner work queued before it, which lists up to the newest.

## 4. Checks run

See the final report for the output. `pnpm run typecheck` and `pnpm run lint` pass. Direct runs: the new tests and 11 neighbouring files (106 tests) pass. `test/e2e/**`: no e2e file drives `run <group> <path>` or the holder texts; `test/e2e/harness.ts` imports only a type from `types/daemon.ts`. I ran `test/e2e/lifecycle.test.ts` once as a daemon start-and-stop check.

## 5. Proposed spec amendment (plain text, for the coordinator)

011 C15, "What is promoted", add after the first sentence: "`squeal run <group> <path>...` (019 D6 narrow run) promotes the test files its paths select that it queues or finds queued or running, as a named wait does: they form a batch after the others, with a 10 s deadline for files queued after it (row 011-397, gh-181). A current file is not queued and does not run again. The answer counts the promoted files (`NarrowRun.promoted`), and the receipt says they run ahead of the other queued files."

005 D2: no change. The named wait's behaviour did not change.

011 C15 or 019 D6, the request's holder (row 011-302 text): "While the scheduler's lock is free and a revision's runner part runs, a pending `run-group` request's holder is `listing` with the worktree's newest revision, and the CLI says `it waits while Squeal lists revision N` (row 011-397)."

No key-format or validity change; no case in `test/keys/key-format.test.ts` is needed.

## 6. Ownership notes

Files outside the brief's list, all on the same path as the owned ones: `src/cli/run-group-narrow.ts` (the receipt text lives there, not in `run-group.ts`), `src/core/scheduler/request-intake.ts` and `request-intake-types.ts` (the wake rule; W1 is told to leave request intake alone), `src/core/scheduler/scheduler.ts` (one accessor, section 3), `src/core/types/scheduler.ts` (two additive fields). `group-pending.ts`, `core/daemon/run-group.ts` and `GroupHolder` were given to this row by the coordinator.
