# Reports and headers

## When reports arrive

While you work, reports arrive after tool calls, in the order they happened, each with the header of the revision it reports. A report at the end of your turn comes from Stop.

Once you have stopped, Squeal wakes you only with the results of checks that were still pending when you stopped. That report is labelled as a hook of the event that armed the waiter (SessionStart, Stop or UserPromptSubmit), not of anything that just happened. Every other change, such as an edit made by someone else while you were idle, arrives with the next prompt.

Registration, at the start of a session, reports every known failure once. After that, a failure is reported again only when it changes.

## The header

The registration at the start of a session, the report at Stop and `squeal status` carry the full header, like `Revision 12: 40 current (34 tests, 6 test files loaded), 3 pending (3 tests), 1 stale (1 test), 2 unknown (2 tests).` In a registration or a Stop report it also names the files changed since your last report: `Revision 12 (changed src/math.ts, src/parse.ts and 2 more): ...`. Those are the edits since you were last told, not the cause of a failure in the message.

Every other SQUEAL message carries the news only: the counts that are not zero among pending, stale and unknown, as in `Revision 12: 3 pending (3 tests), 2 unknown (2 tests).`, then the test files without checks. With no such check, it names those test files alone, as in `Revision 12: test files without checks: 4 unknown.`, and says `Revision 12: no check pending, stale or unknown.` only when there are none of either. It leaves out the changed files, the current and inherited counts, the full-suite checkpoint, and the `Slow tier:` line unless the slow tier changed since you were last shown it; the liveness and install sentences below stay. When your session registered before the daemon listed the test files, the first report after the listing carries the current and inherited counts once, and says when a lookup-only baseline queued none of the test files without checks. `squeal status` shows all of them at any time.

- **revision**: as the SQUEAL primer defines it; not a git commit. Edits by a build, another session or a person move it too, and the header's file list says which files did.
- **current**: the result was produced from exactly the files as they are now.
- **pending**: a run for the current files is queued or running. The outcome shown is the last one known.
- **stale**: a result exists, but for older file contents. Nothing is queued for it yet.
- **unknown**: no trusted result: never run, the runner crashed or timed out, or a file was written while it ran (the reason is in the message; see below).
- **Test files without checks**: test files that have not produced any check yet, counted as pending or unknown (in a message other than the full header, only the classes that are not zero).
- **The daemon has not listed this worktree's test files yet**: nothing has been looked at, so zero counts are not complete. `squeal status` prints `Affected checks: none counted` until the listing is done.
- **The runner part of revision N is pending**: the daemon has not yet listed the test files for the latest edit, so a test file you just added is not counted yet.
- **inherited**: a current result reused from another worktree whose files were byte-identical. It is as current as your own. The full header says `Inherited: 30 of 40 current (25 tests, 5 test files loaded).` and leaves it out at 0; `squeal status` names the worktree and commit it came from, and at 0 says `Inherited from other worktrees: none (every current result here was run in this worktree)`. None inherited means every current result is your worktree's own, not that nothing is current.
- **Full-suite checkpoint**: in the full header, whether a `squeal run --all` or baseline run completed at this revision. It is a request, not a coverage state: without one, current results are still current. `completed at revision 184` means one did. ``none completed since revision 170 (the counts are for revision 184; `squeal run --all` requests one)`` means the last one completed at revision 170 and none has completed since; the current, pending, stale and unknown counts are still those of revision 184, not of 170.
- **Slow tier**: present only when `squeal.config.json` declares slow files (`slow.include`, `nodeTest[].slow`, `pytest[].slow`), such as end-to-end suites. Slow files run apart from your edits' tests: after them, or when you pause under `slow.trigger: "idle"`, and on `squeal run --slow`; whether Stop waits for them is policy (`policy.md`, `stop.requireSlowSuite`). The full header always carries the line; any other message only when the slow tier's state changed, so the last `Slow tier:` line you saw still holds. The line says how many there are and, for each group, its state: `current at revision 12` (the revision they last ran at; `current at revisions 10 to 12` when their runs spread over several), `pending, waiting for the agent to pause` (or for fast test files, host load to drop, or the slow slot another worktree holds), `running test/e2e/cli.test.ts since 14:02 (last run 1 min 12 s)`, or `not run at revision N`. While any is not current, it ends with `squeal run --slow --wait 60000` waits for their results. A slow file's results arrive with your next tool call or prompt, like any other.
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
- **touches files changed here since this session started: ...**: files changed in this worktree since your session registered that the failing test imports (at most three, then a count). They are changes made here by anyone, you or another session or a person sharing the worktree, not yours alone. **none of the files changed here since this session started are in its imports** means no such file is in its imports; the failure may still be an effect of the environment or of a change outside its imports. Without either line, Squeal does not know which files changed here or what the test imports here (a change made while no daemon ran or before your session registered, imports collected in another worktree, a session registered under Squeal 0.1.9 or older), so it may or may not be your edit: read the failure on its own.
- **slow tier, Squeal's run saw it at revision N, against dist/** as of revision N**: a slow file's failure names the build output it ran against instead of the files changed in this session, which its closure rarely holds. Rebuild and run `squeal run --slow` to see whether your change fixed it.
- **load average N when it ran**: on a test that timed out, the machine's one-minute load when it did. A timeout under a high load can pass when the test runs alone.

## A test file that stays unknown after a write

A reason like `fixtures/data.txt was written during this run and ended as it was` (or `was written while this run was in flight`) means a file in the worktree was rewritten with the bytes it already held while the run was going: a no-op save, a `git stash` round trip, a build rewriting its output, or the test itself. Squeal cannot tell which bytes its caches served that run, so it keeps none of the run's results, and its test files stay unknown until their keys change. When a test rewrites a file on every run (a fixture writer), every run of it is unknown. Have the test write outside the worktree (a temp directory) or under a path git ignores and no `inputs` entry names; declaring the file in `inputs` does not help, since a declared file is part of the key and its rewrite still counts.

## Vitest without its dependency optimizer

A header or status note that begins `Squeal runs Vitest without its dependency optimizer` means a Vitest config here turns on `deps.optimizer`, and Squeal runs every test without it. The optimizer's bundles hold copies of source files that no result's key names, so a result could have come from bytes other than those on disk. Tests then import those packages from their sources, which is what Vitest does by default. A test that passes only with the optimizer can fail under Squeal and pass in `vitest run`; the repository's own test command is still the one to run before you finish.

## Many recoveries

Up to five recovered checks are listed one by one. Above five, a report says `31 checks recovered (FAIL -> PASS): 31 tests` and then the shorter list: either the checks still failing (`still failing: 2 (2 tests)` and their names) or the recovered checks, grouped by test file with counts (`16 in tests/a.test.ts`) when that takes fewer lines than their names. Checks no longer reported by the runner are summarized the same way. New failures are always listed in full.

## No daemon validating

A header that says `No daemon has validated since <time>` (or `No daemon is running`) means nothing is being validated: the results are as of the revision it names, and no report will come until a daemon runs again. The hooks start one; `squeal status` shows whether it is back, and `squeal start` starts one by hand. A report says once when the daemon stops and once when it validates again. Until then, run the tests yourself if you need a result.
