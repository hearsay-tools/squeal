# 015-14 Round 3, first stage: baseline and CPU per edit on 0.1.366

Worker d3937b73, 2026-10-27, from `tasks/wave-23.md` W2. Shape: finish, survey, first stage only. This file holds the read-only baseline, the actual hook and daemon versions, the isolated CPU A/B on the released tag, and what the final passive count still needs. It holds no final Round 3 counts and no verdict on coverage as a default: no working day of actual 0.1.366 sessions exists yet. `lessons.md` is unchanged.

## Answer

- **No comparable observation window has started.** At 07:43Z no session had used 0.1.366 hooks. Claude Code installed 0.1.366 at 07:37:52Z, Codex at 07:50:50Z. The first 0.1.366 hook delivery in one of this repository's worktrees came at 08:00:04Z, in a session whose daemon was stopped by request 20 s later. After the host restarted at 08:22:29Z, every daemon that started ran 0.1.366. By 08:53Z, no 0.1.366 daemon had stored a coverage record or judged a file, and no coverage line had reached any session.
- **No coverage line reached an agent since 0.1.365's release, and this is not evidence of less noise.** From 02:10Z to 07:43Z (5.5 h), 9 agent sessions in this repository's worktrees got 56 deliveries with 0 CRAP or `untested` lines, 0 complexity lines and 0 told-over lines. Their hooks were 0.1.359 to 0.1.365; none was 0.1.366, so there is no 0.1.366 delivery sample. Every other project has coverage off (cezar has no `coverage` key; mega and toolkit-dev have no config).
- **The noise fixes show in the stores.** The 0.1.366 daemon's worktree reads 4,272 functions `pass` beside skipped loaders (015-78) against 677 still `unknown`. It made no test file without a record, and no worktree holds a `coverage:no-record` note (015-79). It and the 015-93 reviewer's 0.1.365 daemon wrote manifests and shared parts (015-85): 515 manifests and 7,711 parts in 8 minutes, 9.5 KB per record against 35.3 KB for the 365 full records a 0.1.361 daemon wrote just before.
- **Coverage on cost more CPU per edit in every edit pair on the 0.1.366 clone, and two pairs do not settle by how much.** Over the five fixed edits, the on arm took 1.23 times the off arm's CPU to the verdicts in pair 1 and 1.11 times in pair 2. All ten edit pairs read 1.02 to 1.53, and the eight with both arms at or under load 24 lie in the same range. The pairs fail the stop rule: in pair 2, E2 and E3 were saved at loads 30.9 and 24.14, and the ratios differ by 0.12. Pair 3 did not run: the 10:45Z latest start had passed. Round 2 read a geometric mean of 1.12 at 0.1.349. The edits now select up to 9.4 times as many test files. See "D10" below.
- **What the final count needs** is in "Missing evidence and continuation".

## Rules kept

- Stores opened read only: `node:sqlite` with `readOnly: true` and `PRAGMA query_only = 1`, at `nice 19`. No write to any store, plugin cache, config or another worktree. No signal sent.
- Every A/B arm ran in its own reflink copy under `/var/tmp/dogfood-015-14/w-d3937b73/runs/` (the first run, lost, under `/tmp`), with `HOME`, `XDG_RUNTIME_DIR`, `TMPDIR`, `XDG_CONFIG_HOME` and `XDG_CACHE_HOME` under its own `runs/<arm>.home/`, and `SQUEAL*`, `CLAUDE*`, `CODEX*` and `CEZ*` removed (Round 2's `ab.py`).
- Each arm started only at a one-minute load at or under 24, the CPU count (`bin/gate.sh`). The edits inside an arm are not gated; two edits of pair 2 were saved over 24 and are marked.
- Transcripts were read for SQUEAL lines and counts only. No credential file was read.
- Reads outside this worktree: the plugin caches' directory names and birth times, `~/.claude/plugins/installed_plugins.json` (the Squeal entries), `/proc`, the transcripts, the shared stores, `squeal.config.json` at HEAD of cezar, mega and toolkit-dev, and `git diff` of the coordinator's worktree against the tag (all with `--no-optional-locks`).
- `pnpm install --offline` in the template reads the user's pnpm store and links or copies from it. Nothing was fetched. Under `/var/tmp`, pnpm would not hard-link across the mount and made its own store at `/var/tmp/.pnpm-store` (56 KB, created 08:51:46Z by this worker); it was removed at once, and `setup.sh` now names the user's store and copies (`--package-import-method clone-or-copy`).

## Versions and adoption (read 07:39Z to 07:43Z)

| Where | What it holds | Source |
| --- | --- | --- |
| Claude Code plugin cache | 0.1.361 born 00:35:00Z, 0.1.365 born 06:54:50Z, 0.1.366 born 07:37:52Z | `stat -c %W` of each directory |
| Claude Code install record | user scope and project `/home/agent/projects/squeal`: 0.1.366, commit `06a3d1e54`, updated 07:37:52.862Z and 07:37:57.617Z | `installed_plugins.json` |
| Codex plugin cache | 0.1.365 only, born 02:34:32Z; versions directory 0.1.357 to 0.1.365 | `~/.codex/plugins/` |
| This repository's config at the tag | `coverage.enabled: true`, `coverage.exclude: ["test/**", "src/runners/node-test/runtime/**"]`, complexity on, `baseline.onStart: "lookup-only"` | `git show 06a3d1e54:squeal.config.json` |
| Default for other projects | coverage off since 0.1.361 (row 015-89) | board |

Live Squeal daemons, from `/proc` and the main store's `worktrees` table:

| Worktree | Daemon version | Code it runs | Started (UTC) | Started by |
| --- | --- | --- | --- | --- |
| coordinator 8b2a8995 (`d827009ca6389014`) | 0.1.366 | that worktree's own `plugins/claude-code/dist` | 07:02:15 | the coordinator, before the release |
| this worker d3937b73 (`be5dca0b7944681f`) | 0.1.365 | plugin cache 0.1.365 | 07:35:21 | this session's SessionStart hook, before 0.1.366 reached the cache |
| main checkout (`a6b4acd940a004f5`) | 0.1.365 | plugin cache | 07:36:01, last heartbeat 07:36:06 | a helper's hook; it exited |

The coordinator's build equals the tag now (`git diff squeal--v0.1.366 -- plugins/claude-code/dist src` is empty). Its files were rebuilt at 07:17:29Z, after the daemon started, so the bytes that process loaded are the candidate's build. The coordinator found the candidate's product files byte-identical to the release (`status.md`, 07:17Z). Not proven for the loaded process.

Two daemons that ran coverage after 0.1.365's release are gone, with their worktrees: worker d97c38c5's wrote full records, so it ran 0.1.364 or before (its session's hooks were 0.1.361), and reviewer 3f0f1d72's wrote manifests, so it ran 0.1.365 or later. The other 17 worktrees in the main store have no live daemon. Their last daemons ran 0.1.357 to 0.1.361 (7, last heartbeat 01:33:43Z), 0.1.121 to 0.1.265 (7), or have no version recorded (3).

### Sessions since 0.1.365's release

From 2026-10-27T02:10Z to the scan at 07:42:58Z, this worker's own session left out. A Claude Code session's version is the newest Squeal in its cache at its process start (Round 1's rule). A Codex session's is the one in its skill path, a lower bound.

| Repository | Harness | Where | Sessions | Hook version | Deliveries | Coverage lines | Complexity lines |
| --- | --- | --- | --- | --- | --- | --- | --- |
| squeal | Claude Code, Opus | worktrees | 2 | 0.1.361 | 11 | 0 | 0 |
| squeal | Codex | worktrees | 1 (the coordinator) | 0.1.359 or later | 35 | 0 | 0 |
| squeal | Codex | worktrees | 6 | 0.1.364 to 0.1.365 or later | 10 | 0 | 0 |
| squeal | Claude Code, Haiku helpers | main checkout | 28 | 0.1.361 (22), 0.1.365 (6) | 28 | 0 | 0 |
| squeal | Claude Code, no model | main checkout | 1 | 0.1.361 | 1 | 0 | 0 |
| cezar | Claude Code, Haiku helpers | main checkout | 14 | 0.1.361 | 13 | 0 | 0 |
| cezar | Codex | worktrees | 8 | 0.1.359 to 0.1.365 or later | 53 | 0 | 3 |

No delivery held a told-over line (`Code:` or `Complexity:`), a `coverage:no-record` note, the 015-70 coverage-off note or a provider failure. No session started with 0.1.366 hooks. The Claude Code worker of row 015-87 (d97c38c5, 06:45Z to 07:00Z) ran 0.1.361 hooks: 0.1.365 reached the cache 4 h 45 min after its release.

### Second reading, after the host restart (08:53Z)

The host restarted at 08:22:29Z (`uptime -s`). It stopped every daemon and cleared `/tmp`.

| Where | What changed | Source |
| --- | --- | --- |
| Codex plugin cache | 0.1.366 born 07:50:50Z; versions directory 0.1.366 born 07:52:51Z | `stat -c %W` |
| The coordinator's Codex session | first names a 0.1.366 hook path at 08:23:46Z (0.1.365 from 02:41:37Z) | its rollout |
| Codex session in worktree 3173c561 | started 07:50:46Z on 0.1.365, and its daemon on 0.1.365 at 07:50Z; first 0.1.366 path at 08:29:30Z | its rollout, `/proc` at 07:51Z |
| Claude Code session e9b25b9d, worktree b808ae2c (Opus) | 0.1.366 hooks: registered 08:00:04Z; "the daemon is stopped by request" 08:00:24Z; registered again 08:23:39Z; "stopped until `squeal start`" 08:27:26Z | its transcript |

Daemons the main store records after the restart, all 0.1.366: the coordinator's (08:24:02Z, last heartbeat 08:41:16Z), b808ae2c's (08:27:09Z to 08:27:19Z), 3173c561's (08:29:31Z to 08:30:43Z), the main checkout's (08:30:44Z to 08:30:49Z) and this worker's (08:25:39Z, live). At 08:53Z only this worker's daemon and the A/B arm's were running.

Sessions from 07:37:52Z to 08:53:16Z, this worker's left out (`data/sessions-baseline-2.json`): in this repository, 19 Haiku helpers in the main checkout (19 deliveries), 1 Claude Code Opus session (5) and 2 Codex sessions (42) in worktrees; in cezar, 5 helpers (4), 1 Claude Code Sonnet session (2) and 1 Codex session (7) in worktrees. 0 CRAP, `untested`, complexity or told-over lines.

Store at 08:53:46Z (`data/store-baseline-2.json`): `code.sqlite` 3,373,985,792 bytes (+4,030,464 since 07:41Z), `store.sqlite` 1,237,385,216. Still 106,503 records, the last stored at 07:10:40Z; still 7,711 parts. No `coverage:no-record` note. The new worktrees b808ae2c and 3173c561 and the main checkout read every file `pending, imports`; the coordinator's and this worker's summaries did not change (`data/unknown-baseline-2.json`).

So the earliest proven start of 0.1.366 hooks with a running 0.1.366 daemon in one of this repository's worktrees is 08:23:46Z to 08:24:02Z (the coordinator). No test has run under it with coverage on by 08:53Z.

## Store (read 07:41:01Z)

| Reading | `code.sqlite` | `store.sqlite` | Coverage records | Record bytes |
| --- | --- | --- | --- | --- |
| Round 2 end, 2026-10-26 16:17Z | 2,177,171,456 | 1,087,782,912 | 68,495 | 1,921,968,844 |
| This baseline, 2026-10-27 07:41Z | 3,369,955,328 (822,762 pages of 4 KiB, 36 free); WAL 5,438,432 | 1,240,227,840; WAL 25,387,472 | 106,503 | 3,063,363,622 |

- `code.sqlite` grew 1.19 GB in 15.4 h after Round 2. Records by hour of storing: 1,958 to 6,390 an hour from 16:00Z to 01:00Z (52 to 196 MB an hour), 67 at 02:00Z, none from 03:00Z to 05:59Z, then 365 at 06:00Z and 515 at 07:00Z. The first record is from 2026-10-24T23:30:47Z, so no record has reached the seven-day retention.
- **Full records against manifests**, stored since 02:10Z, by the worktree whose run made the result at the record's key (`bin/records.mjs`):

| Form | Worktree (its session's hooks) | Records | Bytes | Each | Stored (UTC) | Runs |
| --- | --- | --- | --- | --- | --- | --- |
| full | worker d97c38c5 of row 015-87 (Claude Code, 0.1.361) | 365 | 12,881,276 | 35.3 KB | 06:48:41 to 06:59:37 | 21 |
| manifest | coordinator 8b2a8995 (its own 0.1.366 build) | 504 | 1,256,993 | 2.5 KB | 07:02:52 to 07:10:40 | 6 |
| manifest | reviewer 3f0f1d72 of row 015-93 (Codex, 0.1.365 or later) | 11 | 21,005 | 1.9 KB | 07:03:36 to 07:05:50 | 5 |

  So a daemon on 0.1.361 wrote full records 4.6 h after 0.1.365 was released: its session took the hooks the Claude Code cache held. The 515 manifests reference 350,206 parts (680 each). `coverage_parts` holds 7,711 parts, 3,595,815 bytes (466 B each), all first used from 07:02:52Z to 07:10:40Z. Manifests and parts come to 9.5 KB per record in a store that had no parts before. That is two daemons in 8 minutes, not a day's rate.
- The main store holds 1,897,863 results at 219,623 keys, the oldest from 2026-10-09.

## Noise-fix baselines

### Unknown functions beside skipped loaders (015-78)

`uncovered` functions by their file's state and their own outcome, from each worktree's coverage summary (`bin/unknown.mjs`). 10 worktrees have a summary. The coordinator's daemon runs 0.1.366 and this worker's 0.1.365. The main checkout's (0.1.365) holds 763 files, all `pending, imports`. The other 7 are from daemons on 0.1.357 to 0.1.361, frozen when they stopped; two of them are in the table.

| Worktree (daemon) | Files: judged, unknown skipped, unknown no record, pending | Skipped files: functions `pass` / `unknown` | No-record files: functions `unknown` | Judged files: fail / pass / unknown |
| --- | --- | --- | --- | --- |
| coordinator 8b2a8995 (0.1.366) | 350, 396, 132, 0 | 4,272 / 677 | 1,711 | 513 / 3,001 / 534 |
| this worker d3937b73 (0.1.365) | 10, 90, 196, 582 | 619 / 187 | 2,404 | 0 / 0 / 0 |
| 474cc4f5 (0.1.361) | 10, 350, 198, 311 | 0 / 4,212 | 2,432 | 0 / 0 / 0 |
| e66c41c5 (0.1.359) | 49, 371, 406, 35 | 0 / 4,684 | 4,636 | 210 / 79 / 18 |

Round 2's median worktree with closures had 342.5 skipped files hiding 4,081 functions. In the 0.1.366 worktree, 86% of the functions in skipped files (4,272 of 4,949) now read `pass`.

### Test files with a result and no record (015-79)

`bin/norecord.mjs`, each worktree's current test file keys, split by the run that made the newest result.

| Worktree | Keys | With a result | With a record | No record | From the current daemon's runs | From older runs of this worktree | From another worktree's runs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| coordinator 8b2a8995 (0.1.366, since 07:02:17Z) | 1,265 | 1,265 | 1,249 | 16 | 0 | 3 | 13 |
| this worker d3937b73 (0.1.365, since 07:35:23Z) | 1,265 | 223 | 201 | 22 | 0 | 0 | 22 |

All 38 results ended `completed`; the newest is from 01:34:30Z, before any 0.1.365 daemon ran. The main store's `notes:<worktree>` lists hold no `coverage:no-record` note in any worktree. So no 0.1.365 or 0.1.366 writer has dropped a completed payload yet. Round 2 found 0 to 76 such files per worktree, 196 in all.

### Lines, summaries, labels and loader accounts (015-80, 015-81, 015-84)

No coverage line, told-over line or loader account reached any session after 0.1.365's release, so these have no count yet. The code store holds no `sentSummary:` key, the record 015-84 writes when a told-over line is sent.

## D10: CPU per edit, coverage off and on, on 0.1.366

**Method.** Round 2's (`part-b.md`, "D10"), unchanged but for the clone, the gate and three recorded fields:

- **Clone.** `git archive squeal--v0.1.366` (commit `06a3d1e54`) with an offline `pnpm install --frozen-lockfile` from the user's store and one commit of its own (`bin/setup.sh`). Round 2's clone of 0.1.349 used npm. Each arm is a fresh reflink copy with its own empty stores and scratch home.
- **Config.** The arm's commit replaces the `coverage` block with `{ "enabled": false }` or `{ "enabled": true }`: no `coverage.exclude`, as every other project has it. The rest is the tag's config.
- **Edits.** Round 2's five edits (`part-b/bin/edits.json`). Each `find` text appears once at the tag, so each applies unchanged.
- **Gate.** Before each arm, not only each pair: a one-minute load at or under 24 (`nproc`), re-read every 5 minutes.
- **Recorded too.** Node and Squeal versions per arm, and the first 4,000 characters of each wait's output.

**Stop rule**, set at 07:50Z before any arm ended, with the coordinator's agreement (message d13bd4c6): pair 3 does not start when pairs 1 and 2 agree. They agree when both pairs are complete with the same five edits in both arms, every edit started at a one-minute load at or under 24 in both arms, and the two pairs' on/off ratios of CPU to the verdict over all five edits differ by 0.10 or less. Otherwise pair 3 runs if it can start by 10:45Z. After the restart below, `pairs.sh` runs pairs 1 and 2 only. The 10:45Z latest start for pair 3 stays (the coordinator, message fcf35943): if pairs 1 and 2 end after it, they are reported as they agree or disagree, with no pair 3. No third complete run follows another interruption.

**First run, lost.** Pairs started at 07:38:38Z under `/tmp` at load 0.46. Pair 1's coverage-off arm ended at 08:11:45Z and its coverage-on arm had measured E0 when the host restarted at 08:22:29Z and cleared `/tmp`. The values ab.py had printed are in `data/ab-run1-lost.json`. They are not used below: the pair is incomplete. They show what the run costs at 0.1.366: the off arm's five edits took 8,301 s of CPU to their verdicts, 4,274 s of it for E1, and the arm 33 minutes. Each edit selected more test files than at 0.1.349: E0 71, E1 593, E2 218, E3 237, E4 417, against 63, 63, 80, 102 and 139 in Round 2. `src/core/lint/transition.ts` (E1) is now imported by `src/core/state/index.ts` and `src/core/state/sink.ts`, so 593 test files read it. Both arms run the same selection, so the on/off ratio stays comparable with Round 2's; the CPU per edit does not.

**Second run.** Pairs 1 and 2 restarted at 08:52:34Z under `/var/tmp` and ended at 11:28:00Z. The gate held no arm. The arms started at 08:52:38Z (pair 1 off, load 0.23), 09:25:37Z (pair 1 on, 4.30), 10:06:44Z (pair 2 on, 13.29) and 10:49:40Z (pair 2 off, 13.10). Every arm ran Squeal 0.1.366 on Node v24.21.0.

**Result** (`data/ab-run2.jsonl`; `python3 -I bin/d10.py 24 data/ab-run2.jsonl` prints the table and the figures below). "Load" is the one-minute load when the edit was saved. CPU is that of the arm's daemon and its children.

| Pair | Order | Edit | Test files off / on | Load off / on | CPU to verdict, off / on (s) | On / off | CPU to quiet, off / on (s) | On / off | Verdict wall, off / on (s) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | off, on | E0 `kept.ts` | 71 / 71 | 0.5 / 4.0 | 275 / 280 | 1.02 | 275 / 283 | 1.03 | 182 / 170 |
| 1 | off, on | E1 `transition.ts` | 593 / 593 | 2.0 / 5.8 | 3839 / 4429 | 1.15 | 3839 / 4570 | 1.19 | 612 / 664 |
| 1 | off, on | E2 `batches.ts` | 218 / 218 | 9.7 / 21.7 | 914 / 1222 | 1.34 | 914 / 1223 | 1.34 | 440 / 448 |
| 1 | off, on | E3 `named-file-lines.ts` | 237 / 237 | 0.4 / 11.2 | 336 / 513 | 1.53 | 336 / 572 | 1.70 | 267 / 309 |
| 1 | off, on | E4 `command-hold.ts` | 417 / 417 | 2.4 / 18.0 | 2305 / 2988 | 1.30 | 2305 / 3023 | 1.31 | 429 / 498 |
| 1 | | all 5 edits | | | 7669 / 9432 | 1.23 | | | |
| 1 | | start (lookup-only, empty store) | | 0.2 / 4.3 | 22 / 23 | 1.06 | | | 21 / 22 |
| 2 | on, off | E0 `kept.ts` | 71 / 71 | 11.3 / 13.2 | 237 / 292 | 1.23 | 237 / 297 | 1.26 | 171 / 179 |
| 2 | on, off | E1 `transition.ts` | 593 / 593 | 14.7 / 22.5 | 4406 / 4693 | 1.07 | 4406 / 4807 | 1.09 | 777 / 751 |
| 2 (over load 24) | on, off | E2 `batches.ts` | 218 / 218 | **30.9** / 12.5 | 986 / 1181 | 1.20 | 986 / 1187 | 1.20 | 457 / 465 |
| 2 (over load 24) | on, off | E3 `named-file-lines.ts` | 237 / 237 | 18.0 / **24.1** | 392 / 507 | 1.29 | 392 / 560 | 1.43 | 294 / 312 |
| 2 | on, off | E4 `command-hold.ts` | 417 / 417 | 19.0 / 11.6 | 2670 / 2963 | 1.11 | 2670 / 2990 | 1.12 | 544 / 507 |
| 2 | | all 5 edits | | | 8691 / 9637 | 1.11 | | | |
| 2 | | start (lookup-only, empty store) | | 13.1 / 13.3 | 30 / 34 | 1.11 | | | 29 / 32 |

- **Stop rule: pairs 1 and 2 do not agree.** `python3 -I bin/agree.py data/ab-run2.jsonl 24` exits 1: "p2 has edits over load 24: ['E2', 'E3']". In pair 2, E2 was saved in the off arm at a one-minute load of 30.9, and E3 in the on arm at 24.14. The gate reads the load before each arm, not before each edit, so the tests of one edit can raise the load over the limit for the next. The five-edit ratios also differ by more than 0.10: 1.230 in pair 1 and 1.109 in pair 2, a gap of 0.121. Pair 3 did not run: pair 2 ended at 11:28:00Z, after the 10:45Z latest start, and `pairs.sh` ran pairs 1 and 2 only.
- **Per pair**, CPU to the verdicts of all five edits: pair 1 7,669 s off and 9,432 s on (1.23); pair 2 8,691 s off and 9,637 s on (1.11). E1 is 47% to 51% of each arm's CPU to the verdicts, so it weighs most in these two ratios.
- **All ten edit pairs**: on/off from 1.02 to 1.53, each above 1; median 1.216, geometric mean 1.215.
- **Edit pairs with both arms at or under load 24**, apart (8; pair 2's E2 and E3 left out): from 1.02 to 1.53, each above 1; median 1.194, geometric mean 1.208.
- **Intervals.** A t interval on the log ratios gives 1.116 to 1.324 for the ten and 1.081 to 1.350 for the eight. It assumes independent samples. These are not: five edits share an arm, both arms of a pair share the host, and the edits differ in size. Read the intervals as a spread, not as a test. Round 2's ten edit pairs at 0.1.349, by the same method: geometric mean 1.124, 1.026 to 1.232.
- **Other measures.** CPU to quiet: median on/off 1.230. Wall time to the verdict: median 1.032. Start, lookup-only on an empty store: 22 s against 23 s and 30 s against 34 s of CPU. The daemon tree from start to stop: pair 1 7,691 s off and 9,694 s on; pair 2 9,875 s on and 8,722 s off.
- **Stores.** `code.sqlite` was 8,396,800 bytes in both off arms; in the on arms, 27,602,944 and 27,627,520 bytes, with 1,536 records (4.0 MB) and 9,984 and 9,993 parts (4.9 MB). 1,536 is the sum of the five edits' selected test files.

**What each wait checked** (`bin/validation.mjs` over each arm's store, `data/validation-run2.json`, and each wait's first 4,000 characters in `data/ab-run2.jsonl`). Arms are in run order: pair 1 off, pair 1 on, pair 2 on, pair 2 off.

| Edit | Wait exit codes | Failing checks | What failed |
| --- | --- | --- | --- |
| E0 | 1 / 0 / 0 / 0 | 1 / 0 / 0 / 0 | Pair 1 off: `test/harness/codex/latency.test.ts`, session-start p95 82 ms over its 80 ms limit |
| E1 | 1 / 1 / 1 / 1 | 5 / 4 / 4 / 4 | The four bundle checks (`cli/squeal.mjs` differs from the build, expected after a `src` edit) in every arm; pair 1 off also the latency check (84 ms) |
| E2 | 1 / 1 / 1 / 1 | 14 in every arm | The same 14 checks (one name digest) |
| E3 | 1 / 1 / 1 / 1 | 1,840 in every arm | The same checks: `test/cli/codex-trust.test.ts` parse failure and 207 failing test files; each arm noted 174 to 176 test files failing anew in one tier, a mass break that is not re-run |
| E4 | 1 / 1 / 1 / 1 | 1,030 in every arm | The same checks |

- Exit 1 means every named test file has a current result and some fail; 3 means Squeal cannot say (`src/cli/verdict.ts`, `verdictCode`). No wait returned 3. Each ended in 170 s to 777 s, inside its 900 s bound. In every arm, each selected test file had a result at its edit's revision, and every run ended `completed`. Where the summary line is inside the kept 4,000 characters (E0 and E1), it reads "each with a current result"; the worktree's other test files, which no edit selected, read not current (1,194 and 672 of 1,265).
- **Differences between arms.** Pair 1 off failed the latency check at E0 and E1, so it reported one failure more and re-ran 2 more test file slots at E0 (79 against 77). At E1, it skipped 17 tests against 21 in the others. Test file slots, re-runs counted, differ by up to 4 per edit (E3: 245 to 249). E2 to E4 failed the same checks in all four arms. So the CPU of pair 1's E0 and E1 compares slightly different work; the other edits compare the same verdicts.

**Coverage drop notes in the on arms (015-79).** Each on arm's daemon wrote one `coverage` note during E1: "32 completed test files got no record since this daemon started: 32 no-result (its run's result was not found at its key)" (pair 1 at 09:43:10Z, pair 2 at 10:21:07Z). It wrote no later one. At each arm's end, all 692 current test file keys with a result had a record (`norecord.mjs`, `data/norecord-ab-on.json`). So the 32 dropped payloads left no current result without a record. Their cause was not read further. These are isolated clones with coverage on and no `coverage.exclude`, not agent sessions.

**Limits.**

- Two pairs, and they do not meet the stop rule. The on/off ratio of every edit pair is above 1 in both, and the size of the cost is not settled: 1.11 or 1.23 per pair.
- The CPU per edit is not comparable with Round 2's: each edit selects 1.1 to 9.4 times as many test files at 0.1.366 (E1 593 against 63). The ratio is comparable in kind, but the mix of work behind it changed.
- The host load rose during the run, from the arms' own tests and other work on the host. In pair 1 the on arm saved its edits at higher loads (4.0 to 21.7) than the off arm (0.4 to 9.7). In pair 2 the loads were mixed: the off arm saved E2 at 30.9, the on arm E1 and E3 at 22.5 and 24.1. The order alternated, but two pairs do not cancel this.
- This is the CPU of a daemon on a clone, not what a user pays in a session with hooks, other daemons and real edits. It is no recommendation on coverage as a default.

## Missing evidence and continuation

The final Round 3 count, its denominators and a recommendation on coverage as a default need a window this baseline does not have.

| Input | At this baseline (07:43Z; second reading 08:53Z where named) | Needed for the final count |
| --- | --- | --- |
| Sessions with 0.1.366 hooks in this repository's worktrees | 0; at 08:53Z, 3 (one Claude Code session in b808ae2c, the coordinator's and 3173c561's Codex sessions) | A working day of them. A Claude Code session started at or after 07:37:57Z takes 0.1.366. A Codex session takes it once the Codex cache holds 0.1.366 (since 07:50:50Z). |
| Daemons on 0.1.366 | 1, the coordinator's own build; after the 08:22:29Z restart, every daemon that started | The daemons those sessions' hooks start. A daemon keeps its version until it restarts, so a worktree whose daemon started earlier is the old population. |
| Coverage lines judged useful, noise or unclear | 0 since 0.1.365's release | Every CRAP and `untested` line in the window, judged by Round 2's rules (`part-b.md`, "How a line was judged") |
| Repeated summaries and labels (015-84) | 0 told-over lines; no `sentSummary:` key | Told-over lines per session in the window, and their label |
| Inconsistent loader accounts (015-81) | 0 lines | Deliveries that name one file with two loader accounts |
| Skipped-loader functions (015-78) | 4,272 `pass` and 677 `unknown` in the 0.1.366 worktree | The same per live worktree at the window's end |
| Completed results without a record, by drop cause (015-79) | 0 notes; 38 such test files, all from runs before 0.1.365 | The `coverage:no-record` notes of every worktree in the window, read before the worktree is removed |
| Store growth (015-85) | the sizes and record forms above | Bytes per hour and per record over the window, full records and manifests apart |

**Window.** It starts at the first SQUEAL delivery from a 0.1.366 hook in a session in one of this repository's worktrees, read from the transcripts with `sessions.py`. Release time and cache time are not a start. Round 2's window was 22.1 h (2026-10-25T18:10Z to 2026-10-26T16:16Z) with 105 worker, coordinator, researcher and reviewer sessions, 20 of which got coverage lines. Rates per session and per hour make a shorter or quieter window comparable; a window with no coverage-on source edits measures nothing. By that rule the window started at 08:00:04Z (session e9b25b9d), or at 08:23:46Z for the first 0.1.366 session whose daemon kept running (the coordinator's). A window as long as Round 2's ends no sooner than 2026-10-28 about 06:00Z to 06:25Z. A store read is due before each worktree removal in the window ("Limits found here"). At this baseline the host was nearly idle: in the 5.5 h after 0.1.365's release this repository had 9 agent sessions in worktrees, and all other coordinators were done (`wave-23.md`). How long to wait for enough sessions is the coordinator's decision.

**Limits found here.**

- **Removed worktrees lose their notes.** `worktrees.ts` `remove` deletes every per-worktree `meta` row, `notes:<id>` among them. So the `coverage:no-record` counts of a worker's daemon are gone once its worktree is removed, and stderr from a hook-started daemon may be discarded (D8). The count needs `bin/store.mjs` (its `dropNotes`) run before each removal in the window, or a periodic read. The same holds for coverage summaries and states, which Round 2 read only for live worktrees.
- **Each note topic keeps 3 entries and each worktree 20 notes** (`NOTES_PER_TOPIC`, `MAX_PERSISTED_NOTES`). A note holds the daemon's total since it started, so the latest note per daemon suffices unless other notes push it out.
- **Old daemons write full records.** A session that starts before its harness's cache holds a release runs the older hooks and daemon. 0.1.365 reached the Claude Code cache 4 h 45 min after its release, and the 015-87 worker's 0.1.361 daemon wrote 365 full records after it. Split every count by the record form and by daemon version (`records.mjs`, `worktrees.daemon_version`).
- **Seven-day bytes need seven days.** The first manifest is from 2026-10-27T07:02:52Z, so a week of manifest-only growth ends no sooner than 2026-11-03T07:03Z. Full records from older daemons go with their results: the oldest from 2026-10-31T23:30Z, the last stored at 06:59:37Z on 2026-10-27, later for keys still current somewhere.

**Procedure for the final count.** From a scratch directory, with the scripts of `part-b/bin/` and `round-3/bin/`:

1. Versions: `stat -c '%W %n'` over `~/.claude/plugins/cache/hearsay/squeal/*` and `~/.codex/plugins/cache/hearsay/squeal/*`; the Squeal entries of `~/.claude/plugins/installed_plugins.json`; live daemons from `/proc` (command line and start time).
2. Transcripts: `part-b/bin/extract_cc.py` over `~/.claude/projects/*/*.jsonl` changed since the window's start, written as `cc.json`, and `part-b/bin/extract_codex.py` over the rollouts changed since then, written as `codex-all.json`; then `sessions.py` for sessions by version and line kind. Every input below is made again from the transcripts and stores; nothing depends on a scratch file of Round 2 or of this stage, which the host restart removed.
3. Lines and verdicts: copy Round 2's `lines.py`, `cases.py` and `tally.py` to the new scratch and set their `O` constant, which names Round 2's removed `/tmp/dogfood-015-14/w-327524f0/out/`, to the directory holding step 2's `cc.json` and `codex-all.json`. Replace `lines.py`'s fixed `CACHE` table and window with `sessions.py`'s births and the new window. `tally.py`'s `RELAYED` and `CHOSE` hold Round 2's cases found by reading; replace them with the new window's. Check `tally.py`'s summary patterns against 0.1.366's wording: told-over lines start `Code:` since 015-84; `untested` lines say "in the test's own thread" since 015-80.
4. Stores, read only, at the window's end and before each worktree removal: `store.mjs` (mark: the window's start), `records.mjs`, `unknown.mjs`, and `norecord.mjs` per live worktree with its daemon's start.
5. Compare with Round 2's counts in `lessons.md` and `part-b/judged.tsv` (both committed) per hour and per session. Write `lessons.md` Round 3 then, not before. A window with no coverage lines or no new records is an absent sample, not a reason to recommend coverage as a default.

## Scripts and raw data

The scripts are in `bin/`. Run the `.mjs` ones with `node`, the Python ones with `python3 -I`. `ab.py`, `pairs.sh`, `gate.sh` and `setup.sh` run from `/var/tmp/dogfood-015-14/w-d3937b73/bin/`, where `setup.sh` copies them.

| Script | What it does |
| --- | --- |
| `setup.sh` | Builds the A/B template from a release tag and copies the scripts and Round 2's `edits.json` beside it |
| `ab.py` | One A/B arm: Round 2's `part-b/bin/ab.py` with the base from `DOGFOOD_BASE`, the versions and wait output recorded, and the stop rule checked before a pair 3 arm (from 07:52Z; the arms running then had loaded the script without it) |
| `agree.py` | The stop rule: whether pairs 1 and 2 agree |
| `pairs.sh`, `gate.sh` | Pairs in alternating order, each arm gated at a load at or under the CPU count |
| `d10.py` | The D10 table and summary from `ab.jsonl`, with Round 2's pairs beside |
| `validation.mjs` | Per A/B arm and revision: runs and their end states, test file slots and files, results by kind and outcome, and the failing checks with a digest of their names |
| `store.mjs` | The store baseline: sizes, records and parts by hour, manifests against full records, drop notes, daemons |
| `records.mjs` | Records stored since a mark, by form and by the worktree whose run made the result at the key |
| `unknown.mjs` | Files and functions by state and cause per worktree summary |
| `norecord.mjs` | Test files with a result and no record, by the run that made the result |
| `sessions.py` | Sessions by harness, project, hook version and line kind, from Round 2's `extract_cc.py` and `extract_codex.py` outputs |

The bounded outputs are in `data/`. `ab-run2.jsonl` is the second run's `ab.jsonl` without each arm's `squeal code --json` head and with only the Notes lines of its final `squeal status --full`. The arm roots read `$B` for `/var/tmp/dogfood-015-14/w-d3937b73`. The clones, their stores and the full `ab.jsonl` stay under `$B` while the host keeps them. The raw extracts, which hold transcript text, stay under `/var/tmp/dogfood-015-14/w-d3937b73/out/` while the host keeps them. The first scan's extracts under `/tmp` and Round 2's scratch under `/tmp/dogfood-015-14/w-327524f0/` went with the restart.
