# 011-133: what starts the old-version daemons (gh-75, gh-77)

Researcher R1 of wave 22, 2026-10-23, from main e81754965 (0.1.273). Brief: [issue-75-77-brief.md](issue-75-77-brief.md).

**Answer.** A kept copy with the wrong code starts the old daemons. Squeal keeps a copy of each Codex plugin version under `<PLUGIN_DATA>/versions/<version>/`. On this host the copy named `0.1.273` holds 0.1.272 code, and the copy named `0.1.272` holds 0.1.271 code. A Codex hook spawns its daemon from the copy of its own version number and never checks the code in it. A newer hook steps the old daemon down, claims the handoff and spawns its successor from that copy. The successor registers at the old version, so the next newer hook steps it down again. Nothing ends the cycle until the session ends. 0.1.273 still loops in this way (verified by experiment).

## Questions answered

| # | Question | Answer | Tag |
| --- | --- | --- | --- |
| 1 | What the store kept | gh-75's worktree kept all of its records: ten 0.1.260 daemons, each stepped down by 0.1.261 hooks within 0.5 to 40 s, and no 0.1.261 daemon ever registered. The cap of 20 notes removed gh-77's notes. The store keeps no executable path and no pid. | verified by experiment (a query on a copy of the store) |
| 1a | Which harness, which versions | All four looping sessions were Codex sessions whose plugin updated mid-session. SessionStart ran version S and the later hooks ran H > S. The old daemons were at a version below H. | verified by experiment (cezar run logs) |
| 2 | Probe with what the reports had | Reproduced on 0.1.271 to 0.1.273: 39 daemon incarnations in 180 s, 38 of them 0.1.272 successors spawned with `--await-lock` from the copy named 0.1.273. Without that copy (`control`), one handover and convergence. | verified by experiment |
| 3a | Does 0.1.273 still loop? | Yes, whenever the copy of the hook's own version holds older code. | verified by experiment |
| 3b | Does a named wait's first read still return busy? | Not when another process holds the store's write lock: in WAL mode the read goes on, and it returned a current verdict in 0.38 s while a writer held `BEGIN IMMEDIATE` for 3 s. In source, a read that is really blocked retries for up to 1000 ms, then returns `unavailable`. | verified by experiment, 0.1.273; read in source code |
| 3c | Stop wake: liveness change or unchanged state? | A liveness change. Each speaking Stop reported a new handover or a new daemon. The loop makes these changes again and again. A Stop that came with no change was silent. | verified by experiment (run logs and probe) |
| 3d | Is 011-126's busy-store event-loop hold a cause? | No. Every exit in gh-75's store is a step-down, not a lost heartbeat, and the loop reproduces on 0.1.273, which carries 011-126. | verified by experiment |
| 4 | The repair | One row, below. | inferred |
| — | What wrote the mislabeled copies | Not determined, because nothing records the writer. Each copy was made before its version was released, so unreleased code made it. | verified by experiment (times); writer inferred |

## Q1. What the store kept

I copied `/home/agent/projects/cezar/.git/squeal/store.sqlite` (550 MB, with its `-wal` and `-shm` files) to `/tmp` at 07:12Z and opened only the copy. 26 worktree rows remain. I matched the reports to worktrees by cezar's run records (`.ai/cezar/runs.db` and the run logs, copied or read only).

**gh-75: worktree `d22e25bb`, Codex run, 10:04:25 to 10:09:05Z.** The row was registered at 10:04:31Z. Its notes list ten exits, each `daemon stopped: hooks at Squeal 0.1.261 are newer than this daemon (0.1.260)`:

| Incarnation started | Gap after the previous stop | Stopped | Lived |
| --- | --- | --- | --- |
| 10:04:31.851 | none (first) | 10:04:32.936 | 1.1 s |
| 10:04:55.504 | 22.6 s | 10:05:04.048 | 8.5 s |
| 10:05:17.809 | 13.8 s | 10:05:28.926 | 11.1 s |
| 10:05:32.702 | 3.8 s | 10:05:50.735 | 18.0 s |
| 10:06:09.059 | 18.3 s | 10:06:49.246 | 40.2 s |
| 10:06:53.894 | 4.6 s | 10:07:06.347 | 12.5 s |
| 10:07:11.779 | 5.4 s | 10:07:43.953 | 32.2 s |
| 10:07:50.642 | 6.7 s | 10:07:51.179 | 0.5 s |
| 10:07:58.946 | 7.8 s | 10:08:06.035 | 7.1 s |
| 10:08:38.265 | 32.2 s | 10:08:56.293 | 18.0 s |

Each record kind is in the store: `daemon-token` (start time, version 0.1.260), `daemon-exit`, `notes.<worktree>` and one `daemon-handoff` claim. Only the last claim remains, because each claim overwrites the one before: from the 10:08:38.265 incarnation, to 0.1.261, at 10:08:56.276, bound 10:11:06.276. The issue's `since` values are these claim times and note times. For example, 10:05:28.571 is a claim that came 0.36 s before the 10:05:28.926 note. The cap of 20 notes pruned nothing here: the worktree has 16 notes, ten exits and six node:test closure notes. The worktree's last daemon is still 0.1.260.

**gh-77: worktree `5f133bd2` (row `ca78db7f652ba956`), Codex run, 13:17 to 21:44Z.** The cap pruned every note from 13:45Z to 19:01Z. The 20 kept notes span 21:46:54 to 22:16:56Z, from a 0.1.268 daemon that started at 20:44:19Z. No claim remains.

**#75's comment: worktree `e3953400`, Codex run, 15:16 to 15:29Z.** Also a 13:41Z run, `62320a92`, with the same loop. Their rows are gone: removing a worktree removes its rows (`WorktreeRepo.remove`).

**Not in the store:** a daemon's executable path and its pid. The worktree row holds the socket path, start time, heartbeat and version. The token holds the start time, version and a random token.

The cezar run logs record each hook's plugin directory, so they fill the gap (Codex harness, `~/.codex/plugins/cache/hearsay/squeal/<v>/hooks/hooks.json`):

| Run | SessionStart | Later hooks | Handover notices, by from → to | Distinct `since` | Stops that spoke |
| --- | --- | --- | --- | --- | --- |
| d22e25bb (gh-75) | 0.1.260 | 0.1.261 | 12 × 0.1.260 → 0.1.261 | 11 | none ran |
| 62320a92 | 0.1.263 | 0.1.264 | 1 × 0.1.263 → 0.1.264, then 7 × 0.1.262 → 0.1.264 | 8 | 1 of 1 |
| 5f133bd2 (gh-77) | 0.1.263 | 0.1.264, later 0.1.265 to 0.1.267 | 77 × 0.1.262 → 0.1.264, 22 × 0.1.263 → 0.1.265, 9 × 0.1.265 → 0.1.266, 5 × 0.1.266 → 0.1.267 | 110 | 12 of 14 |
| e3953400 (#75 comment) | 0.1.264 | 0.1.265 | 1 × 0.1.262 → 0.1.264, then 22 × 0.1.263 → 0.1.265 | 22 | 1 of 1 |

In e3953400, a 0.1.262 daemon served a new worktree 5 s after a 0.1.264 SessionStart. The only process that could start it was that SessionStart, which spawns from the copy named 0.1.264. So that copy held 0.1.262 code (inferred). gh-77's `squeal start` was 0.1.263, and every successor was 0.1.262. That is why it found "no daemon of Squeal 0.1.263 or later" after 90 s (inferred; the probe's 0.1.272 `start` with 0.1.272 successors exited 0).

**The copies on this host now** (read on 2026-10-23, 07:20Z; release times from `gh release list`):

| Copy | Code in it | Copy made | Its release committed | Its release published |
| --- | --- | --- | --- | --- |
| `versions/0.1.272` | 0.1.271 | 04:09:18Z | 04:18:54Z | 04:19:20Z |
| `versions/0.1.273` | 0.1.272 | 05:47:00Z | 06:39:51Z | 06:40:13Z |

Both copies are older than their own releases. So unreleased code of the named version made each one, with `PLUGIN_ROOT` naming the installed, older plugin. `keepVersion` names a copy after the running code's version (`squealVersion()`) and fills it from `PLUGIN_ROOT` without comparing the two (read in source code, 0.1.261 and 0.1.273, `src/harness/shared/version-copies.ts`, `src/harness/codex/kept.ts`). At 05:47:00Z this repository's store records one test run in progress: run `329196ac`, 80 files at revision 6, in a removed worktree. A Codex reviewer of `cand/0.1.273` (cezar run `801fafa8`) had worked in that worktree until 05:46:39. A Squeal daemon that a Codex hook spawned inherits the hook's `PLUGIN_ROOT` and `PLUGIN_DATA`, and its test processes inherit them too. Under Vitest, `squealVersion()` reads the candidate's `package.json` (read in source code). I did not find the test that wrote the copy. Writer: not determined.

## Q2. The probe

`probes/issue-75/three-versions.mjs`, started by `probe.mjs mislabeled|control`. It uses the committed Codex and Claude Code bundles of 0.1.271, 0.1.272 and 0.1.273 from a clone under `/tmp`. `HOME`, `CODEX_HOME`, `XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME` and `TMPDIR` are under `/tmp`. The steps:

1. A Codex SessionStart of 0.1.272 runs with `PLUGIN_ROOT` in a 0.1.272 cache directory and its copy named 0.1.272 holding 0.1.271. This gives the old daemon.
2. The probe removes the 0.1.272 cache directory, as Codex's install of 0.1.273 does.
3. Codex PreToolUse and PostToolUse hooks of 0.1.273 run about every 4 s. Stop runs every 20 to 30 s.
4. At 40 s, a writer holds `BEGIN IMMEDIATE` for 3 s while a 0.1.273 `status --wait 60000` runs on one file. At 70 s, an edit. At 90 s, `squeal start` from Claude Code's 0.1.272 CLI. From 100 s, four 2 s store holds.
5. The fixture has one node:test file of 4 s and one fast file, so the baseline and the edit run real tiers.

Mode `mislabeled` adds a copy named 0.1.273 that holds 0.1.272, as on this host. Mode `control` has no such copy. The probe records each daemon process (its argv names the executable and `--await-lock`), each record, claim and exit note, and each hook's notice.

| Run | Start load / 24 CPUs | Daemon processes | Incarnations recorded | Claims, exit notes | Tool-hook notices | Ends |
| --- | --- | --- | --- | --- | --- | --- |
| mislabeled, 180 s | 15.79 (rose to about 45 during the run) | 57: one 0.1.271 from copy 0.1.272; 36 0.1.272 from copy 0.1.273 with `--await-lock`; 19 without it (lost the lock); one from `start` | 39: one 0.1.271, 38 × 0.1.272 | 38, 38 | 35 handing over, in 58 PostToolUse calls; 33 distinct `since` values | still looping; final status: 1 of 2 files not current |
| mislabeled again, 150 s; Stop after a 3 s pause, the wait after the writer holds | 15.57 | 51: one 0.1.271; 39 0.1.272 with `--await-lock`; 11 without it | 40: one 0.1.271, 39 × 0.1.272 | 39, 40 | 26 handing over, in 51 PostToolUse calls | still looping; `start` (0.1.272) found a 0.1.272 daemon alive and exited 0 |
| control, 150 s | 15.13 | 2: one 0.1.271 from copy 0.1.272; one 0.1.273 with `--await-lock`, from the copy that its claiming hook made from the 0.1.273 cache | 2: 0.1.271, then 0.1.273 | 1, 1 | 1 handing over, then silence, in 51 PostToolUse calls | converged in under 1 s; `start` found the 0.1.273 daemon alive; final status: all files current |

In `mislabeled`, each successor registered within about 0.2 s of its predecessor's stop. On the host the gaps were 3.8 to 32 s, with a 550 MB store on a loaded host (inferred: the winner opens and checks the store before it registers). Every hook exited 0, the largest in 165 ms.

## Q3. The verdicts

**a. 0.1.273 still loops** while the copy of the hook's version holds other code. `control` converged after one handover with the same old daemon, hooks, `start`, tier and writer, so the copy alone decides the loop. Verified by experiment.

**b. A named wait's first read.** In the 0.1.273 source, `waitForNamed` returns `unavailable` when its first read finds the store busy (`src/cli/status-wait-paths.ts:427`). That read retries for `min(1000 ms, time left)` (`STATUS_BUSY_TIMEOUT_MS`, `src/core/status/open.ts`). So a lock that blocks readers for longer than 1 s at the first read still ends the wait. A writer does not block readers, because the store runs in WAL mode. In `control`, a writer held `BEGIN IMMEDIATE` from 07:46:23.873 to 07:46:26.876Z. The wait started 3 ms after the writer took the lock and returned a current verdict after 0.38 s, exit 0 (verified by experiment). In the first `mislabeled` run the wait started before the writer took the lock, so that run decides nothing. The gh-77 returns after 339 ms and 223 ms came before 011-113 (0.1.266), whose read could become a write and skip the busy handler (inferred).

**c. Stop wakes come from liveness changes.** In gh-77's run, 12 of 14 Stops spoke, each with a new handover or a new daemon. A Codex Stop calls `ensureIfStale` first, which can step the daemon down itself, and then speaks on a liveness change (`src/harness/shared/stop.ts`, read in source code, 0.1.273). In the second `mislabeled` run, each Stop ran after a 3 s pause. 2 of 7 Stops blocked. Each reported a handover that began 21 to 22 ms earlier, so it was that Stop's own step-down. The other 5 found no change and were silent, as were all 7 in `control` and all 5 in the first run, where each Stop followed a step-down at once (verified by experiment). Unchanged state does not wake. The loop makes a fresh change every few seconds, so each Stop finds one. C8 treats a liveness change at Stop as news, so the wakes follow from the loop and need no change of their own.

**d. 011-126 is not the cause.** gh-75's worktree recorded only step-down exits. Its daemons ran at revision 0 with no edit. The loop reproduces on 0.1.273, which carries 011-126.

## Q4. Recommendation: one proposed row

**Proposed row (number for the coordinator): a kept copy runs only the code its name says, and a successor older than its claim ends the handoff (gh-75, gh-77).**

Draft amendments for the coordinator to write:

- 005 D3: "A copy is kept only from a plugin root whose manifest version is the copy's version, and it keeps that manifest. A hook or `squeal start` uses a copy only when the copy's manifest names its version. A copy without a manifest, or with another version, is renamed out of `versions/` and made again from the hook's own root, and until then the hook spawns from its own bundle."
- 011 C9: "The successor a claim spawns runs the claiming hook's version. A daemon that registers older than the live claim it ends ends the handoff with one note. The note names the claim's version, the daemon's version and the executable it runs. No hook asks that incarnation to step down again. Status and the next notice name `squeal start`."
- 011 C9: "The daemon records the executable it runs beside its version." This fills the gap Q1 found.

Files: `src/harness/shared/version-copies.ts` (`keepVersion`, `keptCli`, `keptCacheCli`), `src/harness/codex/kept.ts`, `src/harness/codex/main.ts`, `src/harness/shared/ensure.ts` (`handOver`, `successor`), `src/core/delivery/handoff.ts`, `src/core/status/stopping.ts`, `src/core/store/repos/worktrees.ts` (the token), `src/cli/start.ts`.

Regression tests:

- `test/harness/shared/version-copies.test.ts`: a root of another version makes no copy, and a copy whose code is another version is not used and is made again.
- `test/harness/codex/version-copies-hook.test.ts`: a PostToolUse bundle with `PLUGIN_ROOT` of another version.
- `test/harness/step-down.test.ts`: a successor that registers older than its claim gets no second step-down, and one notice.
- An integration test from this probe with three versions: one handover, then one daemon of the hook's version, while a writer holds the store.

Cost: one code row, a candidate review and a release, as any product row.

Interim step for the human, not tested: delete `~/.codex/plugins/data/squeal-hearsay/versions/0.1.273` and `0.1.272` on this host while no Codex session runs. The next SessionStart makes a correct copy.

## Open questions

- Which process wrote the two mislabeled copies (Q1). One cheap experiment would decide it. Run the candidate's suite in a `/tmp` clone with `PLUGIN_ROOT` and `PLUGIN_DATA` set to a scratch cache and data directory, then look for a copy in the scratch data directory. The repair above makes the writer harmless either way.
- Whether Codex restarts a session's hooks from the new cache directory on every plugin update. The run logs show it did on 2026-10-22 (read in run logs).
- The reports' "a daemon is validating again" notices came from 0.1.261 to 0.1.267 hooks. The 0.1.273 probe gave only "handing over" notices. I did not trace the difference.

## Sources

- Issues [#75](https://github.com/hearsay-tools/squeal/issues/75) and [#77](https://github.com/hearsay-tools/squeal/issues/77), read with `gh issue view <n> --comments` on 2026-10-23. Release times from `gh release list --repo hearsay-tools/squeal`.
- `docs/triage/2026-10-23-digest.md` group A; [issue-75.md](issue-75.md); [issue-77.md](issue-77.md); spec 011 C8 and C9; `status.md` lines for 011-113, 011-122 and 011-126.
- Source at tags `squeal--v0.1.260`, `v0.1.261`, `v0.1.264` and `v0.1.273`, in a clone under `/tmp`: `src/harness/shared/version-copies.ts`, `src/harness/codex/kept.ts`, `src/harness/codex/main.ts`, `src/harness/codex/handlers.ts`, `src/harness/shared/ensure.ts`, `src/harness/shared/stop.ts`, `src/core/daemon/ensure.ts`, `src/core/daemon/version.ts`, `src/cli/status-wait-paths.ts`, `src/core/status/open.ts`.
- Copies of `/home/agent/projects/cezar/.git/squeal/store.sqlite`, `/home/agent/projects/squeal/.git/squeal/store.sqlite` and both repositories' `.ai/cezar/runs.db`. The cezar run logs `d22e25bb`, `62320a92`, `5f133bd2` and `e3953400` (cezarion) and `801fafa8` (squeal), with `.git/squeal/runs/329196ac-*/`.
- `~/.codex/plugins/cache/hearsay/squeal/`, `~/.codex/plugins/data/squeal-hearsay/` and `~/.claude/plugins/cache/hearsay/squeal/`, listed and grepped for the version string.
- Probe: [probes/issue-75/three-versions.mjs](probes/issue-75/three-versions.mjs), [summarize-three.mjs](probes/issue-75/summarize-three.mjs), results in [results-three.txt](probes/issue-75/results-three.txt).
