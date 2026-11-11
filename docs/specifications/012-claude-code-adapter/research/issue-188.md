# Issue #188: Squeal hook text makes read-only subagents end with a reply to Squeal

Triage research, 2026-11-11, documentation only. Reported on Squeal 0.1.432. Inspected: this worktree at `5ffc3653b` (`package.json` 0.1.432, same as `origin/main`; no `v0.1.432` tag exists to diff against). Claude Code on the host: 2.1.321.

**Not reproduced.** One-minute load was 45.04 at 17:52:45Z and 55.78 at 17:53:54Z on 24 CPUs (`cat /proc/loadavg`, `nproc`), above the CPU count at both checks. No live probe ran, recorded-hook or real subagent. Every finding below is read in source, read in docs, or inferred.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Is this the known seam "SubagentStop report restarts the subagent" (board, 012, unnumbered; 005 `research/instruction-surfaces.md` 1, session `can-c`, Claude Code 2.1.295)? | Same symptom, likely same final step: only a Stop-type context starts a turn after the subagent's last message. The trigger is new: test transitions were the only Stop news when `can-c` was recorded; since row 017-23, a lint change alone is Stop news, and a stale heartbeat is Stop news (row 011-215). | read in source code, inferred |
| 2 | Which hook spoke in the final turn: SubagentStop, UserPromptSubmit, or PostToolBatch? | Not determined, because no transcript was available and no live run was allowed at this load. The reporter names UserPromptSubmit. PostToolBatch context arrives before the model's next step in the same turn, so it cannot follow a final message by itself. | inferred |
| 3 | Do subagents get UserPromptSubmit at all? | Possibly. Claude Code 2.1.321 keys its UserPromptSubmit hooks by `r.agentId ?? r.session.id` on a tool-use context. When a subagent context reaches that call is not determined. Squeal's handler (`src/harness/claude-code/hooks/user-prompt-submit.ts`) delivers the delta to the consumer `(session, agent_id)` when one is registered. | read in source code (minified bundle), inferred |
| 4 | Why did the lint line look like news? | Each failed oxlint pass increments a per-scope failure count (`noticesOf`, `src/core/lint/surface/snapshot.ts:213`). A consumer is told "Lint: unknown: …" once per count it has not seen (`newReasons`, `src/core/lint/surface/deliver.ts:195`). If oxlint fails every pass (#140), each pass is new news at the next boundary, Stop included (`src/core/delivery/delivery.ts:300-304`, "lint changes at every tool boundary and at Stop by themselves"). | read in source code; repetition inferred |
| 5 | Duplicate of #150, #171 or #140? | No. Related to each, distinct from each (below). | read in issues |

## Findings

**1. Old mechanism (`can-c`, 2.1.295).** `stop.mjs` runs at SubagentStop. Its context went into the subagent and started another turn, so the parent got the subagent's reply to the report instead of its answer (005 `research/instruction-surfaces.md` table 1, row "Report texts"; recommendation 5). CC2 still says SubagentStop is "same as … Stop" for the subagent's consumer (`012 spec.md` CC2, `SubagentStart` and `SubagentStop` bullet), and Stop "speaks only with news, because any Stop context starts another model turn". So any Stop news in a subagent still has this effect. Claude Code 2.1.321's SubagentStop input carries `agent_id`, `agent_type`, `last_assistant_message` and `background_tasks` (read in the bundle). Read in docs and source; not re-run.

**2. What counts as Stop news now (0.1.432).** `src/harness/shared/stop.ts` and `src/core/delivery/delivery.ts:290-315`:
- a test transition in the consumer's delta;
- a liveness change that is "a daemon down with no successor", a stale heartbeat included (011 C8, amended 2026-10-25, row 011-215). At load 45 to 56 this session itself got "the daemon's heartbeat is late" twice in a few minutes, so under load a subagent's Stop can speak for a late heartbeat alone (inferred);
- a lint change by itself, failed-pass notices included (row 017-23). With #140 failing every pass, each pass adds one (inferred from the counter rule).

None of these is about the subagent's own work when it edited nothing. 011 C8 as amended for gh-153 (row 011-312) stops a no-change session from being *held* for required checks; it does not silence news.

**3. Distinct from related issues.**
- #150 (open, "Read-only session startup queues baseline tests on an already saturated host"): about execution cost of a read-only session. #188 is about delivered text and the lost report; it occurs even with lookup-only start and no queued work.
- #171 (open, "Expected failures at one revision repeat in every later tool call"): repeated content at tool boundaries in a working session, a noise and budget cost. #188's loss needs the text at the subagent's end of turn, where any context costs a whole answer. A fix for #171 alone (silence repeats at PostToolBatch) does not fix #188 if Stop still speaks for lint or liveness.
- #140 (open, oxlint times out after 5 s): the source of the "Lint: unknown" line here and, by the counter rule, a source of repeated lint news. Fixing #140 removes one trigger, not the mechanism.

**4. What a hook probe can and cannot show.** A recorded-hook probe (a SubagentStart then SubagentStop payload with `agent_id` and `agent_type: "general-purpose"` against a fixture store whose lint pass failed, or whose heartbeat is stale) can show that `stop.mjs` prints context for a subagent that ran no edit. It cannot show the report loss: that needs a real Claude subagent whose final message the parent receives. Neither was run.

## Recommendation for Squeal

Treat #188 as a new trigger of the known 012 seam, not as a duplicate of #150, #171 or #140. Give the coordinator one triage row for 012 that first probes, at calm load:
1. a recorded-hook run of SubagentStop for an unedited subagent with a failed lint pass and with a late heartbeat, to see whether `stop.mjs` speaks;
2. one real `claude -p` parent with a general-purpose subagent, as the throwaway `squeal-e2e` user, to see which event reaches the subagent after its report and what the parent receives.

The design question for the spec is whether a subagent's Stop may speak at all for news that is not a test transition of its own edits, and whether subagents get UserPromptSubmit deliveries. That decision is product-facing (it changes what subagents are told), so it is the human's.

## Open questions

- Which hook event spoke in the reported final turn. Needs the subagent transcripts or a real run.
- When Claude Code 2.1.321 fires UserPromptSubmit inside a subagent (a message to a running background agent is the likely case; not verified).
- Whether one failed oxlint pass is one notice or several ("failed 3 times" may be one pass with retries).

## Commands run

```
date -u; cat /proc/loadavg; nproc                     # 45.04 on 24 CPUs; later 55.78, 50.89
gh issue view 188 --repo hearsay-tools/squeal --json title,body,labels,createdAt,author,comments
gh issue view {150,171,140} --repo hearsay-tools/squeal --json title,state
git show origin/main:docs/board.md | sed -n '2225,2245p'
grep -n "can-c\|SubagentStop\|subagent" docs/specifications/005-agent-adoption/research/instruction-surfaces.md
grep -aoE '.{0,160}hook_event_name:"UserPromptSubmit".{0,200}' <claude 2.1.321 binary>
grep -aoE '.{0,120}hook_event_name:"SubagentStop".{0,200}' <claude 2.1.321 binary>
```

## Sources

- Issue: https://github.com/hearsay-tools/squeal/issues/188 (read 2026-11-11 17:52Z); #150, #171, #140 titles and states.
- `docs/board.md` on `origin/main`, unnumbered 012 seam ("a SubagentStop report restarts the subagent").
- `docs/specifications/005-agent-adoption/research/instruction-surfaces.md` table 1 and recommendation 5 (`can-c`, Claude Code 2.1.295).
- `docs/specifications/012-claude-code-adapter/spec.md` CC2, CC4; `docs/specifications/011-core/spec.md` C8 (amendments 2026-10-25 row 011-215, 2026-11-10 row 011-312).
- Code at `5ffc3653b`: `src/harness/claude-code/hooks/{stop,user-prompt-submit}.ts`, `src/harness/claude-code/fork.ts`, `src/harness/shared/{prompt,stop-lint}.ts`, `src/core/delivery/delivery.ts:290-315`, `src/core/lint/surface/{deliver,told,snapshot}.ts`.
- Claude Code 2.1.321 native binary, `.../@anthropic-ai/claude-code/bin/claude.exe` (minified strings).
