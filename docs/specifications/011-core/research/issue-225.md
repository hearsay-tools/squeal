# Issue 225: load retries and single files waiting for CPU while test slots are free

Recommend treating #225 as confirmed by mechanism: a load retry that passes its load gate is then started as a background tier, and the background CPU rule compares the whole host's busy cores with `min(capacity.hostSlots, backgroundShare × CPUs)`. On this host `capacity.hostSlots` is 6, so that bar is 6 busy cores, not 18. Above it, one background tier at a time runs across all of the user's daemons, through the floor. Free test slots do not admit it. The 42-minute and 10-minute waits of the original incident were not reproduced.

## Scope and versions

- Examined Squeal **0.1.512** (`package.json`), commit `6375287b773c62fa6dffe3728783b2373fd08ab6` (branch `cez/99bd5c88`, from main `6375287b7`). Node v26.13.0.
- Research started 2026-11-15 13:24 UTC. Host: **24 CPUs** (`nproc`, `os.availableParallelism()`). Load at start **7.90 7.30 6.64**; before the probe 7.49; at the live read 6.81 and 7.23. A 3 s `/proc/stat` sample read **7.34 busy cores**. One-minute load stayed far below 24, so live reads were allowed. No host load was generated. No daemon was started, no full suite, install or build ran.
- User capacity config on this host: `~/.config/squeal/config.json` = `{"capacity":{"hostSlots":6}}`.
- The issue reports 0.1.506, Codex workers in hearsay-tools/cezarion, 20–23 and 17 of 24 cores busy, 0–1 of 6 slots in use. No JSON, revision or daemon log was kept. These are reporter claims.
- No product, `spec.md`, `status.md`, skill or board file changed. The hold on #127 (retry priority, option A held) and every other hold stand.

## Questions and verdicts

| # | Question | Answer and tag |
|---|---|---|
| 1 | Can a load retry wait for CPU while test slots are free? | **Yes. Verified by experiment, 0.1.512** (pool alone, synthetic readings): a one-file background tier is refused at 17 busy cores with 0 of 6 slots held when an older waiter exists, and with 1 of 6 held when another daemon runs a background tier. |
| 2 | What is the admission threshold? | **Read in source code and verified by experiment, 0.1.512:** host busy cores (plus Squeal's marks, when more) must be below `min(hostSlots, ceiling)`, ceiling = `backgroundShare × CPUs` = 18 on 24 CPUs. With hostSlots 6 the bar is 6. Above it only the floor admits: one background tier at a time per user. |
| 3 | How do retry eligibility and start differ? | **Read in source code, 0.1.512; mechanism verified by experiment:** eligibility is the load gate, one-minute load average < CPU count (24), or 600 s after the gate is first seen closed. Start is the pool's background rule, which reads busy cores, not load average. A retry can be eligible at load 17–23.9 and still not start. No start bound exists. |
| 4 | Does a single affected file meet the same rule? | **Read in source code, 0.1.512:** only when it is not an edit's work. A file an edit reached is "recent" and runs in an edit's tier without a permit. A catch-up, never-run or retried file, alone in the queue, forms a backlog tier and meets the background rule. |
| 5 | Is the original incident reproduced? | **Not determined, because** no snapshot, daemon log, marks or revision of the cezarion daemons exists, and reproduction would need host saturation and a 42-minute wait, which the brief forbids. |
| 6 | What does status show, and is it accurate? | **Read in source code, verified by experiment for the text:** `queued, waiting for CPU since …: the host is busy (17 of 24 cores in use; Squeal's daemons hold 0 of 6 test slots)`. It names neither the bar (6 here) nor the floor nor the older waiters that block it. |

## Findings

**F1. A load retry is queued as background work. [read in source code; 0.1.512]** `retries.ts:queueDue` claims the file and calls `ledger.enqueue(file, priorityOf(file, NOTHING_CHANGED), true)`: forced, not recent. `queue.ts:isFirstGroup` is recent or promoted. With no first-group file queued, `tier-pick.ts:shapeOf` sets `backlog = true`, and `tier-pass.ts:candidateOf` asks the pool with `kind: poolKind(...)`, which is `"backlog"` unless a `run --all` checkpoint is open. This agrees with spec 011 C5 ("forced at the file's normal priority") and the C15 line `retry: normal priority; waits for named groups and edits' work` (row 011-283).

**F2. Eligibility is the load average; start is busy cores. [read in source code; 0.1.512]** `retry/load.ts:loadAllows` is `oneMinute < cpus`. Probe output: load 17 and 23.9 of 24 → eligible; 24 → not. The pool's gate (`capacity/cores.ts:gatedPermits` with `background`) counts busy cores from `/proc/stat` over a window (row 011-182), and each permit needs `cores < min(hostSlots, ceiling)`. The two gates read different measures with different bars. #214 F1 already showed that the 600 s bound queues a retry and grants no start.

**F3. The effective bar on this host is 6 busy cores. [verified by experiment; 0.1.512, synthetic pool]** `probe.ts`, one `acquire(1, "fast", 1, kind)` per case, 24 CPUs:

| Case | hostSlots | Busy | Others | Result |
|---|---|---|---|---|
| A | 6 | 17 | none | granted 1 (floor) |
| B | 6 | 17 | one daemon holds 1 background permit | **refused**, status "1 of 6 test slots" |
| C | 6 | 17 | an older fast waiter, 0 grants | **refused**, status "0 of 6 test slots" |
| D | 6 | 5.5 | one holds 1 background permit | granted 1 |
| E | 23 | 17 | one holds 1 background permit | granted 1 |
| F | 23 | 18 | one holds 1 background permit | refused |
| G | 6 | 23 | checkpoint kind, one holds 1 | granted 1 |

E and B differ only in hostSlots. Spec 021 D18 says "On this 24-CPU host the default is 18", and its replay assumed that ceiling. The code also keeps the older slots bar ("each permit needs the cores below the slots", `cores.ts:74-75`, and `const limit = … Math.min(hostSlots, background.ceiling)` in `gatedPermits`), and for a background tier it compares the whole host's busy cores with Squeal's slot count. `ceilingRefusalLine` names the slots when they are lower, so the code expects this case. Whether D18 meant the slot count to bound host busy cores is a spec question; the text and the code disagree in effect on this host. What decides it: D18's author or the human.

**F4. Above the bar, the floor serializes background work for the whole user. [read in source code; verified by experiment for one look]** `pool.ts:#gated`: when the gate leaves fewer than the fewest workers, the floor grants them only if no other daemon's mark holds a background permit and no older waiter exists (`servedBefore`). A served daemon "waits again from its next look, behind the others". The pool directory is per user (`$XDG_RUNTIME_DIR/squeal`), shared by every project's daemons. So when busy cores stay at or above 6, a retry in one worktree waits for every older waiter's floored backlog tier, one at a time, whatever their length. **[inferred]** This fits 10–42 minutes on a host with many worktrees; it is not shown to be the incident's cause.

**F5. Live state on this host shows the mechanism at low load. [verified by experiment; read-only, 13:27 UTC]** `live-marks.ts` read 3 marks: `5446ad27` waiting 230–244 s with want 63, grant 0; `204bb7cb` holding 2 background permits; `b7555ac0` holding 1 and waiting 30–44 s. Busy cores 7.34, load 7.23 of 24. A load retry would be eligible here, yet a new background tier could start only through the floor, which two held background tiers block. This is a snapshot, not a measured wait for any retry.

**F6. "Test slots held" is not the admission input. [read in source code; 0.1.512]** `pool-wait.ts:gateText` prints other daemons' grants. Edit tiers take no permit, so many running edit tiers read "0 of 6" while they use cores. The waiting line names cores and slots but not the bar `min(slots, ceiling)`, the floor, or an older waiter. Probe case C reproduces the reported text "0 of 6 test slots" with a refusal.

**F7. A named wait already bypasses the pool. [read in source code and spec; not run]** C15 as amended 2026-11-07 (row 011-308): a named wait's batch whose tier the pool refuses "starts at once without a permit as an edit's tier" (`tier-pass.ts:171`). `squeal status --wait 60000 <file>` naming the file promotes it. The issue says `squeal status --wait 60000`; whether the files were named is not recorded. If they were named and still waited, F7 does not hold for that run and the cause is elsewhere (#139, #179). Not determined.

**F8. The node:test file case is less clear. [read in source code; not run]** node:test lanes can run backlog files in local slots (`local-permits.ts:59`, kind `"backlog"`, no wait published) or in the fast pass. "Waiting for CPU" is published only by `tier-start.ts` with a lane. Which path held `no-compat-policy.test.cjs` is not determined.

## Recommendation for Squeal

**[inferred]** Owner spec 011 C4/C5/C10/C15 with spec 021 D18. Options for the human, none authorized here:

1. Decide whether `hostSlots` should bound host busy cores for background tiers (F3). If not, the bar on this host becomes 18 and most of the reported waits (17 busy) would admit.
2. Status names the bar and the blocker: "waits for the host's busy cores below 6 (6 test slots; ceiling 18); N older waiters go first", and suggests naming the file in `status --wait` (F6, F7).
3. A retry-specific path, such as treating an eligible load retry as a checkpoint-kind or edit-kind tier, changes retry priority, which #127 holds. Keep it under #127.

Relations: #127 (retry priority, held), #214 (eligibility versus start, F1 there), #222 and #216 (gate reuse while a retry waits, the incident's report effect), #139 (no recorded blocker), #179 (another worktree's claim). No open issue or board row covers the slots-versus-ceiling bar.

## Open questions

- The incident's daemons: their marks, older waiters, floored tiers and lengths. Needs the pool marks and daemon logs at the time.
- Whether the reporter's `status --wait` named the files (F7).
- Whether row 021-19's measurement used hostSlots 6 or 23 on this host.

## Commands and sources

- `date -u; cat /proc/loadavg; nproc; git rev-parse HEAD; node -p "require('./package.json').version"`: 13:24:26 UTC, `7.90 7.30 6.64`, 24, `6375287b7…`, 0.1.512.
- `gh issue view 225 --repo hearsay-tools/squeal`: OPEN, no comments. `gh issue list --repo hearsay-tools/squeal --state open --limit 60`: related #127, #139, #179, #214 (board), #216, #222.
- `cat ~/.config/squeal/config.json`: `hostSlots: 6`.
- `pnpm exec tsx docs/specifications/011-core/research/probes/issue-225/probe.ts`: exit 0, [output](probes/issue-225/output.txt). `pnpm exec tsx …/live-marks.ts` twice with a 3 s busy-core sample: [output](probes/issue-225/live-marks-output.txt). [Probe README and limits](probes/issue-225/README.md).
- Source, at the commit above: `src/core/scheduler/retries.ts` (`dueOf`, `queueDue`), `src/core/retry/load.ts`, `src/core/scheduler/queue.ts` (`isFirstGroup`, `priorityOf`), `src/core/scheduler/tier-pick.ts` (`shapeOf`), `src/core/scheduler/tier-pass.ts` (`candidateOf`, batch as edit), `src/core/scheduler/capacity.ts`, `src/core/capacity/pool.ts` (`#gated`, `servedBefore`), `src/core/capacity/cores.ts` (`gatedPermits`), `src/core/capacity/background.ts`, `src/core/scheduler/pool-wait.ts`, `src/core/status/next-step.ts:352`.
- Contracts: [011 C4/C5/C10/C15](../spec.md), [011 amendments](../status.md), [021 D18](../../021-remote-store-and-execution/spec.md), [admission.md](admission.md), [issue-127.md](issue-127.md), [issue-214.md](issue-214.md), [board](../../../board.md).
