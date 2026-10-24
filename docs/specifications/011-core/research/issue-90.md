# Issue 90: edits during a manual reproduction clear `squeal stop` and queue the whole slow tier

[#90](https://github.com/hearsay-tools/squeal/issues/90), filed 2026-10-23 on 0.1.279, harness Claude Code in a cezarion worktree.

**Verdict.** Reproduced with synthetic hook calls on 0.1.279 and 0.1.283. Both behave the same. Both parts are the spec working as written, not a code defect. (1) A Bash edit clears the stop mark, and the next PostToolBatch starts a daemon (C9 stopped mark, issue #22, the human 2026-10-17: "until the next edit or an explicit start"). (2) The restart itself queues no slow file under `lookup-only`. The slow tier is queued by the *next* edit, which the live daemon sees as an ordinary revision. The declared input glob re-keys every slow file, so all of them are queued (C4). The existing `squeal hold` (gh-49, 0.1.269, rows 011-72 to 011-74) holds every tier across edits, and that was verified here too. The issue asks for a hold that survives edits until `squeal start`. `squeal hold` already does that, for the life of one command. Nothing in the stop's header or the skill's `SKILL.md` points the agent to it.

Not reproduced: the original Claude session. The brief forbids real browser project resources, and no `claude` process ran. The 84-file scale was not reproduced either. The fixture has 3 slow files of the same shape.

## Questions

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Does a Bash edit clear an explicit `squeal stop`? | Yes. The PostToolBatch after the edit spawns a daemon (silent), and the next boundary says "a daemon is validating again at revision 1" | verified by experiment, 0.1.279 and 0.1.283 |
| 2 | Is that by design? | Yes: C9 stopped mark, the tree print, "A different print clears the mark and the boundary ensures a daemon" | read in spec at `ad3a48d65`; read in source code |
| 3 | Does the hook restart itself queue the affected slow files? | No, under `lookup-only`: "3 not run at revision 1. Squeal has not queued them" | verified by experiment, both versions |
| 4 | What queues the whole slow tier? | The next edit seen by the restarted daemon: "Revision 2 · … + 2 … Slow tier: 3 pending … queued 3 test files". The tier ran about 4 s later | verified by experiment, both versions |
| 5 | Does the incident's output match 3 or 4? | 4: its quoted block is `SQUEAL · revision 2`, `Revision 2 · 2dd06d83 + 2`, "queued 91 test files", which is leg C's shape | inferred from the issue text and the probe output |
| 6 | Does the existing `squeal hold` cover the case? | Yes, for its command's life: edits are recorded, slow files stay pending, `holds=command`; they run when the command exits or at `squeal start`. A background `squeal hold -- sleep 60` held edits from separate calls | verified by experiment, both versions |

## Method

Load before the live runs: `uptime` 1.46 / 2.91 / 2.75 / 2.64 (one-minute) on `nproc` 24, so the probe went ahead. After the runs: 3.61, 3.79. Squeal exercised: the plugin cache `~/.claude/plugins/cache/hearsay/squeal/0.1.279` (the incident's version) and `…/0.1.283` (`squeal --version` printed each). Source read: this checkout, 0.1.283 (`package.json`), at `ad3a48d65`.

Commands, from `/tmp`:

```
node <worktree>/docs/specifications/011-core/research/probes/issue-90/probe.mjs \
  ~/.claude/plugins/cache/hearsay/squeal/<0.1.279|0.1.283> <worktree>/node_modules \
  > probes/issue-90/output-<version>.txt
```

Synthetic, not the original session: each hook bundle gets Claude Code's JSON on stdin (`session_id`, `cwd`, `hook_event_name`, `tool_calls: [{tool_name: "Bash", …}]`), with `CLAUDE_CODE_SESSION_ATTENDED` unset (no idle waiter). Edits are `sh -c "sed -i '$a // probe edit N' e2e/a.e2e.ts"`; the incident also used `python3`, not tested here. Each run used its own `HOME`, `XDG_RUNTIME_DIR` and store, and killed only daemons whose arguments named its root. `pgrep -af squeal-issue90` was empty afterwards and no `/tmp/squeal-issue90-*` remained. Fixture policy: `baseline.onStart: "lookup-only"`, `slow.include: ["e2e/*.e2e.ts"]`, `inputs: {"e2e/*.e2e.ts": ["e2e/**/*.{ts,mjs}"]}`, the shape of cezarion's `squeal.config.json` at `0539798a0` (read, not run).

## Findings

**Q1 and Q2, the stop clears.** Leg A (control): after `squeal stop`, a PostToolBatch with no edit started nothing, and the header said "The daemon is stopped by request (`squeal stop`); a hook starts one at the next edit, or run `squeal start`". Leg B: one `sed` edit, then PostToolBatch. The hook printed nothing and a daemon process was there 5 s later. The next boundary printed `SQUEAL · a daemon is validating again at revision 1`. Mechanism: `src/harness/shared/ensure.ts:72` calls `stopHolds`. `src/core/delivery/stopped.ts` `stopHolds` compares `treePrint` (HEAD, `git status --porcelain=v1 -z --untracked-files=all`, size, mtime and inode of each listed path) with the mark's print, and clears the mark when they differ. Spec C9 (`spec.md:266`) states this rule and its source, task 011-08, issue #22, "decided by the human 2026-10-17: until the next edit or an explicit start". Any edit to a tracked or untracked, not ignored, file clears it, whichever tool made it.

**Q3, the restart queues nothing.** At revision 1 the restarted daemon left the three slow files `notRun: 3, pending: 0` for 10 s, and the header said "Squeal has not queued them". Mechanism: `src/core/scheduler/bootstrap.ts:232`, `if (lookupOnly && !handed.pending.has(file.id) && !reached) continue;`. Under `lookup-only` a miss at start is queued only when a predecessor left it queued or running (011-33) or when the start resumes a rest (011-91). C4 states the same ("nothing is queued that policy did not queue"). The issue's second expectation, "the slow tier stays not queued … as the lookup-only baseline does at startup", already holds for the restart.

**Q4 and Q5, the next edit queues the tier.** Leg C: a second `sed` edit 5 s after the restart. The next PostToolBatch printed `SQUEAL · revision 2`, `Revision 2 · <sha> + 2, dirty: 6 pending`, `Slow tier: 3 test files; 3 pending`, and `Squeal saw your edit and queued 3 test files`. All three were current 4.7 s after the edit. This is C4's ordinary edit path: the edit is a revision, and the declared input `e2e/**/*.{ts,mjs}` re-keys every slow file. The incident's block has the same header, the same `+ 2` and the same "saw your edit" line, so its 91 files came from an edit the restarted daemon saw, not from the restart. Which of the incident's edits that was is not determined: the original session was not available.

**Q6, the existing hold.** Leg D: `squeal hold --max 2m -- sh -c '<edit of e2e/b.e2e.ts>; sleep 8'`. The hook said `validation on hold at revision 3: squeal hold runs …; Edits are recorded and not run until it exits`. Slow files stayed `pending: 3` with `holds=command` for 6 s. After the exit they started at once: all current 2.5 s later on 0.1.283; on 0.1.279 one file was still running then, and all were current at 7.6 s. Leg E: `squeal hold --max 2m -- sleep 60` in the background, then two edits from separate calls (revisions 4 and 5). Both stayed pending under the hold. `squeal start` ended it: all three were current 1 s later, and the next boundary said "the hold for `sleep 60` … ended". C9 *Hold command* (`spec.md:272`) states: "An edit does not end a hold. `squeal stop` stops the daemon and leaves the hold as it is", and "`squeal start` ends every command hold". So the issue's first suggestion ("persists across edits until `squeal start`") exists as `squeal hold`, bounded by its command and by `--max` (default 3 h). A background `sleep` as the command is a way to hold across many calls; that use is verified only in this probe, not in a real session's background Bash.

**Stop against hold.** A stop ends the daemon, and its mark yields to the next edit by design (#22). A hold keeps the daemon, records and keys every edit, and starts no tier until the command ends (#49, #68). For a manual reproduction with edits between runs, the hold is the mechanism that does what the issue expects. The stop does not. The skill reference `plugins/claude-code/skills/squeal/references/commands.md:122` documents `squeal hold` for "a long gate the repository asks you to run yourself". The stopped-mark header and `SKILL.md` do not name it (`grep -n hold plugins/claude-code/skills/squeal/SKILL.md` prints nothing). Whether the agent in the incident knew of `squeal hold` is not determined.

## Recommendation for Squeal

Treat #90 as a duplicate of #49 in substance: the hold it asks for shipped in 0.1.269. No core change is indicated by this evidence. The open gap is discoverability. The stop's header and the skill tell an agent who wants Squeal quiet across edits to `squeal stop`, and never mention `squeal hold`. Whether to name the hold there is a product-facing wording choice for the coordinator and the human. No design is proposed here; existing holds stand.

## Open questions

- Whether a background `squeal hold -- sleep <n>` survives a real Claude Code Bash `run_in_background` call and the harness's process handling. Not tested: no real session ran.
- Whether the incident's agent saw any mention of `squeal hold`. Its transcript was not available.
- `python3` edits were not run. They write a tracked file as `sed` does, so the tree print changes the same way (inferred).

## Sources

- Issue: https://github.com/hearsay-tools/squeal/issues/90, and #49 (closed), read with `gh issue view`.
- Spec: `docs/specifications/011-core/spec.md` at `ad3a48d65`, C4 (lines 110 to 160), C8 (242 to 256), C9 stopped mark (266) and *Holds* (268 to 272). `status.md` entries for 011-08 (lines 20 and 21) and 011-61, 011-72 to 011-74 (67, 95 to 100). `docs/board.md` rows gh-49, gh-68, 011-72 to 011-74.
- Code at `ad3a48d65`: `src/core/delivery/stopped.ts` (`stopHolds`, `treePrint`), `src/harness/shared/ensure.ts:72`, `src/cli/stopped-mark.ts`, `src/core/scheduler/bootstrap.ts:201` and `:232`, `src/core/delivery/format.ts:337` (`sawEditLine`).
- Earlier research: `research/issue-22.md` (the probe this one adapts), `research/issue-49.md`.
- Probe and outputs: `research/probes/issue-90/probe.mjs`, `README.md`, `output-0.1.279.txt`, `output-0.1.283.txt`.
