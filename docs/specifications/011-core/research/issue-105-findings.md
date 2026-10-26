# Issue 105 findings: which ignored files feed test keys

Researcher, 2026-10-26, row 011-255. Brief: `issue-105-brief.md`. Triage: `issue-105.md`. Probes: `probes/issue-105/` (throwaway).
Versions examined: Squeal at `93f5bbc53` (0.1.352, `plugins/claude-code/dist`); cezarion at `9a9f617f` (the incident's base) and `ecdde7685` (main); store copies taken 2026-10-26 17:58Z from `~/projects/{cezar,squeal}/.git/squeal/`.

## Answers

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Reproduce | Reproduced. A scratch write in a new ignored directory makes no revision and moves no key. A declared ignored input moves its test file's key only because the test reads it; a declared ignored input the test never reads makes no revision and moves no key. A build output a spec reads makes a revision when its bytes change and re-keys that spec only. A rewrite of the ignored runtime descriptor `.ai/qa/test-env.json` makes a revision with `git status` empty and queues every slow spec that reads it. One hand-run of a spec that reads no ignored file did exactly that through its `globalSetup`. | verified by experiment |
| 2 | Why | No ignored path enters a revision unless Squeal tracks it. Since 0.1.313 (016 D4, row 016-17, 2026-10-25), a git-ignored path a test file was **observed** to read is kept, hashed and watched as an extra file, unless the same test file wrote an ancestor directory. Cezarion's descriptor is written by a shell script in `globalSetup` and by a detached idle watcher, which the recorder does not see, so the bound does not drop it. The observed set is shared by every worktree and never pruned. | read in source code; verified by experiment |
| 3 | Which ignored files matter | Cezarion: tests read 5 ignored paths; one of them, `.ai/qa/test-env.json`, has **32 e2e readers**, the incident's 32. It is the only ignored file written in the last 24 h that any test reads (1 of 15,817). It made 58 revisions in 22 h, 57 of them alone. No declared input is ignored. Squeal: 35 observed ignored paths, all absence probes in per-run scratch directories (the paths do not exist); every revision they made is from 2026-10-09; since then only `node_modules/.package-lock.json` (the installed lockfile, on purpose). | read from store; verified by experiment (writes) |
| 4 | The header | The full header already names up to three changed paths, then "and N more". The news form the incident showed drops them (task 001-407), and `squeal status` shows none. 72% of cezarion's and 42% of Squeal's revisions change one path; 83% and 66% change three or fewer. | read in source code; read from store |

## 1. Reproduce

Experiment E1 (`probes/issue-105/run.sh`), a clone under `/tmp` shaped like cezarion: `.ai/qa/**` ignored; a `unit` project; a slow `e2e` project whose `globalSetup` runs a shell script that writes `.ai/qa/test-env.json` (pid, start time) and `.ai/qa/build/out.txt`. Specs `a` and `b` read the descriptor in the worker, as cezarion's `packages/web/e2e/agent-browser.ts:19` does; `c` reads the build output; `d` reads no ignored file. `test/declared.test.mjs` declares and reads `.ai/qa/declared.json`; `test/declared-only.test.mjs` declares `.ai/qa/declared-only.json` and never reads it. Squeal ran every file once, then the script made one write per step. Run 1 at 18:01Z (one-minute load 28.96 to 32.72, 24 CPUs) had no `declared-only` file and no restart step; run 2 at 18:06Z (load 20.63 to 30.43) had both. Both runs agree on every shared step. A step waits 4 s after its write.

| Step | Revision | Changed paths | Keys moved | Queued |
|---|---|---|---|---|
| scratch: `.ai/qa/1816/probe.mjs` and its output | none | none | none | none |
| declared input, created, then edited | +1 each | `.ai/qa/declared.json` | `test/declared.test.mjs` | fast, ran at once |
| declared input never read, created, then edited | none | none | none | none |
| build output, same bytes | none | none | none | none |
| build output, new bytes | +1 | `.ai/qa/build/out.txt` | `e2e/c.e2e.mjs` | `c`, slow |
| descriptor rewritten, as a boot does | +1 | `.ai/qa/test-env.json` | `a`, `b` | `a`, `b`, slow |
| `vitest run e2e/d.e2e.mjs` by hand | +1 | `.ai/qa/build/out.txt`, `.ai/qa/test-env.json` | `a`, `b` (and `c` back to its old key) | `a`, `b` |
| Squeal runs `a` and `b` | +1, from their own `globalSetup` | `.ai/qa/test-env.json` | `a`, `b` | none: both current at the new key, no loop |
| descriptor changed while no daemon runs, then `squeal start` | +1 (`start`) | `.ai/qa/test-env.json` | `a`, `b` | none: `a`, `b` stale (lookup-only start) |

Every step had `git status --porcelain` empty. The observed sets at the end: `a`, `b` → `.ai/qa/test-env.json`; `c` → `.ai/qa/build/out.txt`; `declared.test.mjs` → `.ai/qa/declared.json` (its `existsSync` before the file existed). Raw output: `probes/issue-105/e1-run1-2026-10-26.out` and `e1-run2-2026-10-26.out`.

The hand-run row is the incident: the worker "ran one browser spec", its `globalSetup` booted the environment and rewrote the descriptor, and the next report said `+ 1` and queued the readers. In cezarion the build output does not key the specs: the server that reads it is started from `globalSetup` through `test-env-up.sh`, and 011 C12 lists both Vitest's own process (`globalSetup`) and what a non-Node child does as "Not seen". The store agrees: no `.ai/qa/build/` path is in any observed set or any revision.

## 2. Why

- **An ignored path with no reader is dropped before the revision.** `src/core/watcher/candidates.ts:78-81` runs the batch through `checkIgnored`, skipping only the extra files; line 105: `if (ignored.has(rel)) continue;`. A reconciliation pass re-stats only git status's paths, the stat cache and the extra files (`candidates.ts:145`).
- **An observed ignored read becomes an extra file.** `src/core/scheduler/observed.ts:31-37`: "A path git ignores is kept, and watched as an extra file, unless the run wrote, created or removed one of its ancestor directories (`ObservedInputs.written`; 016 D4, the written-directory bound): those are the run's own scratch." Lines 84-97 apply `scratchOf` and call `keys.track(tracked)`; `src/core/scheduler/keying.ts:651-661` (`track`): "the gitignored ones become extra files", then `onExtraFiles`, which re-specs the watcher.
- **The bound misses writers outside the test file's process tree.** `scratchOf` (`observed.ts:127-145`) drops a path only below a directory in `observed.written`, which the recorder fills from the test file's worker and its Node children. Vitest's `globalSetup` runs in Vitest's own process, which 011 C12 lists as "Not seen". Cezarion's writers are `test-env-up.sh` (from `globalSetup`, `packages/web/e2e/environment.ts`) and `markStopped` in `.ai/scripts/test-env-lease.mjs` (the detached idle watcher), both at `9a9f617f`.
- **The set is shared and never pruned.** `src/core/keys/observed.ts:17-21`: "One map per project from test path to paths, shared by every worktree of the repository, merged and never pruned." So a fresh worktree tracks the descriptor before any of its own runs.
- **Selection.** A changed tracked path re-keys the test files that reference it: `src/core/keys/key-index.ts:206-212`, `rekey` → `this.reverse.referencing(changed)`. A slow file with a moved key is pending.
- **When this began.** 011 C12 as amended 2026-10-13 said "ignored paths are never keyed". 016 D4 changed that on 2026-10-25 (commits `674a84e0e` to `fa739f3cf`, released in 0.1.313 at 14:48Z). The first cezarion revision that names the descriptor is 2026-10-25 20:01Z; none before, in revisions back to 2026-10-14 (read from store). Research `016-extensions/research/ignored-paths.md` counted clones with no developer state and left this open (its open question 1).
- **The start pass** re-stats what the stat cache inherited, and `#release` (`keying.ts:605-631`) drops an inherited ignored path only when nothing names it. The descriptor stays named, so a change made while no daemon ran becomes a `start` revision: 4 of the 58 in the store, and E1's restart row (verified by experiment).

## 3. Which ignored files matter

Read from copies of the stores, classified with `git check-ignore --no-index` in each main checkout (`probes/issue-105/ignored.py`).

| Repository | Ignored path | Readers | How it enters | Revisions it made |
|---|---|---|---|---|
| cezarion | `.ai/qa/test-env.json` | 32 e2e specs | observed read; runtime state rewritten at each boot and idle stop | 58 in 22 h (6 worktrees), 57 alone; of the 52 intervals between consecutive ones in one worktree, 20 under 15 s, median 615 s |
| cezarion | `packages/cezar/web/dist/index.html` | 7 server tests | observed absence probe (016 research) | none since 2026-10-15 |
| cezarion | `.agents/skills` | 3 server tests | observed | none |
| cezarion | `packages/web/.e2e-fixtures/` (listing) and `package.json` | 2 e2e specs | observed | none |
| cezarion | `node_modules/.pnpm/lock.yaml` | every file of its projects | installed lockfile (011 C11) | 6 |
| cezarion | `packages/cezar/dist/**`, `web/dist/**` | none now | tracked by 0.1.168 daemons; why not determined (no `dist` path is in an observed set or a declared input now) | 44 ignored-only revisions, all on 2026-10-14 and 15 |
| Squeal | `test/fixtures/{vitest,node-test}/.tmp/*`, `.ai/cezar/tmp/*` | 21, 1 and 1 test files | observed absence probes (config lookups walking up from a scratch repository); the paths do not exist | 46, all on 2026-10-09 |
| Squeal | `node_modules/.package-lock.json` | every file | installed lockfile | 66 |

Written often with no reader, last 24 h at 18:20Z, main checkouts only (worktrees and `node_modules` left out): cezarion 15,817 ignored files (`.ai/qa/served` 10,954, `.ai/cezar/{runs,preview,t}` 2,610, `.ai/qa/build` 1,045, `.ai/qa/artifacts_e2e` 691, `.ai/qa/server-home` 206, `.ai/qa/issue-*` scratch); Squeal 58,024 (`.ai/cezar/t` 57,209, `.ai/cezar/runs` 807). Of all these, only `.ai/qa/test-env.json` has a reader. Declared `inputs`: no literal prefix in either `squeal.config.json` is ignored, and declared globs never match an ignored file (`keying.ts:633-641`, `#declarable`).

## 4. The header

`src/core/delivery/header.ts:28,43-48`: the full form appends ` (changed a, b, c and N more)` (`CHANGED_PATHS_SHOWN = 3`), from the union of the revisions since the consumer was last told (`liveness.ts:95`). The news form (`header.ts:111-117`, task 001-407) "drops the changed paths"; the incident's line `Revision 1 · 9a9f617f + 1: test files without checks: 32 pending, 41 unknown.` is that form. `squeal status` printed `Revision: 4 · 26203f62 + 4` with no path in E1.

What a header could name, from data that exists today:
- **Small set (one to three paths):** each path, that git ignores it, and how many test files it re-keyed, for example `(changed .ai/qa/test-env.json, git-ignored, read by 32 test files)`. The store's revision rows hold the paths and hashes; the readers come from the observed sets in `meta`, or from the daemon's reverse index.
- **Large set:** a count, the count git ignores, and the top directories, for example `(changed 788 paths, all git-ignored, under packages/cezar/dist/)`; cezarion has 31 revisions over 100 paths.
- **Gap:** no stored field says a path is ignored or an extra file; `extraFiles()` lives in the daemon's memory (`keying.ts:689`). A hook would need a stored flag or its own `git check-ignore` (inferred).

## Recommendation for Squeal

The waste is not "ignored files count as changes". It is one ignored **runtime-state file that tests read**, written outside any test file's process tree, so the written-directory bound keeps it. The fix row should decide that case alone; scratch is already ignored. The tradeoff: keying the descriptor costs cezarion 32 slow re-runs per environment boot or idle stop (58 revisions in 22 h); not keying it means a change in that file alone never re-runs its readers, and the file holds a pid, a port and a start time, not code. The source that proves it: `observed.ts:31-37` with E1's hand-run row and the store's 32 readers. A header that names the path and "git-ignored" in the news form would have answered the reporter at once.

## Open questions

1. Whether the 32 readers also lose inheritance across worktrees, since each worktree's descriptor differs. Not determined, because the stored keys mix rows from before and after 0.1.313 (824 reader rows, 274 share a key with another worktree, against 606 of 1,433 for non-readers).
2. The incident worktree's own revision rows are gone from the store (its worktree was removed), so its revision 1's path is inferred from the count match (32 = 32) and E1, not read.
3. Which runner-side signal could mark a write as the environment's own (Vitest's `globalSetup`, a shell child, a detached process). Not determined, because the recorder does not run there; no experiment was made.

## Sources

- Issue https://github.com/hearsay-tools/squeal/issues/105 and its triage comment.
- Squeal `93f5bbc53`: `docs/specifications/011-core/spec.md` C2 (lines 81-88), C3, C11, C12 (line 353); `016-extensions/spec.md` D4 (lines 126-140); `016-extensions/research/ignored-paths.md`; `src/core/watcher/candidates.ts`; `src/core/scheduler/observed.ts`; `src/core/scheduler/keying.ts`; `src/core/keys/observed.ts`; `src/core/keys/key-index.ts`; `src/core/delivery/header.ts`; `src/core/delivery/liveness.ts`; `docs/board.md` rows 004-28, 004-47, 004-81.
- Cezarion (`~/projects/cezar`, https://github.com/hearsay-tools/cezarion) at `9a9f617f`: `squeal.config.json`, `.gitignore`, `packages/web/e2e/vitest.config.ts`, `packages/web/e2e/agent-browser.ts:19`, `.ai/scripts/test-env-up.sh`, `.ai/scripts/test-env-lease.mjs:334-370`, `.ai/scripts/build-e2e.sh`.
- Store copies: `revisions`, `test_file_keys`, `meta` `observed.*` rows of both repositories.
