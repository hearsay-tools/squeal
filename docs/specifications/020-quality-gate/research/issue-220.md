# Issue 220: completed gate results dropped while another worktree's daemon holds the store (with #216)

Researcher 3f0f5163, 2026-11-14. Brief: [issue-220-brief.md](issue-220-brief.md). Source examined: `4c38b65c1` (package 0.1.506). Squawk repository read-only at `~/projects/cezar` (reporter worktree `b476d30b`, HEAD `d6c837157`). Host: 24 CPUs, Node v26.13.0.

**Verdict.** The 224 lost files are a keeper defect, not only contention. The "30 s" bound counts total time from the first refused write and is never reset by a write that lands, so a store that is free often still exhausts it. In #220 the last pass wrote 116 files inside the bound, so the store was not held for 30 s continuously. The root cause of the long busy periods is daemon writers that take the shared lock back to back with no gap; a waiter then never gets in. The 109 "changed" files were a true change: the reporter's own worktree merged `origin/main` during the run. Recommended: a bound on time with no landed write (D17.5), a closing "kept N of M" line, and a pause between batches in the daemon's back-to-back writers (011/021). A side file is not needed first.

## Questions answered

| # | Question | Answer | Tag, version |
|---|---|---|---|
| 1a | Why does the store stay busy for 30 s? | Writers that run write transactions back to back, with no gap, keep a polling waiter out for their whole run. 50 ms transactions with no gap: 0 writes in 8 s for a 20 ms and a 250 ms slice. With a gap as long as the hold: 68 to 188 writes. | verified by experiment, scratch SQLite, Node 26.13 |
| 1b | Which daemon work does that? | The code-store prune (`deleteInBatches`, `src/core/code/store/prune.ts:177-195`, called at `:79-107`): 256-row transactions in a synchronous loop, no pause. Tier records, one transaction per tier (11 to 67 s for 198 files on cezar, `src/core/daemon/open.ts:46-52`). Import slices with no pause (`transfer-import-slices.ts`). Idle `wal_checkpoint(TRUNCATE)` (`idle-checkpoint.ts`). No turn-taking exists: SQLite's busy handler sleeps and polls. | read in source code, 0.1.506; holds of 59 to 116 s on cezar's `code.sqlite` read in [021 store-contention](../../021-remote-store-and-execution/research/store-contention.md) |
| 1c | Which one held it in #220? | Not determined, because the issue names only the holder process (daemon `@dc937452`), not the database or the operation. The keeper writes `code.sqlite` first for each file, so a `code.sqlite` holder blocks every file. | inferred |
| 1d | Is "stayed busy for 30 s" true? | No. `StoreWait` sets its start once and never resets it (`keep-write.ts:76-87`). In the probe, every file landed on its second try (the longest refusal was 250 ms); the pass still stopped after 86 of 340 files and printed "the store stayed busy for 30 s". In #220, 340 waited and 224 were not kept, with no "changed during the wait" clause, so 116 landed inside the bound. | verified by experiment (`bound.probe.ts`); #220 arithmetic inferred from the issue's lines |
| 1e | Why only 29 kept while the runs went on? | An early pass makes one try with a 20 ms slice and stops at the first refusal. The pauses between passes grow to 2 s (`keep-pass.ts`, `keep-queue.ts:15`). Against back-to-back holders that try rarely lands. | read in source code; inferred for #220 |
| 2a | What does the change check read? | Content hashes of this worktree's files (re-hashed only when lstat moved), compared with the lookup's snapshot. Listings come from this worktree's `git ls-files` (`--stage`, `--others --exclude-standard`, `--deleted`). It also reads the serving daemon's revisions for this worktree after the lookup. The window runs from the gate's one lookup to the end of the file's chunk (`keep-expected.ts`, `run-evidence/sources.ts:81-106`, `listings.ts:63-134`, `store-decision.ts:73-74`). | read in source code |
| 2b | Can a shared thing make a file read as changed? | Not for this message. The shared observed rows add paths to a key but never change bytes. A shared `info/exclude` can move a listing, but that gives the `listing` line, not "what their keys name changed". Refs, packed refs and objects are not read. A late daemon revision could flag a path, but only for this worktree's own edits. | read in source code; inferred where marked in the findings |
| 2c | Is `.github/mutants/*` in the keys, and what touched it? | No observed row names `.github/mutants/`. Squawk's `squeal.config.json` gives all 110 `.github/scripts/*.test.cjs` node:test files the input `.github/scripts/**`. The reporter's worktree merged `origin/main` at 21:10:25Z (`a0882f21e`, reflog). The merge brought #3579: `.github/mutants/targets.json`, four `.github/scripts/mutants-*` files, and one doc. 109 of those 110 files is a close match. | read in source (store copy, config, reflog); match inferred, because the gate's start time is not recorded |
| 2d | Spec against code | D17.3 (row 020-59) says a change after the window "does not undo the keep". The keeper still re-reads inputs at each pass's opening check and after a busy pause, and drops a moved file (silently at the opening check). D17.5 says the same. The two sentences disagree. | read in source code and spec |
| 3 | Fix options | See "Options" below. | inferred costs; one figure from #220 |
| 4 | Is #216 resolved by 0.1.495 to 0.1.506? | Partly. The design paths now exist: chunks kept as they end, the failure rerun kept, `--rerun-stored-failures`, a load-scaled estimate. But on a shared, contended store, early writes rarely land (#220: 29 kept), so a killed gate still loses most of its work. The concurrency limit is not built ("Wait and see"). | read in spec, board and source; not reproduced |

## Findings

**Q1, the probe (verified by experiment).** `probes/issue-220/starve.mjs` runs a scratch SQLite file in WAL mode with one fake holder (`holder.mjs`, which sleeps inside its transaction and does no CPU work). Each case ran for 8 s. The one-minute load was 10.76 to 13.73 on 24 CPUs.

| Hold | Gap | Slice | Writes landed | Longest time with no write |
|---:|---:|---:|---:|---:|
| 50 ms | 0 | 20 ms | 0 | 8.3 s (whole case) |
| 50 ms | 0 | 250 ms | 0 | 8.1 s |
| 50 ms | 50 ms | 20 ms | 130 | 185 ms |
| 50 ms | 50 ms | 250 ms | 187 | 80 ms |
| 250 ms | 0 | 20 / 250 ms | 0 / 0 | 8.3 / 8.1 s |
| 250 ms | 250 ms | 20 ms | 68 | 449 ms |
| 250 ms | 250 ms | 250 ms | 188 | 274 ms |

Short transactions do not help a waiter when the holder starts the next one in the same tick. A gap does. The main-store prune already has that gap (`daemon/sliced-prune.ts`: a pause of `max(10 ms, slice time)`). The code-store prune does not have it, and neither do import slices. The store is one file per repository (`<git common dir>/squeal/{store,code,lint}.sqlite`, `store/paths.ts:12-19`, `code/store/open.ts:28`). Read-only on the host: 8 live daemons have cezar's store directory as their working directory, and 56 worktrees share it.

**Q1, the bound (verified by experiment).** `probes/issue-220/bound.probe.ts` drives the real `keepFile`, `sliced` and `StoreWait` with a fake clock. 340 files are queued, each refused once (250 ms) and then landing (50 ms per write). Result: 86 written, the bound spent at 30.35 s, the last write 250 ms before it, and the line "254 completed test files were not kept in the stores: the store stayed busy for 30 s". In #220, the same arithmetic gives about 0.26 s per file at that contention (116 files in about 30 s). All 340 would then need about 90 s (inferred).

**Q2 (read in source; the match is inferred).** Reflog of worktree `b476d30b`: commit `5a54bc2aa` at 21:08:08Z, merge of `origin/main` at 21:10:25Z, changelog commit at 21:21:53Z. The issue was filed at 21:46:39Z. `git diff 5a54bc2aa a0882f21e` changes 6 files, all from #3579 (merged 20:57:47Z). The run must have started before 21:10:25Z and ended after it. That fits a 600 s run followed by a passing second run before 21:46Z. The drop was correct under D17.3: the bytes the run read are not known for a file whose input moved inside its window. The reporter's "another task's commit" is right about the authorship, but the change came in through this worktree's own merge. The issue elides the paths the line named, so they are not determined. In a copy of cezar's `store.sqlite` (in `/tmp`, read-only), only `packages/cezar/src/lint/lint-runner.test.ts` reads `mutants-*` files through observed rows.

**Q4, #216 (read in spec and board).** Its asks, against what shipped:

| #216 ask | What shipped | Release |
|---|---|---|
| Rerun only the failed files and keep the rest | Each failure under load runs once more (020-54); the rerun result is kept (020-55); `--rerun-stored-failures` reruns stored failures and reads the passes from the stores (020-60, 020-63) | 0.1.475, 0.1.480, 0.1.495, 0.1.503 |
| Resume after a kill | Chunks of at least 300 s are written as each ends (020-59). On cezar's store most early writes do not land (#220), so this does not yet hold where #216 ran. | 0.1.495 |
| Name the host load | The estimate is scaled by the load and names it (020-57); the rerun line names the load (020-63) | 0.1.486, 0.1.503 |
| A concurrency limit or a slower retry | Not built: "Wait and see" | n/a |

So #216 depends on #220's fix. After the recommended rows land, the remaining gap is the concurrency limit, which stays on hold.

## Options (Q3)

| Option | What can be lost | Wait after the report | Files |
|---|---|---|---|
| **A. Bound on time with no landed write (recommended).** Reset the 30 s clock at each landed write, and stop at a ceiling: the time the queued files took to run in this gate (never less than 30 s). Waiting longer than a rerun would take saves nothing. | Files still queued when no write lands for 30 s, or at the ceiling. In #220, likely none (inferred). | Up to the files × per-write time, plus 30 s at most; about 90 s in #220 (inferred) | `src/core/code/gate/keep-write.ts`, `keep-pass.ts` |
| B. Retry until written (the issue's ask) | Nothing, unless the command is killed | Unbounded: busy episodes of 1,853 s are recorded on cezar (021 research). #202 comes back. | same files |
| C. Side file outside the locked store, folded in later | Nothing written there, unless the disk fails | None; the command returns after its report | New file format and version; a fold in the gate's lookup and in the daemon; prune of stale files; claim on fold. The fold must replay `storeResults`' heal of other worktrees and its `unresolvedPreloads` check, which need the worktree's keys. It must merge the observed reads and reject a stale key format. Validity holds at fold time without reading inputs (D17.3 decision 2: the result is true at its key). The merge hold must be read at the fold. The fold meets the same busy lock, later. 3+ rows across 020, 011 and 021. |
| D. Pause between daemon batches (011/021) | Not a keeper change; it reduces every waiter's loss | n/a | `src/core/code/store/prune.ts` (`deleteInBatches`), `src/core/store/transfer-import-slices.ts`, maybe tier records |
| E. Early passes try longer | Less loss on a kill (#216) | n/a | `keep-here.ts` `EARLY_SLICE_MS`, `keep-queue.ts`. The 20 ms slice blocks the gate's event loop; a worker thread would avoid that, at a larger cost. |
| F. Several files per transaction | Fewer lock wins needed (2 per file today) | shorter | `keep-write.ts`, `keep-here.ts`; transaction length not measured |

**The kept-count line (the issue's ask).** The JSON report is printed before the last pass, so the final count cannot go into it. Add one stderr line after the last pass whenever a file completed. Example: `squeal code: 145 of 478 completed test files are kept in the stores (29 while the runs went on); the next run on the same bytes runs the other 333.` Add it to the text report too.

## Recommendation for Squeal

1. D17.5: replace "up to the 30 s bound counted from the first write it refused" with option A. The busy line says "no write landed for 30 s" when that is the cause, and "waiting longer would cost more than running them again" at the ceiling.
2. D17.5: the closing kept-count line above.
3. 011 or 021 (the store owners): every back-to-back write loop pauses between batches, as `sliced-prune.ts` does. The code-store prune comes first.
4. Hold C, E and F. Take them up only if a later report shows loss after 1 to 3.

## Row split (proposal)

| Row | Content | Files | Tests | Order |
|---|---|---|---|---|
| 020-67 | Option A and its lines | `src/core/code/gate/keep-write.ts`, `keep-pass.ts`, D17.5 text | New `test/code/gate/keep-stall.test.ts` (fake writer and clock, as `bound.probe.ts`: 340 files each refused once are all kept; no write for 30 s stops; the ceiling stops); update the line text in `test/code/gate/keep-busy.test.ts` and `test/cli/code-gate-keep-busy.test.ts` | first |
| 020-68 | Kept-count line | `src/core/code/gate/keep.ts`, `src/cli/code-gate*.ts` | `test/code/gate/keep-early.test.ts`, `test/cli/code-gate-keep-early.test.ts` | with or after 020-67 (same files) |
| 011/021 next | Pause between code-store prune batches (then import slices) | `src/core/code/store/prune.ts`, `src/core/daemon/lifecycle.ts` (step shape) | A holder-and-waiter test as `starve.mjs`, on a scratch store: a waiter with a 250 ms slice lands during a prune of many batches | parallel to 020-67 |

## Open decisions for the human

1. **How long may `squeal code` wait after its report to save finished results?** A: until no save works for 30 s, and never longer than running those files again (about 90 s in #220; loses nothing there). B: until all are saved (can wait many minutes on a busy host). C: keep today's 30 s in total (lost 224 files in #220). Recommendation: A.
2. **Re-check inputs after a busy pause?** Today a file whose input moved after its run ended is dropped. The spec says such a result is still true at its key. Dropping the check keeps more results when an agent edits during the wait; keeping it costs nothing in safety. A coordinator can settle it as a spec fix unless the human wants it asked.

## Open questions

- What held cezar's `code.sqlite` for 59 to 116 s, and which database refused in #220? A watch of both files with holder stacks would decide it.
- Whether option A alone keeps all 340 files in #220's conditions: not measured (it needs the host's real contention).
- The exact paths behind the 109 and the gate's start time: elided or not recorded in the issue.

## Sources

- Issues: [#220](https://github.com/hearsay-tools/squeal/issues/220), [#216](https://github.com/hearsay-tools/squeal/issues/216), [#201](https://github.com/hearsay-tools/squeal/issues/201), [#202](https://github.com/hearsay-tools/squeal/issues/202).
- Spec: [020 spec](../spec.md) D3.4, D17.3, D17.5; [issue-201.md](issue-201.md); [issue-216.md](issue-216.md); [wave-22-020-59 notes](../tasks/wave-22-020-59/notes.md); [021 store-contention.md](../../021-remote-store-and-execution/research/store-contention.md); `docs/board.md` rows 020-53 to 020-66, gh-216.
- Source at `4c38b65c1`: `src/core/code/gate/{keep,keep-pass,keep-queue,keep-write,keep-here,keep-expected,keep-reasons}.ts`; `src/core/run-evidence/{sources,listings,reason}.ts`; `src/core/scheduler/{store-decision,store-results,stability}.ts`; `src/core/store/{busy,sliced-write,paths,open,connection}.ts`; `src/core/code/store/prune.ts`; `src/core/daemon/{open,sliced-prune,idle-checkpoint,lifecycle}.ts`.
- Squawk, read-only: `git reflog` of worktree `b476d30b`; `git diff 5a54bc2aa a0882f21e`; `squeal.config.json` at `a0882f21e`; `git log --all -- .github/mutants`; meta `observed*` rows in a `/tmp` copy of `.git/squeal/store.sqlite` (copied 2026-11-14T22:10Z).
- Probes: [probes/issue-220/](probes/issue-220/README.md), raw output in `evidence-2026-11-14.txt`.
