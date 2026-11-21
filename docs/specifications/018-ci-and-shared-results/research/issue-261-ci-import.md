# Research: does the new HEAD's CI export reach the store before a fast-forward queues its misses (018-69, gh-261)

Researcher task 6919f6f7, 2026-11-21. Brief: `tasks/wave-22.md`, 018-69. Squeal source at `b849deeb5` (0.1.585), git 2.43.0. Reporting project: hearsay-tools/squawk (clone `~/projects/cezar`, cezarion in the brief), read only: config, CI workflow, a copy of its store, one daemon log, `git ls-remote`, the GitHub Actions API. Live runs only on a boat.dev sandbox (8 vCPU Ryzen 9 9950X, Node 26.13.0, Squeal 0.1.585 from this worktree's `plugins/claude-code`, the remote a local bare copy of squawk with its real `refs/squeal/*`); none on this host (load 20.6 on 16 CPUs, 10:01 UTC). Probes: `probes/issue-261/` (throwaway). Tags: **[exp]** verified by experiment, **[src]** read in source code, **[docs]** read in spec or bench results, **[inf]** inferred.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Do `git pull` / `fetch` bring `refs/squeal/<sha>`? | No; the premise is wrong. The default refspec copies `refs/heads/*` only: after `fetch`, `pull` and `fetch --all` the clone holds no results ref and no results object. Only the daemon's reader reaches them, with its own `ls-remote` and a one-ref fetch that keeps no ref. | exp, src |
| 2 | After `merge --ff-only`, does the reader import the new HEAD's export, and when? | Only after the revision has queued its misses, and only if the ref already exists at that moment. Ref present: import at 2.2 s, 1,195 of 1,433 runnable queued files settled before the first tier (12.3 s); 233 more ran because the import came before the revision stored its new closure lists, so it kept CI's keys for them. Ref published 97 s late: never imported while the daemon ran (17 min, two later batches); all 534 runnable queued files ran locally, every one at a key the export held; a restart imported it. Imported results do take queued files off the queue; a running file finishes. | exp, src |
| 3 | How often does an export exist for the new HEAD at pull time? | Rarely for a fast follower. CI publishes 97 s (median; p90 116 s) after main moves; 9 of the last 100 main commits get no ref. 12 of 20 start-point moves in the reporter's store (60%) came before the ref existed, all 7 of the coordinator's (12 to 44 s after main moved). | exp |
| 4 | What share of the queued files would a matching-key import cover? | Nearly all, with today's CI. Reporter: 570 of 576 files run after three fast-forwards (99%) had the same key in the new HEAD's export. Sandbox: 1,428 of 1,433 runnable queued files (99.7%) are in the export at a key this worktree computes once its closures are current. Environment matched for 1,938 of 1,939 files. Coverage is off in the project; lint is never exported. | exp |
| 5 | The remaining gap and the smallest changes | Two timing gaps, no key gap: the reader looks once per start point, and a fast import races the closure lists. Smallest fixes: look again for the start point's own ref until it appears (bounded), and import or re-key after the revision's closures are stored. Neither changes what counts as current. | exp, inf |

## Findings

### Q1. What `git pull` and `git fetch` bring

**[exp]** `pull-refs.sh`: a scratch remote gets a parentless commit at `refs/squeal/<sha>` and main moves on. In a clone with the default refspec: 0 `refs/squeal` after `git fetch`, after `git pull --ff-only` and after `git fetch --all --prune`; the results object is absent; `ls-remote` lists 1. The reporter's clone has the default refspec (`+refs/heads/*:refs/remotes/origin/*`) and 0 local `refs/squeal/*`; `ls-remote` lists 143. **[src]** `shared/refs.ts` lists `git ls-remote <remote> '<prefix>/*'`; `shared/fetch.ts` fetches one ref with `--refmap= --no-write-fetch-head` and reads the blob by object id. So only the reader's own pass brings an export, never the user's pull.

### Q2. When the reader imports, and what happens to the queue

**The order [src]** (`daemon-loop/index.ts` `onBatch`, `daemon/daemon.ts:994`, `shared/reader.ts`): (1) a watcher batch makes the revision, which queues every file whose key changed and has no stored result; (2) `afterBatch` nudges the reader, which computes the start point `merge-base(HEAD, origin/<default>)`, records it as handled, lists the remote and imports the nearest first-parent ancestor of it that has a ref and is not yet imported here; (3) the import asks for retries, and the next pass or tier selection settles queued files at the new keys (`StoredKeys.adopt`, `queueMisses: false`). A file already running runs to its end.

**The trap [src]**: `#pass` sets `#start` before it lists. When the start point's own ref is not listed yet, it takes an older ancestor's ref, or nothing when that one is held, and every later nudge at the same start point returns at the first check. A listing timeout also leaves `#start` set. Nothing retries a missing export until the start point moves or the daemon restarts.

**Scenario A, ref present before the merge lands [exp]** (`ff.sh run A`: `686bc2f0` → `27faff7e`, 53 paths, no lockfile or config change; the daemon started at `686bc2f0` under `lookup-only` and imported its export, 1,938 of 1,939 files current):

| After the fast-forward | Event |
|---|---|
| 0.2 s | revision 1 (53 paths) |
| ≤ 3.0 s | 1,528 queued (97 of them the manual `browser` group), 513 current |
| 2.2 s | import of `27faff7e` (23,484 results) |
| 9.9 s | the revision stores its new closure lists |
| 11.6 to 12.2 s | files settled at the new keys (`Ledger.commit`, `StoredKeys.adopt`) |
| 12.3 s | first local tier; no run started before the adoption |
| 5.0 min | last local run ends: 238 files ran, 1,195 came from the import |

**The closure race [exp, src]**: 233 of the 238 files that ran have one of the merge's three new source files in their closure (`closure-new-paths.cjs`). `status --full` names them "environment differs (only in fields an imported pass may differ in, but the import kept the export's keys)". `rekeyFiles` (`store/transfer-rekey.ts`) re-keys a file only when its stored closure list holds every path of the exported list (`holdsEvery`). At 2.2 s the stored lists were still `686bc2f0`'s, so those files kept CI's keys, which no local key equals; the import is not repeated. The other 5 were not in the export.

**Scenario B, ref published 97 s after the fast-forward [exp]** (`ff.sh run B`: `6c43132d` → `e8db12ef`, 17 paths, the reporter's revisions 12 and 13):

| After the fast-forward | Event |
|---|---|
| ≤ 2.7 s | revision 1: 631 queued (97 manual), 1,415 current |
| 15 s, 97 s, 127 s | 149, 208, 223 files started locally |
| 97 s | `refs/squeal/e8db12ef…` published on the remote |
| 220 s, 240 s | an edit and its revert: revisions 2 and 3, two more nudges |
| 11.1 min | last local run ends: all 534 runnable files ran here |
| 17.2 min | still no import; `squeal stop`, `squeal start` |
| 17.3 min | the new daemon imports `e8db12ef`: 1,944 of 1,946 files at the key this worktree computed ("another result kept at the same key") |

**The reporter's daemon [exp]** (`coordinator.cjs`, `out/reporter/`): six fast-forwards from 00:07 to 08:43 UTC. The running daemon never imported the commit it moved to. At 03:50 (`686bc2f0`) it imported the parent's export `cf77ce2d` 9 s later (1,526 results; that fast-forward spanned two merges); at 05:31 (`27faff7e`) the previous `686bc2f0` (244 results). The exports of `86a8fd71`, `27faff7e` and `e8db12ef` came only with a new daemon (an upgrade, two session ends), 97, 87 and 77 min after their fast-forwards. Edits at 08:52, after `e8db12ef`'s ref existed, did not import it.

### Q3. How often the export exists at pull time

**Publish lag [exp]** (`lag.mjs`, Actions API, the last 100 first-parent main commits, 2026-11-18T00:20Z to 2026-11-21T08:43Z). Main moves when the merge group's required checks pass; export and publish run outside them (D9, D13). 91 commits have a ref, published 97 s after main's push (median; p10 60 s, p90 116 s, max 305 s; 6 before it). 9 have none: 6 merge groups skipped the Vitest shards, 3 exported but did not publish (not determined why). `--keep 100` reaches back 3.3 days; 52 older refs of commits off main's line are not pruned. Every import header names `event: merge_group` with `sha` equal to the main commit, so merge-queue SHAs match.

**Moves before the publish [exp]** (`moves.mjs`, start point by `git merge-base <head> origin/main` in the reporter's clone): 20 start-point moves onto exported main commits in 10 worktrees; 12 before the publish. The coordinator moved 12 to 44 s after main, 39 to 116 s before the publish, every time.

**D14 fallback [src, exp]**: the nearest older export not yet imported here is taken. It covers only files changed in an earlier merge of a multi-merge fast-forward (03:50 above); for a single merge it is the one already imported, so nothing comes.

**CI's Squeal [exp]**: until 2026-11-21 about 03:40 CI ran 0.1.522, whose exports held 1,229 files; from 0.1.582 they hold 1,941 (node:test and about 530 more `server` files). Key format 21 in both. The issue's first two queues fell in the older period.

### Q4. The share a matching-key import covers

**Reporter [exp]** (`reporter.mjs`: the key of each file the coordinator ran after a fast-forward against that file's key in any import of the new HEAD):

| Revision (HEAD, CI Squeal) | Files run | Same key in the HEAD's export | File-minutes |
|---|---|---|---|
| 3 (`9cb1aeb6`, 0.1.522) | 125 | 5; 104 not in the export | 0.1 of 13.6 |
| 5 (`86a8fd71`, 0.1.522) | 175 | 10; 161 not in the export | 0.6 of 9.8 |
| 9 (`27faff7e`, 0.1.582) | 390 | 388 | 12.7 of 12.8 |
| 11 (`6c43132d`, 0.1.582) | 129 | 125 | 8.4 of 8.5 |
| 13 (`e8db12ef`, 0.1.582) | 57 | 57 | 3.8 of 3.8 |

On the reporter's loaded host the first local runs began 79 to 111 s after each of the last three fast-forwards; by publish + 30 s, 36 of the 576 files had started (`started-before-publish.cjs`).

**Sandbox [exp]**: scenario A, 1,195 + 233 of 1,433 (Q2); scenario B, 534 of 534 ran at keys the export held. Environment, D10, D11: a fresh `pnpm install --frozen-lockfile` with the pinned Node 26.13.0 made 1,938 of 1,939 exported files current at the export's commit. **[docs]** Coverage is off in the project; with it on, an imported file is current without a coverage record (020 D13.3). Exports carry test results only (D2), so the `lint` check (oxlint) always runs locally; not measured.

**Squeal's benchmark [docs]** (`bench/README.md`, `bench/results/2026-11-21-0.1.584-default-AMD-EPYC-4585PX-16-Core-Processor/` at `bc30db2a6`; 0.1.584, 4 vCPU, one run each; not re-run here). A commit changing 125 of 500 modules: `ff` queues 350 files and drains in 60 s idle, 1 late notice; `ff-known` (another worktree ran the incoming commit first, "as the base branch's CI would") queues 0 and drains in 9.4 s; `ff-load50` still had 71 waiting 376 s after it (`session-wt0.jsonl`, `ff-poll` step 24) and 9 late notices; the agent's own edits kept a 1.5 to 1.7 s median verdict. `ff-known` is the bound a reader fix can reach. No cell sets `shared.ref` or publishes a ref late, so none measures the reader; a cell with a local bare remote and a ref published N s after the fast-forward, as `ff.sh` does, would.

### Q5. The gap, and the smallest changes that would close it

A fast follower moves its start point 12 to 44 s after main moves; CI publishes about 60 to 120 s after main moves; the reader looks once. When it does find the ref at once, it can import before the revision's closures are stored. Options, smallest first, with the risk to current-state honesty (vision principle 2):

1. **Look again for the start point's own ref while it is missing**, for example every 30 s for up to 10 min or until the start point moves; retry a timed-out listing the same way. With the measured lag the import lands about 1.5 to 2 min after the fast-forward. Saving: in the reporter's three fast-forwards about 535 of 576 runs (36 had started by publish + 30 s, 6 were not in the export); in scenario B on an idle 8-vCPU box, about 310 of 534 (223 had started by 127 s). Honesty: unchanged, results match by exact key and files stay pending until then. Cost: one `ls-remote` per try (0.45 to 0.6 s to GitHub, `transport.md` Q3), and a note when it gives up.
2. **Import or re-key only after the revision has stored its closure lists** (or re-key a held import of this start point again then). Closes the race: 233 of 1,433 runnable queued files in scenario A, every file whose closure gained a new path. Honesty: unchanged, `holdsEvery` still guards the key. Cost: the import comes about 8 s later, still before the first tier in scenario A.
3. **A bounded wait before tiers run the queued misses of a start-point move** while `shared.ref` is set and its ref is not imported (for example up to 2 to 3 min, released by the import). Saves the runs that start before the import in option 1 (on an idle box most of them). Honesty: files stay pending and must be shown as waiting; the agent's own edits must not wait. Risk: a later verdict for commits CI never exports (9 of 100).
4. **Import on every HEAD move**: adds nothing; the start point decides the export, and a HEAD move that keeps it has no new export.
5. **Several older exports per start point**: an older pass could stand in for a newer CI failure, which an export does not list (`transport.md` Q4). Honesty risk: a false current pass.
6. **Base-verified or lowest-priority files from a fast-forward** (the issue's request): current without a key match breaks principle 2; deferring is the scheduling policy gh-204 leaves to the human.

## Recommendation

Treat #261's waste as two reader timing defects, not a key or policy question. In the reporter's data the new HEAD's export held 99% of the files the coordinator ran, and its running daemon never imported it. Options 1 and 2 together would have saved about 535 of those 576 runs and most of the notices, at no honesty cost. Measure option 3 only after them, with the bench cell above at 50% load. Keep options 5 and 6 to the human's decision on gh-204.

## Open questions for the human

1. Option 1 adds a network call every 30 s for up to 10 min after a start-point move whose export is missing. Is a bounded retry acceptable, or must the reader stay at one look per start point?
2. Should a start-point move's queued misses wait up to about 2 min for the export (option 3), when that delays verdicts for the 9 in 100 commits CI never exports?
3. Why did 3 of the last 100 squawk main commits export but not publish? Needs a read of those runs' logs (read-only).

## Sources

- Issue #261 (`gh issue view 261 -R hearsay-tools/squeal`); `011-core/research/issue-261.md`, `issue-204.md`.
- Spec 018 D2, D3, D9, D10, D11, D13, D14; `research/transport.md` Q3, Q4; 020 D13.3.
- Source at `b849deeb5`: `src/core/shared/reader.ts` (`#pass`, `#take`), `choose.ts`, `fetch.ts`, `refs.ts`, `served.ts`; `src/core/store/transfer-rekey.ts` (`rekeyFiles`, `holdsEvery`); `src/core/daemon/daemon.ts:994-1022`, `#requestRetries`; `src/core/daemon-loop/index.ts`; `src/core/scheduler/stored-keys.ts`.
- Reporter, read-only: `squeal.config.json` (`shared.ref: refs/squeal`, `lookup-only`, coverage off), `.github/workflows/ci.yml` (record, export, publish `--keep 100`), a copy of `.git/squeal/store.sqlite` taken 2026-11-21T10:01Z, `logs/daemon-25fc5639a9bd0aaf.log`, `git ls-remote origin 'refs/squeal/*'`, Actions API runs and jobs of `ci.yml` retrieved 2026-11-21.
- Bench: `bench/README.md` and the results directory above at `bc30db2a6`.
- Probes and outputs: `probes/issue-261/` (`README.md` lists each script, where it ran and what it touched).
