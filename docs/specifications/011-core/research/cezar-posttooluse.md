# Repeated PostToolUse errors in Cezar task c8bb31ae

Brief: `cezar-posttooluse-brief.md`. Researched 2026-10-26, about 10 minutes, read-only.
Sources: Cezar transcript `/home/agent/projects/cezar/.ai/cezar/runs/c8bb31ae-1472-4b4b-bcd1-f80f2dba1b40.ndjson` (243 lines when read, 13:23 local),
the Codex plugin cache `/home/agent/.codex/plugins/cache/hearsay/squeal/`, its `hooks.json` at 0.1.342,
and the runtime store `/home/agent/.codex/plugins/data/squeal-hearsay/`. No hook ran, nothing in the task changed, no message went to it.

## Answers

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | What fails, how, how often, when | Two PostToolUse runs of the 0.1.341 Codex hook failed with `hook exited with code 1`, at 12:20:10.708Z (87 ms) and 12:20:10.890Z (75 ms). In the same 8 s window, two PreToolUse runs and both Stop hooks failed the same way. No other hook failed. | read in transcript |
| 2 | Crash, timeout, missing runtime, block, other | Missing plugin files. Codex replaced its plugin cache `squeal/0.1.341` with `squeal/0.1.342` at 12:19:58.686Z. The running turn kept the 0.1.341 `hooks.json`, whose commands point to `${PLUGIN_ROOT}/dist/*.mjs` in the deleted directory. Node exits 1 when the script file is missing. Not a timeout (2 s limit, 62–87 ms runs), not a regression block (a block is a decision, not a non-zero exit), not a Squeal code crash. | inferred from transcript + file times; exit 1 on a missing path verified by experiment |
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
- Parent note (2026-10-26): main's 200-file tier crashed at 12:18:37Z with "Failed to load custom CoverageProviderModule from …/squeal/0.1.341/dist/coverage/provider.mjs". This task's 0.1.341 hooks loaded files from that same directory at 12:18:56Z and 12:19:07Z, so the directory existed then. The main crash therefore needs another cause, for example a 0.1.341 cache directory that was still being written at 12:18:37Z. Not determined, because I did not read that crash's evidence. It does not change the c8bb31ae finding: those failures start after the 12:19:58Z swap.
