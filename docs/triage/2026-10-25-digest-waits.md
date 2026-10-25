# Triage digest, 2026-10-25: named waits and the selection verdict

The seven `proposed` rows of brief T1 (`specifications/011-core/tasks/triage-2026-10-25.md`): gh-79, gh-82, gh-83, gh-84, gh-87, gh-88 and gh-91, grouped by theme with one recommendation per group (`docs/process.md`, Issue triage, "From row to work"). All seven are about `squeal status [--wait <ms>] <path>...` and its `selection` JSON: what a selection's verdict is, when a wait ends, and what it shows while it is blocked. They were triaged on 2026-10-23 and 2026-10-24, on 0.1.276 to 0.1.292; main is 0.1.309 (b40b53283). Facts come from the rows, their research files and the issues, read with `gh issue view <n>` on 2026-10-25. A fact read in spec or source says so and names the file, at main b40b53283. Release times are `gh release list` publish times, UTC. No reproduction ran for this digest. Groups are in the order the coordinator would take them: first the verdict, where a caller can count a fail as a pass and a current selection gets an exit 3 with no reason in JSON; then the run of a named file, whose blocked state is more common since `lookup-only` became the default; last the view of work in flight, whose repair waits for one research row. The other ten rows are in T2's digest, `docs/triage/2026-10-25-digest.md`; where a row here touches one of them, this digest names that row and does not decide it. Every code row also costs a candidate review and a release, as any product row does (`docs/process.md`, steps 5 and 6); the costs below leave that out. Not covered: gh-27, gh-41 and gh-43, whose holds are unchanged, and #96 and #97, not triaged yet.

## Releases against the reports

| Release | Published | Shipped, of concern here | Reports that ran it |
|---|---|---|---|
| 0.1.242 | 2026-10-21 | 011-63: the `selection` payload with `code` and `verdict`; a wait that times out still says its files were promoted (C15 Lifetime); `commands.md` says `selection.code` is the exit code | |
| 0.1.275 | 2026-10-23 11:08 | 011-134: `retry` tells a missing path, a file not listed yet and a file Squeal has not keyed | gh-79's incident (filed 11:32Z, before 0.1.276 was published; inferred from the times) |
| 0.1.276 | 12:27 | | gh-82's first report (version not stated; triaged on 0.1.276) |
| 0.1.277 | 15:51 | | gh-83; gh-84 (filed 16:31Z, before 0.1.278 was published; inferred) |
| 0.1.278 | 16:37 | | gh-88; gh-87's comments of 17:39Z to 18:48Z; gh-82's two comments |
| 0.1.279 | 19:39 | | gh-87's comment of 21:13Z |
| 0.1.284 | 2026-10-24 02:35 | 011-159: `lookup-only` is the default baseline | |
| 0.1.286 | 05:09 | 011-146: `status --wait <ms> <file> --check <text>`; a stale or unknown file that nothing queues gets a focused run (review 0.1.286 B6) | |
| 0.1.289 | 09:38 | | gh-91 |
| 0.1.294 | 15:35 | 011-182: on a busy host, a backlog tier takes permits only below half the slots | |
| 0.1.296 | 19:51 | 011-184: once a tier has run 30 s, a promoted file cuts no tier that runs a file the same or an earlier open wait selected; the reason `named` | gh-87's comments of 20:09Z and 20:41Z |
| 0.1.302 | 2026-10-25 01:25 | 011-193: a cut keeps an open wait's promotion; 011-191: the named selection moves to `src/cli/named-selection.ts`, no behaviour change | |
| 0.1.304 | 07:35 | 011-196: promotions settle once per record, so a re-run keeps them | |
| 0.1.305 | 08:02 | 015-42: coverage work caps its share of the daemon's main thread (011-197: that work delayed a change-feed pass by 23 minutes) | |
| 0.1.307 | 09:04 | 011-198: `run --all` waits for a change-feed pass; 011-200: status and the hook headers name a change feed whose last batch is more than 60 s old | |

No release since the reports changes how a selection's verdict is decided or worded. Since 0.1.278, `src/cli/verdict.ts`, `status-wait-lines.ts`, `status-wait-paths.ts` and `named-selection.ts` changed only for focused checks (011-146) and for refactors with no behaviour change (011-171, quality slices, 011-191) (`git log squeal--v0.1.278..b40b53283`). What changed is promotion (011-184, 011-193, 011-196), the default baseline (011-159) and the change feed (015-42, 011-198, 011-200).

## One contract, several rows

Read in source (`src/cli/status-wait-paths.ts`, `waitForNamed`, `decidedOutcome` and `namedCode`; `src/cli/verdict.ts`, `verdictCode`; `src/cli/status-wait-lines.ts`, `unsyncedText`): a selection has a verdict only when one read finds all of these:

1. the daemon is alive: a lapsed heartbeat gives no verdict yet, even with a live socket;
2. the daemon's sync pass over the edits made before the wait is stored at the read's revision or later; a snapshot (`status <path>...` without `--wait`) asks for it for 750 ms;
3. the revision is listed: neither `runnerPartPending` nor `awaitingInstall` is set, for the whole worktree;
4. no selected file is pending.

Then the code is 0 when every selected file is current and none fails, 1 with a known failure among them, else 3. A path that selects nothing leaves no clean verdict: 1 with a known failure among the files the other paths select, else 3. An unrelated failure or retry is not a gate: `readVerdict` counts only the selected files' states and the failed global setups of their projects.

The text names each gate. The JSON shows gate 3 (`selection.verdict.unlisted`) and gate 4 (`byClass`) only. It does not say which gate gave a 3. Gates 1 and 2 are not in `selection` at all.

So one contract change answers several rows: **a selection's verdict is pass, fail or none, and none always names the one gate or class that holds it, from a closed list, in the text and the JSON alike.** As an additive field beside `selection.code`: a result word and a reason kind, for example `unsynced`, `unlisted`, `lapsed`, `pending`, `not-current`, `not-run`, `unmatched`, `paused`, `on-hold`, `no-daemon` (the names are this digest's; the row picks them). It answers:

- gh-88: its 24 current files gave exit 3 at gate 2 (group A); the JSON would say `unsynced`;
- gh-84: a word to gate on, so no caller tallies `state`;
- gh-83: a named path that Squeal does not run gets its own kind, instead of a quiet selection of the tests that read it;
- gh-87, its comment of 2026-10-24 20:41Z: `unlisted`, with what the runner part waits for (group C);
- gh-82: `not-current` with the command that advances the file, until group B's change makes the wait ask for the run itself.

It does not answer gh-79 or gh-91, which are about the work in flight, not about the verdict.

The gates stay. Gate 2 keeps a result from before an edit out of a verdict (`lessons.md` defect 30); 011-198 applied the same rule to `run --all` in 0.1.307. Gate 3 keeps a verdict from a revision whose runner part has not run (C4 steps 1 and 2: `invalidate`, `environment`, `testFiles`, `affected`, `closure`), so the test files it adds and the closures it changes are not known yet (read in spec, C2 and C4). This digest recommends no loosening of either gate.

## A. The selection's verdict, and why it has none

Rows: gh-88, gh-84, gh-83. Related: 011-63 (0.1.242), 011-134 (0.1.275), 011-146 and 011-171 (0.1.286, 0.1.288), 011-200 (0.1.307), 011-205 (planned), T2's gh-92.

Facts. gh-88, 2026-10-23 17:38Z, 0.1.278, cezarion at revision 28, load 90.81 on 24 CPUs: `squeal status --json <24 paths>`, a snapshot with no `--wait`, and its text form both exited 3. The JSON had 24 files `current` and `pass`, `unlisted: false`, no failures. The text ended: "Named test files have no verdict: results are as of revision 28; the daemon has not stored its pass over the latest edits." Outside the selection, one file had a current failure and an unclaimed load retry. A second snapshot, one current pass and one current fail, also exited 3. Not reproduced (load 45.45).

gh-84, filed 16:31Z, incident version not stated (0.1.277 or older, inferred from the times): an agent gated a pull request on 59 parity files and twice counted `state: "current"` as a pass without reading `verdict`. A later check showed all 59 passed, so no wrong claim shipped. Not reproduced (load 71.05).

gh-83, 0.1.277: in cezarion, whose config does not cover `packages/cezar/test/e2e/task-cli.test.ts`, `squeal status <that path>` selected two covered tests that read it, which could pass. Nothing said that the named E2E file did not run. Not reproduced (load 68.08).

Read in source.

- gh-88. The quoted line is `unsyncedText` (`src/cli/status-wait-lines.ts:402`, line 393 at 0.1.278) for a snapshot whose sync is `pending`: the daemon had not stored its pass over the edits within the snapshot's 750 ms. Such a read is not ready, so its outcome is not `settled`, and `namedCode` gives 3 whatever the classes of the files. The same gate explains the second snapshot: a settled selection with a current fail gives 1 (`verdictCode`). The unrelated failure and its retry are not read. So the reporter's lead, the unrelated retry, is not the cause (read in source; not run). Why the pass took more than 750 ms at load 90.81 is not determined. `references/commands.md` has said since 0.1.233 that this line gives no verdict and that `status --wait 60000 <path>...` waits for it. A `--wait` holds for the same gate until its deadline.
- gh-84. `selection.code` (0, 1 or 3) is the summary that the issue's third fix asks for, since 0.1.242 (011-63). `commands.md` says "`selection.code` is the exit code" and that `state` and `verdict` are separate fields. `SKILL.md` does not name `selection.code`; 011-146's notes record that `SKILL.md` is at its size budget.
- gh-83. `selectNamedFiles` (`src/cli/named-selection.ts`) reads any path that is not a listed test file as a source path, and selects the test files whose valid closure holds it. `selectedLine` prints `Selected: <files>` and nothing about the path. `retry` has told such a path apart since 0.1.275 (`notKeyed`, `src/cli/retry-unlisted.ts`: "is not a test file Squeal has keyed in this worktree", with a pattern check for a file not listed yet); status does not use it.

Which fix each report predates. None of the three code paths changed since 0.1.278 (above). 011-200 (0.1.307) names a late change feed in status and the hook headers, and the snapshot's `daemon` field carries it (`withLate`, `src/core/status/snapshot.ts`); whether the named verdict line names it was not checked. 015-42 (0.1.305) removed one cause of a slow pass, coverage work on the daemon's main thread (011-197); gh-88 ran 0.1.278, before Squeal had coverage work (015-11, 0.1.295), so that cause does not apply to it (inferred). gh-84 is met in part by `selection.code`, which shipped before the report.

Status. gh-88: met in part. Its acceptance lines 1 to 3 hold by the source reading once the pass is stored (not verified by a run); line 4 is open for the JSON, which gives no reason for a 3 with every file current. gh-84: met in part. gh-83: open.

Overlaps. 011-63 owns the `selection` payload. 011-146 and 011-171 own the focused outcome in the same decision code (`focusOutcome` beside `decidedOutcome`). 011-205 (planned) words the header's current and inherited counts, not the named line: no shared file. T2's gh-92 (load retries on a busy host) concerns the retry that gh-88's reporter blamed; by the reading above that retry does not hold a selection, so gh-88 and gh-92 share no fix. T2 decides gh-92.

Recommendation. Merge gh-84 and gh-83 into gh-88: gh-88 carries the row, and all three keys stay. Approve one 011 row, "a selection says its verdict and why it has none":

1. An additive field beside `selection.code`: the result word and, for a 3, the one reason kind that holds it, from the list above, with the text the line prints. The text, the JSON and the exit code come from one function.
2. A named path that is not a listed test file is named as such on the `Selected:` line and in the JSON, apart from the test files that read it. When it is a file that no runner's patterns take in, the line says that Squeal does not run it, by the same reading as `notKeyed`. An ordinary source path still selects its readers.
3. `commands.md`, in each plugin: gate on `selection.code` or the result word, never on `state`.

No gate changes. No `schemaVersion` raise, as 011-51 and 011-63 did for their additive fields.

Cost. One worker (opus xhigh). C6 and C15 sentences and 005 D2's named-wait text. Files: `src/cli/status-wait-paths.ts`, `status-wait-lines.ts`, `named-selection.ts`, `verdict.ts`, `retry-unlisted.ts` if its reading is shared, the plugins' `references/commands.md`, and the `plugins/claude-code/dist` rebuild. Tests: 24 current passes with the pass not stored give 3 and `unsynced` in the text and the JSON; the same selection with the pass stored, beside an unrelated current failure and a pending load retry, gives 0 (this pins gh-88's line 1); a current fail in the selection gives 1; an excluded test file read by covered tests is named as not run, and the readers' verdict stays apart; a source path still selects its readers.

Cheaper. Comments and guidance only: answer #88 with the source reading (the sync gate, not the retry; use `--wait`), #84 with `selection.code`, and #83 with "a path that is not a test file Squeal runs selects the tests that read it". Price: a caller that reads only the JSON still sees 3 with every file current and no reason (gh-88's line 4 stays open), and an excluded test path still reads like a source path whose readers pass (gh-83 stays open).

## B. Getting a run for the named files

Rows: gh-82, gh-79. Related: 011-11 (promotion), 011-51 (0.1.237), 011-63 (0.1.242), 011-159 (0.1.284), 011-146 (0.1.286), 011-182 (0.1.294), 011-184 (0.1.296), 011-193 (0.1.302), 011-196 (0.1.304), 011-195 (running), 011-205 (planned), gh-87's comment of 17:46Z, T2's gh-78.

Facts. gh-82, filed 2026-10-23 12:53Z, incident version not stated: a named wait on a file that had passed at revision 11 returned at once at revision 16 with exit 3: "1 last passed at other inputs, nothing queued it (the baseline is lookup-only)". `squeal retry <file>` and then the same wait gave a current result after 4.1 s. Two comments on 0.1.278 (cezarion#1319 and #1313): after a cockpit restart or a daemon resume at an unchanged revision, a selected file that had passed read stale with nothing queued, and `retry` then a wait cleared it. The research (`011-core/research/issue-82.md`, 0.1.276) confirmed in source and with parser checks that no single command refreshes and waits; the live sequence did not run (load 30.36).

gh-79, filed 2026-10-23 11:32Z, incident version not stated (0.1.275 or older, inferred from the times): during cezarion#1425, at load 44 to 77 on 24 CPUs, a `squeal status --wait 60000` gate over 41 parity files left 38 to 40 of them pending for more than 30 minutes, behind about 537 queued files. The JSON `next` said "no command runs it sooner". The agent ran the 41 files with `npm test` in 24 minutes. Same symptom as closed #51 (gh-51, shipped by 011-51, 011-54 and 011-63 in 0.1.242). Not reproduced (load 68.44).

gh-87's comment of 17:46Z, 0.1.278: a fast guard stayed `queued, promoted` for about 20 minutes through repeated 60 s waits, behind "a non-yielding tier because it is the backlog's turn", with 113 files queued.

Read in spec and source.

- gh-82. A wait ends when no selected file is pending (`decidedOutcome`), so a stale file that nothing queues ends it at once with exit 3, and the line names `squeal retry <file>` (011-27). C15: a named wait "changes only the order in which queued files are taken. It does not change which files run." `retry` on a listed file with no current result asks for one run, needs no reason and spends no failure retry (`src/cli/retry.ts`; `issue-82.md` finding 2). Since 0.1.284 (011-159), `lookup-only` is the default for every repository without a `baseline` key, so a file whose key moved while no daemon ran stays unqueued at the next start in every such repository, not only in cezarion (inferred from 011-159's done-when). Since 0.1.286 a `--check` wait gives such a file a focused run (011-146, B6), whose outcome is never a result, so it does not answer gh-82.
- gh-79. Promotion has put named files first since 011-11 (C15 Rank). A promoted queued file's `reason` reads `queued, promoted, behind ...` since 0.1.215 (011-13; `src/core/status/next-step.ts:277`), while `next` keeps "no command runs it sooner (a running tier is not interrupted)". The issue quotes `next` only, so whether its files were promoted at that moment is not known. Read in spec: a promoted file is work an edit caused (C15 Rank), and an edit's tier runs at `runner.tierSize`, 4 files, and is never resized (C4 step 5, C10); tiers run one at a time in a lane; after four first-group tiers the backlog gets its turn, up to 200 files under a 120 s estimate with no wall-clock cap, and that turn does not yield (C4 step 5, C15 Rank). Promotion lasts until the wait's deadline (C15 Lifetime), so between two 60 s waits nothing is promoted.
- A lead, inferred and not measured: 41 named files need at least 11 tiers of 4, one after another, and at least two backlog turns among them. At cezar's p50 of 184 s for a named file's own tier (`research/running-tier-yields.md`, a replay of 0.1.235 data at load p50 41 to 53), 11 tiers take about 34 minutes. The direct run of the same 41 files took 24 minutes. So a 41-file gate can take more than 30 minutes with promotion working as specified: the tier size, not the order, may set the time. gh-87's 17:46Z comment is the backlog's turn as C15 Rank allows it.

Which fix each report predates. gh-82: none; 011-159 makes its state more common. gh-79 and gh-87's comment predate 011-182 (0.1.294), 011-184 (0.1.296: fewer cuts of a wait's own files), 011-193 (0.1.302) and 011-196 (0.1.304: a promotion survives a cut or a re-run of its file). None of these changes the tier size of promoted work, the backlog's turn, or promotion between two waits.

Status. gh-82: open. gh-79: met in part. Its acceptance lines 1 and 3 are C15 as specified, and line 2 is met in `reason` but not in `next`; the 30-minute cost is not answered.

Overlaps. C4 step 5 and C15 (Rank, Lifetime) own both rows; 005 D2 owns the wait. 011-195 (running, wave 37) builds a model-based test of the scheduler over promotion and yield invariants; a change to promotion or queueing lands after it and adds an invariant for itself. 011-205 (planned) tells the agent, at the first header after the listing, that a lookup-only baseline queued nothing for its unknown files; gh-82's change would make a named wait ask for such a file. The two agree and share no file. The human's hold of 2026-10-20 (a stale file after a pull is expected under `lookup-only`; `run --all` clears it) is about files nobody named; gh-82's change keeps it. T2's gh-78 asks for named slow files to run; this group is about fast files.

Recommendation. Approve gh-82 as one 011 row; keep gh-79 `proposed` and answer #79.

- gh-82's row: a named wait asks for one run, as `retry` with no reason does, of each test file named by its own path that is stale or unknown, has nothing queued, has no claim of its key in another worktree and has no retry asked at its key. Then the wait holds for that file as for a pending one. A source path's selection and every file not named stay lookup-only. C15's "does not change which files run" gets this one exception. The load is one run of each file the agent named, which it asked for; nothing else runs.
- gh-79: comment that promotion works as specified, that a 41-file gate runs in tiers of 4 (the lead above), and that `--check` (0.1.286) gives a focused first answer inside a large file; ask for a report on 0.1.304 or later that includes `selection.testFiles[].reason`. If the human wants the throughput answered, a 011 research row measures it on the scheduler's in-memory fixture, as `issue-91.md`'s probe did: 41 promoted files with cezar's parity durations beside a 537-file backlog, tiers of 4 against a promoted tier sized by the backlog's wall budget. It runs no real tests.

Cost. gh-82's row: one worker; C15 and 005 D2 sentences; `src/cli/status-wait-paths.ts` and the request that `retry` already sends (`src/cli/retry.ts`, `src/core/retry/records.ts`); no scheduler change is expected (inferred: the retry request already queues the file). Tests: an inherited pass made stale with nothing queued gets a run and exit 0 from one wait; a source-path selection queues nothing; a second wait at the same key asks no second run; a file under another worktree's claim is not asked for. gh-79: a comment. The optional research row: one researcher (opus high), a probe under `research/probes/issue-79/` and one findings file; no spec, code, review or release.

Cheaper. For gh-82, guidance only: `commands.md` names `squeal retry <files> && squeal status --wait 60000 <files>` for a stale or unknown named file. Price: the two commands stay, which is the friction the issue reports, and an agent that misses the hint reads exit 3 with no run asked. For gh-79, drop it with the comment. Price: large gates keep running in tiers of 4, and agents keep running the files with `npm test` beside Squeal, the duplicate load the report names.

## C. Seeing the work a wait waits for

Rows: gh-91, gh-87. Related: 011-51 (0.1.237), 011-54, 011-107 (0.1.265), 011-180 (survey), 011-184 (0.1.296), 011-193 (0.1.302), 011-196 (0.1.304), 011-195 (running), the runner-part bound (001-228), T2's gh-95 and gh-78.

Facts. gh-91, 0.1.289, 2026-10-24 in cezarion, load 93.40 at 13:18Z: six parity files queued with `retry`, then named waits. The first wait showed 4 files running since 13:07:59 and 2 queued and promoted. A later one showed the 4 running since 13:10:46 and "the tier does not yield: it holds a file a yield already cut at its key". The yield showed only as a changed start time. The research (`011-core/research/issue-91.md`, 0.1.292, load 5.36, the in-memory scheduler fixture) reproduced four gaps: F1, the running files' line says "a running tier is not interrupted" while the queued line says "the tier yields"; F2, after the cut nothing names the yield; F3, no cut files and no lost time; F4, no progress for a running tier. Why the two promoted files stayed queued after the restart is not determined.

gh-87, filed 17:28Z, body version not stated, cezarion#1308: named waits at revisions 1 to 5 timed out behind an older run; at revision 5 the runner had not listed the revision; the heartbeat was 17 s stale with a live socket. It asks for the requested and active revisions, progress, the remaining bound, and a documented safe action. Its comments:

- 17:39Z, 0.1.278: a wait timed out with revision 3 not listed, "each of its calls bounded at 966 s"; later a store lock, a slow-slot wait and a stop signal. A focused browser gate run under `squeal hold` waited for the environment lease that the daemon's older full-file run held; `squeal stop` in that worktree released it.
- 17:46Z: the backlog's turn (group B).
- 18:28Z and 18:48Z: `squeal hold` paused validation, but the daemon still held the environment lease with no Vitest child; `squeal stop` released it.
- 21:13Z, 0.1.279: after a dependency install queued 985 files, a node:test file waited for revision 9's listing behind a run in flight; it passed later.
- 2026-10-24 20:09Z, 0.1.296: five selected files stayed unlisted while an earlier node:test tier finished; two waits exited 3.
- 20:41Z, 0.1.296: all six selected files were current and passing by 20:13Z, but `runnerPartPending` stayed true, and waits exited 3, for more than 25 minutes, while the fast work ended and optional slow tests started. A `squeal stop` and `squeal start` in that worktree cleared it; the next wait exited 0 after 21.6 s.

Not reproduced (load 47.04).

Read in spec and source.

- gh-91. Since 0.1.289, the files that print a yield (`src/core/scheduler/yields.ts`, `src/core/status/next-step.ts`, `src/core/status/standing.ts`, `src/core/types/standing.ts`, `src/cli/named-file-lines.ts`) changed only by 011-184's `named` reason and 011-191's move (`git log`). So F1 to F4 hold on main (read in source; not run). Cut marks and promotions live in the daemon's memory (C15 Lifetime; `issue-91.md` F3).
- gh-87's view. An unlisted revision's reason names the bound of each call, "each of its calls bounded at 966 s" (`next-step.ts:121`); C15 says the store keeps no call's start, so there is no countdown. A running tier's standing has `lane`, `since` and `files` only (`issue-91.md` F4); `Tier.ended` (011-54) knows which files ended, and status does not read it.
- gh-87's stuck listing on 0.1.296. Each call of a runner part waits at most `runner.timeoutMs` plus 66 s (966 s in cezarion), is then abandoned, and the revision is recorded as refined, "so no wait for it waits longer than the bound for its runner part" (C4, `src/core/scheduler/runner-work-bound.ts`); a recreate waits for the run in flight. C15 says that no tier starts until the revision is listed. The comment reports more than 25 minutes unlisted, and slow tests that started meanwhile. A lead, inferred and not verified: each call waited for a later run in flight, so the bound held for each call but not in total; or the slow lane is not held by the listing. Either way the report is past C4's bound as worded.

Which fix each report predates. gh-91 predates 011-184 (0.1.296): a tier that has run 30 s and runs a file the same wait selected does not yield to that wait's other files. In gh-91 all six files were one wait's, so a cut by that wait's promotion after 30 s would not happen now (inferred; the cut's cause is not determined, and it may have been the 30 s overrun rule, an edit or a runner part). It also predates 011-193 and 011-196, which keep a promotion through a cut. No release changes F1 to F4. gh-87's comments of 2026-10-24 ran 0.1.296; nothing since then changes the runner-part bound or the listing (011-198 and 011-200 change `run --all` and the late-feed line; inferred from their rows).

Status. gh-91: open for what a wait shows; its scheduling cause is answered in part by 011-184, 011-193 and 011-196. gh-87: open.

Overlaps. C4 step 5, C6 and C15 own the lines. `yields.ts` is in 011-195's model (running), so a change there lands after it. T2's gh-95 (node:test runs that outlive their tests) is a candidate holder of gh-87's node:test listing waits (comments of 21:13Z and 2026-10-24): a runner part that waits for the run in flight waits as long as that run lives. T2's gh-78 (an idle browser environment lease) covers gh-87's lease comments (17:39Z, 18:28Z, 18:48Z). This digest decides neither. The holds on gh-41 and gh-43 are unchanged.

Recommendation. Merge gh-87's view request into gh-91: gh-91 carries what a wait shows of the work in flight, and gh-87 keeps the stuck listing and the recovery action. Both keys stay. Approve:

1. One 011 row for the view, after 011-195. The running files' line reads the yield standing, so the two lines agree (F1). The daemon keeps its last yield in each worktree (time, cause, cut files, and the cut run's start and end) until the restarted tier ends, and the running and queued lines name it (F2, F3). A running tier says how many of its files ended (F4, from `Tier.ended`). An unlisted revision's line names the run its runner part waits for, with that run's lane, start and ended count. The last yield is not kept across a daemon restart, and the line says so when a successor has none (`issue-91.md` open question 1, the cheaper answer). The JSON fields are additive, with no `schemaVersion` raise.
2. One 011 research row for gh-87's stuck listing. First, read only: cezarion's store and daemon log for that worktree, 2026-10-24 20:00 to 20:45Z, if they are kept (its runs, runner-part notes and listed revision). Then, below the load hold, the scheduler fixture with a node:test runner part behind successive runs in flight. Done when the findings say whether a listing can stay pending past one call's bound on main, which run held it, and whether gh-95's runs that outlive their tests explain it.

Answer #87 now: on 0.1.296, `squeal stop` and `squeal start` in the affected worktree cleared the listing; whether that becomes the documented recovery is decided with the research's findings.

Cost. Row 1: one worker; C6 and C15 sentences; `src/core/scheduler/yields.ts`, `src/core/status/next-step.ts` and `standing.ts`, `src/core/types/standing.ts` (additive), `src/cli/named-file-lines.ts`; tests from `issue-91.md`'s probe (F1 to F4, red first) and one for the unlisted line. Row 2: one researcher (opus high), a read-only copy of the store, a probe under `research/probes/issue-87/` and one findings file; no spec, code, review or release.

Cheaper. F1 alone, wording only: the running files' line reads the yield standing (one function in `next-step.ts`, one test), plus the research row. Price: after a cut nothing names it, and lost time and progress stay unknown, which is gh-91's main request and gh-87's first acceptance line. Cheaper still: the research row and comments on both issues. Price: agents keep reading a restarted tier from a changed start time alone, and a blocked wait keeps giving no reason that tells progress from a stall.

## Decisions asked

One answer per group:

- A: merge gh-84 and gh-83 into gh-88 and approve one 011 row: the selection's result word and the reason for no verdict in the text and the JSON, and a named path that Squeal does not run named as such? Or comments and guidance only.
- B: approve gh-82 as one 011 row (a named wait asks for one run of each stale or unknown file named by its own path), and keep gh-79 `proposed` with a comment on #79 (optionally with the fixture research row)? Or guidance only for gh-82, and drop gh-79.
- C: merge gh-87's view request into gh-91, and approve the view row after 011-195 and a research row on gh-87's stuck listing? Or the F1 wording fix with the research row only.
