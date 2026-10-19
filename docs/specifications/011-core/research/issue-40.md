# Research: issue 40, why named files stay pending through a status wait

Researcher, 2026-10-19, worktree `cez/195a9b5b` at 036be0a0. [Issue #40](https://github.com/hearsay-tools/squeal/issues/40): a session waited three times (`squeal status --wait 60000 <31 test files>`), each ending `15 test files still pending at revision 20`, while status said `0 running`, 239 queued, at load 12 to 14; `npm test` then passed the 31 files in about 10 minutes. Incident Squeal version unknown.

Environment: installed `squeal` 0.1.222 (`/home/agent/.local/bin/squeal`), worktree `package.json` 0.1.222, CLI under test `plugins/claude-code/dist/cli/squeal.mjs` (0.1.222), Vitest 5.0.3 from a sibling worktree's `node_modules` (symlinked, read only). Host: 24 CPUs (`nproc`), one-minute load 3.34 to 4.53 throughout (`/proc/loadavg`), so live probes were allowed. No broad suite, no build. The full 10-minute incident was not recreated.

## Answers

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Does a 0.1.222 named timeout give each pending file's reason and an actionable command? | Reasons: yes, one per file plus grouped counts on the verdict line. Command: only for slow files (`squeal run --slow`); a queued, running, claimed or unlisted file gets a bound but no command. | verified by experiment (0.1.222), read in source code |
| 2 | Do queued fast named files outrank queued background files, keeping the constraints? | Yes at the next tier boundary while the wait is open: the three named files led the next tier ahead of 15 queued background files; the slow file still waited for the fast tests. Not inside a backlog tier already running: with the default `backlogTierSize` 200, `run --all` put them in one running tier, behind 23 background files. | verified by experiment (0.1.222) |
| R | Reproduction | Partial. The timed-out named wait and the wait behind background work reproduce in small form. The incident's `0 running` beside 239 queued and 15 pending files was not reproduced; with the version unknown, its cause is not determined. | verified by experiment / not determined |

## 1. What a named timeout says on 0.1.222

**Verified by experiment** (probe run B below, `backlogTierSize` 4). A 1.5 s wait on three fast files and one slow file, just after `run --all`, exited 3 with:

```
Pending (4): tests/fast/f1.test.ts: queued behind the vitest tier running since 16:14:46; tests/fast/f2.test.ts: queued behind the vitest tier running since 16:14:46; tests/fast/f3.test.ts: queued behind the vitest tier running since 16:14:46; tests/slow/s1.test.ts: slow, run after the fast tests or on `squeal run --slow`
Named test files have no verdict: the deadline passed after 1.5 s: 4 test files still pending at revision 0: 3 queued behind the vitest tier running since 16:14:46, 1 slow, run after the fast tests or on `squeal run --slow`. Worktree: known failures 0; checks 0 running, 0 queued; 28 test files without checks: 4 running, 24 queued
```

**Read in source code** (`src/cli/named-file-lines.ts` `reasonText`, `src/cli/named-files.ts` `PendingReason`, `queuedReason`, `unlistedReason`; 011-12, 011-13): the five reasons are `running since … in the <lane> lane`, `queued[, promoted][ behind the <lane> tier running since …]`, `waiting for <worktree>'s run of its key, at most until …`, `slow, run after the fast tests | when the agent pauses or on \`squeal run --slow\``, and `revision N not listed yet … each of its calls bounded at N s`. The class line lists 10 files then `and N more`; the verdict line caps reason groups at five; `--json` `wait.testFiles` carries every file's reason.

What the issue asks that is already covered (done rows):
- per-file reason with its bound on a timeout: 011-12 (0.1.210), C15's list;
- slow tier waiting named, with `run --slow`: 011-12, 004-80 wording;
- "queued behind" a running tier, with its start: 011-12;
- `promoted` shown while a promotion holds: 011-13 (0.1.212);
- `running 0` while a re-keyed run is open (gh-17 finding 3): 011-12 counts it as running. If the incident ran before 0.1.210 this alone could explain `0 running` beside pending files. **Inferred**, version unknown.

Residual, not covered:
- **No command for non-slow reasons.** `queued`, `running`, `claim` and `unlisted` name no command (source above). No command runs a queued file ahead of a running tier: `retry` (011-16) queues, it does not preempt, and C15 forbids splitting a running tier (that is 001-381's). The issue's "command that runs them now" therefore has no honest Squeal answer today for these reasons. **Read in source code**; a human decision.
- **"queued behind N files" is not said.** The reason names the tier ahead, not how many queued files precede the file or the tier's size. **Read in source code.**
- **Plain `queued` with nothing named.** `queuedReason` returns `queued` with no bound when no run is open in the lane, no claim holds and the file is not slow. A capacity wait does not reach this for a promoted file (an edit's tier takes no permit, C10), but any other daemon-side hold would read as bare `queued`. Whether the incident's 15 files read so is not determined. **Read in source code.**
- **"running" while waiting for a worker.** In run A the named files were counted running inside a 27-file backlog tier on 23 workers and started 2.5 s late, behind background files; a wait then says `running since … in the vitest lane` although the file has not started. With real backlog files this can last up to the tier's length (`runner.timeoutMs` 600 s). **Verified by experiment.**
- **Promoted label not seen.** The 1.5 s wait sent a promotion (the files later ran early) but its text said `queued`, not `queued, promoted`. Why is not determined: the CLI sends the request without waiting for it (`status-wait-promote.ts`), and the daemon publishes the `promotions:<worktree>` row afterwards.
- **Discovery with no dependencies.** In this worktree (no `node_modules`), `squeal status --wait 60000 <6 test files>` waited the full 60.2 s and exited 3 with `Selected: ` empty and `the runner has not listed the test files of revision 0 yet`, while the Notes said Squeal runs none of the tests until `npm ci`. The verdict line names listing, not the install, as the hold. **Verified by experiment**; related to issue 38's lookup-only recovery, not to this issue's queue.

## 2. Do named fast files go ahead of background work?

**Verified by experiment**, order taken from each test's own log (ms after `run --all`):

- **Run B, `backlogTierSize` 4.** Tier 1: b01 to b04 at 92 to 104 ms. Tier 2: b05 to b08 at 2344 ms. Tier 3: f1, f2, f3 at 4595 to 4601 ms with b09 at 4591. Then b10 to b24 in four more tiers to 13588 ms, and s1 at 15879 ms. The second wait (15 s) settled after 14.4 s, exit 0. So the named files went ahead of 15 queued background files, shared their tier with one background file of comparable duration (001-184), and the slow file still waited for every fast file (004 D2). They did not go into tier 2: the first wait's promotion ended at its 1.5 s deadline, before that boundary, and the second wait's request evidently arrived after tier 2 began (**inferred** from the times; C15: promotion lasts until the deadline). In the incident, three 60 s waits in a row leave the same gaps between waits.
- **Run A, default `backlogTierSize` 200.** `run --all` took 27 files in one backlog tier (`27 running, 1 queued` 3 s in). b01 to b23 started at 341 to 373 ms on 23 workers; b24 and f1 to f3 at 2513 to 2522 ms, when workers freed. Promotion had nothing to reorder: C15 never joins or splits a running tier. With a 239-file backlog of real durations, named files in that tier wait for the tier's workers, labelled running.
- **Covered by regression tests** (read in source code): `test/scheduler/promotion.test.ts` (Z before B; past deadline orders nothing; claimed key waits for its claimant) and `test/scheduler/queue-promotion.test.ts` (leads the first group; ends at the deadline; fairness turn after four first-group tiers; leads the slow class's order; dropped with the queue).

## Recommendation for Squeal

Treat the issue's second acceptance criterion as met by 011-11 for queued files (both runs above), and its first as met by 011-12/13 for the reason, not for the command. Residual for a row, if the human wants one: (a) a timed-out named wait names the command or honest absence of one for each non-slow reason, e.g. that a running backlog tier finishes first, (b) a file inside a running tier that has not started reads as queued within that tier, not running since the tier began, (c) when nothing in the store explains a bare `queued`, say so rather than print a bare word. Whether named files may leave a running backlog tier stays with 001-381. The `promoted` label not seen in a short wait is worth one look by whoever owns 011-13's seam. Existing holds stand; no implementation.

## Open questions

- The incident's version and whether its 15 files read `running`, `queued` or bare: not determined, because the issue does not record them. Its `0 running` matches gh-17 finding 3, fixed in 0.1.210, only if it ran on an older version.
- Why the 1.5 s wait printed `queued` and not `queued, promoted`: not determined in the time box.
- Whether a load of 12 to 14 on the incident host shrank backlog tiers (C10 PSI): not measured; this host stayed at 3 to 5.

## Commands

```
cat /proc/loadavg; nproc; squeal --version                     # 3.74 load, 24 CPUs, 0.1.222
squeal status --wait 60000 test/scheduler/queue-promotion.test.ts test/scheduler/promotion.test.ts \
  test/cli/named-file-lines.test.ts test/cli/status-wait-promoted.test.ts test/daemon/promote.test.ts \
  test/scheduler/hold-queue.test.ts                             # this worktree, no node_modules: exit 3 after 60.2 s
cd /tmp && bash <worktree>/docs/specifications/011-core/research/probes/issue-40/probe.sh \
  <worktree>/plugins/claude-code/dist/cli/squeal.mjs <sibling worktree>/node_modules 200   # run A, load 3.56 -> 4.53
cd /tmp && bash .../probe.sh .../squeal.mjs .../node_modules 4                          # run B, load 4.21 -> 4.28
```

Run A preceded the probe's edit that added the 1.5 s wait; run B used the committed script.

## Sources

- Issue: https://github.com/hearsay-tools/squeal/issues/40 (`gh issue view 40 -R hearsay-tools/squeal`, 2026-10-19).
- Spec 011 C4 step 4, C6, C10 Capacity, C15; `status.md` lines for 011-03, 011-11/12, 011-13; Spec 004 D2 and its `slow.*` keys.
- Board rows 011-11, 011-12, 011-13, 011-16, 011-17, 001-381 (`docs/board.md` at 036be0a0).
- Source at 036be0a0: `src/cli/named-file-lines.ts`, `src/cli/named-files.ts`, `src/cli/status-wait-promote.ts`, `src/core/scheduler/queue.ts`; tests `test/scheduler/promotion.test.ts`, `test/scheduler/queue-promotion.test.ts`.
- Probe: `probes/issue-40/` (throwaway).
