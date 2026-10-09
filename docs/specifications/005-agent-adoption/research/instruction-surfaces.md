# Instruction surfaces

Board row 005-02. Claude Code 2.1.295 with `claude-sonnet-5-5`, Codex CLI 0.160.1 with its configured default `gpt-6.1-sol` (source tag `rust-v0.160.1`, `d27764b`), Squeal plugins 0.1.67 pinned from commit `9848df0`, run 2026-10-09 on this host. 40 subject sessions: 24 Claude Code for $2.45, 16 Codex for 1.08 M input tokens (0.92 M cached) and 16 k output tokens. Probes, plans and trimmed logs: `probes/instruction-surfaces/`.

## Answers

| # | Question | Answer | Tag |
| --- | --- | --- | --- |
| 1 | Which surfaces reach the model, when, after compaction, in subagents | Both harnesses deliver the primer and header, the skill list and the report texts on their own. Each reads only its own instruction file: Claude Code reads `CLAUDE.md`, or `AGENTS.md` only when no `CLAUDE.md` exists; Codex reads `AGENTS.md` and never `CLAUDE.md`. Project instructions, the primer and the skill list come back after compaction, while earlier reports survive only as a summary. Subagents get the primer from SubagentStart in both harnesses. Claude Code's Explore and Plan subagents skip the instruction file. Table 1. | verified by experiment, read in official docs |
| 2 | Conditions a to d, both harnesses | Neither the plugin alone (a) nor the plugin with a block (b) produced one agent-run test in 22 sessions; agents waited on Squeal instead. A gate demanding `npx vitest run` (c) produced a full Vitest run in 5 of 5 sessions. The gate reworded to `squeal run --all --wait` (d) produced 0 Vitest runs and a pasted checkpoint in 5 of 5. All 34 condition sessions ended green, and every final pass/fail claim was true. Table 2. | verified by experiment |
| 3 | The block's wording | The three wordings (141, 322 and 469 bytes) had no effect we could measure next to the plugin, because (a) already scored 0. The block does work as a fallback: with the plugin absent, both agents ran `npx vitest run` as `b2` says. Shortest that carries the fallback and the Codex command: `b2`, 322 bytes. | verified by experiment |
| 4 | The install step's shape | Put it in `squeal init` as one consent question, default no, the shape of `--trust`. It writes a marker-delimited block into the file each harness reads, and it never rewrites a gate unasked: it offers the (d) rewording as a second question. | read in source code, read in official docs, inferred |

## 1. Surfaces

Method: each fixture's instruction files carried a unique word (`CORMORANT-CLAUDEMD`, `HERON-AGENTSMD`). The agent and one subagent were asked to quote what they received. Their answers were checked against the record of what actually reached the model: Claude Code transcript attachments and Codex rollout messages (`logs/canary-extracts.txt`). Compaction: Claude Code `-p --resume <id> /compact`, then re-asked; Codex `exec resume` with `-c model_auto_compact_token_limit=15000`, which compacted before the turn. Sessions `can-c`, `can-c2`, `can-c3`, `can-c4`, `can-x`, `can-x3`.

Table 1. Surfaces at Claude Code 2.1.295 (CC) and Codex 0.160.1 (CX).

| Surface | Reaches the model | After compaction | Subagents |
| --- | --- | --- | --- |
| `CLAUDE.md` | CC: a system reminder before the first prompt. CX: never; it would need `project_doc_fallback_filenames` (docs, `agents_md.rs:272`). | CC: re-read from disk and re-injected verbatim (`can-c3`; docs, "What survives compaction"). | CC: in a general-purpose subagent's own `instructions` attachment (`can-c`). Explore and Plan skip it (docs, sub-agents). |
| `AGENTS.md` | CC: only when no `CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md` sits at the working directory or above (`can-c`: both files, `HERON` never reached the model; `can-c4`: `AGENTS.md` alone, loaded). The reader is the built-in `cc-plugin-agents-md` (2.1.277 or later, default `claude-md-or-agents-md`). CX: a user message, `# AGENTS.md instructions for <cwd>`, at thread start, up to 32 KiB; skipped when the project is marked untrusted (`agents_md.rs:64`). | CX: re-injected after the compaction item (`can-x3`, rollout line 84). CC: not tested; docs treat it as project instructions. | CX: in the subagent's rollout, together with the parent's history (`can-x`). |
| SessionStart header and primer | CC: SessionStart hook context before the first prompt. CX: a developer message. Both at every `startup` and `resume`. | Both: SessionStart with `source: compact` re-injects the primer alone (`can-c2`; `can-x3` line 88). The header comes back on resume. | Both: SubagentStart gives the subagent its own registration and primer (`can-c`, `can-x`). |
| Skill description | CC: the skill listing. CX: the `<skills_instructions>` developer message. Main agent and subagents. | Both: still listed (`can-c3`, `can-x3`). | Both: listed. |
| Skill body | Only when loaded. CC agents loaded it in 0 of 19 condition sessions with the plugin; CX agents read `SKILL.md` with `cat` in 13 of 13. | CC: invoked bodies are re-injected, capped at 5,000 tokens each (docs); `SKILL.md` is 4,000 bytes. CX: not tested. | Only if the subagent loads it. |
| Report texts (PostToolBatch or PostToolUse, Stop, deny) | CC: hook context at the batch boundary. CX: a developer message after the tool call (`can-c`, `can-x`). | Both: only as the compaction summary; the next resume header restates current failures (`can-c3`: "no longer visible as a message of its own"). | Each agent gets its own. CC: SubagentStop runs `stop.mjs`. Its report went *into* the subagent and started another turn, so the parent received the subagent's reply to the report instead of its answer to the task (`can-c`). |
| `squeal --help` | Only when run. No agent ran it in 40 sessions. CC: `bin/` puts `squeal` on the Bash PATH. CX: `squeal` is not on PATH, and agents ran the primer's absolute path in all 17 of their Squeal calls. | n/a | n/a |

Two cautions. GPT under Codex declined to quote developer messages ("I can't reproduce private developer messages verbatim"), so a Codex agent's self-report about these surfaces is not evidence; only the rollout is. And `-c plugins."squeal@hearsay".enabled=false` on `codex exec` did not disable the plugin: its hooks ran and its skill stayed listed (`nb-x`).

## 2. Conditions

Fixture: 001's shape. Three modules, 10 tests in 4 files, one of them a 2.5 s integration stand-in. The daemon was warm, with a full-suite checkpoint completed before each session. Task 1 (`prompts/task.txt`): group thousands in `formatMoney`, which breaks three test files, "bring the tests in line … tell me whether the tests pass". Task 2: add three `applyDiscount` tests, with no question about test state. Agents could run Vitest under 001's allow-list. Ground truth came from `npx vitest run` after each session. Blocks: `probes/instruction-surfaces/conditions/`.

Table 2. Per condition: agent-run Vitest calls (scope, wall time), Squeal calls, session wall time, final claim. Per-session rows are in `logs/sessions.tsv`.

| Harness, task | Condition | n | Vitest runs by the agent | Squeal calls | Wall s | Claim true |
| --- | --- | --- | --- | --- | --- | --- |
| CC, 1 | a, plugin alone | 3 | 0 | 5 `status --wait` (0.6 to 3.5 s) + 3 refused compound | 26 to 47 | 3/3 |
| CC, 1 | b1, b2, b3 | 2 each | 0 | 1 or 2 `status --wait` each (1.3 to 3.8 s) | 17 to 32 | 6/6 |
| CC, 1 | c, gate `npx vitest run` | 3 | 5 full (3.3 to 3.7 s) + 1 refused | 0 | 23 to 32 | 3/3 |
| CC, 1 | d, gate `squeal run --all --wait` | 3 | 0 | 4 `run --all --wait` (1.9 to 3.7 s) | 17 to 30 | 3/3, one says "14 tests" for 14 checks |
| CC, 2 | a; b2 | 2; 2 | 0; 0 | 1 `status --wait` each | 12 to 21 | 4/4 |
| CX, 1 | a | 2 | 0 | 1 `status --wait` each | 35 to 39 | 2/2 |
| CX, 1 | b2 (with `nb-x`) | 3 | 0 | 5 `status --wait` | 33 to 53 | 3/3, `nb-x` says "14 affected tests" |
| CX, 1 | c | 2 | 2 full (3.0 s) | 1 `status --wait` each | 41 to 43 | 2/2 |
| CX, 1 | d | 2 | 0 | 4 `run --all --wait` (2.6 s) | 58 to 59 | 2/2, both say "N tests" for N checks |
| CX, 2 | a; b2 | 2; 2 | 0; 0 | 1 `status --wait` each | 20 to 22 | 4/4 |
| CC, 1 | b2 with markers, plugin absent | 1 | 1 full (3.5 s) | 1 attempted, refused | 29 | 1/1 |
| CX, 1 | b2 with markers, plugin absent | 1 | 1 full (3.1 s) | 0 | 37 | 1/1 |

Findings:

- **With the plugin and no gate, no agent ran tests.** No agent did in 22 sessions (13 Claude Code, 9 Codex, both tasks). Every agent waited on Squeal at least once before its final claim, and it never used `sleep`. In this setting the primer alone is the lever. 001 recorded 5 of 18 and 7 of 17 at 2.1.288 before the primer existed (task 001-88). The tasks and fixture differ, so the drop is *inferred*, not measured. 002 `codex-sessions-and-wake.md` 5 saw the same with SessionStart context in one run each.
- **The gate decides.** Under (c), all 5 sessions ran the full suite. Claude Code ran it twice in 2 of 3 sessions, using it as the fix loop; Squeal reported the same miss at the same batch boundary, after the run. Under (d), all 5 ran `squeal run --all --wait` instead and pasted it; 3 of them used it as their loop. The checkpoint ran only the files without a current result ("started at revision 6: 1 test files" in `cd3`). Codex turned "the command the SQUEAL messages name" into the primer's absolute CLI path in both (d) sessions. On this 3 s suite (d) saves no wall time; it saves the run on a suite that takes minutes, as 004 sq1 and 002 as2 showed.
- **The block added nothing measurable next to the plugin, and it worked as a fallback without one.** (b) scored 0 like (a). Without the plugin, both agents ran `npx vitest run`, citing the block ("no SQUEAL messages appeared this session, which is the fallback `CLAUDE.md` gives"). The Claude Code agent first tried `squeal status --wait 60000`, chained to its edits, and the allow-list refused it.
- **The weak spot is the unit, not the verdict.** Every pass/fail claim matched the ground truth. That is weak evidence, though, because every session ended green. In 4 of 34 sessions the agent reported Squeal's check count as tests ("All 14 tests pass" for 10 tests plus 4 file-level checks). Three of those were under (d), whose pasted output reads `Affected checks: 14 passed`.
- **The harnesses differ in where they look.** Codex agents read `SKILL.md` in every session (13 of 13), and Claude Code agents never loaded it (0 of 19). Under (d), Codex ran two checkpoints per session, and its sessions were the longest (58 s).

## 3. The block

| Wording | Bytes | Next to the plugin (CC) | Plugin absent |
| --- | --- | --- | --- |
| `b1`, the human's proposal: wait for Squeal, full suite only as a justified final gate, run tests when no SQUEAL message appeared | 469 | 0 runs, 2 sessions | not run |
| `b2`, a done-step: run `squeal status --wait 60000` (or the command SQUEAL names) before saying done, report failures and pending, else `npx vitest run` | 322 | 0 runs, 2 + 2 sessions; CX 0 runs, 3 + 2 | CC and CX: ran the suite, 1 each |
| `b3`, one line: SQUEAL messages and status are the test results; without them run `npx vitest run` | 141 | 0 runs, 2 sessions | not run |

The block must name the Codex command indirectly: `squeal` is not on a Codex agent's PATH, and a block cannot hold a per-user absolute path. A block telling the agent to skip Vitest contradicts a gate that requires Vitest in the same file. Claude Code's docs say contradicting instructions are resolved "arbitrarily", and (c) shows the gate wins over the primer, so the block has to defer to the gate. *Inferred:* no session put a block and a gate together.

## 4. The install step

- **Where.** `squeal init`. It already writes the one committed file Squeal owns (`squeal.config.json`) and edits `.claude/settings.json`. It also has a consent pattern: `--trust` asks one yes/no question, default no, changes nothing without a terminal unless `--yes` (`src/cli/init.ts`, 002 row 17). The board's Later entry "`squeal init` with a harness choice" is the seam. A skill is a poor home, because Claude Code agents loaded it in 0 of 19 sessions. An offer at a repository's first session costs context in every session to save one command, and editing a project file is the human's decision (vision 8). *Inferred.*
- **Which file.** Claude Code reads `CLAUDE.md`. It reads `AGENTS.md` only when no `CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md` exists, or when `CLAUDE.md` imports `@AGENTS.md`. A personal `CLAUDE.local.md` silently stops `AGENTS.md` from loading (docs). Codex reads `AGENTS.md` only. Rule: for Codex, write `AGENTS.md`. For Claude Code, write `AGENTS.md` when Claude Code reads it (no `CLAUDE.md`, or an `@AGENTS.md` import), else `CLAUDE.md`. Name the file in the question.
- **Markers.** `<!-- squeal:begin … -->` / `<!-- squeal:end -->`. Claude Code strips block-level HTML comments before injection: `squeal:begin` appears nowhere in `nb-c`'s transcript (docs agree). Codex passes them to the model verbatim: they are in `nb-x`'s rollout, and `agents_md.rs` has no comment handling. Upgrade replaces what lies between the markers. `squeal remove` should take the block out and list it under "Still there" when it cannot.
- **An existing gate.** Detect instruction lines that run the test command (`vitest run`, `npx vitest`, `npm test`). Never edit them silently. Offer the (d) rewording as its own question with the diff shown, and write the block with a clause deferring to the gate. (d) kept the gate's purpose, a full checkpoint with pasted output, and removed every Vitest run in 5 of 5 sessions.

## Recommendation for Squeal

1. **Keep the primer as the main surface.** It reaches the main agent and subagents in both harnesses, comes back after compaction, and carried the whole effect here. The skill is a reference: Codex agents read it, Claude Code agents did not need it.
2. **Make gate rewording the install step's main offer.** A gate is the one lever measured to change what agents run: (c) gave 5/5 full runs, (d) gave 0/5. Offer, never impose: (d)'s wording, or `stop.requireFullSuite` (not measured here).
3. **Write the block too, as `b2`, 322 bytes, plus a clause that defers to any gate in the file.** Its value is the fallback for collaborators without the plugin, which was verified in both harnesses, not more adoption where the plugin runs.
4. **Fix the unit in what a gate pastes.** `Affected checks: 14 passed` read as "14 tests" in 3 of 5 (d) sessions. The text should separate tests from file-level checks.
5. For 001: SubagentStop's report restarts the subagent and replaces its answer to the parent (`can-c`).

## Open questions

- Is the ceiling an artefact of a warm daemon and a 3 s suite? 002's Codex worker ran tests because Squeal's first result took 2 min. Not determined, because every session here had results within 4 s. The adoption-baseline and hook-levers topics should rerun (a), (c) and (d) on a cold or slow repository.
- Do sessions that end red get honest claims? Not determined, because none ended red.
- How does a block next to a gate behave, and how does `stop.requireFullSuite` compare with (d)? Not determined, because the 40-session budget went to the conditions above.
- `AGENTS.md` after Claude Code compaction, and skill bodies after Codex compaction: read in docs or not covered, not tested.

## Sources

- Claude Code docs, fetched 2026-10-09: https://code.claude.com/docs/en/memory ("AGENTS.md", "How CLAUDE.md files load", HTML comments stripped), https://code.claude.com/docs/en/context-window ("What survives compaction"), https://code.claude.com/docs/en/sub-agents ("What loads at startup").
- Codex docs, fetched 2026-10-09: https://learn.chatgpt.com/docs/agent-configuration/agents-md (redirected from developers.openai.com/codex/guides/agents-md).
- openai/codex `rust-v0.160.1` (`d27764b`): `codex-rs/core/src/agents_md.rs` (lines 58 to 68, untrusted projects; 272, candidate names), `codex-rs/core/tests/suite/agents_md.rs` (`untrusted_project_excludes_project_instructions`), `codex-rs/core/tests/suite/compact.rs`.
- This repository at `9848df0`: `src/harness/shared/primer.ts`, `src/harness/shared/session.ts` (primer alone after `compact`), `src/cli/init.ts`, `plugins/claude-code/hooks/hooks.json`, `plugins/*/skills/squeal/SKILL.md`; 001 and 002 `lessons.md`; 002 `research/codex-sessions-and-wake.md`.
- Probes: `probes/instruction-surfaces/` (README, `bin/`, `conditions/`, `prompts/`, `logs/`).
