# 015-14 Round 3, first stage: baseline and CPU per edit on 0.1.366

Worker d3937b73, 2026-10-27, from `tasks/wave-23.md` W2. Shape: finish, survey, first stage only. This file holds the read-only baseline, the actual hook and daemon versions, the isolated CPU A/B on the released tag, and what the final passive count still needs. It holds no final Round 3 counts and no verdict on coverage as a default: no working day of actual 0.1.366 sessions exists yet. `lessons.md` is unchanged.

## Answer

- **No observation window has started.** At 07:43Z no session had used 0.1.366 hooks. Claude Code installed 0.1.366 at 07:37:52Z; the Codex cache still held 0.1.365. One daemon ran a 0.1.366 build: the coordinator's worktree, from its own build, since 07:02:17Z.
- **No coverage line reached an agent since 0.1.365's release, and this is not evidence of less noise.** From 02:10Z to 07:43Z (5.5 h), 9 agent sessions in this repository's worktrees got 56 deliveries with 0 CRAP or `untested` lines, 0 complexity lines and 0 told-over lines. Their hooks were 0.1.359 to 0.1.365; none was 0.1.366, so there is no 0.1.366 delivery sample. Every other project has coverage off (cezar has no `coverage` key; mega and toolkit-dev have no config).
- **The noise fixes show in the stores.** The 0.1.366 daemon's worktree reads 4,272 functions `pass` beside skipped loaders (015-78) against 677 still `unknown`. It made no test file without a record, and no worktree holds a `coverage:no-record` note (015-79). It and the 015-93 reviewer's 0.1.365 daemon wrote manifests and shared parts (015-85): 515 manifests and 7,711 parts in 8 minutes, 9.5 KB per record against 35.3 KB for the 365 full records a 0.1.361 daemon wrote just before.
- **CPU per edit** on the 0.1.366 clone, below the CPU count: see "D10" below.
- **What the final count needs** is in "Missing evidence and continuation".

## Rules kept

- Stores opened read only: `node:sqlite` with `readOnly: true` and `PRAGMA query_only = 1`, at `nice 19`. No write to any store, plugin cache, config or another worktree. No signal sent.
- Every A/B arm ran in its own reflink copy under `/tmp/dogfood-015-14/w-d3937b73/runs/`, with `HOME`, `XDG_RUNTIME_DIR`, `TMPDIR`, `XDG_CONFIG_HOME` and `XDG_CACHE_HOME` under its own `runs/<arm>.home/`, and `SQUEAL*`, `CLAUDE*`, `CODEX*` and `CEZ*` removed (Round 2's `ab.py`).
- Each arm started only at a one-minute load at or under 24, the CPU count (`bin/gate.sh`).
- Transcripts were read for SQUEAL lines and counts only. No credential file was read.
- Reads outside this worktree: the plugin caches' directory names and birth times, `~/.claude/plugins/installed_plugins.json` (the Squeal entries), `/proc`, the transcripts, the shared stores, `squeal.config.json` at HEAD of cezar, mega and toolkit-dev, and `git diff` of the coordinator's worktree against the tag (all with `--no-optional-locks`).
- One write outside the scratch base: `pnpm install --offline` in the template reads the shared pnpm store and links from it. Nothing was fetched.

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

- **Clone.** `git archive squeal--v0.1.366` (commit `06a3d1e54`) with `pnpm install --frozen-lockfile --offline` and one commit of its own (`bin/setup.sh`). Round 2's clone of 0.1.349 used npm. Each arm is a fresh reflink copy with its own empty stores and scratch home.
- **Config.** The arm's commit replaces the `coverage` block with `{ "enabled": false }` or `{ "enabled": true }`: no `coverage.exclude`, as every other project has it. The rest is the tag's config.
- **Edits.** Round 2's five edits (`part-b/bin/edits.json`). Each `find` text appears once at the tag, so each applies unchanged.
- **Gate.** Before each arm, not only each pair: a one-minute load at or under 24 (`nproc`), re-read every 5 minutes.
- **Recorded too.** Node and Squeal versions per arm, and the first 4,000 characters of each wait's output.

**Stop rule**, set at 07:50Z before any arm ended, with the coordinator's agreement (message d13bd4c6): pair 3 does not start when pairs 1 and 2 agree. They agree when both pairs are complete with the same five edits in both arms, every edit started at a one-minute load at or under 24 in both arms, and the two pairs' on/off ratios of CPU to the verdict over all five edits differ by 0.10 or less. Otherwise pair 3 runs if it can start by 10:45Z.

**Result.** Running: the first arm started at 07:38:38Z at load 0.46. Not measured yet.

## Missing evidence and continuation

The final Round 3 count, its denominators and a recommendation on coverage as a default need a window this baseline does not have.

| Input | At this baseline | Needed for the final count |
| --- | --- | --- |
| Sessions with 0.1.366 hooks in this repository's worktrees | 0 | A working day of them. A Claude Code session started at or after 07:37:57Z takes 0.1.366. A Codex session takes it once the Codex cache holds 0.1.366 (not there at 07:40Z). |
| Daemons on 0.1.366 | 1, the coordinator's own build | The daemons those sessions' hooks start. A daemon keeps its version until it restarts, so a worktree whose daemon started earlier is the old population. |
| Coverage lines judged useful, noise or unclear | 0 since 0.1.365's release | Every CRAP and `untested` line in the window, judged by Round 2's rules (`part-b.md`, "How a line was judged") |
| Repeated summaries and labels (015-84) | 0 told-over lines; no `sentSummary:` key | Told-over lines per session in the window, and their label |
| Inconsistent loader accounts (015-81) | 0 lines | Deliveries that name one file with two loader accounts |
| Skipped-loader functions (015-78) | 4,272 `pass` and 677 `unknown` in the 0.1.366 worktree | The same per live worktree at the window's end |
| Completed results without a record, by drop cause (015-79) | 0 notes; 38 such test files, all from runs before 0.1.365 | The `coverage:no-record` notes of every worktree in the window, read before the worktree is removed |
| Store growth (015-85) | the sizes and record forms above | Bytes per hour and per record over the window, full records and manifests apart |

**Window.** It starts at the first SQUEAL delivery from a 0.1.366 hook in a session in one of this repository's worktrees, read from the transcripts with `sessions.py`. Release time and cache time are not a start. Round 2's window was 22.1 h (2026-10-25T18:10Z to 2026-10-26T16:16Z) with 105 worker, coordinator, researcher and reviewer sessions, 20 of which got coverage lines. Rates per session and per hour make a shorter or quieter window comparable; a window with no coverage-on source edits measures nothing. The earliest end of a comparable window is 22 h after its start: 2026-10-28 about 06:00Z if a 0.1.366 session had started at 07:38Z, later as the start moves. At this baseline the host was nearly idle: in the 5.5 h after 0.1.365's release this repository had 9 agent sessions in worktrees, and all other coordinators were done (`wave-23.md`). How long to wait for enough sessions is the coordinator's decision.

**Limits found here.**

- **Removed worktrees lose their notes.** `worktrees.ts` `remove` deletes every per-worktree `meta` row, `notes:<id>` among them. So the `coverage:no-record` counts of a worker's daemon are gone once its worktree is removed, and stderr from a hook-started daemon may be discarded (D8). The count needs `bin/store.mjs` (its `dropNotes`) run before each removal in the window, or a periodic read. The same holds for coverage summaries and states, which Round 2 read only for live worktrees.
- **Each note topic keeps 3 entries and each worktree 20 notes** (`NOTES_PER_TOPIC`, `MAX_PERSISTED_NOTES`). A note holds the daemon's total since it started, so the latest note per daemon suffices unless other notes push it out.
- **Old daemons write full records.** A session that starts before its harness's cache holds a release runs the older hooks and daemon. 0.1.365 reached the Claude Code cache 4 h 45 min after its release, and the 015-87 worker's 0.1.361 daemon wrote 365 full records after it. Split every count by the record form and by daemon version (`records.mjs`, `worktrees.daemon_version`).
- **Seven-day bytes need seven days.** The first manifest is from 2026-10-27T07:02:52Z, so a week of manifest-only growth ends no sooner than 2026-11-03T07:03Z. Full records from older daemons go with their results: the oldest from 2026-10-31T23:30Z, the last stored at 06:59:37Z on 2026-10-27, later for keys still current somewhere.

**Procedure for the final count.** From a scratch directory, with the scripts of `part-b/bin/` and `round-3/bin/`:

1. Versions: `stat -c '%W %n'` over `~/.claude/plugins/cache/hearsay/squeal/*` and `~/.codex/plugins/cache/hearsay/squeal/*`; the Squeal entries of `~/.claude/plugins/installed_plugins.json`; live daemons from `/proc` (command line and start time).
2. Transcripts: `extract_cc.py` over `~/.claude/projects/*/*.jsonl` changed since the window's start, and `extract_codex.py` over the rollouts changed since then; then `sessions.py` for sessions by version and line kind.
3. Lines and verdicts: Round 2's `lines.py`, `cases.py` and `tally.py`. Replace `lines.py`'s fixed `CACHE` table and window with `sessions.py`'s births. Check `tally.py`'s summary patterns against 0.1.366's wording: told-over lines start `Code:` since 015-84; `untested` lines say "in the test's own thread" since 015-80.
4. Stores, read only, at the window's end and before each worktree removal: `store.mjs` (mark: the window's start), `records.mjs`, `unknown.mjs`, and `norecord.mjs` per live worktree with its daemon's start.
5. Compare with Round 2's counts in `lessons.md` per hour and per session. Write `lessons.md` Round 3 then, not before.

## Scripts and raw data

The scripts are in `bin/`. Run the `.mjs` ones with `node`, the Python ones with `python3 -I`. `ab.py`, `pairs.sh`, `gate.sh` and `setup.sh` run from `/tmp/dogfood-015-14/w-d3937b73/bin/`, where `setup.sh` copies them.

| Script | What it does |
| --- | --- |
| `setup.sh` | Builds the A/B template from a release tag and copies the scripts and Round 2's `edits.json` beside it |
| `ab.py` | One A/B arm: Round 2's `part-b/bin/ab.py` with the base from `DOGFOOD_BASE`, and the versions and wait output recorded |
| `pairs.sh`, `gate.sh` | Pairs in alternating order, each arm gated at a load at or under the CPU count |
| `d10.py` | The D10 table and summary from `ab.jsonl`, with Round 2's pairs beside |
| `store.mjs` | The store baseline: sizes, records and parts by hour, manifests against full records, drop notes, daemons |
| `records.mjs` | Records stored since a mark, by form and by the worktree whose run made the result at the key |
| `unknown.mjs` | Files and functions by state and cause per worktree summary |
| `norecord.mjs` | Test files with a result and no record, by the run that made the result |
| `sessions.py` | Sessions by harness, project, hook version and line kind, from Round 2's `extract_cc.py` and `extract_codex.py` outputs |

The bounded outputs are in `data/`. The raw extracts, which hold transcript text, stay under `/tmp/dogfood-015-14/w-d3937b73/out/` while the host keeps them.
