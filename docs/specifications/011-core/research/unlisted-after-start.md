# 011-385: why a worktree stays "not listed" for many minutes after a start

Researcher of row 011-385 (task aa667b23), 2026-11-17, 19:45Z to 21:15Z. Brief: `tasks/011-385.md`. Read: `docs/vision.md`, `docs/styleguide.md`, `research/hand-runs-2026-11-16.md`, `restart-baseline.md`, `005-agent-adoption/research/session-start-cost.md` (005-101) and `daemon-restart-per-turn.md` (005-99), board rows 005-110, 011-210, gh-176, gh-181. Source at `c74b471d9` (0.1.548): `src/core/scheduler/bootstrap.ts`, `src/core/state/header.ts`, `header-part.ts`, `src/core/delivery/delivery.ts`, `delta.ts`, `counts-owed.ts`, `src/core/store/connection.ts`, `long-write.ts`, `plugins/claude-code/hooks/hooks.json`.

Data, read-only: Claude Code transcripts of Squawk task worktrees under `~/.claude/projects/` (cezar 206 directories; the oldest kept is 2026-11-13); Squeal daemon logs `~/projects/{cezar,squeal}/.git/squeal/logs/` (2026-11-14T16:04Z to 2026-11-17T20:02Z, so the brief's "since 2026-11-10" starts on 11-13 for transcripts and 11-14 for logs); Squawk run logs of the four named runs; the stores' `worktrees` table opened `mode=ro`. No daemon was started or stopped; no test ran in a real worktree. Probes: `probes/unlisted-after-start/` (throwaway, README there). Host load during the one experiment: load average 10 to 14 on 24 vCPUs, the host's own.

**Labels.** *m* measured (a probe over logs or transcripts, or an experiment), *d* derived from measured numbers, *a* assumed. A **stretch** is the time from the first hook text that says the test files are not listed ("The daemon has not listed this worktree's test files yet", from 2026-11-17 "Squeal is still starting in this worktree and has no results yet") to the first later Squeal text that does not. **Listing commit**: the daemon's first commit that writes the worktree's test file keys (`commitFirst`, logged as a long write).

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Time from start to listed, and where it goes | The daemon lists fast; the agent is not told. Cezar: listing commit a median 23 s after the first unlisted text (p90 135 s, n=116); first listed text a median 1,455 s after the listing commit (p90 19,148 s, n=76): 98% of the median stretch comes after the listing. Every boundary hook between the listing and the first listed text timed out at Claude Code's 2 s limit: 5,661 of 5,662 recorded. Squeal: 10 s to the listing, 9 s more to the text (p90 362 s); 760 of 760 recorded hooks there timed out | verified by experiment (probes over logs and transcripts) |
| 2 | Before or after 0.1.545 | Every start of question 1 ran before the release of 011-391 (0.1.545 was its candidate; the release is 0.1.546, daemons from 2026-11-17T18:58Z), except 2 cezar and 6 squeal starts. The removed check sits before the daemon's first log line, a median 6.7 s after the unlisted text in cezar. It cannot change the picture: on 0.1.546 cezar sessions d9416fae and 09e1a782 listed in 9 and 11 s, then timed out 50 and 49 hooks and were still unlisted 28 and 30 min later | verified by experiment (logs, transcripts); the check's place read in source |
| 3 | Does a restart list again; could it reuse | It lists again (`baseline` always calls the runner's listing) and rewrites every listed state. But a restart is never unlisted: 0 of 238 stretches joined to a daemon came at a later start of that worktree; the registration reads the predecessor's keys. Reuse is safe only under a rule (below); it saves under 1 s and does not touch the stretches | read in source code; the 0 of 238 verified by experiment |
| 4 | What the agent reads, and hand runs | The registration's unlisted text, then nothing: a timed-out hook delivers no text. Agents ran a Squeal command in 93 of 203 cezar stretches. Hand runs were not more frequent in the stretch: cezar 3.1% of tool batches in it, 3.6% after it; squeal 0.6% and 1.9% | verified by experiment (transcripts) |
| 5 | Candidate rows | R1: the first delivery after the listing seeds the view as a registration does. R2 (to rank with 005-110): a boundary hook that cannot finish says the listed counts once. No row for the daemon's listing time or for reusing a listing | effects derived; see section 5 |

## 1. Where the time goes

`daemon-starts.cjs` reads each daemon process from the logs; `stretches.cjs` reads each transcript with an unlisted text; `join.cjs` joins them by worktree root and time (116 of 203 cezar stretches, 122 of 175 squeal; the rest had no log for the start, mostly before 2026-11-14T16:04Z). *m*

| Step, median / p90 (max) | cezar n=116 | squeal n=122 | Log line or column |
|---|---|---|---|
| Unlisted text to the daemon's first log line | 6.7 / 53.7 s (171) | 9.5 / 28.5 s | transcript `timestamp`; first line of the pid |
| Store lock waits logged before the listing | 0 / 8.7 s (67) | 0 / 0 s | `the store was busy for X s ... ran once it was free: <what>` |
| Other long store writes before the listing | 0.25 / 1.0 s | 0 / 0 s | `long write: store.sqlite ... by storeClosures < resolveClosures` and others |
| Environments, runner listing, keys, closures, lookup (residual) | 9.8 / 93 s (405) | about 0 / 2 s | not logged one by one: first line to listing, minus the lines above (*d*) |
| Listing commit, lock held | 1.9 / 3.3 s (14.6) | 1.0 / 1.6 s | `long write: ... by #write < Ledger.commit < commitFirst; N rows written` (cezar median 81,029 rows) |
| **Unlisted text to listing commit** | **23 / 135 s (523)** | **10 / 29 s (145)** | the `commitFirst` line |
| Listing commit to `serving` | 31 / 189 s | 30 / 69 s | `serving <root> on <socket>` |
| Queue wait, load admission | 0: not on the listing path | 0 | read in source: under `lookup-only` the listing commits before anything is queued; runs start after `commitLast` |
| **Listing commit to first listed text** | **1,455 / 19,148 s (n=76; 40 never closed)** | **9 / 362 s (n=114)** | transcript; the first Squeal text that is not unlisted |
| Boundary hooks timed out after the listing, per stretch | 32 / 123 (max 213) | 0 / 18 | `hook_cancelled`, `timedOut: true`, `timeoutMs: 2000` |

The daemon's own time follows the host's load: cezar listing medians by day 12 s (11-14), 29 s (11-15, the load window), 25 s (11-16), 30 s (11-17). *m*

**The named runs** (cezar, 2026-11-15/16). *m*

| Run | Unlisted text to listing | Rows | Listing to first listed text | Hooks timed out after the listing | How it ended |
|---|---|---|---|---|---|
| 09a5d3d2 | 34 s | 57,964 | 1,119 s | 62 of 62 | a new SessionStart at 13:36 |
| ac0581f3 | 25 s | 48,492 | 1,081 s | 68 of 68 | a hook at 12:13:50 that finished in 1,603 ms and carried the owed counts |
| 4f01f44d | 332 s (lock held 14.6 s) | 89,122 | 6,238 s | 62 of 62 | a hook |
| e6e8a925 | 95 s | 11,800 | 292 s | 12 of 12 | a hook |

**Why every hook after the listing fails.** A session that registers before the listing has an empty view and is owed the counts (row 011-205). Its first delivery after the listing writes one view row for every state it was never told (`planDelta`: `before === null` writes), reads every state and builds the full header, in one `BEGIN IMMEDIATE` transaction that, since row 011-288, commits only once the output is written. Claude Code kills the hook at 2 s; the transaction rolls back; the next boundary has the same work and more. It ends only when one delivery fits in 2 s, or a new session registers listed (32 of 121 closed cezar stretches). *Read in source code; the kills verified in transcripts.*

How much heavier that delivery is, `owed-delivery.ts` on a synthetic file-backed store at 0.1.548 source, in-process (no Node start, no other writer, no failures, no code or lint store), two runs each: *m*

| Known states | First boundary after the listing (owed, with news) | Next boundary (news) | Registration after the listing | Its first boundary |
|---|---|---|---|---|
| 20,000 | 281, 312 ms | 171, 168 ms | 77, 80 ms | 105, 105 ms |
| 50,000 | 729, 881 ms | 513, 583 ms | 293, 280 ms | 317, 337 ms |
| 80,000 | 1,241, 1,302 ms | 932, 1,198 ms | 451, 532 ms | 630, 749 ms |

The owed delivery costs 1.1 to 1.9 times an ordinary one. In the field the timeout rate of the same sessions' boundary hooks falls from 100% before the first listed text to 80.7% (cezar, 1,543 of 1,911) and 22.9% (squeal, 216 of 943) in the hour after it. *m* That the extra cost alone explains the 100% is *inferred*: the field delivery also carries the liveness change and any inherited failures, which the synthetic store has not. A killed hook also held the store's write lock until the kill (*inferred* from `BEGIN IMMEDIATE`): 5,661 such kills in cezar stretches.

**Caveat.** Claude Code records a boundary hook only when it printed text or was cancelled. After the listing there were 6,688 tool batches against 5,662 recorded hooks in cezar (1,499 against 760 in squeal); up to 1,026 (739) hooks may have run silent. A silent run that finished would have committed the view, so the next news would have closed the stretch. *Derived.*

The cost of an ordinary boundary hook in cezar (successful runs with text: median 949 to 1,177 ms by day, p90 about 1.8 s; 87 to 96% of recorded runs timed out, `boundary-durations.cjs`) is row 005-110's subject and is not studied here. *m*

## 2. Releases

Daemon versions by start, from the stores' `worktrees.daemon_version`: cezar 0.1.503 (11-14), 0.1.522 and 0.1.523 (11-16), 0.1.526 and 0.1.531 (11-17), 0.1.546 from 18:58Z. The other stretches (11-13 to 11-17) ran the releases between, up to 0.1.542 (*inferred* from these dates; the table keeps only each worktree's last start). 011-391 (0.1.546) removed the whole-store `quick_check` that ran at store open, before the daemon writes its record (005-101: 12.6 s warm, 82.7 s cold on a cezar copy). That interval ends before the first log line, which came a median 6.7 s after the unlisted text in cezar. The 0.1.546 starts: cezar 9.3 and 11.0 s to the listing (against a median 30 s on 11-17 before it), squeal 5.6 to 12.1 s (median 12.3 s before). *m; the check's share inferred, n=2 and 6.* Whatever the check cost, it is inside the daemon's 2% of the cezar stretch.

## 3. Restarts and a reused listing

`baseline` lists through the runner at every start, keys every file from stored closures, looks it up, and `commitFirst` writes every listed state (005-99: median 43,167 rows, the lock held 3.6 s in sum per restart). *Read in source code.* A restart is listed at once for the agent: `testFilesListed` is "any key row", and key rows survive the stop (`header-part.ts`). 0 of 238 joined stretches came at a later start; all were the first start of their worktree in the logs. *m.* So "each restart lists about 1,300 files again" (hand-runs item 1) is machine cost, not an unlisted state.

A stored listing could stand in for the runner's listing when all of these hold: every project's environment hash equals the hash it was listed under (it covers the resolved config, config files and their dependencies, setup files, the installed-dependency fingerprint, Node, allow-listed env variables and the adapter version); no path was added, removed or renamed since that listing in a revision the runner did not see (`scan`'s unseen sets); and the listing ran to completion (not the stored-keys fallback of a failed listing). Unsafe without it: a test file added or deleted while no daemon ran; a config that reads an env variable not on the allow list, the clock or a file outside its dependencies; a glob over ignored files the stat cache never hashes. Gain: the listing call alone, 65 to 330 ms (`daemon-memory.md` 3) of a start of tens of seconds; the environments are read anyway. *Rule read in source; gain from earlier measurement.* No row.

## 4. What the agent reads

At registration: the unlisted text, with zero counts (0.1.531 and earlier) or "Squeal is still starting in this worktree and has no results yet" (row 005-90). Then nothing until a delivery fits: a timed-out hook adds no text. `squeal status` reads the store with no 2 s limit and shows the listed counts; agents ran a Squeal command in 93 of 203 cezar stretches (3.8% of tool batches in them, 3.3% after). Hand test runs: cezar 358 in 11,382 batches in stretches (3.1%) and 392 in 10,943 after (3.6%); squeal 21 in 3,247 (0.6%) and 265 in 14,273 (1.9%). The stretch does not raise hand runs; the 84 of 254 in hand-runs item 1 follows from cezar sessions spending about half their batches in a stretch (11,382 of 22,325). *m; the last clause derived.* The revision-level text of gh-176, gh-181 and 011-210 ("Vitest has not yet listed the test files of revision N") is a different state and is not counted here.

## 5. Candidate rows

Expected effects use the field's own rates: the median gap between boundary hooks in stretches was 10 s (mean 35 s cezar, 22 s squeal) (*m*), and timeouts are taken as independent per boundary (*a*).

| Row | Status | Input | Done when |
|---|---|---|---|
| R1 the first delivery after the listing costs no more than a registration | proposed | This file, section 1. A session registered before the listing writes one view row per never-told state in its first delivery after it, 1.1 to 1.9 times an ordinary delivery (729 to 881 ms at 50,000 states, synthetic), and every kill repeats it. Owner 005 (consumer views, 005-106 design N; 011-205 owed counts). Expected: the post-listing delivery fails at the ordinary rate instead of 100%. Squeal: about 1.3 boundaries, under 30 s, against a p90 of 362 s now. Cezar: about 5 boundaries at its 81% rate, 1 to 3 min against a median of 24 min, only if the ordinary hook stays as it is (*d*). Risk: an inherited failure read as a told pass would be told as a regression; the seed must follow 005-106 (non-pass states, a mark) | The first delivery after the listing to a consumer owed the counts seeds its view as a registration at that moment would (the daemon at its listing commit, or the delivery), then plans the delta from it; it carries the owed counts once; at 50,000 synthetic states it takes no longer than a registration plus an ordinary delivery; the counts-owed tests and a new case with an inherited failure pass |
| R2 a boundary hook that cannot finish says the listed counts once (rank with 005-110) | proposed | This file, sections 1 and 4; row 005-110 (hooks pass 2 s in cezar on 0.1.546). Owner 005. Expected: every measured stretch ends at the first boundary after the listing, about 10 s median, against 1,455 s (cezar) and 9 s (squeal) now; in the two 0.1.546 cezar sessions, about 10 s against 28 to 30 min and more (*d*). Risk: a second, shorter text path; it must be told once, so it needs its own small commit, which waits for the store lock up to the 1 s busy timeout; the wording is product-facing | A boundary hook with a delivery still running near its budget gives up that delivery and writes, once per listing, a short text with the listed counts from one cheap read, then exits inside 2 s; a hook with the lock held past its busy timeout still exits silent inside 2 s; tests for both |

No row for the daemon's listing time: in cezar it is a median 2% of each stretch (98% comes after the listing, *m*), and its p90 is the 11-15 load window. No row for a reused listing (section 3). Re-measure the stretches with `stretches.cjs` and `join.cjs` after R1 or 005-110's rows land.

## Open questions

1. How much of the 100% timeout rate after the listing the owed view write explains, against the rest of that delivery (liveness change, inherited failures, header): not determined, because the field hooks were killed with no trace and the synthetic store has no failures and no code or lint store. 005-110's step budget on store copies would decide it.
2. The split of the residual (environments, runner listing, closures, lookup) per start: not determined, because the daemon logs no line between its first line and the listing commit.
3. Hooks that ran silent and finished: not determined, because Claude Code records no silent hook (up to 1,026 of 6,688 cezar batches after the listing).
4. Codex and other harnesses: not counted; their run logs were not read.
5. The 0.1.546 effect on the daemon's time rests on 2 cezar and 6 squeal starts.

## Sources

- Transcripts `~/.claude/projects/-home-agent-projects-{cezar,squeal}--ai-squawk-worktrees-*/*.jsonl` (attachments `hook_success`, `hook_cancelled` with `durationMs`, `timedOut`, `timeoutMs`), read 2026-11-17 20:00 to 21:10Z.
- Daemon logs `~/projects/{cezar,squeal}/.git/squeal/logs/daemon-*.log`; cezar's for the named runs: `daemon-025753328af4ba03.log` (09a5d3d2), `daemon-e9ddd0f8d18fa5f8.log` (ac0581f3).
- Squawk run logs `~/projects/cezar/.ai/squawk/runs/{09a5d3d2,ac0581f3,4f01f44d,e6e8a925}-*.ndjson.br`.
- Stores `~/projects/{cezar,squeal}/.git/squeal/store.sqlite`, table `worktrees` only, `mode=ro`.
- Source at `c74b471d9`: `src/core/scheduler/bootstrap.ts` 119-330 (`baseline`, `commitFirst`, `commitLast`), `src/core/state/header.ts:109`, `src/core/state/header-part.ts` (`listed`), `src/core/delivery/delivery.ts` 215-430 (`plan`, `deliver`, `payCounts`), `src/core/delivery/delta.ts` 176-235 (`planDelta`), `src/core/delivery/counts-owed.ts`, `src/core/store/connection.ts:51`, `src/core/store/long-write.ts:21`, `src/core/types/store-records.ts:312`, `src/core/keys/environment-hash.ts`, `plugins/claude-code/hooks/hooks.json` (and 0.1.516's in the plugin cache: the same 2 s limits).
- Earlier findings: `hand-runs-2026-11-16.md` 1; `restart-baseline.md`; `005-agent-adoption/research/daemon-restart-per-turn.md` 1, 4, 5; `session-start-cost.md` 1, 7; board row 005-110.
- Probes: `probes/unlisted-after-start/` (README lists each script and the commands).
