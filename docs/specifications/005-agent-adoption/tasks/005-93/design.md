# 005-93 design note: late and caught-up messages for the agent's own edits

Researcher session 081c29c0, 2026-11-16, for coordinator 4d2ecbfc. Code read at `7bd783c9b`. No product code changed. The human approves this note before any code (`docs/board.md`, row 005-93).

Rule this note applies: `docs/vision.md` principle 1, "Silence has to stay readable"; `../../status.md`, 2026-11-16 (a hook carries what the agent can use; no clean line after each edit).

## Answers

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | When are results late? | When the oldest owed file has waited more than 2 times what this worktree normally needs for the owed files: its measured start delay, plus the scheduler's own wall estimate of the files from their stored durations, plus its measured overhead per run. No fixed number of seconds. Which files count is the main open choice (options 1A, 1B). | rule inferred; figures verified by experiment on the stores |
| 2 | Can a message at a tool boundary miss an edit of the same tool call? | Yes. Nothing on the hook path waits for the watcher. The edit's revision is written about 0.3 s after the tool returns; the hook starts within milliseconds. A second window: the notes ignore a recorded revision until its runner part lands. | read in source code; timings verified by experiment |
| 3 | Settled line sent against edits whose files all finish? | Squeal worktrees: 8 settled lines against 17 moments when every affected file had run. cezar: 0 against 27. Over 4 days of transcripts: 43 settled lines in 929 messages (Squeal), 1 in 992 (cezar). | verified by experiment |
| 4 | The texts | Drafts in section 4: late, caught up, the news header's own count, and no count for a consumer with no edit. | inferred (wording for the human) |
| 5 | What they replace | The heartbeat notices 005-91 removes; in hooks, the late-feed and unlisted sentences while edits are owed; the worktree queue in the news header; the settled line. `squeal status` keeps all of them. | read in source code |

## 1. When results count as late

**What the store shows** (verified by experiment, `probes/results.txt`; 45-day window, live worktrees only, since a destroyed worktree's revisions are pruned):

| | Squeal | cezar |
|---|---|---|
| Edits with a first run at their own revision | 94 (11 worktrees) | 556 (21 worktrees) |
| Edit to first run start, p50 / p75 / p90 | 17.6 s / 136 s / 527 s | 10.5 s / 17.7 s / 45.6 s |
| Edit to first run end, p50 / p90 | 44.6 s / 600 s | 15.7 s / 57.9 s |
| First run's wall estimate from stored durations, p50 | 4.5 s | 0.9 s |
| Run wall minus its estimate, p50 | 1.6 s | 2.9 s |

The wait before the first run starts is the largest part, larger than the tests. It holds the watcher's batch, the runner part (listing and affected files), a pool permit, and a tier already running. On this host, the load is several coordinators' work at once.

**Proposed rule** (inferred). At a tool boundary, the consumer owes a file when an edit re-keyed it and it has no result at its key (`editNotes`, `src/core/delivery/edits.ts`). Results are late when the oldest owed edit is older than

`bound = 2 × (start + Σ over tiers of (overhead + wallEstimate(tier)))`

- `wallEstimate(sum, longest, width)` is the scheduler's own bound (`src/core/scheduler/backlog.ts`, used by `estimateMs` in `tier-width.ts`). Tiers are `runner.tierSize` files; width is the runner's `tierWidth`. A file with no stored duration counts the median of the known ones.
- `start` and `overhead` are this worktree's medians over its recent edit runs: edit to first start, and run wall minus estimate. Both come from the store, so they follow the machine and its normal load. Before any run, both are 0 and the bound is durations alone.
- 2 is a ratio, not a time. 3 and 4 were measured too (below).
- The daemon down, stopping or stopped keeps its own liveness message: the next step there is to start it or run by hand, not to wait.

**Which files count: the open choice.**

- **1A, every file the edits re-keyed** (the set the settled line counts today). On the stores, the re-keyed files had not all run before the next edit in 265 of 286 Squeal edits and 725 of 1,004 cezar edits. The edit cut (011-25) runs namesakes and a few direct importers first; the other importers wait until edits pause. So "late" is the normal state in an editing streak. Said once per streak: 9 late notices in 199 worktree-hours (Squeal), 27 in 877 (cezar), with caught up after the streak (cezar, notice to caught up p50 38 min). Weak measure: the files come from today's closures (destroyed worktrees lost their keys), and a file is matched to the first later run, so the tails run to days.
- **1B, only the edit's first-group files** (the files the edit cut runs at once). Measured on the first run per edit: late at 2× in 36% (Squeal) and 19% (cezar) of edits; at 3× in 29% and 11%; at 4× in 23% and 9%. At 3×, 27 notices over 11 Squeal worktrees (one worktree 21, 7 none) and 59 over 21 cezar worktrees. The scheduler records no first-group set today. 1B needs that recorded where the cut is made (styleguide: record a fact where it is known), and the header and the late line would count a different set from the settled count.

Examples from the store at 3× (1B): cezar `0bb25930`, revision 15, one file of 1.7 s: bound 45.5 s, run started at 45.6 s, ended at 53.0 s, so one late line at the first boundary after 45.5 s and caught up after 53.0 s. Squeal `5446ad27`, revision 66, four files with a 22.7 s longest: bound 138 s, ended at 44.6 s, so nothing was said.

Recommendation: 1A. One set for every count the agent reads. The notice then says the truth about streaks, about once per session. 1B is quieter per streak but louder per session and needs a new stored fact.

## 2. An edit in the same tool call

Path (read in source code): Claude Code's PostToolBatch runs `deliver` (`src/harness/shared/deliver.ts`): `ensureIfStale`, then `syncOnHeadMove` (commits only), then `onToolBoundary`. `deliver` in `src/core/delivery/delivery.ts` reads `store.revisions.latest`. The daemon's watcher writes that revision after a 100 ms quiet period, at most 500 ms per batch (`WATCHER_TIMINGS`, `src/core/types/watcher.ts`), then stats and hashes. No step on the hook path waits for it.

Timings (verified by experiment, `probes/same-call.mjs`): an Edit or Write result to the revision that recorded the file was 169 to 405 ms in 22 of 25 Squeal cases (p50 296 ms), and 0.7 s, 1.7 s and 28.9 s in the other three. In cezar, 7 cases, 150 ms to 36 s. The one hook start found for the same call was 3 ms after the tool returned; delivered hooks ran 0.5 to 1.3 s. Whether the read sees the edit depends on the hook's start-up time.

Second window (read in source code): `editNotes` returns nothing while the latest revision's runner part is not applied (`isRefined`). The measured start delay (p50 10.5 to 17.6 s) holds this wait.

Effect on the design:
- Late: the clock starts at the edit's revision time, so a revision not yet written only starts the clock later. No false statement.
- Caught up: it can name revision N while the same call's edit, N+1, is not written yet. Guard (inferred): send it only while the latest revision is refined and is the one named; it names that revision and its changed paths, so the agent can see what it covers. The 300 ms window stays open, as row 005-93 (d) accepts.

## 3. Settled line against edits that finish

`settledLine` (001-223) rides only on a delivery with other news once the 001-224 line was said (`editNotes`, `state.said && !delivering`), and only while no re-keyed file is pending.

| | Squeal | cezar |
|---|---|---|
| Moments every affected file had run (store, live worktrees) | 17 (13 worktrees, 286 edits) | 27 (23 worktrees, 1,004 edits) |
| Settled lines delivered to the same worktrees | 8 (12 with transcripts) | 0 (13 with transcripts) |
| 4 days of transcripts: PostToolBatch messages / settled lines / sessions told "saw your edit" | 929 / 43 / 110 | 992 / 1 / 61 |

All verified by experiment; the moments carry the weak attribution of 1A. The settled line reaches a minority of finished edits in Squeal and none in cezar.

## 4. Texts (drafts for the human)

Words: "the test files your edits affect" everywhere, never "re-keyed". Times in UTC with the zone named (005-94).

Late, once, at a tool boundary (not at Stop, not to an idle agent):

> SQUEAL · results for your edits are late at revision 42
> 7 of the 9 test files your edits affect have not run, 2 min 10 s after your edit at revision 41. Passing results stay silent; Squeal says once when it has caught up. To have them now, `squeal status --wait 60000 <path>...` runs the files your paths select first; or run those files yourself.

The path wait puts the named files first (row 011-145, focused entries, `src/core/scheduler/slots.ts`). With 3 files or fewer, the line names them.

Late, with nothing to count (the feed has not read the edit, or the runner has not listed its revision):

> SQUEAL · results for your edits are late at revision 41
> Squeal has not read edits made after 14:03:20 UTC, so it has not queued their test files. To have results now, run the tests yourself; `squeal status` says when Squeal reads them again.

Caught up, once, only after a late line, at a tool boundary:

> SQUEAL · caught up at revision 45
> All 9 test files your edits affect have run at revision 45, with no new failure.

With checks that gave no result: "…have run at revision 45: 8 with results, 1 with no result (unknown); no new failure." A failure during the delay is a failure report, and it ends the late state: no caught-up follows it (row 005-93).

News header, own count in place of the worktree queue:

> Revision 42 (changed src/a.ts): 3 of the 9 test files your edits affect have not run.

When none is owed: "Revision 42 (changed src/a.ts): the 9 test files your edits affect have all run." This appears only inside a delivery that has other news.

A consumer with no edit since it registered: no count; the header ends after the changed paths. `squeal status` has the worktree's counts.

## 5. What they replace, what stays

| Today in hooks | After 005-93 | `squeal status` |
|---|---|---|
| Heartbeat late notices and their recovery (116 late and 196 "validating again" or "current again" in 1,921 messages over 4 days); 005-91 removes the short ones | The late line when results are owed; the daemon down keeps its liveness message | keeps heartbeat detail |
| Late-feed sentence, "has not yet read edits made after …" | The second late text while the consumer has edited | keeps it (005-94 rewords it) |
| Runner part sentence, "has not yet listed the test files of revision N" | Counts toward late; the second late text | keeps it |
| Worktree queue, "8551 pending (8089 tests, 462 test files loaded). Test files without checks: …" (news p50 511 pending in Squeal, 1,863 in cezar) | Own count | keeps all four counts |
| Settled line (001-223) and its joined form | The own count in the header, and caught up after a late line | none |

Stays as it is: the 001-224 first-edit line, failure reports, the "Not validated" line when no daemon could start, the registration and Stop full header (005-94 decides).

## Decided (the human, 2026-11-16)

1. Files: **1A**, every test file the edits affect.
2. Factor: **2**.
3. Same-call edit: name the revision and accept the 300 ms window.
4. Caught up says "no new failure" only.
5. A consumer with no edit gets no count.

## Open choices for the human (as asked; answers above)

1. Which files count: **1A** every file the edits affect (recommended; about one late and one caught-up per editing streak) or **1B** only the files Squeal runs right after the edit (late on 11 to 36% of edits by factor; needs a new stored fact).
2. The factor in the bound: **2** (recommended), **3** or **4**. Measured above for 1B.
3. The same-call edit: **name the revision and accept the 300 ms window** (recommended; row (d)), or **hold caught up for one more boundary** when the tool batch may have edited.
4. Caught up and known failures: **say "no new failure" only** (recommended), or **add "Known failures: N"** beside it.
5. A consumer with no edit: **no count** (recommended), or **the worktree's pending count** as today.

## Open questions

- 1A's figures rest on today's closures and first-later-run matching; a probe on a live session with the `rekeyed` record would settle them.
- Codex, Pi and OpenCode timings were not measured; their boundary hooks start differently.
- Whether `squeal status` should show the asking session's own count: status takes no consumer today.

## Sources

- Code at `7bd783c9b`: `src/core/delivery/edits.ts`, `delivery.ts`, `header.ts` (`newsLine`), `liveness.ts`, `format.ts` (`settledLine`, `sawEditLine`); `src/harness/shared/deliver.ts`; `src/core/status/feed-late.ts`; `src/core/scheduler/backlog.ts` (`wallEstimate`), `tier-width.ts`, `slots.ts`, `edit-cut.ts`; `src/core/types/watcher.ts`; `src/core/types/policy.ts` (`tierSize` 4).
- Stores, read-only: `~/projects/squeal/.git/squeal/store.sqlite`, `~/projects/cezar/.git/squeal/store.sqlite`.
- Transcripts, read-only: `~/.claude/projects/-home-user-projects-{squeal,cezar}*/*.jsonl`.
- Probes and output: `probes/` (throwaway; `probes/README.md`, `probes/results.txt`).
- `../../research/hook-messages-2026-11-16.md` findings 7, 8; `docs/board.md` rows 005-91, 005-93.
