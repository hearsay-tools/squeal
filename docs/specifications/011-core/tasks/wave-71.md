# Wave 71: rows 011-302 (say what holds a pending group request) and 011-303 (research: why issue #154's lint request was not taken)

Coordinator e30ed1a7, 2026-11-06. The human approved gh-154 as "diagnostics + cause hunt" (2026-11-06). W1 and W2 own disjoint files and run in parallel. W2 sends the coordinator what held the incident's request as soon as it knows; the coordinator relays it to W1. Version: the next free one after 0.1.408 (015-104 holds 0.1.408); the coordinator claims it at landing.

Host policy, as in `wave-60.md`: no local full suite, no `squeal run --all`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on every test command; private `/tmp` fixtures; never make CPU load on purpose; no `pnpm run build`; no real harness session under the real HOME. Not yours: the board, `spec.md`, `status.md`, `plugins/*/dist`, the `package.json` version. Read affected results with `squeal status --wait 60000 <paths>`.

## W1: row 011-302 (a pending group request says what holds it)

Use /worker. Shape: slice, test first.

Outcome: when `squeal run <group> --wait` reaches its deadline before the daemon takes the request, the output names what holds it (daemon startup, or the scheduler lock and the operation that holds it, with how long) and the next action; exit 3 and "no verdict" stay.

Read: the board row 011-302; `research/issue-154.md` (Source evidence); spec 011 C6, C9, C15 (reason wording for pending test files); 019 D6.

Seam and lead: `groupRequests()` in `src/core/daemon/run-group.ts` and `#requestGroup` in `src/core/daemon/daemon.ts:968`. First edit: a test in `test/cli/run-lint-group.test.ts` beside the pending case at 247–267 where the stand-in socket reports a holder, and the expected line names it. Then: `mutex.ts` keeps the current task's label and start time; each `#lock.run` site in `scheduler.ts` passes a short label (for example "applying revision 412"); `#requestGroup` reports "daemon startup" while it awaits `#starting`, then the lock holder; `RunGroupResponse` gets one additive field. A response from a daemon without the field reads "this daemon does not say what holds it". Name a cause only when it is recorded; otherwise say it is unknown. Example line: `Group lint has no verdict: the deadline passed before the daemon took request <id>; it waits for the scheduler, which has been applying revision 412 for 48 s. The request stays pending: wait again with squeal run lint --wait, or run the linter yourself.`

Owns: `src/core/scheduler/mutex.ts`; the `#lock.run` call sites in `scheduler.ts` (labels only); `src/core/daemon/run-group.ts`, `handlers.ts`, `daemon.ts` (`#requestGroup`/`#requestSlowSuite` only); `RunGroupResponse` in `src/core/types/daemon.ts`; `src/cli/run-lint-group.ts`, `src/cli/run-group.ts`; their tests. Leave alone: `src/cli/code-coverage.ts`, `src/cli/code-crap-reason.ts` (row 015-104); W2's files.

Done when: tests cover startup held, lock held with its label and age, and an older daemon's response; the previous release's CLI reads the new payload without error (test); no scheduling order changes; lint and typecheck pass; affected results read. Notes in `tasks/011-302/notes.md`, with the 011 C6 or 019 D6 sentence to amend.

## W2: row 011-303 (research: what held the incident's request)

Use /researcher. Shape: research.

Outcome: `research/issue-154-cause.md` names, with evidence tags, what kept issue #154's `run lint` request from being taken within 60 s, and why a docs-only commit left 2,466 lint checks unlinted at Stop.

Read: `research/issue-154.md`; issue #154; `research/restart-baseline.md` (how it read a daemon's `store.sqlite` and `runs/<id>/report.json`); `research/issue-138.md`.

Leads, in order: (1) forensics first: find the cezarion worktree store of PR hearsay-tools/cezarion#2755 (head `e7fb3339c`, 2026-11-06 about 05:45 UTC) on this host, read only, and build its timeline: revisions applied, lint keys moved, Stop, request time; (2) from source, which lint-key inputs a docs-only change moves; (3) only if (1) leaves the cause open, reproduce in an isolated copy (own `XDG_RUNTIME_DIR`, store, Git common directory, no real HOME, no `pnpm exec` in the copy) and time acceptance against lock holders. Live runs only at one-minute load at or below 24; record load per run. Confirm or reject the link to #138. As soon as you know the holder, send the coordinator a progress message naming it.

Owns: `research/issue-154-cause.md`, `research/probes/issue-154/` (new files only). No product code.

Done when: the findings file is committed with a verdict per question, the commands run, and what stays open.

## R1: review of cand/0.1.409

Use /reviewer. Shape: review. Pinned to the `cand/0.1.409` SHA named in the spawn; the range is `origin/main..<sha>` on 0.1.408: W1's commits (011-302) cherry-picked without conflict, the release commit (0.1.409, bundles; no key-format change), and the docs commit (019 D6, status logs).

Read W1 above, `research/issue-154.md`, `research/issue-154-cause.md` (F1, F3), `tasks/011-302/notes.md`, 019 D6 as amended. Check that:
- the no-verdict line names only recorded facts, in the order of D6, with ages; "unknown" and "does not say" read right; exit 3 and no verdict stay;
- the lock order and timing are the plain mutex's (`test/scheduler/mutex.test.ts`); the six labels outside `scheduler.ts` change nothing else; `watchLock` costs nothing without a waiting request, and `run-group-held` is posted only then;
- the `main-step` post before lint keying cannot leave a stale step after keying ends or fails;
- `holder` is additive: the 0.1.408 CLI reads a new answer, and the new CLI reads an old daemon's (`group-pending-release.test.ts`);
- the heartbeat read from the store at the deadline cannot make the CLI fail or hang when the store is busy or absent;
- the version is raised in all eight places, and the bundles match the tree.

Use affected results (`squeal status --wait 60000 <paths>`), no local full suite; CI on the candidate is the full suite. `opencode-dispose` and `scratch-identity` are known load flakes (008-38; 019-07 CI race); name them if seen, not blockers. Write `reviews/0.1.409.md` with a PASS or FAIL verdict and commit it.
