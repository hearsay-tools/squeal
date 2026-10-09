# Adoption baseline (005-01)

Why agents run tests themselves today, and how to measure a change. Researcher task 005-01, 2026-10-09. Records read: the lessons of specs 001 to 004 and every transcript they name that is still on disk (76 sessions: Claude Code 2.1.288 and 2.1.291 with `claude-sonnet-5-5`, Codex CLI 0.160.1 with `gpt-6.1-sol`). Wider record: every Cezar session in this repository's worktrees (237) and cezar's (93) that registered with Squeal, 2026-10-04 to 10-09, Claude Code 2.1.286 to 2.1.295 and Codex 0.160.1. No agent session was started (0 of 40, $0). Script, outputs and limits: `probes/adoption-baseline/`. Readings of the record itself (lessons, transcripts, store copies) are tagged `read in source code`, the record being the source; counts the script produced are `verified by experiment`.

## Questions answered

| # | Question | Answer |
| --- | --- | --- |
| 1 | Every agent-initiated run, with reason | 32 runs in the named record (table below). Reasons: none stated, right after the agent's own edit 9; confirming a fix 7; no daemon 6; Squeal's coverage text 4; a repository gate 3; investigating a reported failure 2; a red step 1; distrust of a header 0. In the wider record (2,440 runs here, 746 in cezar) agents rarely say why; by position: own change 55%, re-run 18%, gate 17%, name pattern 9%. |
| 2 | Redundant runs, and the cross-check's value | Named: 3 runs while Squeal held a current result, 6 more that Squeal answered during the run. Store-checked here: 61 of 277 (22%) redundant, 139 partly, 77 not covered. Five cases found Squeal wrong: a runtime read and two spawned-process inputs outside the key (named), a stale module cache after a rebase and a load-caused FAIL kept current (wider). |
| 3 | A metric computed without hand reading | `probes/adoption-baseline/metric.mjs`, run over all three records. It reproduces 001's "5 of 18" exactly. False claims are not determined automatically: the text heuristic's 7 flags in the named record were all true claims. |
| 4 | Prior art | beads, Nx and Serena each write a marked, upgradable block that points at the tool and, for beads and Nx, names the habit to replace. Claude Code reads `CLAUDE.md` and reads `AGENTS.md` only without one; Codex reads `AGENTS.md`. Serena backs words with a rate-limited deny that tells the agent it may retry. |

## 1. Agent-initiated runs in the named record

Tag: `verified by experiment` (the script over the transcripts) for command, scope, wall time and what Squeal last told the agent; `read in official docs` is not applicable; the lessons files are cited where they hold what Squeal knew; `inferred` where marked. Wall time is the transcript's tool-call span, or Codex's recorded `duration`.

| # | Session | Command | Scope | Wall s | Reason (stated, or evident) | Squeal at that moment |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 001 P1 | `npx vitest run` 3 files | files | 1.8 | none stated, 1.6 s after its edits | not reached: first result 80 s after the edit |
| 2 | 001 P2 | `plugin.test.ts` after `npm run build` | files | 1.7 | confirming its fix of the failure Squeal reported | wrong: kept FAIL current after the rebuild (runtime read, surprise 2) |
| 3 | 001 P3 | `why.test.ts` | files | 1.6 | none stated, 0.3 s after the edit | result known 0.5 s after the edit, during the run |
| 4, 5 | 001 F2, F4 | `npm test`, `npx vitest run` | full | 3.1, 3.6 | none stated, 0.4 s after the edits | known during the run (inferred: fixture p50 2.4 s) |
| 6 | 001 W1 | `money.test.ts` | files | 12.3 | investigating a failure the waiter reported, not its own | current FAIL, delivered |
| 7 | 001 D1 | `npx vitest run` | full | 3.3 | no daemon: "Its "0 failures" doesn't cover my change" | daemon stopped by the probe |
| 8 | 001 re-run F2 | `npx vitest run` | full | 4.0 | confirming a fix: "Now let me run the tests" | 4 recoveries delivered, 3 checks pending |
| 9 | 001 re-run F3 | `money.test.ts` | files | 2.3 | none stated, no edit | current, nothing pending: redundant |
| 10 | 001 re-run F4 | `format.test.ts` | files | 4.8 | none stated, 0.3 s after the edit | known during the run (inferred) |
| 11 | 001 R2 | `plugin.test.ts` after a build | files | 1.5 | confirming a fix | 11 pending |
| 12 | 001 R3 | `why.test.ts` | files | 1.6 | none stated, 0.3 s after the edit | known 0.5 s after the edit, during the run |
| 13, 14 | 001 R6 | `test/daemon test/e2e test/harness` ×2 | files | 48.2 ×2 | after its edits, then confirming a fix | not reached: a tier of 45 s timeouts held the queue for 135 s |
| 15 | 001 S1 | 2 files after a build | files | 1.7 | none stated, 2.2 s after the edit | 195 pending |
| 16, 17 | 001 S4 | `test/cli test/status` ×2 | files | 12.5, 12.3 | reading the 7 failures Stop named; confirming the fix | 7 current failures: redundant; then pending |
| 18 | 001 G1a | `npx vitest run` | full | 3.8 | confirming its fix of 5 reported failures | not reached at start (inferred) |
| 19 | 002-19 | `graph-memory.test.ts` | files | 11.8 | red step, started while its own `status --wait 60000` still waited | not reached: new file unlisted behind a cold baseline at load 80; the wait timed out |
| 20 | 002-19 | `graph*.test.ts` | files | 11.4 | confirming the fix | not reached; later kept a stale FAIL current (002 defect 5) |
| 21 | 002-19 | `npx vitest run --silent=false` | full | 247.4 | gate: the brief required the full suite, pasted | baseline incomplete, 129 files without checks |
| 22, 23 | 003-19 s2 | `node --import tsx --test stop-child.test.ts` ×2 | files | 0.3, 0.2 | coverage text: "Squeal only covers Vitest" | not reached: its run started 4 min 17 s later |
| 24, 25 | 003-19 s3 | node:test `cursor-hang-stdin.test.ts` ×2 | files | 0.2, 0.2 | coverage text | wrong: stale PASS current, file never re-run (003 defect 6) |
| 26 | 004-17 sq1 | `npx vitest run` | full | 205.0 | gate: `AGENTS.md` verification | own test current; 10 slow files pending |
| 27 | 004-17 sq2 | `npx vitest run test/harness` | files | 13.1 | gate, cited | 81 pending |
| 28 | 004-17 sq3 | `test/e2e/policy.test.ts` | files | 93.4 | no daemon | none validating (004 defect 5) |
| 29 to 31 | 004-17 cz1 | node:test `todo-task-text.test.ts` ×3 | files | 0.5, 0.4, 0.4 | no daemon | none validating (004 defects 5, 6) |
| 32 | 004-17 cz2 | `npm test -w ... provider-action-gate.test.ts` | files | 2.6 | no daemon | none validating |

Counts per reason: none stated after its own edit 9 (1, 3 to 5, 9, 10, 12, 13, 15); confirming a fix 7 (2, 8, 11, 14, 17, 18, 20); no daemon 6; Squeal's own coverage text 4; repository gate 3; investigating a reported failure 2; red step 1; distrust of a header 0. What Squeal knew: current at start 3, known during the run 6, not reached 12, partly 2, wrong 3, no daemon 6. Total wall time 12.6 min, 7.5 of it the two full Codex gate runs.

**The wider record** (`verified by experiment`). Here, 210 of 226 editing sessions ran tests themselves (93%): 2,440 runs, 1,506 min of wall time, scope files 1,803, full 412, name pattern 224. In cezar 37 of 61 (61%): 746 runs, 680 min. Agents state no reason before most runs, and the reasoning is hidden (Claude Code `thinking` empty, Codex reasoning encrypted), so the script classes runs by position: a full run is a gate; the same files with no edit since are a re-run; a name pattern is an investigation; files after its own edits are a check of its own change. On a random sample of 40 runs this agreed with my hand labels 32 times (`inferred`); the word classifier agreed 17 of 37. By position, here: own change 1,348 (55%), re-run 440 (18%), gate 405 (17%, but 591 min, 39% of the wall time), investigation 224 (9%). Cezar: own change 380, investigation 226, re-run 86, gate 51. Own-change runs start 9.9 s after the edit at p50 here (19.8 s in cezar). Pulls: 76 of 237 sessions here, 72 `status --wait`; in cezar Codex sessions pulled 184 times, Claude Code sessions 22.

**One agent's own account** (`read in source code`: transcript `-home-agent-projects-cezar--ai-cezar-worktrees-1fb4b5b3-…/416790cd`, the human's question at 13:51 UTC, its answer in the screenshot `.ai/cezar/runs/87218933-…-images/pasted-1.png`). Asked whether it used Squeal, a Claude Code worker on cezar said: "Mostly by myself… I never queried it (`squeal status --wait`, `squeal why`)". Its reasons, its own grading: the new test file needed `console.log` output ("Squeal only reports pass/fail"); a red/green proof by reverting the fix ("the timing would have been muddled"); neighbouring suites and 33 timed-out files ("avoidable… I should have waited"); the full gate ("required… Squeal doesn't cover typecheck, build, the package tests or e2e"). The script's store column for that session: 10 of its 13 runs covered files Squeal had not run yet at load 100 to 170.

## 2. Redundant runs and what the cross-check is worth

Redundant means Squeal held a current result for every file the run covered when it started. Named record (`inferred` from the lessons and the transcripts; the store rows of those worktrees are pruned): 3 redundant at start (9, 6, 16), and 6 that Squeal answered while the run was still going (3, 12 measured; 4, 5, 10, 18 inferred). Wider record, from copies of the stores (`verified by experiment`, with the approximation the probe README names): of 277 runs whose worktree rows survive, 58 redundant and 3 more redundant if lookups count (22%), 139 partly current (50%), 77 not covered (28%). Cezar: 14 of 82 (17%), 52 not covered.

Runs that found Squeal wrong, the value of the agent's own run:

- Named: 2 (P2) false FAIL kept current for a test that reads build output at runtime; 24 and 25 (003 s3) false PASS for a test reaching its input through a spawned process; 20 (002-19) the agent's pass beside a FAIL Squeal then kept current. Removing the agent's run would have cost a false "Known failures: 0" on a broken mock in s3, the costliest kind, and false failures reported or chased in P2 and 002-19.
- Wider: of the 23 redundant runs with a readable outcome, 14 agreed and 9 disagreed. By reading those 9: Squeal held a wrong current result twice (a FAIL that "looks like a stale module cache after my rebase", `run-slow.test.ts`, 2026-10-08 21:39 UTC; a load-caused FAIL kept current, `step-down.test.ts`, 10-09 11:54 UTC, passing 3 of 3 alone); the agent's own run flaked under load 3 times; the agent ran another code state on purpose 3 times (a fix reverted to watch a test fail); a different Node once.

Each catch came from an input or condition outside the key: runtime reads, spawned processes, a module cache, host load. Observed runtime inputs (001-132, on by default) now cover the read and spawn cases (`read in source code`: spec 001 D3 and D4); review wave-13e still proves three false-current-PASS paths at `a04226c`. So the cross-check still pays, rarely: five cases, three among the 32 named runs and two among the 23 store-checked runs whose outcome could be compared.

## 3. The metric

`probes/adoption-baseline/metric.mjs` (`verified by experiment` on all three records, 40 s in total). Per session, from Claude Code transcripts or `stream-json`, Codex rollouts or `exec --json`, and optionally a store copy:

- **Own runs** by scope (full, files, pattern), runner, wall time, outcome read from the runner's summary, reason by position;
- **Redundant**: every covered file had a completed run in that worktree after the last change to its closure (`--store`), plus the state Squeal last showed the agent and edits since;
- **Cross-check**: agent outcome against Squeal's current outcome for redundant runs;
- **Pulls and waits**: `squeal status`, `status --wait`, `why`, `run`; skill loads; Squeal messages that reached the model, by kind;
- **False final claims**: not determined, because free text defeats a pattern. The script's flags matched 7 final messages in the named record and all 7 were true, qualified claims ("No full-suite run has completed at this revision, so I can't say the whole suite passes").

Checks: it reproduces 001's 5 of 18 editing sessions with own runs, and finds 7 of 18 where the lessons say 7 of 17. Baseline for the spec's proof, per editing session here: 10.8 own runs, 9.0 outside a full-suite gate, 6.7 min of test wall time; 32% of sessions pulled Squeal at least once.

## 4. Prior art

Each `read in source code` or `read in official docs`, 2026-10-09.

- **beads** (`steveyegge/beads` at `c4c66d4`). `bd onboard` prints a 10-line block for `AGENTS.md` that points at `bd prime`; `bd setup <agent>` writes it between `<!-- BEGIN BEADS INTEGRATION v:N profile:P hash:H -->` and `<!-- END … -->`, updates it in place, refuses to write through a symlink, offers `--check` and `--remove`, and keeps a richer profile over a poorer one. A SessionStart hook runs `bd prime` for dynamic context, re-run after compaction. The block names the habit it replaces ("do NOT use TodoWrite, TaskCreate, or markdown TODO lists") and its own rank ("guidance, not permission to override repository, user, or orchestrator instructions"). Squeal can reuse the versioned, hashed marker, `--check`/`--remove`, the symlink guard, and a short pointer with the live detail in the hook.
- **Nx** (`nrwl/nx` at `23804ef`, `packages/nx/src/ai`). `nx configure-ai-agents` writes `AGENTS.md` for Codex and others and `CLAUDE.md` for Claude Code, between `<!-- nx configuration start-->` and `<!-- nx configuration end-->` with "Leave the start & end comments to automatically receive updates", and `--check` reports outdated blocks. Its rule is the nearest analogue to Squeal's: "When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` … instead of using the underlying tooling directly". Squeal can reuse the per-harness file choice and one imperative naming the commands it replaces.
- **Serena** (`oraios/serena` at `1de556f`). Onboarding is a tool that has the agent write memories, `task_completion` among them ("exact commands to run when a coding task is considered done"), which records the habit rather than redirecting it. Its docs say agents drift from its tools ("agent drift") and "strongly recommend" a `remind` PreToolUse hook: after 3 consecutive greps or reads it denies once with "You can continue using grep now if needed, the counter was reset", plus `additionalContext`, at most once per 120 s. That is a deny that steers by permitting the retry, for 005-03.
- **agents.md** (`agentsmd/agents.md` at `d001185`). The convention tells agents to run what the file lists: "Will the agent run testing commands found in AGENTS.md automatically? Yes, if you list them". The closest file wins; the user's prompt overrides all. A listed test command is the habit's source.
- **Claude Code memory** (code.claude.com/docs/en/memory; installed 2.1.295). `CLAUDE.md` is "delivered as a user message after the system prompt… no guarantee of strict compliance"; "To block an action regardless of what Claude decides, use a PreToolUse hook". Project-root `CLAUDE.md` is re-read after `/compact`; nested ones load on demand. `@path` imports, four hops. `AGENTS.md` is read by the built-in `cc-plugin-agents-md` (2.1.277 and later) only when no `CLAUDE.md` or `CLAUDE.local.md` exists at or above the working directory, unless `instructionFiles` is `claude-md-and-agents-md`. This repository has both files with the same gate line, so Claude Code reads only `CLAUDE.md`. A block written only to `AGENTS.md` misses Claude Code in such repositories.
- **Codex AGENTS.md** (learn.chatgpt.com/docs/agent-configuration/agents-md). Global `AGENTS.override.md` or `AGENTS.md`, then one file per directory from the git root down to the working directory, concatenated so closer files come later and win, read once per run, capped by `project_doc_max_bytes` (32 KiB).
- **Skill triggers.** Claude Code lists each skill's name and description every turn (combined description cap 1,536 characters; listing budget 1% of context, descriptions of the least-used skills dropped first), loads the body on use, re-attaches up to 5,000 tokens of an invoked skill after compaction, and recommends a hook for "a rule that must hold every time"; `claude plugin eval` with a `tool_used: Skill` grader measures trigger rate. Codex lists name, description and path within 2% of context, shortens descriptions first when crowded, and allows `allow_implicit_invocation: false`. Both say: front-load the use case and trigger words. In the named record agents loaded the Squeal skill 23 times unprompted, and both `status --wait` calls of 001's re-run came after a skill load.

## Recommendation for Squeal

Reasons, ranked by runs explained. Named record: checking its own change with no reason stated (9), confirming a fix (7), no daemon (6), Squeal's coverage text (4), a gate (3). The no-daemon and coverage-text runs had product or harness causes: the primer now names node:test (003 defect 1, `primer.ts`), 0.1.59 fixed the step-down deadlock (004 defect 5), and 004 defect 6 is Codex failing every hook after a mid-turn plugin replace (openai/codex#31383). They are 1% of the wider record. Wider record: own change 55%, re-run 18%, gate 17% of runs and 39% of wall time, investigation 9%. Underneath most of them, the store says Squeal often had nothing yet: in 216 of 277 store-checked runs (78%) at least one covered file had no completed run in that worktree since its last change. The agent starts about 10 s after its edit (p50); under load, Squeal's result takes minutes.

Levers, in the order the evidence supports:

1. **A wait the agent can trust for its own files.** Own-change and red/green runs are the majority, and the one agent asked said it did not trust the timing. `status --wait` waits for everything pending and timed out at 60 s in 002-19 and 003-19. Words alone cannot fix a wait that does not return; 005-03 question 3 asks what a per-file wait needs.
2. **The repository gate, reworded or satisfied by Squeal.** 17% of runs, 39% of wall time. The gate line here ("`npx vitest run`… Paste the output") sits in `CLAUDE.md` and `AGENTS.md` and in the worker, reviewer and coordinator skills. The install block must not contradict it; 005-02 condition (d) tests a gate Squeal can satisfy.
3. **A marked block in the instruction file, per harness**, shaped like beads and Nx: versioned markers, `--check`, `--remove`, `CLAUDE.md` for Claude Code and `AGENTS.md` for Codex, one sentence naming the commands it replaces and when to run them anyway. Expected effect small on its own: the primer and skill already say this and are read.
4. **`squeal why` with the run's console output**, for investigation runs (9%) and the red step's debugging; a product gap the coordinator named on 2026-10-09, not an adoption text.
5. **Hooks**: 22% of store-checked runs were redundant at start, the most a takeover answering from current results could absorb without waiting. Keep an escape: the cross-check found Squeal wrong 5 times.

The proof's metric: own runs outside a full-suite gate per editing session (baseline 9.0 here), the redundant share by store, `status --wait` per session, and test wall time, all from `metric.mjs`. Add a fixed last line to every 005-02 prompt (for example `TESTS: pass | fail | unknown, evidence: …`) and a full run after each session, so false claims become countable.

## Open questions

- False final claims: not determined in the record; needs the structured last line above, or a judge model reading the final message beside the script's evidence.
- Redundancy for the named record: not determined from a store, because the dogfood worktrees' rows were pruned. Later dogfooding should copy the store before removing a worktree.
- This repository is atypical: agents build Squeal, so "no daemon" in their words is often the product under test, and `squeal start`/`stop` are tests, not pulls.
- The position classifier is 32 of 40 on one sample; probe runs by reviewers and red steps written with `-t` are its known misses.
- Codex sessions in cezar pulled Squeal 184 times against 22 for Claude Code sessions there and run tests in fewer sessions (12 of 28 against 25 of 33). Not explained here; the sessions differ in role and model.

## Sources

- Lessons: `docs/specifications/001-core-loop/lessons.md` (Setup, Sessions, What agents did, re-run, attended runs), `002-codex-adapter/lessons.md` (proof, 002-19), `003-node-test-runner/lessons.md` (003-19), `004-slow-suites/lessons.md` (004-17); `001-core-loop/spec.md` D3, D4; `001-core-loop/reviews/wave-13e.md`.
- Transcripts: `~/.claude/projects/-tmp-squeal-dogfood-*`, `-tmp-sq46-*`, `-tmp-sq6-*`, `-tmp-sq65-*`; `~/.codex/sessions/2026/10/08/rollout-…-01a1188e…`, `…-01a11ab3…`, `…-01a11abf…`, `…-01a11ac4…`, `2026/10/09/rollout-…-01a11f55…`, `…-01a11f5c…`, `…-01a11f6e…`; the Cezar worktree sessions listed in `probes/adoption-baseline/README.md`; coordinator transcript `-home-agent-projects-squeal--ai-cezar-worktrees-87218933-…/48c5c8c8-…` (14:00:56 UTC reply on the agent's account).
- Stores: copies of `/home/agent/projects/squeal/.git/squeal/store.sqlite` and `/home/agent/projects/cezar/.git/squeal/store.sqlite`, 2026-10-09 16:25 local.
- beads: https://github.com/steveyegge/beads at `c4c66d4` (`cmd/bd/onboard.go`, `cmd/bd/setup.go`, `cmd/bd/setup/agents.go`, `cmd/bd/setup/claude.go`, `internal/templates/agents/`).
- Nx: https://github.com/nrwl/nx at `23804ef` (`packages/nx/src/ai/constants.ts`, `set-up-ai-agents/`); https://nx.dev/docs/reference/nx-commands, https://nx.dev/docs/getting-started/ai-setup.
- Serena: https://github.com/oraios/serena at `1de556f` (`src/serena/hooks.py`, `src/serena/tools/workflow_tools.py`, `resources/config/prompt_templates/simple_tool_outputs.yml`, `docs/02-usage/030_clients.md`).
- agents.md: https://github.com/agentsmd/agents.md at `d001185` (`components/FAQSection.tsx`).
- Claude Code: https://code.claude.com/docs/en/memory, https://code.claude.com/docs/en/skills (fetched 2026-10-09; installed 2.1.295).
- Codex: https://learn.chatgpt.com/docs/agent-configuration/agents-md, https://learn.chatgpt.com/docs/build-skills (fetched 2026-10-09; installed 0.160.1).
