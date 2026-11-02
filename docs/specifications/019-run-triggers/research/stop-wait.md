# Research: stop-wait

Row 019-03, topic `stop-wait` of `README.md`. Source read at Squeal `6c5615a55` (0.1.393). External: Claude Code hooks docs (`code.claude.com/docs/en/hooks.md`, fetched 2026-11-02), Claude Code 2.1.300 run as `squeal-e2e` (the host's own is 2.1.316), Codex source at tag `rust-v0.164.0` (`6aaac69`, the host's 0.164.0). Cezarion store copied with `VACUUM INTO` on 2026-11-03 and read from the copy. Probes: `probes/stop-wait/` (throwaway).

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Can a slow file be not current when the agent finishes under `stop.requireSlowSuite: true`? | Yes, in at least ten cases. The main ones: the bound passes (default 120 s, cap 600 s); any Stop after Squeal spoke at Stop (`stop_hook_active`, true for the rest of that turn, even after more edits); a slow file that is not run and not queued; Pi, OpenCode and an untrusted Codex hook (one hold, no wait); a Codex subagent (never checked). | read in source code; verified by experiment |
| 2 | Where do the bounds come from, and what does each harness allow? | 600000 ms is Squeal's own cap (`slow.maxDeferMs`'s default), and 630 s is the hook `timeout` that Squeal picked above it. Claude Code: no maximum in the docs; Stop hooks that ran 660 s (`timeout: 900`) and 1900 s (`timeout: 2400`) both blocked, and Claude Code acted on the block. Codex: no maximum in source. OpenCode and Pi run in process with no harness timeout; Squeal's own deadline there is 2 s. Repeated blocks: Claude Code ends the turn after 8 consecutive continuations (reset by a tool call); Codex has no cap. | read in official docs; read in source code; verified by experiment |
| 3 | How long does the slow tier take? | This repository declares no slow tier. Cezarion (90 browser files, one at a time): one file 11 s median, 39 s p90. A whole slow pass is 36 s median and 5.4 min p90 when gaps up to 30 s count as one pass; 5% of passes take more than 600 s. Passes of 45 or more files: 17.5 min median, 32 min p90, and 82% take more than 600 s. | verified by experiment (store copy) |
| 4 | Options to "require all" | (a) a higher cap; (b) holds repeated until all are current; (c) a hold that tells the agent to run `squeal run --slow --wait`; (d) Stop requests the slow tier explicitly before it waits. Each alone leaves gaps; (d) is the cheapest and closes three cases. | inferred, from the source and harness findings |
| 5 | Is the item already handled? | No. Today Stop *tries* once, within 2 to 10 minutes. It does not *require* every slow test. The smallest change is (d) and a higher cap. Whether the requirement must survive a second Stop is a decision for the human. | inferred |

## Findings

### 1. What exists, and when a slow file is still not current at the end

How Stop works today, per harness (*read in source code*, `src/harness/shared/stop.ts`, `stop-slow.ts`, `src/harness/*/`, `plugins/*/hooks/hooks.json`):

- **Claude Code and Codex.** Each has two Stop entries that run in parallel: `stop.mjs` (`timeout: 2`) and `stop-slow.mjs` (`timeout: 630`). The 2 s entry waits up to `stop.waitMs` (capped at 1500 ms) for fast checks only. It blocks for `blockOnKnownFailures`, `requireFullSuite`, complexity or lint. For `requireSlowSuite` it leaves slow files to the waiting entry, but only after that entry has recorded a `stop-wait` row for this registration and Squeal version (`stopWaitRuns`). If the 2 s entry ends the turn silently, it writes a handoff and nudges the daemon. The waiting entry waits up to 3 s for that handoff. It then polls every 250 ms until no slow file is "not current" (`slowFilesNotCurrent`: pending *or* not run) and the runner part is applied. It stops at `stop.slowWaitMs` (default 120000 ms, capped at `STOP_SLOW_WAIT_CAP_MS` = 600000 ms), or when the daemon has been down for 10 s. Its decisions: an untold slow failure gives one block; all current with no failure gives silence; at the bound, one block that names the files and `squeal run --slow --wait`.
- **`requireFullSuite`** never waits. It blocks at once when no full-suite checkpoint exists at the current revision, also with `stop_hook_active` false only.
- **OpenCode and Pi.** They have no waiting entry. `stopTurn` runs with `harness: "pi"`, so `stopWaitRuns` is never true. The 2 s entry blocks at once while a slow file is not current. Both ask Stop once per run: Pi's `agent_before_settle` and OpenCode's first `session.idle`. A continued run ends with `endTurn`/`endRun` and does not check again.

The cases in which an agent finishes under `requireSlowSuite: true` with a slow file not current:

| # | Case | Source | Evidence |
|---|---|---|---|
| C1 | The bound passes. A block names the files. The next Stop has `stop_hook_active`, and both entries return at once. | `stopSlow` first line; `decide` in `stop.ts` | verified by experiment: `cases.probe.ts` A, both harnesses. First Stop: block after 433 ms (bound 400). Second Stop: silent in 4 to 8 ms, file still not current. |
| C2 | The 2 s entry spoke: a delta with a fast failure, a block for another policy, or a block because the revision moved 3 times (`STOP_DECISIONS`). The waiting entry finds no handoff and stays silent. Every later Stop in that continued turn has `stop_hook_active`. | `handedOver`; `stopTurn` | verified by experiment: probe B. First Stop: the 2 s entry gave news, the waiting entry was silent after 3005 ms. Second Stop: silent, file not current. |
| C3 | `stop_hook_active` stays true after the continued turn runs tools, so edits made after a hold are never held for slow files. | Codex `session/turn.rs:444,758`: set once, never reset in the turn | verified by experiment (Claude Code 2.1.300, `cc-active-*.sh`: Stop 1 blocked, the agent ran Bash, Stop 2 had `"stop_hook_active":true`); read in source code (Codex) |
| C4 | A slow file that is not run and not queued: a `lookup-only` miss, a file `unknown` after repeated discards (`ledger.ts`), or a file with no key. Nothing runs it, because the nudge only pumps pending work. The wait uses the whole bound, then blocks once. | `classifySlowFiles` (`notRun`), `nudgeSlow` | verified by experiment: probe C, both harnesses. Block after 426 ms at a 400 ms bound. |
| C5 | Load guard. A slow tier started by a pause is not an explicit request. Above `slow.maxLoadPerCpu` (1.0) it waits up to `slow.maxDeferMs` (600 s) per pass. This uses up the whole Stop bound. The load was 27 on 24 CPUs while this was written. | `slow-tier.ts` `#waitForCapacity`, `#skipGuard` (only `run --slow`) | read in source code; `slow-claims.md` 4 in spec 001 |
| C6 | Slot or backlog. Another worktree holds every slow permit (no bound; the time does not count against `maxDeferMs`), or this daemon's fast backlog (baseline, `run --all`) is queued. | 004 D2, D3 | read in spec and source code |
| C7 | Pi, OpenCode, or a Codex user who has not trusted `stop-slow`: one immediate hold, no wait. Then the continued turn ends. | `bridge-turn.ts` `stop`, `pi/run.ts` `settle` | read in source code |
| C8 | SubagentStop. Claude Code: the 2 s entry blocks once, with no wait. Codex: `subagentStop` only unregisters and never checks slow files. This contradicts 004 D7 ("a SubagentStop blocks"). | `codex/handlers.ts` `subagentStop` | verified by experiment: probe D. Claude Code `block`, Codex silent, file not current in both. |
| C9 | A main agent whose worktree had no revision since it registered (004-67, on purpose). This includes an edit still inside the 500 ms debounce. | `no-edit.ts` | read in source code and spec |
| C10 | No Stop at all: an interrupt (Codex's `interrupt` handler says "no Stop follows an interrupt"), or a killed session. The exit drain (004-29) runs the files later, but the results reach only the next session. | `codex/handlers.ts` `interrupt`; 004 D9 | read in source code; Claude Code interrupt not determined, because the fetched docs do not say if Stop fires after Esc |

C2 and C3 together are the largest gap. Under `requireSlowSuite`, *any* Squeal speech at Stop turns the slow requirement off for the rest of the turn. That speech can be a new fast failure, a known-failure block or the slow bound itself. *inferred from C1 to C3.*

### 2. The bounds

- **Squeal's numbers.** `STOP_SLOW_WAIT_CAP_MS = 600_000` is "10 minutes, `slow.maxDeferMs`'s default, below the waiting entry's hook timeout". `STOP_SLOW_HOOK_TIMEOUT_S = 630` is "above `STOP_SLOW_WAIT_CAP_MS` plus the handoff, so the bound, not the harness, ends the wait" (`src/core/slow/stop-wait.ts`, `src/harness/shared/stop-slow.ts`). So no harness forced either number. *read in source code.*
- **Claude Code.** The docs say `timeout` is "Seconds before canceling", with a default of 600 for `command` and no maximum given. A hook that reaches its timeout is cancelled "discarding the hook's output, so on most events a timed-out hook renders no decision". The `stop_hook_active` field "is `true` when Claude Code is already continuing as a result of a stop hook". "Claude Code applies an 8-consecutive-continuation cap … The count of consecutive continuations resets each time Claude calls a tool", and `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` changes it. *read in official docs (fetched 2026-11-02).* The waiter already runs with `timeout: 3600` on `asyncRewake` (`plugins/claude-code/hooks/hooks.json`). Probe `a`: a Stop hook with `timeout: 900` slept 660 s, then blocked. Claude Code waited (session 663.7 s), fed the block back (`num_turns` 2, result `PINEAPPLE`), and called Stop again with `stop_hook_active: true`. *verified by experiment (2.1.300, `-p`, haiku).* Probe `b`: a Stop hook with `timeout: 2400` slept 1900 s, then blocked. The session took 1906.9 s, `num_turns` was 2, the result was `PINEAPPLE`, and the next Stop had `stop_hook_active: true`. *verified by experiment (2.1.300, `-p`, haiku).* So Claude Code honours a Stop hook of at least 31.7 minutes. The upper limit was not probed.
- **Codex.** `normalize_command_hook`: SessionEnd and Interrupt are clamped to 1..3 s, and "all other hooks" get `timeout_sec.unwrap_or(600).max(1)`, with no upper bound (`hooks/src/engine/discovery.rs:839-862`). Stop blocks loop with no cap: `stop_hook_active = true; continue;` (`core/src/session/turn.rs:758`). The hook's trust hash covers the normalized handler, including `timeout_sec` (`discovery.rs:600-606, 874-891`). So a new timeout makes users trust `stop-slow` again, and until they do, Squeal falls back to the 2 s block (C7). *read in source code (0.164.0).*
- **OpenCode and Pi.** `Plugin.trigger` "awaits plugins sequentially without a timeout" (`../../008-opencode-adapter/research/opencode-plugins.md`, OpenCode 1.18.35). Pi's handlers "are awaited in series, with no timeout" (`../../009-pi-adapter/research/pi-extension-events.md`, Pi 1.0.4). Squeal sets its own deadline: `SETTLE_DEADLINE_MS` and `IDLE_DEADLINE_MS`, both 2000 ms. A long wait there would freeze the run (Pi) or delay the continuation (OpenCode). *read in source code; prior research.*

### 3. How long the slow tier takes

This repository has no slow tier: `squeal.config.json` excludes `test/e2e/**` and declares no `slow.include`. Spec 001's `slow-claims.md` 4 measured its `test/e2e` as if slow: tiers of 4 files took 63 s median, 106 s p90 and 292 s max. *verified by experiment there.*

Cezarion declares 90 files `packages/web/e2e/*.e2e.ts` with `slow.maxParallel: 1` and `maxWorkers: 1`, and `requireSlowSuite: false`. `store-durations.mjs` on the copy: 15088 slow runs (of 43516 runs from 462 worktrees), 2026-10-14 to 2026-11-02. Each run held one file, and all completed:

| Measure | n | Median | p90 | Max | > 120 s | > 600 s |
|---|---|---|---|---|---|---|
| One slow run (wall) | 15088 | 11.1 s | 39.3 s | 357 s | 242 | 0 |
| Pass, gap ≤ 30 s | 2500 | 35.7 s | 323 s | 2271 s | 547 | 125 (5%) |
| Pass, gap ≤ 120 s | 978 | 172 s | 1294 s | 3208 s | 553 | 215 (22%) |
| Pass of ≥ 45 files, gap ≤ 30 s | 91 | 1053 s | 1903 s | 2271 s | 91 | 75 (82%) |

A "pass" is consecutive slow runs in one worktree. Its wall time excludes the guard, slot and backlog waits (C5, C6), which the store does not record. The share over 600 s depends on the gap rule: 5% at a 30 s gap, 22% at a 120 s gap. *verified by experiment (store copy).* An edit to any web source re-keys all of the browser specs (`../../004-slow-suites/research/slow-tier-role.md`). So under `requireSlowSuite`, a web edit in cezarion would need a full pass of about 17 to 32 minutes, beyond any bound that exists today. *inferred.*

### 4. Options to "require all"

| Option | What the agent and human see | Closes | Leaves, and failure modes |
|---|---|---|---|
| (a) Raise the cap, for example to 3540 s with `timeout: 3600` (the waiter's value) | One longer silent Stop. The human waits with the turn open and can interrupt. | C1 for most passes | Codex users trust the hook again (C7 until they do). C2 to C10 stay. A hung file is bounded by `runner.timeoutMs`. A dead daemon ends the wait after 10 s. The guard still uses up to 600 s of it. |
| (b) Hold again on `stop_hook_active` while files are pending, with a loop guard (for example: only while a slow file became current or is running since the last hold, at most N) | Each hold is a model turn, and the agent usually runs `run --slow --wait`. Claude Code ends the turn after 8 blocks with no tool call; Codex has no cap. | C1 to C3 | A guard Squeal must own on Codex. A dead daemon or a file that never runs (C4) loops until the guard. Each hold costs tokens and reads as Stop feedback. |
| (c) The bound's block tells the agent to run `squeal run --slow --wait` with no deadline. It does this already, with a deadline. | The agent waits in a Bash call. That call is bounded by the Bash tool's own timeout, a maximum the docs link to but this research did not fetch. | Queues C4 files; skips the guard and the backlog (explicit trigger) | Depends on the agent doing it once. After it, the next Stop is still `stop_hook_active` (C3). |
| (d) Before it waits, the waiting entry sends the explicit `run-slow` request instead of only the idle nudge | No change in wording. The wait is shorter. | C4 (`queueSlowSuite` queues every keyed slow file not current and clears `unknownKey`), C5 and C6-backlog (`#skipGuard`, `#fastFirst`) | Not the slot (C6), C1 to C3, or C7 to C10. It runs slow files at a pause that a `"idle"`/`"continuous"` policy would also run, but under load and beside a backlog. That is the price, and it is opt-in through `requireSlowSuite`. |

*inferred, from findings 1 to 3 and `scheduler.ts` `requestSlowSuite`, `slow-tier.ts` `queueSlowSuite`, `#skipGuard`.*

## Recommendation

1. **Not handled today.** `stop.requireSlowSuite` gives one bounded attempt (120 s default, 600 s at most), not a requirement. Cezarion's whole slow tier takes about 17 to 32 minutes, and any Squeal speech at Stop switches the slow requirement off for the rest of the turn.
2. **Smallest change for the waiting entry: option (d).** One socket request: the waiting entry sends `run-slow` instead of relying on the idle nudge. This closes the not-run, guard and backlog cases with no harness change and no new key.
3. **Then option (a), if the human wants a full tier at Stop.** Raise `STOP_SLOW_WAIT_CAP_MS` and the `stop-slow` hook `timeout` in both hooks.json files, and keep the default `stop.slowWaitMs`. Claude Code accepts at least 1900 s (verified). Codex has no limit, at the cost of one re-trust.
4. **Decision for the human, not a mechanism choice.** Must "require" survive a second Stop (C2, C3)? If yes, only (b) does it, and it needs a Squeal-side loop guard because Codex has none. If no, write in 004 D9 and in the primer that the requirement holds for one Stop per turn.
5. **Out of reach for a small change.** Pi and OpenCode would need a waiting entry inside a 2 s handler. Codex SubagentStop (C8) is a gap against 004 D7 by itself, and a coordinator should decide whether D7 or the Codex handler is wrong.

## Open questions for the human

- Should the slow requirement hold on every Stop of a turn (C2, C3: repeated holds, model turns, a loop guard), or on the first Stop only?
- For a project like cezarion, is a 20 to 30 minute Stop acceptable, or does "require all" apply only to smaller slow tiers?
- Does a Claude Code Stop fire after an interrupt (Esc)? This was not determined: the fetched docs do not say, and it was not probed.
- The largest Stop hook timeout Claude Code accepts. It was not determined, because the docs give none and the probes went up to 1900 s only.

## Sources

- Squeal `6c5615a55`: `src/harness/shared/stop.ts`, `stop-slow.ts`, `no-edit.ts`; `src/core/slow/stop-wait.ts`; `src/core/state/slow.ts`; `src/core/scheduler/slow-tier.ts`, `scheduler.ts`; `src/harness/claude-code/hooks/stop*.ts`; `src/harness/codex/handlers.ts`; `src/harness/opencode/bridge-turn.ts`, `hooks.ts`; `src/harness/pi/run.ts`, `extension.ts`; `plugins/claude-code/hooks/hooks.json`, `plugins/codex/hooks/hooks.json`; spec 004 D2, D3, D7 to D9.
- Claude Code hooks reference, https://code.claude.com/docs/en/hooks.md, fetched 2026-11-02: "Common fields", "Timeouts", "Stop" input and the 8-continuation cap.
- Codex `rust-v0.164.0` (`6aaac694`): https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/hooks/src/engine/discovery.rs, `codex-rs/core/src/session/turn.rs`, `codex-rs/hooks/src/events/stop.rs`.
- Prior research: `../../001-core-loop/research/slow-claims.md`, `../../002-codex-adapter/research/codex-hooks.md`, `../../004-slow-suites/research/slow-tier-role.md`, `../../008-opencode-adapter/research/opencode-plugins.md`, `../../009-pi-adapter/research/pi-extension-events.md`.
- Probes (`probes/stop-wait/`): `cases.probe.ts` with `vitest.probe.config.ts` (cases A to D, run 2026-11-03 with `pnpm exec vitest run --config …`, 7 passed); `cc-timeout-*.sh` (probes `a`, `b`); `cc-active-*.sh` (probe `c`); `store-durations.mjs` (cezarion store copy, cezarion at `e03d62149`).
