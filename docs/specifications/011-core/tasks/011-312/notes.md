# Row 011-312: notes (wave 73 W1)

Worker b231b178, 2026-11-10. Spec text: 011 C8 (amendment of 2026-11-10) and 019 D4 (amendment after step 4).

## What changed

- `src/harness/shared/no-edit.ts` stays the one owner of "this session changed nothing". `unchangedSinceRegistration(context)` now takes the hook context. It needs no revision since registration, and one of two proofs:
  1. The daemon that had finished its start scan at registration is the one recorded (004-67, unchanged).
  2. `HEAD` names the commit the registration recorded, and `git status --porcelain=v1 -z --untracked-files=all --ignore-submodules=all` is empty.
- `readTree(context, timeoutMs)` reads Git once per hook call, before the deciding transactions. It reads only when the second proof can decide: the consumer has a recorded `head`, the worktree has had no revision since registration, and the first proof fails. The reading is cached in a `WeakMap` keyed by the hook context. The precedent is `src/core/scheduler/head-move.ts`. Without a reading the proof fails. It is never assumed.
- `src/core/delivery/registered.ts`: `Registration.head` is optional. `tellRegistered` takes `head`. `registrationHead(root)` wraps `readGitHead`, which reads files and spawns nothing. It returns `null` for an unborn `HEAD`, for a missing or unreadable `HEAD`, and for a reftable repository. A parked registration keeps its first `head`, as it keeps its `since`.
- `stop-required.ts`: `requiredStep` no longer limits the exemption to `MAIN_AGENT`. Open checks return `null` while the daemon is stopped by request (`stoppedByRequest(header)`: `daemon.state === "down" && daemon.stopped`). `stoppedText` is the information line.
- `stop-slow.ts`: the waiting entry reads Git after the hand-off. A stop mark counts as the end of the wait, so it decides at once and does not wait for the 10 s down bound or the policy bound.
- `stop.ts`: the 2 s entry reads Git before `holdsNow` when it decides the checks Stop requires itself (`rules.required !== null`). Its time is at most 1 s, and within `HOOK_TIMEOUT_MS - STOP_MARGIN_MS - STOP_RECORD_WAIT_MS` from the callback's start, so the wait for the waiting entry's record keeps its time. The information line is appended to a block's reasons or to the news. It is never output on its own.

## Deviations, each approved by coordinator d64f8c13 (reply to request 43235c63)

1. **Files outside the brief's ownership.** `src/harness/shared/context.ts` passes `root: location.root` to `createDelivery`. `src/core/delivery/delivery.ts` adds an optional `DeliveryOptions.root` and passes `head: registrationHead(root)` to `tellRegistered`. Reason: the worktree row has no root for a fresh linked worktree until its daemon registers, and that is the #153 case. This is in its own commit, with the agreement in its subject.
2. **Store form.** The registration slot value gains an optional `head` string. There is no new meta key and no schema change. A value with no `head` still reads (`test/delivery/registered-head.test.ts`). A registration with no `head`, no `scanned` and no gaps keeps the bare-number form that 0.1.10 hooks read.
3. **How "Stop reports lint and does not hold" is read.** Any Stop output costs a continuation: Claude Code `additionalContext`, Codex `block`. With a stopped daemon the open checks never clear, so a line on its own would cost one continuation at every Stop. Thus, with a stop mark:
   - Open required checks never hold.
   - The waiting entry returns at once.
   - The line rides only on text Stop already says (news, or a block for another policy). It names `squeal start`.
   - A Stop with nothing else to say stays silent.
   - Holds for required failures already found stay as they were.

## Other deviations, not decided by the brief

- `src/harness/shared/stop.ts` is now 375 lines (it was 350). It was over the 300-line guide before this row.
- `src/core/delivery/registered.ts` is 306 lines (it was 257).
- **Spec 004 D9 is now stale, and I do not own it.** Its no-edit paragraph says "a main agent" and "A SubagentStop still blocks". 011 C8 and 019 D4 now say otherwise. The coordinator should amend 004 D9, or record the change in its `status.md`.
- `research/probes/issue-153/stop.ts` still calls `unchangedSinceRegistration(store, consumer)`. It is a throwaway research probe outside typecheck, and I left it as it was.

## Limits

- **Git-ignored files that Squeal tracks.** Suppose an edit goes to a file that Git ignores while no daemon watches: before a fresh worktree's start scan, or while the daemon is stopped. That edit is in no revision and not in `git status`, so the session reads as unchanged and Stop does not hold. The stop mark's tree print has the same limit (011 C9: "Edits to gitignored files leave the print unchanged"). `test/harness/stop-no-edit.test.ts` pins the limit ("a file Git ignores ... is the proof's limit").
- **A revert while no daemon watched.** The registration records only `HEAD`, not whether the tree was clean then. A session that reverts changes which were there at registration (for example with `git checkout .` or `git stash`) reads as unchanged. With a daemon watching, the revert is a revision, so this case does not apply.
- **Submodules.** `--ignore-submodules=all`, as in the stop mark's print: Git reports no change inside a submodule and no move of its commit.
- **reftable repositories and an unborn `HEAD`.** No `head` is recorded, so only the first proof applies, as before.
- **Git's time.** A `git status` past its bound fails the second proof, and Stop holds as before.
- **Failures with a stopped daemon.** An untold required failure still holds once. `lint.blocking` can still hold once per turn (up to `stop.maxHolds`) for a file that went to fail. After `squeal stop --until-start` no daemon re-lints that file, so the hold repeats each turn until `squeal start`. This is outside the brief ("holds for failures already found stay").
- **Other text.** The Stop text in the lint case names no `--wait` command (tested). I did not audit the status and header lines outside these files for `run ... --wait` while the daemon is stopped.

## Tests

- `test/harness/stop-no-edit.test.ts`, both harnesses:
  - Registration before the start scan, with no edit, is not held. This test was red before the change: the hold named "`squeal run lint --wait` waits for their results".
  - An edit no daemon watched, a commit, and an untracked file still hold.
  - The limit for a Git-ignored file.
  - A Claude Code subagent with no edit is not held. After a revision, it is held.
- `test/harness/stop-stopped-daemon.test.ts`, both harnesses:
  - With a plain stop mark and with `--until-start`: no hold, the information line rides on news, and no `--wait` command appears.
  - A Stop with nothing else to say is silent and does not wait out a 60 s bound.
  - A daemon that died still holds at the bound with `squeal run lint --wait`.
- `test/delivery/registered-head.test.ts`:
  - The `head` is recorded and read back.
  - A value with no `head` reads.
  - A returning session keeps its first `head`.
  - `registrationHead` for a main checkout, a linked worktree and a detached `HEAD`. It is `null` for an unborn `HEAD`, a fake git dir, and a `HEAD` that is a directory.
