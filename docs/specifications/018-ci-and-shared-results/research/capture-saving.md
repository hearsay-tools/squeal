# capture-saving: what a capture reporter would really save (row 018-25)

Researcher for spec 018, 2026-11-10. Brief: `tasks/wave-6.md`, "018-25"; it answers `local-capture.md` recommendation 3 and open question 3 (the human, 2026-11-10: "Capture: Yes, measure"). Squeal source at `19b8f2660`. Records: Claude Code transcripts and Codex rollouts of squeal's and cezar's worktrees (this session excluded), and copies of both stores taken 2026-11-10 09:31Z (`quick_check` ok). No agent CLI ran, no daemon, no test. Load 2.6 to 3.9 on 24 vCPUs; nothing was timed. Probes: `probes/capture-saving/` (throwaway). Tags: **[exp]** verified by experiment, **[src]** read in source code, **[inf]** inferred.

**Window.** 6 days, 2026-11-04 00:00Z to 2026-11-10 00:00Z, not 7. The stores prune runs after 7 days (`store/prune.ts`, spec 001 D8) **[src]**: squeal keeps runs from 2026-11-03 14:34Z, cezar the bulk from 11-03 09:00Z **[exp]**, so a manual run on 11-03 would lose the daemon runs before it. The cezar store also holds no daemon run from 2026-11-07 15:00Z to 11-09 08:00Z (41 h) **[exp]** (`out-daemon-seconds.txt`); the 332 cezar runs of storable shape with no daemon run anywhere in the store within 2 h of their start are set apart, since no daemon ran there for a capture to save.

## Questions answered

| # | Question | Answer |
|---|---|---|
| 1 | How many manual runs can be stored at the daemon's key | squeal 292 of 442 Vitest runs (66%); cezar 1,048 of 1,535 (68%), of which 716 had a daemon running nearby. 258 and 679 of those name test files the store knows **[exp]** |
| 2 | How many ran content the daemon had not yet run by the run's end | squeal 1,142 to 1,925 of 2,073 file-runs (55 to 93%), in 189 to 235 of 258 runs. cezar 11,895 to 13,332 of 16,294 (73 to 82%), in 573 to 615 of 679 runs **[exp]** |
| 3 | The CPU they stand for | Of those, the daemon later ran the same content in the same worktree 283 to 430 times in squeal (741 to 1,033 file-seconds, 124 to 172 a day) and 1,354 to 1,596 times in cezar (14,315 to 17,012, 2,386 to 2,835 a day). That is 0.16 to 0.23% and 0.93 to 1.11% of the daemon's own file-seconds; with a bound for other worktrees, at most 0.32% and 1.7% **[exp][inf]** |
| 4 | Go or no-go for the capture reporter | No-go. The saving is 9 to 13% of the manual runs' own cost and at most 1.7% of Squeal's work. Most manual runs test content the daemon never needs: the agent changes it again first **[inf]** |

The ranges are four variants of one join (below): git rewrites with unknown paths counted as a change or ignored, and 2 s or 30 s from an edit to the daemon revision that holds it.

## 1. Method and storable shape

**The join** **[exp]** (`extract.mjs`, `join.mjs`). A manual run is the same record as `local-capture.md` 1 (same classifier), with its worktree and its start and end. A worktree's store id is `sha256(realpath(root))[0:16]` (`fs/git-layout.ts` `worktreeIdOfRealPath`) **[src]**, so even a removed worktree's daemon runs join by path. For each run and each test file it names (Vitest's substring filter over the store's `test_files`), "same content" means no change to the file, its closure (`test_files.closure_paths`, the newest list) or its project's environment files (`environment_walks.files`, package manifests) between the daemon run's revision and the manual run. Changes come from two records:

- **Store mode**, worktrees still registered (31 squeal, 9 cezar runs): the `revisions` rows, exact by revision number.
- **Transcript mode**, removed worktrees (261 squeal, 707 cezar runs): the `revisions` rows are deleted with the worktree (`WORKTREE_SCOPED_TABLES`) **[src]**, so changes come from the agents' own edits (tool edits, Codex `FileChange`, writing shell commands). A daemon run counts as same content when its revision was first seen (the first daemon run at that revision) after the last change before the manual run plus the lag, and before the next change plus the lag.

Each file-run gets one class: the daemon ran that content before the run, finished it during the run, started it during the run and ended after, ran it after the run, never ran it in that worktree, or the content changed during the run (a capture's stability check would refuse it).

**Storable shape** **[exp]**, as `local-capture.md` 3: no `-t`, `-u`, coverage, other config or directory (`--config`, `--root`, a `cd` elsewhere), watch, keyed flag, or unknown end (a background run). squeal drops 67 name filters, 72 other configs, 4 keyed flags, 7 background runs. cezar drops 249 name filters, 183 other configs or directories, 46 keyed or untested flags, 2 coverage, 2 watch, 5 background. 105 cezar storable runs use `--project`, which was kept but not tested (`local-capture.md` open question 2).

**Validation** **[exp]**. On the registered worktrees, both modes ran on the same 161 squeal and 24 cezar file-runs. For "daemon ran it after the run", the class that carries the saving, store mode gave 9 and 5, transcript mode 8 and 6 (strict, 2 s). The modes disagree mostly where store mode says "changed during the run" (57 squeal file-runs): a build in the same shell command rewrote `plugins/*/dist` files inside closures, which no transcript edit shows. The edit-to-revision lag measured on the same worktrees: squeal p50 0.3 s, p90 1.4 s (n 15); cezar p50 16 s, p90 42 s (n 12). These samples are small; the 2 s and 30 s variants bracket them.

## 2. Content the daemon had not run by the run's end

| File-runs (6 days) | squeal (2,073) | cezar (16,294) |
|---|---|---|
| Daemon ran it before the run | 29 to 788 | 1,764 to 3,369 |
| Daemon finished it during the run | 37 to 77 | 947 to 1,144 |
| Changed during the run | 82 | 67 to 68 |
| **Not yet run by the run's end** | **1,142 to 1,925** | **11,895 to 13,332** |
| of which: daemon ran it after the run (same worktree) | 292 to 528 | 1,928 to 2,757 |
| started during the run, ended after | 13 to 30 | 110 to 121 |
| never ran that content in that worktree | 710 to 1,475 | 8,691 to 10,807 |
| no daemon run in that worktree at all | 19 | 413 |

Each range is the lowest and highest of the four variants (`out-join-*.txt`). Ignoring git rewrites moves file-runs from "never" to "before"; the 30 s lag moves them from "before" and "during" to "after". By run: 189 to 235 of 258 squeal runs and 573 to 615 of 679 cezar runs had at least one file not yet run by their end.

**Why "never ran" is the largest class** **[exp]** (`out-never.txt`, strict, 2 s). squeal: the next change to the file's closure came p50 184 s after the run started, the daemon's next run of that file p50 516 s after; in 711 of 1,406 transcript-mode file-runs the content changed before the daemon reached it, and in 642 the daemon never ran that file again in that worktree. cezar: the next change came p50 1,735 s after, the daemon's next run of the file p50 4,681 s after; 7,785 of 10,723 had no later daemon run of the file in that worktree, and 2,248 showed no change in that worktree before the run. cezar's `squeal.config.json` sets `"baseline": {"onStart": "lookup-only"}` **[src]**, so a worker's daemon does not run base content the store lacks; that explains part of the 2,248 **[inf]**. In both projects, agents mostly test content the daemon has deferred, and then change it again.

## 3. What a capture would save

A stored capture saves a daemon run only when the daemon would later have run that exact content. Counted once per daemon run, with the duration that run recorded (`results.duration_ms` of the file check, exact for 279 to 425 and 1,276 to 1,479 of them; every one of those was a pass, which a capture may store) **[exp]**:

| | squeal | cezar |
|---|---|---|
| Daemon runs saved, same worktree | 283 to 430 | 1,354 to 1,596 |
| File-seconds saved (a day) | 741 to 1,033 (124 to 172) | 14,315 to 17,012 (2,386 to 2,835) |
| Bound for another worktree running the same final content later | at most 288 to 402 | at most 3,330 to 8,982 |
| Daemon's own file-seconds in the window (a day) | 449,353 (74,892) | 1,531,161 (255,194) |
| **Saving as a share of the daemon's work** | **0.16 to 0.23%; at most 0.32%** | **0.93 to 1.11%; at most 1.7%** |
| Manual storable file-runs' own file-seconds | 8,054 | 131,688 |
| Saving as a share of them | 9 to 13% | 11 to 13% |
| Daemon start after the manual run ended, p50 | 105 to 164 s | 543 to 1,059 s |

A file-second is one test file's wall time in one worker, about one CPU core while it runs **[inf]**. The bound row assumes that every never-run content that stayed final in its worktree was later run elsewhere (`bound.mjs`); a key match after a merge needs equal closure content, so the real figure is lower **[inf]**.

**Cost side** **[inf]**. The reporter enters the project's Vitest config, which is keyed, so adding it re-keys each project once (`local-capture.md` 2). One re-key is about 6,843 file-seconds in squeal and 14,349 in cezar at this window's per-file means (1,577 and 1,742 files): 40 to 55 days of squeal's saving, 5 to 6 days of cezar's. Then the capture switch, the recorder for observed reads, the stability proof from the run's start to end, and ingestion all come on top.

## Recommendation for Squeal

1. **No-go for the capture reporter as a CPU saving.** It would save at most 0.32% of Squeal's own test work in squeal and 1.7% in cezar. Most manual runs test content the daemon never needs, because the agent changes it again before the daemon gets there. A one-time re-key alone costs 5 to 55 days of the saving.
2. **The latency gain is the only real benefit, and it is small.** For the files it covers, a capture would make a result current p50 2 to 3 min earlier in squeal and 9 to 18 min earlier in cezar, for about 50 to 70 file results a day in squeal and 225 to 265 in cezar. The lag comes from the daemon's own scheduling; capture does not change it.
3. **Do not reopen capture without new evidence.** New evidence would be a project where the daemon later runs most of the manual content itself. Here that would show as the "after" class growing toward the "not yet run" total; today it is 16 to 35% of it in squeal and 15 to 23% in cezar, by variant.

## Open questions

1. Whether the deferred content matters: 710 to 1,475 squeal and 8,691 to 10,807 cezar file-runs ran content the daemon never ran in that worktree. Not determined which share was superseded, deferred by the edit cut or the backlog, or skipped by lookup-only, beyond the counts in section 2.
2. The cross-worktree saving is only bounded. Measuring it needs the key of the manual run's content, which the store does not keep for a removed worktree.
3. The cezar daemon gap of 2026-11-07 15:00Z to 11-09 08:00Z. Its cause is not determined from the store; it is out of this row's scope.
4. Transcript mode misses changes made by a process inside a command (builds, code generators) and by people. The small validation set does not show a bias in the "after" class, but it cannot rule one out.

## Sources

- Squeal at `19b8f2660`: `src/core/store/{schema,prune}.ts`, `src/core/store/repos/{worktrees,results}.ts`, `src/core/fs/git-layout.ts`, `src/core/keys/check-key.ts`, `src/runners/vitest/environment.ts`; cezar `squeal.config.json` and `package.json` scripts.
- Store copies: `/home/agent/projects/{squeal,cezar}/.git/squeal/store.sqlite` (with `-wal`, `-shm`), 2026-11-10 09:31Z, deleted after use.
- Transcripts: `~/.claude/projects/-home-agent-projects-{squeal,cezar}*` (main and `subagents/` files), `~/.codex/sessions/2026/11/{02..10}`; read-only.
- Earlier findings: `local-capture.md` (row 018-22), `main-results.md`.
- Probes and outputs: `probes/capture-saving/` (`out-join-{strict,ignore}-{2000,30000}.txt`, `out-never.txt`, `out-bound.txt`, `out-daemon-seconds.txt`).
