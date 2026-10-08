# Reports and headers

## When reports arrive

While you work, reports arrive after tool calls, in the order they happened, each with the header of the revision it reports. A report at the end of your turn comes from Stop.

Once you have stopped, Squeal wakes you only with the results of checks that were still pending when you stopped. That report is labelled as a hook of the event that armed the waiter (SessionStart, Stop or UserPromptSubmit), not of anything that just happened. Every other change, such as an edit made by someone else while you were idle, arrives with the next prompt.

Registration, at the start of a session, reports every known failure once. After that, a failure is reported again only when it changes.

## The header

Every SQUEAL message and `squeal status` carry a header like `Revision 12: 40 current, 3 pending, 1 stale, 2 unknown.` In a SQUEAL message it also names the files changed since your last report: `Revision 12 (changed src/math.ts, src/parse.ts and 2 more): ...`. Those are the edits since you were last told, not the cause of a failure in the message.

- **revision**: Squeal's counter of workspace changes. It is not a git commit.
- **current**: the result was produced from exactly the files as they are now.
- **pending**: a run for the current files is queued or running. The outcome shown is the last one known.
- **stale**: a result exists, but for older file contents. Nothing is queued for it yet.
- **unknown**: no trusted result: never run, or the runner crashed or timed out (the reason is in the message).
- **Test files without checks**: test files that have not produced any check yet, counted as pending or unknown.
- **The daemon has not listed this worktree's test files yet**: nothing has been looked at, so zero counts are not complete. `squeal status` prints `Affected checks: none counted` until the listing is done.
- **The runner part of revision N is pending**: the daemon has not yet listed the test files for the latest edit, so a test file you just added is not counted yet.
- **inherited**: a current result reused from another worktree whose files were byte-identical. It is as current as your own. The header says `Inherited: 30 of 40 current.` and leaves it out at 0; `squeal status` names the worktree and commit it came from, and at 0 says `Inherited from other worktrees: none (every current result here was run in this worktree)`. None inherited means every current result is your worktree's own, not that nothing is current.
- **Full-suite checkpoint**: whether a `squeal run --all` or baseline run completed at this revision. It is a request, not a coverage state: without one, current results are still current. `completed at revision 184` means one did. ``none completed since revision 170 (the counts are for revision 184; `squeal run --all` requests one)`` means the last one completed at revision 170 and none has completed since; the current, pending, stale and unknown counts are still those of revision 184, not of 170.
- **No dependencies are installed in this worktree**: the daemon found no installed lockfile (such as `node_modules/.package-lock.json`), so failures that cannot find a package are expected until an install. It appears beside failures only.
- **These results follow a dependency install**: an installed lockfile was written since your last report, so the recoveries or failures in the message may come from the install rather than from your edits. A deleted lockfile is not an install, and a report that says no dependencies are installed never says this.

## Reading a failure

```
FAIL  tests/auth.test.ts > login > expired token
      PASS -> FAIL, seen by Squeal's run at revision 12
      expected 401, received 500
      at src/auth.ts:42:7
      touches files changed here since this session started: src/auth.ts
```

- **seen by Squeal's run at revision N**: Squeal's own runner produced the result, not a test command of yours. `at start (baseline)` marks a failure found by the run when the daemon started; `in <worktree> at commit <sha>, inherited at revision N` marks a result reused from another worktree.
- **touches files changed here since this session started: ...**: files changed in this worktree since your session registered that the failing test imports (at most three, then a count). They are changes made here by anyone, you or another session or a person sharing the worktree, not yours alone. **none of the files changed here since this session started are in its imports** means no such file is in its imports; the failure may still be an effect of the environment or of a change outside its imports. Without either line, Squeal does not know which files changed here or what the test imports here: a file the test imports changed while no daemon ran, or before a daemon that started during your session first read it, so it may or may not be your edit; your session registered under Squeal 0.1.9 or older; or the stored imports were collected in another worktree whose version of the test file differs. **none of the files changed here** is also left out when the daemon had not finished starting when your session registered, or another daemon started since, because files it had not seen before are hashed without being recorded as changes; and when your session registered after its first tool calls (the first session of a new store, a registration that expired), because their edits may predate the registration. Changes made while your session was not registered (after it ended, before a resume) are not counted.
- **load average N when it ran**: on a test that timed out, the machine's one-minute load when it did. A timeout under a high load can pass when the test runs alone.

## Many recoveries

Up to five recovered checks are listed one by one. Above five, a report says `31 checks recovered (FAIL -> PASS)` and then the shorter list: either the checks still failing (`still failing: 2` and their names) or the recovered checks, grouped by test file with counts (`16 in tests/a.test.ts`) when that takes fewer lines than their names. Checks no longer reported by the runner are summarized the same way. New failures are always listed in full.

## No daemon validating

A header that says `No daemon has validated since <time>` (or `No daemon is running`) means nothing is being validated: the results are as of the revision it names, and no report will come until a daemon runs again. The hooks start one; `squeal status` shows whether it is back, and `squeal start` starts one by hand. A report says once when the daemon stops and once when it validates again. Until then, run the tests yourself if you need a result.
