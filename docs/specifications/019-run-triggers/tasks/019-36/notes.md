# 019-36 and 019-38 notes

Worker 19a8831e, 2026-11-04, on branch `cez/19a8831e`. Row 019-36 (lessons Round 2 P10) and, on the coordinator's instruction, row 019-38 (P8, the human's option A) on the same branch. These notes are the residue: what changed, what the probe showed, and what the next worker must know.

## 019-36: the first Stop's 2 s entry with news

**Cause** (lessons P10, confirmed): the 2 s entry prepared its news first (`newsText`), and the news's writes stay in a transaction open until the hand-off (row 011-288). It then waited for the waiting entry's record (`waitingEntryRecorded`, row 019-30). The record is a write, so it could not land while that transaction was open, and the 2 s entry held at once.

**Fix** (`src/harness/shared/stop.ts`, `stop-decide.ts`):

- Before it prepares its news, the 2 s entry checks whether it would hold for the required checks now (`holdsNow`, the same `held` as `decide`, from one read transaction), and if so waits for the record then. A consumer with no registration does not wait: it registers with its news, and the waiting entry records only a registered one.
- `waitingEntryRecorded` reads the record once and does not poll while a prepared report is open (`context.prepared.pending`): the record cannot land then. This covers a hold decided after the news, when the state changed between the check and the decision.

**Tests** (`test/harness/stop-first-last.test.ts`, both harnesses): 019-30's test with an untold result at the first Stop: the 2 s entry tells the news, the waiting entry says nothing, no hold is counted; at the next Stop the waiting entry holds once. On the old code the 2 s entry held (both harnesses failed). A second test: the record wait with a prepared report open returns in under 500 ms; without the guard it waited its whole 2 s deadline (both failed).

### The probe

`../019-33/bin/p3probe.mjs` drives the pinned 0.1.400 bundles, so it cannot check a branch as it is. The Claude Code bundles of this branch were built to a scratch directory, not to `plugins/claude-code/dist` (the row has no build):

```sh
node_modules/.bin/tsx -e "Promise.all([import('esbuild'), import('./src/harness/claude-code/build.ts')]).then(([e, b]) => e.build(b.bundleOptions('/tmp/dogfood-019-33/dist-019-36')))"
```

**The 019-33 probe drops its own consumer.** Each hook runs under `sudo` (`as-e2e.mjs`), and the hooks' harness-process walk skips only shells, so SessionStart's registration records that `sudo`, which exits at once. The daemon's heartbeat then drops the consumer (lessons defect 24). A first Stop that finds no registration registers again (`newsText`), the new registration erases the waiting entry's record (review wave 13ba, B1), and the 2 s entry holds after its 500 ms record wait. A real session's harness process lives, so this does not happen there. Evidence: in a copy with logging, the 2 s entry read `registered=false` at its check in 1 of 4 trials of the no-news variant (there the waiting entry recorded after the new registration, so no hold); both holds of run b below came at the record wait's deadline with no news in the text (a registration with no known failures says nothing). It probably also explains Round 2's dropped "news told first" variant (`../019-33/notes.md`), where both entries said nothing.

`bin/p3probe.mjs` is 019-33's probe with a stand-in harness process (`bin/harness.mjs`): one long-lived process per trial, as the e2e user, starts every hook of the trial as its child, so the registration records a process that lives until the trial ends. It also takes `P3_DIST` (the bundle directory) and `P3_TELL=1` (tell the pass at a boundary before Stop, so the first Stop has no news). Its times are from the stand-in's start of the Stop pair, without the `sudo` start.

| Run | Bundles | Probe | Trials | Holds by the 2 s entry | Its time when it gave news | Load |
| --- | --- | --- | --- | --- | --- | --- |
| a | branch | 019-33's | 4 | 0 (3 news, 1 nothing) | 334 to 364 ms | 15.6 to 19.2 |
| b | branch | 019-33's | 4 | 2, both with no news, at 672 and 1,000 ms (dropped consumer) | 325 to 370 ms | 15.4 to 22.1 |
| debug | branch, logging | 019-33's | 4 | 0 (4 news) | 306 to 458 ms | 19.8 to 37.9 |
| debug, no news | branch, logging | 019-33's, `P3_TELL=1` | 4 | 0 (4 nothing) | (none) | 30.5 to 46.1 |
| stand-in | branch | `bin/p3probe.mjs` | 4 | 0 (4 news; the waiting entry said nothing after 3.22 to 3.30 s) | 242 to 327 ms | 20.9 to 22.4 |
| stand-in, control | 0.1.400 pin | `bin/p3probe.mjs` | 4 | 4, at 579 to 597 ms (the waiting entry ended after 3.60 to 3.67 s: its record waited for the lock) | (none) | 17.8 to 21.0 |
| stand-in, no news | branch | `bin/p3probe.mjs`, `P3_TELL=1` | 4 | 0 (4 nothing at 235 to 267 ms; the waiting entry held after 15.6 to 15.9 s with `the e2e group ran at revision 2: 1 check fails: [e2e] test/e2e/flow.test.ts > shouts end to end.`) | (none) | 14.3 to 21.0 |

The done-when, `p3probe.mjs 4 150` with no hold from the 2 s entry, holds with the stand-in (0 of 8 on the branch, 4 of 4 on 0.1.400 as the control). With 019-33's probe the 2 holds of 16 trials are the dropped consumer above. The no-news variant with the stand-in is the case s3b2 to s3b4 stood for: the waiting entry decides and holds with the e2e failure after the e2e run, where Round 2's dropped variant had both entries silent.

The raw rows (each entry's text included) are in `/tmp/dogfood-019-33/logs/p3/019-36/` while the host keeps `/tmp`: `p3-fixed-lead150*.jsonl` (runs a, b), `p3-debug*.jsonl` and `debug-told.log` (the logging copy), `f-*.jsonl` (the stand-in runs).

In all 8 trials with logging, the waiting entry's record landed 95 to 192 ms after the 2 s entry began its wait, with 282 to 389 ms of the 500 ms left. Round 2 (0.1.400, 019-33's probe, the 2 s entry 150 ms first): 4 holds in 4 trials, at 635 to 660 ms.

## 019-38: Stop tells an untold commit line or update once (P8)

**Change**: one line of `src/core/delivery/delivery.ts`, given to the row by the coordinator (2026-11-04): commit news (`commitNews`) is read at Stop too, not only at a tool boundary. So a Stop's delivery carries an untold commit line or update in its header block, as a boundary's does, in the same held transaction, and it is marked told at the hand-off. The Stop entries already put news with their hold or alone as news that continues the turn once, so `stop.ts` needed no new text path. Without a `checks` key `commitNews` marks the line told and says nothing, so the texts do not change. A Codex Stop with `stop_hook_active` runs `quiet` and reads no news, as before.

**Tests**:

- `test/commit/stop-told-daemon.test.ts` (P8's done-when; a real daemon, a real `git commit`; Claude Code and Codex): the commit's boundary gets no answer from the daemon (its socket file is renamed away for that hook, as a boundary past its 500 ms bound gives up), the report is then stored by a `sync`, the next Stop tells the line once, and neither the Stop after it nor the next boundary repeats it. Then a commit whose commit group's file runs 3 s: its boundary tells the line with `1 test file still running`, the update is stored after it, the next Stop tells the update once, and the Stop after it does not.
- `test/delivery/commit-update.test.ts` (019-22): "is never told at Stop" now pins the new rule: a Stop tells the report, then its update, each once; a Stop tells the update a boundary did not.
- `test/delivery/group-told.test.ts` (019-16): the line is news by itself at a Stop no boundary told it before, once; without `checks` a Stop says nothing and marks it told.

**For the next worker**:

- Only the files of a group at `commit` count as a commit's running work and give an update (row 019-28). A fixture with groups only at `edit` gets no update.
- With P9 (019-35) the update of a lint-only commit is stored when lint records; s1f's update would then exist at its first Stop and reach the agent through this row.
- Red-first for the daemon test was not run: reverting `delivery.ts` would queue about 500 test files on a loaded host. The old line skipped commit news at Stop by construction (`!stop`), and 019-22's old test pinned exactly that.
