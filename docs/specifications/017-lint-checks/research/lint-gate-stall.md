# 017-34: why lint stays pending during a gate (gh-238)

Researcher, 2026-11-27, task c57e0ae0. Brief: `tasks/wave-8.md`. Logs and stores only: no load, no daemon, no test run. Probes: `probes/017-34/` (throwaway; README there).

**Recommendation:** yes, lint still stalls after 0.1.570. Do not tune the CPU limit. A full re-lint of about 4,000 files almost never fits a 120 s gate: 12 of 271 did. Let a gate wait for the lint of the files it names, and lint those files outside the background lease (fix row below).

**Sample.** The squawk repository is the only repository on this host with lint on (oxlint, about 4,100 files). Its 1,343 daemon logs run from 2026-11-14 16:07Z to 2026-11-27 18:08Z. Its lint store holds the last keying of 2,469 worktrees. 1,281 of those keyings fall inside their worktree's log. Before 0.1.570 means daemons 0.1.503 to 0.1.568. After means 0.1.570 to 0.1.657. The split is the log format: 0.1.570 dropped "test slots" from the refusal line. The first line in the new format is at 2026-11-19 21:07Z. The host went from 24 to 16 CPUs at about 2026-11-20 22:45Z, so the ceiling went from 18 to 12 busy CPUs.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Does lint still wait behind the CPU limit once test slots no longer cap it? | Yes. After 0.1.570, 609 of 781 lint waits of 10 s or more had a CPU-ceiling refusal logged by the same daemon at the same time. The other 172 had none. Those are refusals by the pool's fair share or queue order, which no line logs. By time, the logged waits are 57% of the wait time and the unlogged ones 43%. | read in source code (0.1.657); counts from the logs and the store; attribution inferred |
| 2 | How many lint waits had free test slots, before and after 0.1.570? | Before: 258,482 of 398,075 refused looks (65%) were below the 18-CPU ceiling. The 6 test slots capped them. Inside full re-lints it was 62,668 of 107,003 (59%). After: none, because slots no longer cap the ceiling. But 27 of the 125 open lint wait records show busy CPUs below the limit. | logs; source |
| 3 | How long are the waits? | After 0.1.570: refusal episodes closed by a grant last 4 s at the median, 31 s at p90 and 912 s at most (10,562 episodes). Waits between lint parts last 24 s at the median, 122 s at p90 and 2,673 s at most. A full re-lint that finished took 413 s at the median, 1,697 s at p90 and 5,485 s at most. 71% of that time was waits. Before 0.1.570: 2,189 s at the median and 43% waits. | logs and store |
| 4 | What started each full re-check? | After 0.1.570, there were 271 full re-lints. 167 are new worktrees whose lint environment had no finished lint yet. 104 are config keyings: 5 from an edit to a file the lint rules read, 1 from `.oxlintrc.json`, and 98 in worktrees the store has dropped, so the cause is not known. The environment itself moved 207 times, about 26 times a day: 175 times by files the rules read, 31 times by the oxlint config, once by something else. | store records; source |

## Findings

**F1. A gate waits for the whole repository, and a full re-lint is slow under load.** *Read in source code and in squawk's `scripts/prepr.mjs`.* `squeal status --json` gives one lint count for the whole repository: `linting.done/total`. It has no lint count per path. `prepr` treats any unfinished file as "lint did not finish" and falls back to `npm run lint`. So a gate passes only if every file has a result. After 0.1.570, 271 keyings left at least half of the files to lint. 68 finished, and only 12 finished within 120 s of the keying. 123 linted their first part within 120 s. The finished ones linted 554 files a minute at the median, waits included: about 7 minutes for 4,000 files. *Store and logs.*

**F2. Each part of 16 files asks for the CPU again.** *Read in source code, 0.1.657.* `lintParts` (`src/core/lint/pass/parts.ts`) takes `capacity.take(1, "slow", 1, "backlog")` per part and gives it back after the part. A refusal ends the pass, which looks again 2 s later (`CAPACITY_RECHECK_MS`). A served waiter goes to the back of the queue (`#served`, `src/core/capacity/pool.ts`). So about 250 parts each wait their turn. The waits add up: the waits of 10 s or more between parts last 24 s at the median, and a re-lint has many of them. *Inferred from the timings above.*

**F3. Three refusal causes exist; the log names one.** *Read in source code, 0.1.657.* `acquire` refuses a backlog lease in three cases:
- **The CPU ceiling.** `#gated` returns fewer than one permit. The log line is `the background ceiling refused a backlog tier`. Test tiers and lint write the same line, once per episode.
- **The fair share.** `target < fewest`. Lint and its own daemon's test backlog share one pool and one share (`scheduler.capacity()`, `src/core/daemon/daemon.ts`). While the daemon's test backlog holds that share, lint gets none, even with CPUs free.
- **The queue order.** `#take` keeps permits back for older waiters.

`#logRefusal` returns early unless the ceiling caused the refusal. So the last two leave no trace in the log. Row 017-33's record (`refusedCpu`) writes the gate's busy CPUs and limit for any refusal. So status says "waiting for CPU (13 busy, limit 18)" when the CPU was not the cause. 27 of the 125 wait records still open show busy below the limit. *Store.*

**F4. An edited file stays in the backlog while a full re-lint runs.** *Read in source code, 0.1.657.* In an edit keying, `judgeAll` (`rekey.ts`) keeps the quiet set. `readQueue` (`parts.ts`) puts a pending file that is in the quiet set in the backlog. The backlog needs a lease, so the agent's own changed files wait for the CPU like every other file. `firstOf` puts them first in that queue, so they lint in the next part that is granted.

**F5. Re-lints start because the lint environment moves on main.** *Store records; source.* The oxlint provider declares `packages: ["oxlint"]`. Its closure holds 232 files: the JS rule plugins under `packages/cezar/src/lint/`, their imports and the data files they read. `environmentOf` (`keys.ts`) hashes the blobs of all of them, plus the install fingerprint. Every lint key holds those blobs too. So a change to any of the 232 files changes the key of all 4,000 files. These files changed most often between environments: `layers.json` (93 times), `layer-import.baseline.json` (87), `packages/web/src/styles/index.css` (86), the web `*.baseline.json` files (86), `runner-facts.ts` and `agent-runner.ts` (85), and `.env.example` (58). The diff is between environments in time order, across branches, so it may count a change twice. *Inferred.* A first keying hits the stored results when an earlier worktree finished at the same environment: 467 times it hit, 8 times it missed. Most full first keyings come at an environment where no worktree finished: an earlier re-lint was still running or its worktree had ended. *Store.*

**F6. Many re-lints never finish.** *Store and logs.* After 0.1.570, 203 of the 271 full re-lints still had files pending when the worktree's last daemon line was written. Most daemons lived only a short time after the keying: 2 min at the median and 17 min at p90. 26 lived 10 min or more, and 13 lived 30 min or more. Before 0.1.570, 511 of 529 never finished; 81 of them lived 30 min or more.

## Proposed fix row

**017-NN: a gate gets the lint of the files it names (gh-238).**

*Scope.*
1. In the parts' queue, a pending file that the latest revisions changed runs as an edit part: `running(1)`, outside the background ceiling. This holds while the file is in a first or config keying's quiet set. The rest of the backlog keeps its lease.
2. `squeal status --wait <paths>` also waits for the lint of the named paths that lint includes. Its JSON gives their lint apart from the repository count: done, pending, failing and unknown, each with its reason. The repository-wide `linting` count stays.
3. A refusal that the CPU did not cause is not told as a CPU wait: status gives the share or queue reason (F3).

Squawk's `prepr` must read the new fields; that is outside Squeal. Whether a gate may treat lint of the selected files as enough is the human's decision, as `issue-238.md` left it.

*Done when.* A daemon test fixture: a config keying leaves N files pending, and the pool refuses every backlog lease. An edited included file then reaches `pass` or `fail`, while the backlog stays `pending`. `status --wait <file>` returns that file's lint verdict before the backlog finishes. With the refusal from the share and busy CPUs below the limit, status names the share and gives no CPU numbers. Backlog parts still wait while refused.

## Open questions

- **Which refusal cause each unlogged wait had.** Not determined: the log names only the ceiling, and the open records show only the last wait of a pass.
- **Gate times.** Squeal does not log `status --wait` calls, so the count of gates that met an unfinished re-lint is not determined. F1 gives the chance of meeting one, not the number of times it happened.
- **Duplicated work.** Several worktrees at a new environment lint the same files in the same order at the same time. This does not show whether a part looks for a result that another daemon stored while the part waited.
- **History.** The store keeps only each worktree's last keying, so earlier re-lints of one worktree are counted only through new environments (F5).
- **Results from other worktrees.** A result another worktree stored after this worktree's keying counts as this worktree's lint. Completion times can therefore read a little short.

## Sources

- Daemon logs `<squawk>/.git/squeal/logs/daemon-*.log` (1,343 files). Squeal's own logs (782 files) and one other repository's (35 files) have refusal lines but no lint: lint is off there.
- `<squawk>/.git/squeal/lint.sqlite`: `meta` (`lint-keying`, `lint-inputs`, `lint-cursor`, `lint-cpu-wait`), `states`, `results.linted_at`. `store.sqlite`: `worktrees`, `revisions`. All read-only.
- Squeal source at this branch (0.1.659 tree):
  - `src/core/lint/pass/parts.ts`, `rekey.ts`, `keys.ts`, `cpu-wait.ts`, `index.ts`
  - `src/core/lint/provider/oxlint/provider.ts`
  - `src/core/capacity/pool.ts`, `background.ts`, `cores.ts`
  - `src/core/scheduler/capacity.ts`, `src/core/daemon/daemon.ts`
  - `squeal--v0.1.567:src/core/capacity/background.ts` for the old refusal line
- Squawk `scripts/prepr.mjs` at its main on 2026-11-27 (`lintOf`, `lintUnfinished`).
- [Issue #238](https://github.com/hearsay-tools/squeal/issues/238); `research/issue-238.md`; board row 017-33.
