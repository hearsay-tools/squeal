# Issue 22: an explicit `squeal stop` is undone by the next hook boundary

## Verdict and provenance

Reproduced on 0.1.199. After `squeal stop` exits 0 with `Squeal daemon stopped for <root>`, the next Claude Code Stop hook spawns a new daemon, every time, at the same revision with nothing pending: three cycles out of three. The PostToolBatch hook does the same, and in a real session it fires first, after the Bash call that ran `squeal stop`, so the daemon is back before the turn even reaches Stop. With no hook after the stop, no daemon came back within 15 s, so the hooks are the only restarter seen.

Host load before the live run: `11.55 18.52 23.88` (`uptime`) on 24 CPUs (`nproc`), so it went ahead. During the runs: `20.91` at the first start, `19.42` at the second, `21.63` and `20.52` at their ends. Exercised: the installed Claude Code plugin 0.1.199, `~/.claude/plugins/cache/hearsay/squeal/0.1.199/dist/{session-start,post-tool-batch,stop,session-end}.mjs` and its `dist/cli/squeal.mjs`, run with `node` directly. Source read: this checkout, 0.1.203 (`package.json`) at `1e412a2e`, not exercised; the same function exists in the 0.1.199 bundles (`dist/stop.mjs:5356`, `dist/post-tool-batch.mjs:5404`, `ensureIfStale`). No shared daemon was touched: each run used a fresh `/tmp/squeal-issue22-*` with its own `HOME` and `XDG_RUNTIME_DIR`, stopped and killed only daemons whose arguments named that root, and removed it; `pgrep -af squeal-issue22` was empty afterwards.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Does a Stop hook after `squeal stop` start a daemon with nothing pending? | Yes, 3 of 3 cycles, one daemon each, within 3 s | verified by experiment, 0.1.199 |
| 2 | Does anything else restart it with no hook? | Nothing within 15 s | verified by experiment, 0.1.199 |
| 3 | Does PostToolBatch (the `squeal stop` Bash call's own boundary) restart it? | Yes, and it fires before Stop in a real turn | verified by experiment, 0.1.199 |
| 4 | Why | Both hooks call `ensureIfStale`, which spawns whenever the recorded heartbeat is not alive; a stop clears the record, and nothing records that the stop was asked for | read in source code, 0.1.203 at `1e412a2e`; same function in 0.1.199 dist |
| 5 | What the agent is told | Once, "SQUEAL · no daemon is validating at revision 0" as hook context; later spawns silent in the probe | verified by experiment, 0.1.199 |
| 6 | Owning spec sections | 011 C8 (each tool boundary and end of turn ensures a daemon) and C9 (the stop, the rest); 012 CC2 states the PostToolBatch and Stop mapping | read in spec at `1e412a2e` |

## Findings

**Commands.** `node docs/specifications/011-core/research/probes/issue-22/probe.mjs ~/.claude/plugins/cache/hearsay/squeal/0.1.199`, run twice from `/tmp`. Full outputs in `probes/issue-22/output-run1.txt` and `output-run2.txt`. The fixture is a committed repository with `squeal.config.json` `{}`, a `vitest.config.ts` and one test file, and no `node_modules`. Hooks get Claude Code's JSON on stdin (`session_id`, `cwd`, `hook_event_name`, `source: "startup"`, `stop_hook_active: false`, `tool_calls: [{tool_name: "Bash", …}]`) with `CLAUDE_CODE_SESSION_ATTENDED` unset, so no idle waiter.

**Q1 to Q3, outputs** (run 1, then run 2's PostToolBatch step; paths abbreviated):

```
+3.7s  $ squeal stop -> exit=0      Squeal daemon stopped for /tmp/…/repo
+18.8s daemon processes for fixture: 0          # 15 s, no hook: stays down
+18.9s $ squeal status               Daemon: no daemon running since 2026-10-16T23:45:25.369Z
--- cycle 1
+19.0s hook stop exit=0 stdout={"hookSpecificOutput":{"hookEventName":"Stop","additionalContext":"SQUEAL · no daemon is validating at revision 0\n…"}}
+22.1s daemon processes for fixture: 1          # squeal.mjs daemon /tmp/…/repo
+22.2s $ squeal status               Daemon: running, last heartbeat 3 s ago
+22.4s $ squeal stop -> exit=0
--- cycle 2 and cycle 3: hook stop stdout="" ; daemon processes 1 ; squeal stop exit 0
--- run 2, PostToolBatch after squeal stop
+19.2s hook post-tool-batch exit=0 stdout={…"SQUEAL · no daemon is validating at revision 0\n…"}
+22.3s daemon processes for fixture: 1
```

Each `squeal stop` wrote the note `daemon stopped: squeal stop`; the status shows the daemon started each time and logged its runner notes again.

**Q4, mechanism.** `src/harness/shared/ensure.ts:70` `ensureIfStale` reads `worktrees.daemon` and calls `ensure` whenever `daemonLiveness(record, now).state !== "alive"`; `ensure` calls `ensureDaemon`, which spawns when no socket answers. Its callers are `src/harness/shared/stop.ts:118` (Stop and SubagentStop, before the wait and before any pending check) and `src/harness/shared/deliver.ts:67` (PostToolBatch). Neither looks at what is pending. On the daemon side, `squeal stop` reaches `#shutdown("stop-requested", 0, "daemon stopped: squeal stop")` (`src/core/daemon/daemon.ts:576`), which persists a note and clears the record as every exit does (C9, "Clearing the record empties its socket, so every read finds no daemon"); `src/cli/stop.ts` writes nothing that a hook reads. So to a hook a stopped daemon is a crashed one, and C8's rule "each tool boundary … when the recorded heartbeat is stale, ensures a daemon (C9)" applies as written. The one quiet absence C9 already defines, the rest (`daemon-rest:<worktree>`, after the `unused` exit), suppresses only the "no daemon is validating" line; the next boundary still "starts a daemon as any does". This is the spec doing what it says, not a code defect against the spec. Read in source code and spec, not separately tested.

**Q5, what the agent saw.** In the probe the first restarting hook said "no daemon is validating" and later ones said nothing, since the down state had been told once (C9 "liveness is told once per change"). The issue's line, "a daemon is validating again at revision N", is the alive-liveness title (`src/core/delivery/format.ts:327`), which the probe never printed, because it ran no boundary after a spawned daemon heartbeat without stopping it first. In a real session the order is: Bash `squeal stop` → PostToolBatch spawns and (once) says "no daemon is validating" → the next boundary or Stop reads the heartbeat and says "validating again". A Stop hook that speaks starts another model turn (CC2), which matches the issue's loop. Inferred from the two observed messages and CC2; the exact message sequence of the reported session is not determined.

## Uncertainty against the reported session

The report is agent-filed (`friction`), from a hearsay-tools/cezarion worker worktree on 2026-10-17; its transcript and Squeal version were not inspected. Differences: the probe's fixture had no `node_modules`, so Vitest never ran and "nothing pending" held trivially, where the worker's worktree presumably had a runner and results; the probe had no idle waiter (`-p`-like), while cezar workers may run attended; the probe drove hook bundles directly, not a live `claude`, so hook ordering inside one turn is taken from CC2, not observed; the worker ran in a linked worktree, the probe in a main one. None of these touches the mechanism, which needs only a cleared daemon record and a hook boundary. The plugin version the worker ran is assumed to be the host's pinned 0.1.199, not determined.

## Recommendation for Squeal

Treat #22 as reproduced and scoped to 011 C8 and C9: today no state survives `squeal stop` that a hook could honour, so any fix is a C9 rule for what a stop leaves behind and a C8 rule for when a boundary may override it (the issue proposes "until the next edit or an explicit `squeal start`"). It applies to every harness, since `ensureIfStale` is shared, and it must cover PostToolBatch, not only Stop, or the Bash call's own boundary undoes the stop first. No design here; existing holds stand.

## Open questions

- Which boundary the reported worker saw first, and whether it ran attended (waiter armed): not determined, because the cezarion transcript was not read.
- Whether SessionStart, UserPromptSubmit or a Codex/OpenCode/Pi boundary also restart after a stop: they use `ensure`/`ensureToRegister` from the same module (read in source code), not tested.

## Sources

- https://github.com/hearsay-tools/squeal/issues/22 (fetched with `gh issue view 22 --json`, 2026-10-17)
- `docs/specifications/011-core/spec.md` C8, C9; `docs/specifications/012-claude-code-adapter/spec.md` CC2, at `1e412a2e`
- `src/harness/shared/ensure.ts`, `src/harness/shared/stop.ts`, `src/harness/shared/deliver.ts`, `src/cli/stop.ts`, `src/core/daemon/daemon.ts`, `src/core/delivery/format.ts`, at `1e412a2e`
- `~/.claude/plugins/cache/hearsay/squeal/0.1.199/dist/` (exercised)
- `docs/specifications/011-core/research/probes/issue-22/` (probe and outputs)
