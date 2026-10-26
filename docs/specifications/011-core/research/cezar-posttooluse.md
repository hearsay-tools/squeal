# Repeated PostToolUse errors in Cezar task c8bb31ae

Brief: `cezar-posttooluse-brief.md`. Researched 2026-10-26, about 10 minutes, read-only.
Sources: Cezar transcript `/home/agent/projects/cezar/.ai/cezar/runs/c8bb31ae-1472-4b4b-bcd1-f80f2dba1b40.ndjson` (243 lines when read, 13:23 local),
the Codex plugin cache `/home/agent/.codex/plugins/cache/hearsay/squeal/`, its `hooks.json` at 0.1.342,
and the runtime store `/home/agent/.codex/plugins/data/squeal-hearsay/`. No hook ran, nothing in the task changed, no message went to it.

## Answers

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | What fails, how, how often, when | Observed: two PostToolUse runs of the 0.1.341 Codex hook failed with `hook exited with code 1`, at 12:20:10.708Z (87 ms) and 12:20:10.890Z (75 ms). In the same 8 s window, two PreToolUse runs and both Stop hooks failed the same way. No other hook failed. | read in transcript |
| 2 | Crash, timeout, missing runtime, block, other | Observed: exit 1 only; stderr is absent. Inferred cause: missing plugin files. Codex replaced its plugin cache `squeal/0.1.341` with `squeal/0.1.342` at 12:19:58.686Z. The running turn kept the 0.1.341 `hooks.json`, whose commands point to `${PLUGIN_ROOT}/dist/*.mjs` in the deleted directory. Node exits 1 when the script file is missing. Not a timeout (2 s limit, 62–87 ms runs), not a regression block (a block is a decision, not a non-zero exit), not a Squeal code crash. | inferred from transcript + file times; exit 1 on a missing path verified by experiment |
| 3 | Upgrade link, main checkpoint link, recovery | Linked to the 0.1.341 → 0.1.342 plugin swap, not to 0.1.339 and not to main's incomplete checkpoint. It healed itself at the next turn. No recovery is needed. | inferred, limits below |

## Findings

**1. The failed hooks** (read in transcript). Every hook item in the transcript, counted by event, status and plugin version:

| Event | Version | Completed | Failed |
|---|---|---|---|
| SessionStart | 0.1.341 | 1 (12:18:56Z) | 0 |
| PostToolUse | 0.1.341 | 1 (12:19:07Z) | 2 |
| PreToolUse | 0.1.341 | 0 | 2 |
| Stop (`stop.mjs`, `stop-slow.mjs`) | 0.1.341 | 0 | 2 |
| PostToolUse | 0.1.342 | 2 (12:22:17Z, 12:23:25Z) | 0 |

The failed items, in order (seq, time, tool):
- 133, 12:20:08.759Z, PreToolUse failed, 87 ms, before `gh project item-edit …`
- 138, 12:20:10.708Z, PostToolUse failed, 87 ms, after the same command
- 139, 12:20:10.791Z, PreToolUse failed, 75 ms, before `cezar_ask`
- 144, 12:20:10.890Z, PostToolUse failed, 75 ms, after `cezar_ask`
- 162 and 163, 12:20:16.084Z, both Stop hooks failed, 66 and 62 ms

Each carries only `"entries":[{"kind":"error","text":"hook exited with code 1"}]`, with
`"source":"/home/agent/.codex/plugins/cache/hearsay/squeal/0.1.341/hooks/hooks.json"`. Codex keeps no stderr, so the transcript does not show the Node error text.
The PostToolUse command is the sh gate from `hooks.json` followed by
`exec node --disable-warning=ExperimentalWarning "${PLUGIN_ROOT}/dist/post-tool-use.mjs"` (read in `0.1.342/hooks/hooks.json`; 0.1.341's copy is gone).

**2. Cause** (inferred; the timing is read, the exit code verified by experiment).
- `ls --full-time` on the cache shows only `0.1.342`, created 13:19:58.686 +0100 = 12:19:58.686Z. The `0.1.341` directory is gone.
- The first failure is 10 s later (12:20:08.759Z). The last 0.1.341 success is 12:19:07Z, before the swap.
- The failures hit every hook type, including the Stop hooks that have no sh gate. That excludes one script's bug and points at the shared plugin root.
- All failures took 62–87 ms. That is Node start time plus a failed module load. A Squeal hook that reaches the store takes longer (the successes took 294–890 ms).
- Probe: `node …/0.1.341/dist/post-tool-use.mjs` printed `node:internal/modules/cjs/loader:1568 throw err;` and exited 1 (`probes/cezar-posttooluse/README.md`).
- The next turn started at 12:20:55.685Z. From then on, Codex loaded `0.1.342/hooks/hooks.json` and every hook item completed.

**3. Upgrade and checkpoint links** (inferred).
- Runtime store `versions/` holds 0.1.335, 0.1.336, 0.1.339 (11:47:35Z), 0.1.341 (12:18:20Z), 0.1.342 (12:20:03Z). The runtime keeps old versions; the Codex plugin cache keeps one. So the runtime was never missing; only the plugin directory was.
- The session started at 12:18:54Z, after 0.1.341 was installed. 0.1.339 played no part in this session.
- Main's incomplete checkpoint cannot explain a missing-module exit in under 90 ms, and the Stop hooks failed identically. The failure happens before any hook code reads the store.
- `launcher-notices.json` (12:22:09Z) records a mixed install at that moment: "squeal 0.1.342; plugins: Claude Code 0.1.341 and Codex 0.1.342". This did not cause the failures but shows the Claude Code plugin still lags.
- The 0.1.342 PostToolUse at 12:22:17Z reported "No daemon has validated since 2026-10-26T12:22:02.317Z", and the later one at 12:23:25Z completed. That is the daemon handover after the upgrade, not a hook failure.

Limits: Codex records no stderr and no timestamp for its own cache swap, so "the turn kept the old hooks.json" is inferred from paths in the failed items and the directory time. I did not read Codex's source.

## Recommendation

- Recovery for the task: none. The failures stopped at the next turn (12:20:55Z), and the task's later hooks ran on 0.1.342. Do not restart the daemon for this. During the failed turn, Squeal gave no feedback after `gh project item-edit` and `cezar_ask`; neither edits files, so no result was lost.
- For the user: "Codex updated the Squeal plugin while the agent was working. For about 8 seconds, the agent still called the old plugin files, which Codex had already deleted, so each hook exited with an error. From the next turn on, the agent used the new plugin and the errors stopped."
- Separate follow-up: run `squeal update` to bring the Claude Code plugin to 0.1.342, as the launcher notice says.
- Possible Squeal fix, for the coordinator to weigh: a missing-file exit in the hook command is the same each time Codex swaps the cache mid-turn. The sh gate could check `[ -f "${PLUGIN_ROOT}/dist/post-tool-use.mjs" ] || exit 0` before `exec node`, and the ungated hooks likewise. Cost: one file test per hook; effect: a silent skip for at most one turn instead of a visible error. Not verified.

## Open questions

- Does Codex always reload `hooks.json` at a turn start, or did something else trigger it here? Not determined, because I did not read Codex source.
- How often does a cache swap land mid-turn across tasks? Not counted; other transcripts were out of scope.
- Correction: an earlier note here said main's coverage crash used "that same directory". It did not. Main's crash names the Claude Code cache `/home/agent/.claude/plugins/cache/hearsay/squeal/0.1.341/`; the c8bb31ae hooks ran from the Codex cache `/home/agent/.codex/plugins/cache/hearsay/squeal/0.1.341/`. See the coverage section below.

## Additional: main's coverage-provider crash (2026-10-26, about 5 minutes, read-only)

Human evidence: Cezar main shows 495 files with no result, none queued, and "Failed to load custom CoverageProviderModule from /home/agent/.claude/plugins/cache/hearsay/squeal/0.1.341/dist/coverage/provider.mjs".
Sources: run logs `/home/agent/projects/cezar/.git/squeal/runs/*/vitest.log` and `report.json`, Vitest 4.1.10 `dist/chunks/coverage.CTzCuANN.js` in Cezar's `node_modules`, the two provider files. No import probe, test, restart or checkpoint.

**Verdict: the nested cause is not determined. The evidence rules out a missing file as the general cause.** (inferred from the logs below)

**What the logs show** (read in run logs). 15 runs crashed with this error between 12:18:36Z and 12:26:42Z, local file times 13:18–13:26 +0100. Each run's `end:` line is `crashed (unhandled error outside any test file: Error: Failed to load custom CoverageProviderModule from <path>`, with the stack `resolveCoverageProviderModule (…/vitest/dist/chunks/coverage.CTzCuANN.js:22:9)` → `startCoverageInsideWorker (…/setup-common.DYx3LtFI.js:7:25)` → `runBaseTests` → `init-forks`. The error is raised inside a test worker, not at run start.

| Log time (+0100) | Checkout | Provider path | Failed workers | Passing tests in the same run |
|---|---|---|---|---|
| 13:18:36 | main | `.claude/…/0.1.341/…` | 69 | 2727 |
| 13:20:36 | main | `.claude/…/0.1.341/…` | 65 | 1306 |
| 13:22:26 | main | `.claude/…/0.1.341/…` | 55 | 1950 |
| 13:24:36 | main | `.claude/…/0.1.341/…` | 18 | 982 |
| 13:22:47–13:26:42 (11 runs) | worktree c8bb31ae | `.codex/plugins/data/squeal-hearsay/versions/0.1.342/…` | 1–13 each | 0–85 each |

**Why not a missing file** (inferred).
- In every main run, most workers loaded the same provider path, and their tests passed (for example 2727 passes beside 69 failures at 13:18:36). A missing file fails every worker.
- The c8bb31ae worktree fails the same way on a different file, the runtime store's `versions/0.1.342/dist/coverage/provider.mjs`. That file was written at 13:20:03.675 +0100, before all 11 of those runs, and the runtime store never deletes versions.
- Both provider files are 4208 bytes and import only Node built-ins (`node:crypto`, `node:fs`, `node:inspector/promises`, `node:path`, `node:url`). So no package dependency can be missing. (read in the files)
- Limit: the `.claude/…/0.1.341` directory has mtime 13:24:28 +0100 and `provider.mjs` 13:07:41, so Claude Code rewrote that cache directory at 13:24. I cannot prove the file was present at every main crash. The passing workers in the same runs show it was present for most of them.

**Why the cause is unknown** (read in source code, Vitest 4.1.10). `resolveCoverageProviderModule` catches any error from `loader.import(options.customProviderModule)` and throws ``new Error(`Failed to load custom CoverageProviderModule from ${…}`, { cause: error })``. Squeal's log and `report.json` keep only the message and stack, not `cause`. The 8cc08fa8 run log and report contain no cause text. So the run logs cannot tell a module-resolution error from an error thrown while evaluating the provider (for example in its `node:inspector/promises` setup) or a worker-side loader failure.

**Probable direction** (inferred, not verified). Failures are partial and per worker, and they cluster in the minutes after the 0.1.341 and 0.1.342 installs. The candidates are a load error in the Vite module runner inside a worker, or a provider top-level error in some workers. The candidates do not include a missing file or a missing dependency.

**Safe recovery, with limits.**
- Do nothing in the hook or the daemon blindly. Do not delete or edit plugin caches.
- After the plugins agree on one version (`squeal update`, as the launcher notice asks) and the daemon has restarted onto it at a time the human picks, request one fresh run of the 495 files. If workers still fail, the problem does not come from the upgrade.
- Required fix in Squeal: record `error.cause` (message and stack, recursively) for unhandled errors in the run log and `report.json`. Without it, the next occurrence stays undiagnosable. Second: a run that crashes on the coverage provider should keep and queue its unresulted files, not leave 495 files with no result and none queued. Both fixes are for the coordinator to weigh. Neither is verified.
