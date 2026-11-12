# Reuse by `squeal code --base` where no daemon ever ran (row 020-38)

Researcher, 2026-11-12. Brief: "020-38" in `../tasks/wave-13.md`; board row `keep-observed-without-daemon`; `../../011-core/research/run-evidence.md`, Difference 1. Released Squeal **0.1.451** (plugin cache copy; `src/` at `93e3e65cd` equals tag `squeal--v0.1.451`), Node v26.13.0, Vitest 5.0.3. Probes: `probes/no-daemon-reuse/` (README there), in `/tmp/ndr` clones of this repository at `93e3e65cd` with their own HOME and TMPDIR, at most 7 test files at once. Every run started below a one-minute load of 24 (20.2 to 23.4) and ended between 22.8 and 38.2 on 24 vCPUs. Durations are therefore loaded-host figures; the file counts do not depend on load.

This file proposes; it does not decide.

## Answers

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | In a clone where no daemon ever ran, how many completed files does a second `squeal code --base` read from the stores? | **37 of 160.** The first run completed all 160 and kept 37. The second ran the other 123 again (202 s wall against 251 s for the first) and kept none of them. A third run would do the same: nothing in the store changed. | verified by experiment (0.1.451) |
| 2 | Against a clone with a daemon's observed reads? | **160 of 160.** After a daemon ran the same 160 files at the unedited bytes and stopped, the first gate run after the edit kept all 160, and the second read all 160 from the stores (24 s wall, nothing run). | verified by experiment (0.1.451) |
| 2a | Is the cause Difference 1? | **Yes, file for file.** The 123 files the no-daemon clone ran again are exactly the 123 files for which the daemon recorded observed reads (`observed.` row, median 5 paths, at most 343). The 37 kept files are those with none. With the daemon's reads copied in, the gate's runs read nothing new (B1 kept 160 of 160). | verified by experiment; matches `keep.ts:163-185` (read in source code) |
| 3a | Cost of "the keeper records observed reads" | One merge write of the shared `observed*` rows per `flush`: **about 78 ms under the write lock and 5.2 MB of WAL** at this checkout's sizes (3.8 MB + 0.64 MB + 0.66 MB). The writer exists already: with no serving daemon, the keeper writes results directly today. Code: the keeper stores at the grown key, as the daemon does, instead of dropping the file. | write cost verified by experiment (scratch copy of the rows); the rest read in source code |
| 3b | Cost of "a daemon request when one serves" | **No gain in the measured case**: no daemon serves where none ever ran. It helps only a gate run that reads paths new to a serving daemon; in clone B there were none. Cost: a field in the `keep` request and a merge in the daemon's retried path. | gain verified by experiment (B1: 0 new reads); cost read in source code |
| 3c | Cost of "nothing" | Each repeat run in such a clone runs again every selected file with observed reads, and never learns them: **123 of 160 files (77%), about 178 s more wall time per repeat** here (202 s against 24 s). Repository-wide, 1,054 of the 1,721 test files at `93e3e65cd` (61%) have observed reads in this checkout's store. | verified by experiment (this selection); repository share read from the store |

## Findings

**Runs** (`probes/no-daemon-reuse/out/summary.jsonl`, `out/stores.txt`). Edit: one function added to `src/core/code/gate/estimate.ts`; 160 Vitest files selected, all completed and passed in every run.

| Run | Clone | Read from stores | Ran | Kept after it | Runner time | Wall |
|---|---|---|---|---|---|---|
| A1 | A, no daemon ever | 0 | 160 | 37 files | 187.6 s | 251.4 s |
| A2 | A, same bytes | 37 | 123 | 37 files (none new) | 142.0 s | 202.0 s |
| B0 | B, daemon runs the 160 at the unedited bytes, then stops | | 160 | 160 files, `observed.` 144 KB | | 1,672.9 s |
| B1 | B, after the same edit | 0 | 160 | 160 more keys (320) | 164.6 s | 215.7 s |
| B2 | B, same bytes | 160 | 0 | | 0 | 24.1 s |

A's store has no `observed*` meta row after both runs: the keeper writes none. B's rows are the same size before and after B1 and B2.

**Why** (read in source code, `93e3e65cd`). `Keeper.#keepable` (`src/core/code/gate/keep.ts:163-185`) drops every file with an entry in `observedGrowth`, that is, any run-time read its key lacks. The gate's keys copy the observed rows from the store (`gate/stored.ts:242`), so in clone B the reads are in the key before the run and the growth is empty. In clone A the rows are empty, so every file that reads beyond its imports has growth at every run. The daemon in the same case stores at the grown key (`store-decision.ts:180`, `at: "grown"`) and adds the reads to the shared rows (`keys.writeSeen`, `record-tier.ts:214`).

**What option 1 would keep on the first run** (read in source code; inferred for the outcome). The daemon does not store a file whose growth includes a path first hashed during the run (`store-decision.ts:175`, `first-seen`; it runs the file again). The gate's keys start as a daemon's: `bootstrap` hashes every path `git ls-files --cached --others --exclude-standard` lists, before any run (`scheduler/keying.ts:215-256`, `#seed` at 1022-1027). So a tracked or untracked-unignored path a run reads is not first-seen, and option 1 would keep such a file on the first run. A git-ignored path read at run time is first-seen: that file would be kept one run later. In this selection the observed paths are mostly tracked (`test/fixtures` 1,656, `src/core` 819, `src/cli` 223, `src/harness` 218, `src/runners` 203). Not run.

**Write cost of option 1** (verified by experiment, `out/meta-write-main.json`, load 20.8). `meta-write.mjs` copies the three `observed*.` rows of this checkout's store into a scratch WAL database and merges one path 15 times, as `SharedPaths.write` does (`src/core/keys/observed.ts`): read, parse, add, sort, format, write, in one `BEGIN IMMEDIATE` transaction.

| Row | Size | Median | Max | WAL per write |
|---|---|---|---|---|
| `observed.` | 3.81 MB | 56.1 ms | 81.3 ms | 3.85 MB |
| `observedDirect.` | 0.64 MB | 11.3 ms | 20.6 ms | 0.65 MB |
| `observedModules.` | 0.66 MB | 10.5 ms | 15.9 ms | 0.67 MB |

In a clone where no daemon ever ran, the rows start empty and grow with the files the gate runs: after 160 files they would be about 0.38 MB together, as B's are. The daemon already writes these rows at each record with growth. Spec 021 measured hooks holding the lock 0.9 to 1.8 s to write one page (`021-remote-store-and-execution/spec.md`, problem 1).

**Writers** (read in source code and spec). With no serving daemon the keeper already writes results and coverage records to the store itself (`keep.ts:218` falls to `writeHere`). Spec 021 keeps that: one-shot commands "write the store directly only when no daemon serves, with D1's bound" (`021-.../spec.md:135`). Option 1 therefore adds a row to an existing direct write, not a new writer. The row is shared by every worktree's daemon of the clone, so a merge also moves other worktrees' keys for those files, as a daemon's record does. Precedents for a one-shot command writing these rows: `squeal import` (`store/transfer-rows.ts:124`, missing entries only) and `ci export`, into its job's store (`ci/export.ts:243`).

**Option 2 and the serving daemon** (read in source code). While a daemon serves, the keeper sends each write as a `keep` request (`gate/keep-sent.ts`). The daemon writes the record and the results at the key the gate gives (`daemon/keep-request.ts`) and merges no observed reads. So a full option 1 needs option 2's protocol change as its serving-daemon half, or it applies only when no daemon serves, and a grown file stays unkept while one does.

## Recommendation for Squeal (a proposal)

Option 1 is the only option that closes the measured gap: 123 of 160 files and about 178 s per repeat run in this selection. Its write is small (about 78 ms at today's largest rows, once per `flush`), goes through the direct write the keeper already makes when no daemon serves, and stores at the key the daemon itself would use. The fit is to make it a row of the run evidence module after 011-319 and 011-320: the keeper's column for "the run read a path its key lacks, known before the run" changes from "not kept" to "store at the grown key and merge the reads". `store-decision.ts` and the key format stay as they are. Whether the serving-daemon half (option 2) comes with it is the second choice. The measurement gives it no gain on its own.

"Nothing" stays defensible only if gate runs in clones with no daemon history are rare for users. That frequency was not measured.

## Open questions

1. How often users run `squeal code --base` twice on the same bytes in a clone with no daemon history. Not determined: there is no source for it. A CI job whose store is not kept between jobs reuses nothing whatever the option (inferred).
2. One selection only: the loaders of a gate file, which are CLI-heavy tests. Another edit gives another share. The repository share (61% of test files with observed reads) is an upper bound for the files a no-daemon repeat run reruns.
3. The daemon took 1,673 s for the 160 files that the gate ran in 216 to 251 s (B0 includes the daemon's start and its listing of 1,721 files). Not determined why; outside this question.
4. Whether option 1's merge would contend with other worktrees' daemons on a busy clone. The 78 ms is a scratch file with no other writer.

## Sources

- Probes and outputs: `probes/no-daemon-reuse/` (`steps.sh`, `env.sh`, `guard.sh`, `summarize.mjs`, `kept-count.cjs`, `reruns-vs-observed.cjs`, `selected-observed.cjs`, `repo-observed.cjs`, `meta-write.mjs`, `out/`).
- Released CLI: `~/.claude/plugins/cache/hearsay/squeal/0.1.451/dist/cli/squeal.mjs` (copied to `/tmp/ndr`).
- Source at `93e3e65cd`: `src/core/code/gate/keep.ts`, `keep-sent.ts`, `stored.ts`; `src/core/scheduler/observed.ts`, `store-decision.ts`, `keying.ts`, `record-tier.ts`; `src/core/keys/observed.ts`; `src/core/daemon/keep-request.ts`; `src/core/store/transfer-rows.ts`; `src/core/ci/export.ts`.
- Specs: `../spec.md` D17.3, D17.5; `../../021-remote-store-and-execution/spec.md` problem 1 and line 135; `../../011-core/research/run-evidence.md`, Difference 1.
- Store: this checkout's `/home/agent/projects/squeal/.git/squeal/store.sqlite`, read-only, 2026-11-12.
