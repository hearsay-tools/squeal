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
- **inherited**: a current result reused from another worktree whose files were byte-identical. It is as current as your own. The header says `Inherited: 30 of 40 current.`; `squeal status` names the worktree and commit it came from.
- **Full-suite checkpoint**: whether a `squeal run --all` or baseline run completed at this revision. It is a request, not a coverage state: without one, current results are still current.

## No daemon validating

A header that says `No daemon has validated since <time>` (or `No daemon is running`) means nothing is being validated: the results are as of the revision it names, and no report will come until a daemon runs again. The hooks start one; `squeal status` shows whether it is back, and `squeal start` starts one by hand. A report says once when the daemon stops and once when it validates again. Until then, run the tests yourself if you need a result.
