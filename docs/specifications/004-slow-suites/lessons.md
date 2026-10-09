# 004 Slow suites: lessons

## Dogfooding on this repository and on cezarion

Task 004-17, 2026-10-09, 06:10 to 07:40 UTC. Real Codex agents worked in two worktrees with slow files declared: this repository (`test/e2e`, Vitest, over the committed `plugins/**`) and cezarion (`test:package`, node:test, over `packages/cezar/dist`). The agent was Codex CLI 0.160.1 with `gpt-6.1-sol`. Its hooks were trusted in the real `~/.codex` and no bypass flag was used. One session ran under `codex exec`. The rest ran in the interactive TUI inside `tmux`, because a `codex exec` session ends with its turn and the daemon then exits (defect 1). Node 24.21.0 only. Load was 0.1 to 3.5 per CPU on 24 CPUs; it was mostly 0.4 to 2. Scripts, prompts and trimmed logs: `research/probes/dogfood/`. Its README lists the rules followed and every source.

The Squeal plugin changed under the run. The Codex marketplace auto-updates from `main`. It replaced 0.1.56 with 0.1.57 at about 06:37 (status calls through 0.1.56's path failed from 06:37:53), 0.1.58 at 06:52:02 and 0.1.59 at 07:31:19, each time deleting the old version's directory. Every observation below names the daemon version that made it: each poll line logs the daemon's pid and version. Version boundaries:

| Version | Daemons | Observations |
| --- | --- | --- |
| 0.1.56 | squeal worktree to 06:47:51, cezarion to about 06:53 | sq1, sq2 first turn, squeal slow tier at r1 and r12, cezarion's default baseline |
| 0.1.57 | squeal 06:49:52 to 07:18:54 | sq2 second turn (sq3), squeal slow tier at r13 |
| 0.1.58 | cezarion from 07:00:55, squeal from 07:18:56 | cz2, cz3, cezarion `run --slow`, both second worktrees, squeal's last run |

0.1.59 carries 001-153, the fix for defect 5. It installed at 07:31:19, after the last observation; no daemon here ran it.

All five worktrees are removed: the two dogfood worktrees, this repository's second worktree, and cezarion's B and C. The shared stores still hold their rows and run logs. This repository's `.git/squeal/` holds worktree `4a1e2fec7c9b9e8f` (`/tmp/squeal-dogfood-004-6191defd`) and `526823fabe3abf1c` (`/tmp/squeal-dogfood-004-6191defd-b`). Cezar's `/home/agent/projects/cezar/.git/squeal/` holds `7be860c111f6af60` (`/tmp/squeal-dogfood-cezarion-004-6191defd`), `18338f2b4ea0a0c8` (`-b`) and `096f48b72dfb1fcb` (`-c`). That includes the `slow-tier:`, `slow-artifacts:` and `failure-keys:` meta rows. Nothing there was deleted.

### Verdict

| Goal | Verdict | Evidence |
| --- | --- | --- |
| 1. An edit never waits behind a slow file | held where exercised (this repository) | sq1 (0.1.56): the deliberate edit at r2 (06:24:41) re-keyed 7 current slow files to pending. Eight fast tiers of r2 ran from 06:24:41.8 to 06:25:14.9, and no slow file ran during the turn. The next edit's direct test ran in a 4.1 s tier and recorded 5 failures at 06:25:18.9. They reached the agent 2.7 s later. Cezarion: not exercised, because no daemon was validating during cz1 and cz2 (defects 5 and 6). |
| 2. Slow files run after the fast tier drains, on idle, `run --slow` or `run --all`; one slow tier per user, low priority, preempted between files | partly | Idle, TUI: after sq2's turn (06:34:13), the fast backlog drained by about 06:36:30, the guard waited 4 min 45 s, and 10 files ran 06:41:18 to 06:47:27. Never during a turn: sq1 read "waiting for the agent to pause" from 06:25:20 until the session ended. Never under `codex exec`: the daemon exits 3 s after the session (defect 1). `run --slow`: cezarion 07:01:50, first file at 07:07:14, behind the slot and the guard. The agent's own `run --slow` in cz3 ran its file within about 10 s. One tier per user held: squeal's and cezarion's slow runs never overlapped. But the slot was not handed over file by file (defect 2). The default baseline kept cezarion's slow tier ineligible for the whole session (defect 3). Low priority held: the slow lane's Vitest worker ran at nice 10, `ionice` class idle (pid 3514195 at 07:24:23, 0.1.58, `logs/sq.slow-priority.txt`). Preemption between files by a fast revision: not exercised, since no edit landed while a slow tier ran. |
| 3. A slow file re-runs when its keyed inputs change; a change during the run discards it | re-run held; discard not exercised | This repository: sq1's `npm run build` (r5 to r7) moved 10 current files to pending, and sq2's rebuild re-ran all 10 at r12. Cezarion: cz2's rebuild changed `dist`, and the 0.1.58 daemon found all 13 not run at r1. No edit landed during a slow run. |
| 4. A slow failure reaches the agent with its revision and artifact; Stop never waits | held (Codex) | This repository, 0.1.56 then 0.1.57: `policy.test.ts` failed at 06:43:13.5 (r12). It was delivered with the next prompt at 06:47:40.7, 1.2 s after the prompt was submitted. Cezarion, 0.1.58: `package-cli.test.ts` failed at 07:12:39.9 and was delivered with the next prompt at 07:13:46.1, 1.2 s after submission. Both carried "slow tier, Squeal's run saw it at revision N, against <declared globs> as of revision N". The agents quoted it back. Stop never waited: sq1's `codex exec` returned 0.5 s after its last message with 10 slow files pending. The Claude Code idle waiter was not exercised. |
| 5. A slow result is inherited only when its key holds the artifact | this repository: held; cezarion: never inherited, and its keys could inherit across builds | This repository's B (07:30:59): `origin/main` plus A's whole diff, so `plugins/**` byte-identical, same config, 0.1.58 from the installed path like A's daemon. Ready in 3.6 s, it inherited 2,329 current results, all 10 slow files among them (57 checks, origin `4a1e2fec7c9b9e8f`), and ran none. Cezarion's B: same commit and config, byte-identical `packages/cezar/dist` (750 files), 0.1.58 from the same path. It inherited none of A's 13 slow results, because their keys differ. C, with a different `dist`, got the same key as B at start (defect 7). |
| 6. Status and headers state the slow tier honestly | held, four wording defects | Every state D8 names was seen and matched the store (table below). Defect 8: "sources changed since" after an edit to a slow test file only, "current ... as of revision 1" after a slow file ran at revision 2, the text dropped the slot reason while the JSON kept it, and "sources changed since" in a fresh worktree whose start scan lists every file as new. |
| 7. Under pressure a slow file waits up to a bound, then runs with a note | held; the bound was never reached | Eight deferrals, 75 s to 4 min 45 s each, at load 1.0 to 2.9 per CPU. Every deferred file ran; none was skipped. No deferral reached `maxDeferMs`, so the "ran under load" note never appeared. |
| 8. Squeal never builds | held | Every rebuild was the agent's `npm run build`. Squeal ran against what was on disk and said "sources changed since" when `src` moved without a rebuild (sq1, r3). |

Defects 1 to 3 decide whether a slow tier runs at all in real use. Codex `exec` sessions never idle. A large repository's default baseline never drains in a session. And the plugin auto-updates re-key everything several times an hour (defect 4). Defects 5 and 6 left cezarion without a validating daemon for 9.5 minutes. In that window the agent ran node:test itself three times and its Vitest unit file once, "because Squeal had no validating daemon". No stale slow pass was seen. Defect 7 could give one: two cezarion worktrees with different builds computed the same slow-file key.

### Open questions 1 and 2, with data

**1. Defaults.** Slow files ran with `slow.maxWorkers` 2, `slow.maxLoadPerCpu` 1.0 and `slow.maxDeferMs` 600000, at load 0.3 to 1.2 per CPU (the 1-minute average at the nearest poll; the guard admits a file at 1.0 or below), on Squeal 0.1.56 (r1, r12), 0.1.57 and 0.1.58 (both r13). `logs/sq.slow-runs.txt`, `logs/cz.slow-runs.txt`.

| File | Runs (s) | Load per CPU at start |
| --- | --- | --- |
| this repository, `policy.test.ts` | 60.3, 57.2, 66.0, 56.4 | 0.71, 0.80, 0.72, 0.56 |
| `slow-vitest.test.ts` | 86.8, 48.1, 47.2, 44.9 | 0.37, 0.41, 0.66, 0.92 |
| `lifecycle.test.ts` | 38.4, 41.1, 36.8, 61.6 | 0.94, 0.80, 0.75, 0.47 |
| `worktrees.test.ts` | 26.8, 84.5, 29.4 | 0.93, 0.48, 0.30 |
| `transitions.test.ts` | 39.5, 12.2, 13.5 | 1.22, 0.92, 0.84 |
| `slow-node-test.test.ts` | 25.6, 22.8, 23.3, 23.9 | 0.42, 0.57, 0.62, 0.61 |
| `node-test.test.ts` | 16.6, 16.5, 14.4, 15.8 | 0.76, 0.80, 0.76, 0.71 |
| `shipped-plugin.test.ts` | 8.1, 8.5, 7.2, 9.3 | 0.42, 0.57, 0.88, 0.89 |
| `plugin-copy`, `torn-status` | 0.2 to 0.5 | |
| cezarion, `application-update.test.ts` | 201.2 | 0.5, rising to 2.8 during the run |
| `task-cli.test.ts`, `delegation.test.ts`, `package-cli.test.ts` | 22.1, 16.2, 12.4 and 20.3 | 0.2 to 0.6 |
| the other nine `test:package` files | 0.4 to 11.9 | 0.3 to 0.8 |

The whole tier, run time only: this repository 261 s at r12 and 256 s at r13 under 0.1.58 (10 files), cezarion 299 s (13 files). Research measured 60 to 70 s for this repository's `test/e2e` at default parallelism and 63 s for cezarion's `test:package`. So `maxWorkers` 2 with `nice` costs about 4x wall time per tier here; that is the price of not competing. `application-update.test.ts` took 201 s against 36 to 48 s in 003-19, while the host's load rose from 0.5 to 2.8 per CPU under it.

The guard deferred eight times that ended in a run: in this repository 89 s, 4 min 45 s, 1 min 45 s, about 1 min 46 s, 1 min 46 s, 2 min 15 s and one of unknown start that ended at 07:24:10; in cezarion 75 s. Cezarion's first wait overlapped its slot wait. Load per CPU was 1.0 to 2.9 while it waited. It never reached 600 s. That was because load fell during the run, from 2.9 to 3.5 per CPU at 06:14 to 0.1 to 1 after 07:00. At the start-of-run load (70 to 85 on 24 CPUs), a 1.0 threshold would defer every slow tier to the 10-minute bound.

Recommendation, from these numbers: keep `maxLoadPerCpu` 1.0 and `maxDeferMs` 600000. The bound, not the threshold, makes the guard safe on this host, and the deferrals seen cost 1 to 5 minutes. Keep `maxWorkers` 2. No calm-load comparison with higher values was run; that needs a probe on a quiet host.

**2. The idle trigger and the agent's turns.** One consumer per worktree throughout, so "every or any consumer idle" was not exercised.
- In a TUI session, the slow tier started only after the turn ended and the fast backlog drained. sq2: turn end 06:34:13, first slow file 06:41:18 (the guard's 4 min 45 s inside). sq3: turn end 06:50:04, first slow file 06:58:04, after a 0.1.57 re-key and its fast re-run.
- During a turn, the line read "waiting for the agent to pause" and nothing ran (sq1, 06:25:20 to 06:30:37).
- No turn began while a slow file ran, so a turn interrupting a slow tier was not observed. Each slow tier finished before my next prompt: 12 s, 12 min and 13 s before it.
- `codex exec` never idles. The turn ends with the session, and the daemon exits 3 s later (defect 1). A Codex agent that works through `exec`, or `claude -p`, gets slow results only from `run --slow` or `run --all`.
- Proposed answer stands: a consumer in a turn blocks the slow tier. Add that a daemon whose last consumer left with slow files pending should run them before it exits (defect 1).

### Setup

| Item | This repository | Cezarion |
| --- | --- | --- |
| Worktree | `git worktree add --detach /tmp/squeal-dogfood-004-6191defd origin/main` (`6b42c98`), `npm ci` and `npm run build` (6.2 s; the build reproduced the committed `dist`, `git status` clean) | `git -C /home/agent/projects/cezar worktree add --detach /tmp/squeal-dogfood-cezarion-004-6191defd HEAD` (`c07b0bfc`), `npm ci` (25.9 s) and `npm run build` (21.7 s) |
| Config, uncommitted | the committed `squeal.config.json` (its `inputs` key `test/e2e/*.test.ts` by `plugins/claude-code/**`, `plugins/codex/**` and fixtures) plus `"slow": { "include": ["test/e2e/**/*.test.ts"] }` (`logs/squeal.config.squeal.diff`) | `squeal init --harness codex` (0.1.56) seeded `test:unit` and `test:package`; then `test:package` `slow: true` and `inputs` `{"packages/cezar/test/e2e/**": ["packages/cezar/dist/**"]}`; from 06:54:26 `baseline.onStart` `lookup-only` (coordinator decision, defect 3) (`logs/squeal.config.cezarion*.json`) |
| Slow files | 10 | 13 |
| Start to ready | 15.9 s (0.1.56, load 69) | first start died at +13 s: "could not start: database is locked" (defect 9); second start 27.0 s (load 11) |
| Daemon RSS at ready | 563 MiB | 890 MiB |
| `squeal init` | not run (config committed) | 003's defect 7 is closed: the refused root chain gets the template name `root:test:unit` |
| 003 defect 6 | | closed: a note names the three `test:unit` files that load nothing but themselves and a manifest |

### Sessions and probes

This repository. sq1 ran under `codex exec`; sq2, sq3 and sq4 were turns of one TUI session.

| When | What | Slow tier | Reached the agent |
| --- | --- | --- | --- |
| 06:14 to 06:24 | daemon start, no consumer (0.1.56) | fast baseline drained at 06:18:40; guard waited 89 s; 7 of 10 files ran at r1 06:20:10 to 06:24:07 as part of the start checkpoint | n/a |
| sq1 06:24:20 to 06:30:37 | deliberate break of `durationText` (r2), revert and feature (r3, r4), `npm run build` (r5 to r7), full `npx vitest run` | r2 moved 7 current files to 10 pending ("waiting for host load to drop", then "waiting for the agent to pause"). r3: 7 current again with "sources changed since". The build at r5 to r7 re-keyed all 10. Nothing ran in the turn. | r3: 5 first-seen failures of the new test, 2.7 s after recording. r7: 7 recoveries. The r2 break never reached it: no tier ran `slow-tier.test.ts` before the revert 30 s later, because the first r2 tier was a known failure (`step-down.test.ts`, 21.6 s), which 001 D5 orders first. |
| after sq1 | `codex exec` ended 06:30:37.2 | daemon stopped 06:30:40.2 "no session registered for 3 s after its last one ended"; 10 slow files pending and never run (defect 1) | n/a |
| sq2 06:32:21 to 06:34:13 | denial text changed in `src`, unit tests, `npm run build`; told not to touch `test/e2e` | after the turn: fast drained, guard 4 min 45 s, 10 files 06:41:18 to 06:47:27 (one more 1 min 45 s load wait). `policy.test.ts` PASS to FAIL at 06:43:13.5, r12 | with the next prompt, 06:47:40.7 |
| 06:37 | plugin 0.1.57 installed, 0.1.56 removed | the 0.1.56 daemon kept serving from the deleted directory; its slow lane created its Vitest instance and ran 10 files after the removal | |
| sq3 06:47:39 to 06:50:04 | allowed to fix `test/e2e`; edited `policy.test.ts`, ran it itself (91.5 s) | 0.1.57 hook stepped the daemon down at 06:47:51.5; no daemon served until 06:49:52.5 (defect 5). Under 0.1.57, every check and all 10 slow files re-ran at r13 (defect 4): slow 06:58:04 to 07:06:27 | "no daemon is validating at revision 12" at 06:47:58. The agent ran the e2e file itself because "Squeal's daemon was inactive". |
| sq4 07:18:41 | asked only for feedback | 0.1.58 stepped 0.1.57 down at 07:18:54; a 0.1.58 daemon served at 07:18:56 with 2,324 checks queued, all 10 slow files pending (defect 4) | with the prompt, 07:18:43.3: `policy.test.ts` FAIL to PASS ×2, "slow tier ... current ... as of revision 13", plus 14 fast PASS to FAIL from load-sensitive daemon tests (below) |

Cezarion. One TUI session, three turns.

| When | What | Slow tier | Reached the agent |
| --- | --- | --- | --- |
| 06:22:42 to 06:51 | daemon start, no consumer, default baseline (0.1.56) | 13 pending throughout; a 200-file Vitest backlog tier was in flight from 06:23:03 until the step-down; 4,482 checks passed (defect 3) | n/a |
| cz1 06:51:27 to 06:52:40 | 003's `todoTaskText` task (break, fix, two fixtures) | 0.1.57's SessionStart stepped the 0.1.56 daemon down at 06:51:28.9; it finished its tier and left; no daemon served until 07:00:55 (defects 5, 6) | "no daemon is validating at revision 0" at 06:51:41; then 11 "Hook failed: hook exited with code 1" (defect 6). The agent ran `node --test` itself three times. |
| cz2 06:54:32 to 06:55 | disabled-provider message changed in `src`, unit test, package rebuilt; told not to touch e2e | two 0.1.58 daemons, one from a hook and one from my `squeal start`, lived 16 to 20 s (unexplained, below) | "Returned without a daemon". The agent ran the Vitest unit file itself "because Squeal wasn't validating". |
| 07:00:55 | I started a 0.1.58 daemon detached; config now `lookup-only` | r1: "13 not run at revision 1" | |
| 07:01:50 | `squeal run --slow` (once, by me) | "13 slow files queued". Waited for the slot held by this repository's r13 tier, then load. Files 07:07:14 to 07:13:31. `package-cli.test.ts` FAIL at 07:12:39.9 | |
| cz3 07:13:44 to 07:14:44 | allowed to fix e2e | the agent edited `package-cli.test.ts` (r2) and ran `squeal run --slow` itself: "1 slow file queued"; it ran 07:14:00 to 07:14:20 | the failure with the prompt at 07:13:46.1; FAIL to PASS at the next PostToolUse, 07:14:21.4, 1.1 s after recording. The agent ran no test itself: "I requested Squeal's slow-tier run and waited for its result because its daemon is now running." |
| 07:14 to 07:16 | second worktrees B (A's source diff, `dist` byte-identical) and C (HEAD, `dist` differs), A's config, 0.1.58 | neither inherited a slow result (defect 7) | n/a |

### What the agents did about e2e

- sq1 ran the whole Vitest suite itself (`npx vitest run`, 268 files, `test/e2e` included, 2,057 passed, 1 failed), because the repository's `AGENTS.md` lists it in the verification gate. It cited Squeal's run for the new test's red and green. Its own run had one failure, `test/daemon/slow-lane.test.ts` (an empty lane marker, then a hook timeout), which it reported as separate.
- sq2 ran `npx vitest run test/harness` itself, citing the same gate. It did not touch e2e.
- sq3 ran `npx vitest run test/e2e/policy.test.ts` (91.5 s) itself, because the step-down left no daemon (defect 5).
- cz1 and cz2 ran node:test and the Vitest unit file themselves while no daemon served (defects 5, 6). Neither ran e2e.
- cz3 ran no test. It asked for `squeal run --slow` and waited with `status --wait`, which returned on the FAIL to PASS after 15.2 s.

So the agents used Squeal for e2e whenever a daemon was validating and the repository's own gate did not require a full run.

### The slow-tier line, as seen against the truth (goal 6)

| State shown | Seen | True? |
| --- | --- | --- |
| "no slow test files listed yet; not covered by Stop's wait." | first 3 to 5 s after each start | yes |
| "N pending" | while fast work was queued | yes |
| "N pending, waiting for host load to drop" | at each deferral, and in sq1's turn before "waiting for the agent to pause" | yes; load per CPU 1.0 to 2.9 at the poll |
| "N pending, waiting for the agent to pause" | sq1 during its turn | yes |
| "N pending, waiting for the slow slot another worktree's slow tier holds" | cezarion 07:01:51 and 07:07:13 | yes; this repository's tier ran then. Between, the text dropped the reason while the JSON kept `waiting: slot` (defect 8). |
| "running <file> since HH:MM (no earlier run / last run N s)" | every slow run | yes; HH:MM is local time (UTC+2 here) |
| "N current against <globs> as of revision R" | after each tier | yes, except after cz3 (defect 8) |
| ", sources changed since" | sq1 r3 (src changed, no rebuild): true. cezarion r2 (only a slow test file changed): misleading (defect 8) | |
| "N not run at revision R" | cezarion after the bump, B and C | yes |
| without a daemon: "N pending" with no reason | after sq1 | yes; the daemon line says none runs |

### Load guard and slot (goal 7, D2)

- Guard: deferrals listed under open question 1. Every one ended when load per CPU fell below 1.0, never at the bound.
- Slot: the lock lives at `/run/user/1001/squeal/slow.lock` (`XDG_RUNTIME_DIR` set, as 004-16 made it), not `/tmp/squeal-1001/`. The two dogfood daemons shared it and never ran slow files at once. Cezarion's `run --slow` waited 5 min 24 s for it (defect 2).
- Fast tiers beside the slow lane: at r13 (0.1.57, load 0.5 to 2 per CPU) 14 fast checks went PASS to FAIL: nine `test/daemon/lifecycle.test.ts` waits ("daemon ready not met in 60000 ms"), `graph-cost.test.ts` (267.9 ms against 258.7 ms), three scheduler backlog tests and `scheduler/ordering.test.ts`. They ran in fast tiers that partly overlapped slow files. Whether the slow lane caused them was not isolated. The agent received them as 14 PASS to FAIL beside its own recovery.

### Defects

Numbered from 1 for this spec.

1. **Under `codex exec`, the daemon exits 3 s after the session ends, so slow files pending at the end of a session never run.** Core daemon (001 D10 "its last session is gone") against 004 D2 trigger (a). sq1 ended 06:30:37.2 with 10 slow files pending since 06:25:39, shown as "waiting for the agent to pause". The note at 06:30:40.2 reads "daemon stopped: no session registered for 3 s after its last one ended". A `codex exec` or `claude -p` session's turn ends with the session, so the idle trigger never fires for such agents; their next session is in a turn from its first hook. D9 says the failure "arrives with the next prompt or tool call"; for `exec` it never runs. Fix direction: a daemon whose consumers are all gone, with slow files pending, counts as "no consumer registered" (D2's own idle case) and drains the slow tier before it exits, bounded by `daemon.idleExitMinutes`.
2. **The slow slot is not handed over between files, so another worktree's slow tier waits for the holder's whole tier.** Slot (004 D2: "released between files, so two worktrees' slow tiers interleave file by file"). Cezarion asked `run --slow` at 07:01:50 and showed "waiting for the slow slot another worktree's slow tier holds". This repository's r13 tier then ran four files: `worktrees.test.ts` (in flight, to 07:03:05), then, after a load wait, three back to back from 07:04:51 to 07:06:27. Cezarion's first file started at 07:07:14, 47 s after that tier drained. Through this repository's own load wait (07:03:05 to 07:04:51), cezarion's published reason stayed `waiting: slot` (JSON at 07:03:42 to 07:07:13), so the slot was held or re-taken across the holder's wait too. A daemon that misses the slot "retries on the next scheduling pass", and the holder re-takes it at once. Fix direction: a waiter's mark in the slot directory that the holder honours by skipping one turn.
3. **With the default baseline, cezarion's slow tier never became eligible in a session-length run.** Scheduler, D2 ("eligible only when the fast tier has nothing pending"). Under 0.1.56, the default `baseline.onStart` (`lookup-then-run-missing`) ran from 06:23:03 to 06:51. No result was inherited, since a fresh `npm ci` re-keys (001's measurement). At the step-down a 200-file Vitest backlog tier was still in flight, 4,482 checks had passed, and all 13 slow files were still pending. 003-19 measured cezarion's whole baseline at 51.5 min. With `lookup-only` (coordinator decision, 2026-10-09) the slow tier ran. Fix direction, a product decision: let the slow tier take its turn when the only fast work pending is the second group (baseline, environment, `run --all`), not edit-caused work, or bound the wait.
4. **Every plugin version bump re-keys every check, slow files included, and restarts the baseline.** Keys, 001 D3. The environment hash holds the daemon's Squeal version: `squealVersion` in `src/core/keys/environment.ts:56`, from `this.#version` at `src/core/daemon/daemon.ts:253`. The adapter versions are separate constants (Vitest `"2"`, node:test `"9"`) and did not change. Measured at the 0.1.58 step-down: at 07:18:56 this repository had 2,305 current; at 07:18:58, `pass=0 queued=2324` and all 10 slow files pending. Revision 13 had changed only `test/e2e/policy.test.ts`. Cezarion's header after its bump read "4485 stale". The marketplace installed 0.1.57 and 0.1.58 within 15 minutes, and each bump re-runs the fast suite (about 4 min here, about 50 min in cezarion) and every slow file (about 4 to 6 min), in every worktree that steps down.
5. **A step-down left the worktree without a serving daemon for 2 min 1 s, because its two successors deadlocked on the lock.** Core daemon, 001 D10. Fixed by 001-153 in 0.1.59 (`src/core/daemon/lock.ts`). Daemons from 0.1.59 on carry the fix; every observation here predates it. At 06:47:51.5 the 0.1.56 daemon stepped down for 0.1.57's hooks. Successor pid 2451514 started at 06:47:51 but served only at 06:49:52.5, 0.8 s after the note "a successor daemon gave up: the lock was still held after 120000 ms". The cause (001-153): each step-down spawns two successors (SessionStart and PostToolBatch), and `awaitDaemonLock` retried `BEGIN EXCLUSIVE` on one kept connection, whose failed attempt keeps its lock until close. Meanwhile the hook told the agent "no daemon is validating at revision 12" (06:47:58), and it ran the e2e file itself (91.5 s). The give-up note's "the next hook boundary starts one" was wrong while the other successor took the lock 0.8 s later.
6. **After the marketplace replaces the plugin mid-turn, every Squeal hook fails for the rest of that turn.** Harness (openai/codex#31383), reproduced mid-session. cz1 started at 06:51:27 on 0.1.57. 0.1.58 replaced it at 06:52:02. Every hook after that in the same turn printed "Hook failed: hook exited with code 1": 11 times, Stop included (`logs/cz1.tui-events.txt`). The edits of that turn were never reported, and Stop delivered nothing. The next turn (cz2, 06:54:32) ran its hooks from 0.1.58. Not a defect when the turn boundary falls in between: sq2 started on 0.1.56, its directory went at 06:37 while it was idle, and its next hooks (06:47:40, 06:47:58) ran from 0.1.57 with no error. Squeal cannot change how Codex resolves `${PLUGIN_ROOT}`. Fix direction, for the coordinator: a hook command that reaches the plugin through a version-independent path, or a release note that an update interrupts the turn in flight.
7. **In cezarion's shape, a slow file's key at a worktree's start seems to leave out the gitignored artifact. Two worktrees with different builds computed the same key, and one with an identical build never inherited. The plugin's install path also enters the key.** Keys, D5 and D6 (goal 5), node:test slow project, 0.1.58 (`logs/cz.keys.txt`).
   - Reproduction: `packages/cezar/dist` is gitignored in cezar (`.gitignore:2:dist/`). B is A's commit plus A's source diff, built: `dist` byte-identical to A's (750 files). C is the same commit without the diff, built: `dist` differs. Both have A's config. Both daemons were started at 07:14:52 from one copy of the 0.1.58 plugin. At revision 0 both computed `release.test.ts` key `aed7da19...`.
   - In C, an edit to `packages/cezar/dist/todos.js` at 07:15:33 made revision 1, which names that path. Twenty seconds later C's key was still `aed7da19...` from revision 0. With `baseline.onStart` `lookup-only` nothing was queued, so the key may only be refreshed when work is.
   - A's 13 results sit under `bffc2233...`, computed at A's revision 1, the first after cz2's rebuild changed `dist`. B restarted from the installed 0.1.58 path computed `9c9ba2ef...` and inherited none of them ("13 not run at revision 0").
   - A fast node:test file's key matches where its sources match: `todo-task-text.test.ts` is `1b6f0f30...` in A and B and differs in C, which lacks the `todos.ts` change.
   - Only the plugin path changed between `aed7da19...` and `9c9ba2ef...` for B. The slow run's argv carries the plugin's absolute paths (`--require <plugin>/dist/node-test/recorder.cjs`, `--test-reporter=<plugin>/dist/node-test/reporter.mjs`; `logs/cz.slow-run-argv.txt`).
   - Reading: a start key without the ignored artifact explains all three observations (B equals C, B differs from A, C's edit moved nothing). It is not proven: the keys' inputs were not printed.
   - Risk: if C's daemon had found results stored under B's start key, it would have inherited a slow result for a different build. That would be a false pass, which D6 exists to prevent. None was seen, because B never ran its slow files.
   - This repository's artifact, `plugins/**`, is tracked and inherited correctly (verdict, goal 5). The 004-16 e2e commits its artifact in the fixture, so it cannot see this.
   - Next step: print the key inputs of one slow file at revision 0 and at revision 1 in two such worktrees.
8. **Four wording slips in the slow-tier line.** Status, D8 (goal 6). (a) After cz3's edit to `package-cli.test.ts` only, the line read "13 current against packages/cezar/dist/** as of revision 1, sources changed since": no source of the artifact changed, only a slow test file. (b) The same line said "as of revision 1" while that file had just run at revision 2. (c) From 07:03:42 to 07:07:13 the JSON kept `activity: {"kind":"waiting","for":"slot"}` on six polls, while the text line read "13 pending." without the reason on five of them (`logs/cz.poll.txt`). (d) A fresh worktree's first revision lists every file as new (`oldHash: null`, trigger `watch` in A at 06:14:37, `interval` in this repository's B at 07:31:03). B's line then read "10 current ... as of revision 0, sources changed since" for inherited results, though no source differed from the commit.
9. **A daemon starting on a shared store still exits with `database is locked`.** Store, 001; 003 defect 5 again. Cezarion's first start: "2026-10-09T06:15:37.068Z, revision 0: daemon exited: could not start: database is locked", 13 s after `squeal start`, while cezar's own daemons (0.1.55, 0.1.56) used the same store. The second start, 7 minutes later, succeeded.

### Not explained

- Two 0.1.58 daemons for cezarion lived 16 to 20 s and exited without a note: pid 2716121 (hook, 06:55:27 to 06:55:43) and pid 2737672 (`squeal start`, 06:56:03 to 06:56:22). A daemon in the foreground (90 s, stopped by `timeout`) and one started with `setsid` at 07:00:55 stayed. This repository's daemon ran no tier between 06:54 and 06:58, so its tests did not kill them. No stderr was kept for the ones that died.
- Squeal's fast-tier failures beside the slow lane at r13 (see the slot section).

### Non-defects checked

- 003's defect 7 (template name) and defect 6 (unkeyed spawn files without a note) are closed in 0.1.56.
- openai/codex#31383 across a turn boundary: not reproduced (defect 6 gives the evidence).
- A 0.1.56 daemon whose plugin directory was deleted kept running its slow lane: it created the second Vitest instance and ran 10 files after the removal.
- Squeal's slot follows `XDG_RUNTIME_DIR` (004-16): `/run/user/1001/squeal/slow.lock`.
