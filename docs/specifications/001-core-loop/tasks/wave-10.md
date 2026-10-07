# Wave 10 briefs

From `lessons.md` defect 14 and the human's decisions of 2026-10-07: a timer-free waiter that wakes only an idle agent and only for its own pending checks, and revision attribution in headers. `--backend claude --model opus --effort high`, never Fable. 001-86 reviews 001-85; 001-87 is the attended check.

## 001-85 the waiter wakes only an idle agent, for its own pending checks; headers name what a revision changed

Use /worker. Shape: slice.

Outcome: mid-turn every report arrives in order through PostToolBatch or Stop with a current header; an idle agent is woken only by results of checks that were pending when it stopped; after an interrupt nothing wakes it and the news rides on the next prompt; every report says which files its revision changed.

Read: `lessons.md` "Reports out of order mid-turn" and defect 14, defects 8 to 10; spec D6, D9 (SessionStart, UserPromptSubmit, Stop, the idle waiter), D10 (waiter-lock liveness); `research/claude-code-integration.md` Q4.

Decided (do not re-open): no timers. Per consumer, a turn state: UserPromptSubmit sets in-turn and delivers the undelivered delta as context on the prompt; a Stop that ends the turn silently sets idle and records the checks pending at that moment; a Stop that speaks keeps in-turn. A session starts idle. The waiter prints only while idle, and only transitions of checks in that recorded set; everything else waits for the next prompt or tool boundary. After an interrupt (no Stop) the state stays in-turn. The header names the revision's changed files, at most three plus "and N more" (from the revision record the store already keeps).

Seam: `src/harness/claude-code/hooks/waiter.ts`, the delta check before it prints. Then `user-prompt-submit.ts`, `stop.ts`, the consumer record, and the header in `src/core/delivery/format.ts`. Where the turn state lives (a `consumers` column with a migration, or the existing waiter-lock or meta) is yours; say why in the report, and keep the hooks within their 80 ms p95.

Own: `src/harness/claude-code/`, `src/core/delivery/`, `src/core/store/` (a migration only if needed), `src/core/types/` (additive), `plugins/claude-code/skills/squeal/SKILL.md` (the paragraph on the waiter's label and report order), tests under `test/harness/`, `test/delivery/`, `test/store/`, D6, D9 in `spec.md`, one `status.md` line. Do not run `npm run build` or touch `plugins/claude-code/dist`. Commit as you go.

Done when: recorded hook JSON tests show (1) mid-turn news through PostToolBatch only, the waiter silent; (2) idle with a pending check, the waiter delivers its result; (3) idle with a change to a check not pending at Stop, the waiter silent and the next prompt carries it; (4) after an interrupt (UserPromptSubmit, no Stop), the waiter silent and the next prompt carries it; (5) a speaking Stop keeps in-turn; (6) headers name changed files with the cap. Hook latency test passes.

## 001-86 review of 001-85

Use /reviewer. Range: 001-85's commits as landed. Output `reviews/wave-10.md`. Outcome: whether any transition can now be lost or delayed past the next prompt or tool boundary. Probe: a waiter wake whose turn runs no UserPromptSubmit; Stop blocked by `blockOnKnownFailures`; compaction; a subagent's Stop; two sessions on one worktree; a store from 0.1.7 opened by the new code and the reverse; the hook p95.

## 001-87 attended check of wave 10

Use /worker. Shape: survey. Attended Claude Code session in tmux on a scratch fixture (never this repository's store), as `lessons.md` "Attended check after wave 6.5" did, with the new plugin build. Cases: idle wake for a check pending at Stop; a mid-turn break during `sleep 20` arrives after it through PostToolBatch only, header current and naming the file; an edit made from outside while idle does not wake; Esc mid-turn then a prompt carries the news. Append a dated subsection to `lessons.md` under "Reports out of order mid-turn"; close defect 14 there or name what still fails.

## 001-88 Squeal tells the agent how to use it, in the right place

Use /worker. Shape: slice. Runs after 001-85 and its review land; before 001-87, which then also records whether the agent runs Vitest itself.

Outcome: an agent in a Squeal repository stops running Vitest to learn what its edits did, keeps working while results come in, and reaches for `squeal status --wait` or `squeal why` only when it needs them.

Read: Matt Pocock's `writing-for-agents` and `writing-great-skills` (github.com/mattpocock/skills; fetch them, cite what you apply): context load, steps before reference, disclosed reference behind context pointers. Spec D7, D9; the current `plugins/claude-code/skills/squeal/SKILL.md`.

Decided by the human:
- The skill's description triggers when the agent is about to run tests (vitest, npm test) or check whether a change broke something, not "before claiming done".
- The body is steps first; counts, commands and policy move to `references/*.md`, reached by pointers.
- A short primer is injected by SessionStart where Squeal validates (and again after compaction): Squeal runs the Vitest tests; do not run Vitest to learn whether edits broke something; results arrive after your tool calls; run tests yourself only without a daemon, with unknown results, or when the repo's own gate requires it; Squeal does not cover typecheck, build or other suites.
- Every pointer to `squeal status --wait` says the default first: results arrive with your next tool call, so keep working; wait only when you need the result before your next step (for example before saying the task is done). The agent must not read a hint as "always run this".
- A FAIL report ends with one line, once per message: `Full output: squeal why "<name>"`.

Own: `plugins/claude-code/skills/squeal/` (SKILL.md and a new `references/`), `src/harness/claude-code/hooks/session-start.ts` (the primer), `src/core/delivery/format.ts` (the pointer lines), their tests, D9 in `spec.md`, one `status.md` line. Do not run `npm run build` or touch `plugins/claude-code/dist`. Commit as you go.

Done when: the primer appears in SessionStart registration for startup, resume and compact, and not in a repository without a store or config; the skill description and body match the decisions; a FAIL report carries the `why` line once; every `status --wait` pointer states the next-tool-call default; the hook latency test passes; the primer plus header stay under the 10,000-character cap with 40 known failures.
