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

Use /reviewer. Range `6d414e5..13d2cb5` (001-85 plus two coordinator test fixes: the e2e header parser and the bundled waiter test). Note from the worker: the turn state lives in `meta`, one row per worktree, so two sessions on one worktree is the first probe; the latency test only asserts below load 4, so measure p95 on a quiet window or report that CI asserted it. Output `reviews/wave-10.md`. Outcome: whether any transition can now be lost or delayed past the next prompt or tool boundary. Probe: a waiter wake whose turn runs no UserPromptSubmit; Stop blocked by `blockOnKnownFailures`; compaction; a subagent's Stop; two sessions on one worktree; a store from 0.1.7 opened by the new code and the reverse; the hook p95.

## 001-87 attended check of wave 10

Use /worker. Shape: survey. Attended Claude Code session in tmux on a scratch fixture (never this repository's store), as `lessons.md` "Attended check after wave 6.5" did, with the new plugin build. Cases: idle wake for a check pending at Stop; a mid-turn break during `sleep 20` arrives after it through PostToolBatch only, header current and naming the file; an edit made from outside while idle does not wake; Esc mid-turn then a prompt carries the news. Also, from `reviews/wave-10.md` "Inputs for the next wave": edit a file whose tests were not pending at Stop for the outside-edit case; record the hook latency table (silent Stop included) at the lowest load you can get; confirm the prompt context after Esc arrives before the model's first tool call; note whether the agent read the primer and ran Vitest itself. Load the plugin from this checkout's `plugins/claude-code` (0.1.9) with `--plugin-dir`, not the user's installed copy. Append a dated subsection to `lessons.md` under "Reports out of order mid-turn"; close defect 14 there or name what still fails. Leave the scratch fixture and any daemon you started stopped.

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
- Header wording (`reviews/wave-10.md` S4, decided b, implemented by 001-89): the header names the files changed since the agent's last report; the skill says so and does not claim it names the cause.
- Measure SessionStart with the primer against the 80 ms budget using 001-89's latency cases once they land, or report p95 at the lowest load you can get.

Own: `plugins/claude-code/skills/squeal/` (SKILL.md and a new `references/`), `src/harness/claude-code/hooks/session-start.ts` (the primer), `src/core/delivery/format.ts` (the pointer lines), their tests, D9 in `spec.md`, one `status.md` line. Do not run `npm run build` or touch `plugins/claude-code/dist`. Commit as you go.

Done when: the primer appears in SessionStart registration for startup, resume and compact, and not in a repository without a store or config; the skill description and body match the decisions; a FAIL report carries the `why` line once; every `status --wait` pointer states the next-tool-call default; the hook latency test passes; the primer plus header stay under the 10,000-character cap with 40 known failures.

## After 001-86

`reviews/wave-10.md` passed 001-85 with S1 to S5 should-fix. S4 decided by the coordinator: option (b), the header names the files changed since the revision this consumer was last told about. 001-89 takes S1, S2, S3, S4 (b), S5; 001-88 takes S4's skill wording and measures its primer with S5's cases. They run in parallel on disjoint files.

## 001-89 turn state and attribution fixes

Use /worker. Shape: repair. Outcome: no transition can be marked delivered without reaching the agent, the waiter never speaks mid-turn because of a stale idle state, an idle agent is woken only by a result still owed to it, and a header names the edits since the agent's last report. Read: `reviews/wave-10.md` S1 to S5 (each has fix steps), N2, "Inputs for the next wave". Seam: `src/harness/claude-code/hooks/user-prompt-submit.ts`, the discarded `startTurn` result (S1). Then S2 (a tool call, in PostToolBatch, marks the consumer in a turn), S3 (trim the waited-for set as each file's result lands), S4 (b) (`changedPaths` is the union over revisions since the consumer's last told revision, capped as today), S5 (silent Stop and silent UserPromptSubmit cases in `latency.test.ts`; if a silent Stop misses 80 ms p95 at low load, fold `endTurn` into the delivery transaction). Own: `user-prompt-submit.ts`, `post-tool-batch.ts`, `stop.ts`, `src/core/delivery/` except `format.ts`, `test/delivery/`, `test/harness/` except tests of `session-start.ts` and the skill, D6 and D9 sentences, one `status.md` line. Leave `format.ts`, `session-start.ts`, `SKILL.md` to 001-88. Done when: probes P1 and P2 of the review are tests; a stale idle state is corrected by the next tool call (test); a header after two revisions since the last report names both revisions' files; the latency cases exist and report p95.

## 001-90 squeal remove

Use /worker. Shape: slice.

Outcome: one command takes Squeal out of a repository: every worktree's daemon stopped, the shared state and this repository's temp directories gone, and a message saying what is left.

Read: spec D1 (store location, socket), D7 (CLI), D10 (lifecycle, temp directory keyed by repository id), D11 (`squeal.config.json`, committed); `src/cli/stop.ts`, `src/cli/daemon-access.ts` (`daemonSocket`, `askDaemon`), `src/core/daemon/scratch.ts` (repository id, temp dir naming).

Seam: a new `src/cli/remove.ts`, registered in `src/cli/main.ts` beside `stop`. First edit: list every worktree recorded in the store with a daemon, ask each to stop through `locateDaemon`, then wait until each worktree lock is free.

Behaviour:
- Stops every daemon of the repository, not only this worktree's; refuses with the worktree path and exit 1 if one does not stop within a few seconds. Deletes nothing in that case.
- Deletes `<common-dir>/squeal/` (store, locks, runs, `repository-id`) and the repository's temp directories under `/tmp/squeal-<uid>/tmp/` (by its repository id), only after every lock is free.
- `--config` also deletes `squeal.config.json` at the worktree root; without it, the config stays and the message says the next session will start Squeal again.
- Prints what it removed and what remains: the plugin (`claude plugin uninstall squeal`) and the config when kept. Idempotent: on a repository with nothing to remove it says so and exits 0.

Own: `src/cli/remove.ts`, `src/cli/main.ts` (one command), `src/cli/index.ts` if it lists commands, `test/cli/remove.test.ts`, `plugins/claude-code/skills/squeal/references/commands.md` (one entry), `plugins/claude-code/README.md` (uninstall section), D7 in `spec.md`, one `status.md` line. Leave `src/core/daemon/` alone unless the stop path needs a hook; ask first. Do not run `npm run build` or touch `plugins/claude-code/dist`. Commit as you go.

Done when: a test with two worktrees and two real daemons runs `squeal remove`, both daemons exit, `<common-dir>/squeal/` and the temp directories are gone, and a SessionStart hook afterwards in a worktree without a config prints nothing; a daemon that will not stop makes it exit 1 with nothing deleted; `--config` removes the config; a second run says nothing to remove.

## 001-91 reports: fewer lines, and where a result came from

Use /worker. Shape: slice. Runs beside 001-90 (disjoint files); a /reviewer follows.

Outcome: a report is short when many checks recover, still names what changed, and says for each failure that Squeal's runner saw it and whether the agent's changes reach it.

Read: `lessons.md` "Report volume and provenance", defects 15 and 16; spec D3 (closure, installed-dependency fingerprint), D6 (delta, message format, 10,000-character cap), D9.

Decided by the human:
- Recoveries: up to 5 are listed as today. Above 5, one summary line ("31 checks recovered (FAIL -> PASS)"), then the shorter of two lists: the recovered checks, or the checks still failing ("still failing: 2" and their names). A long list is grouped by test file with counts. New failures are always listed in full. Retired checks (RESOLVED, no longer reported) collapse the same way.
- Install context: when the worktree's installed-dependency fingerprint is empty, the header says once that no dependencies are installed, so failures that cannot find a package are expected until an install. A report whose revision changed the installed lockfile says the recoveries or failures follow an install.
- Runner label: replace "baseline finding" with wording that says Squeal's own run saw it at revision N (and at start, when it was the baseline).
- Attribution: each failure says whether its closure contains any file changed since the consumer was registered (the revisions since its registration revision): "touches your changes: src/x.ts" (at most 3, then "and N more") or "none of your changes are in its imports". Inherited results say the same against this worktree's changes.
- Timeouts: a failure that is a test timeout carries the load average at the time of its run, recorded with the run.

Seam: `src/core/delivery/format.ts` and `delta.ts` (the recovery collapse), then the attribution read in `src/core/delivery/` from the stored closures. Own: `src/core/delivery/`, `src/core/types/` (additive), `src/runners/vitest/run.ts` and `results.ts` (timeout load, if recorded there), `src/core/store/` (only an additive field for the load; a migration only if needed, ask first), tests under `test/delivery/`, `test/e2e/` header parsing if it changes, `plugins/claude-code/skills/squeal/references/reports.md`, D6 in `spec.md`, one `status.md` line. Leave `src/cli/` alone (001-90). Do not run `npm run build` or touch `plugins/claude-code/dist`. Commit as you go.

Done when: tests show 31 recoveries with 2 still failing as one summary plus the 2 names; 31 recoveries with 20 still failing as the summary plus the recovered list grouped by file; 4 recoveries listed in full; the no-dependencies note once; the install label after a lockfile change; a failure with and without a changed file in its closure; a timeout with its load; the message stays under the cap with 40 failures.

## 001-92 review of 001-91

Use /reviewer. Range `c2196e3..b5581e0`, the 001-91 commits plus the coordinator's e2e assertion fix. Output `reviews/wave-10b.md`. Outcome: whether the collapsed reports and the attribution are true at every edge. Probe: inherited results (whose changes does "touches your changes" compare against), a test file whose closure was never collected, retired checks collapsing beside recoveries, 6 recoveries with 6 still failing (tie), the 10,000-character cap with 40 failures and 300 recoveries, the no-dependencies note on a worktree mid-install, a timeout recorded by 0.1.9 (no load field) read by 0.1.10, and whether the registration revision survives SessionStart `resume` and `compact`. Do not re-check "What fits" from earlier reviews.

## 001-93 any tool call marks the agent in a turn

Use /worker. Shape: slice. Decided by the human: PreToolUse on every tool.

Outcome: when another plugin's Stop hook continues a turn after Squeal's silent Stop, the continuation's first tool call puts the consumer back in a turn before it runs, so the waiter never speaks mid-turn (`lessons.md` "Defect 14 after wave 10", case 5b) and no repository without Squeal pays a Node start per tool call.

Read: `lessons.md` "Attended check after wave 10" and "Defect 14 after wave 10"; spec D9 (PreToolUse, turn state); `plugins/claude-code/hooks/hooks.json`; `src/harness/claude-code/hooks/pre-tool-use.ts`, `src/core/delivery/turn.ts`.

Seam: `hooks.json`, the PreToolUse matcher. Then `pre-tool-use.ts`: for every tool, an idle consumer goes back in a turn (the same correction PostToolBatch does since 001-89), in one small transaction; the deny-once policy stays on `Edit|Write|NotebookEdit` only; a fork stays ignored.

Fast path: the PreToolUse command in `hooks.json` first runs a POSIX `sh` test that exits 0 with no output unless the project uses Squeal: `squeal.config.json` at `$CLAUDE_PROJECT_DIR`, or `<git dir>/squeal` for a main checkout, or, for a linked worktree, the common dir its `.git` file names (`gitdir:` then `commondir`). No Node, no `git` process. Apply the same fast path to PostToolBatch if it is cheap to share.

Own: `plugins/claude-code/hooks/hooks.json`, `src/harness/claude-code/hooks/pre-tool-use.ts`, `src/harness/claude-code/` helpers it needs, `src/core/delivery/turn.ts` (only if the correction needs a new entry point), tests under `test/harness/` (pre-tool-use, plugin manifest, latency), `test/e2e/` only if the manifest test lives there, D9 in `spec.md`, one `status.md` line, and a dated line closing defect 14 in `lessons.md` if the tests show case 5b fixed. Do not run `npm run build` or touch `plugins/claude-code/dist`. Commit as you go.

Done when: a recorded-JSON test runs a silent Stop, then a PreToolUse for `Bash`, then a result for a waited file, and the waiter stays silent while the next PostToolBatch delivers it; the deny-once policy still fires only on edits; the fast path exits 0 silently in a repository with neither config nor store (main checkout and linked worktree), measured under 10 ms p95, and runs the hook where Squeal is used (main checkout, linked worktree, config only); the latency test gains a PreToolUse-on-Bash case.

## After 001-92 and 001-93

001-93 landed (0.1.11, `e74f82d`); defect 14 is closed for case 5b. `reviews/wave-10b.md` failed 001-91 on B1 and B2. B2 decided by the coordinator: option (b), saying nothing over saying something wrong. 001-94 repairs; 001-95 re-reviews it (second and last round on the 001-91 slice) and gives 001-90 its first review (N6).

## 001-94 attribution repairs

Use /worker. Shape: repair. Outcome: "touches your changes" names only files the agent's own session changed, or says nothing. Read: `reviews/wave-10b.md` B1, B2, S1, S2, N1 to N5 (each has fix steps); spec D6. Seam: `src/core/delivery/delivery.ts` `register` (B1: keep an existing registration revision while the consumer stays registered; also for N4's re-registration of the same session). Then B2 (b): SessionStart's `settle` waits within its budget for a marker the daemon writes after `bootstrap`; if the wait runs out, record no registration revision, so no attribution line appears for that consumer. S1: amend D6 and the header so a header never says both "no dependencies installed" and "follow a dependency install", and a deleted lockfile is not labelled an install. S2: attribute against the closure stored under this worktree's current key for the test file, not the newest closure of any worktree. N1, N2, N3 (one query for the revisions since registration), N5. Own: `src/core/delivery/`, `src/core/daemon/` (only the bootstrap marker write), `src/harness/claude-code/hooks/session-start.ts` and `settle` (B2 wait only), `src/core/types/` (additive), tests under `test/delivery/`, `test/harness/`, `test/daemon/`, `plugins/claude-code/skills/squeal/references/reports.md` (N5), D6 in `spec.md`, one `status.md` line. Do not run `npm run build` or touch `plugins/claude-code/dist`. Commit as you go. Done when: the review's B1 and B2 probes are tests that failed before; a resume keeps attribution; a daemon whose bootstrap outlasts SessionStart's budget yields no attribution line; S1's mid-install header says one thing; two worktrees with different imports for one test file each get their own attribution; N1 to N3 have tests or measurements.

## 001-95 re-review of 001-94, and review of 001-90

Use /reviewer. Output `reviews/wave-10c.md`, two sections. (1) 001-94, `b787492..192c187`: are `reviews/wave-10b.md` B1, B2, S1, S2 closed, and does the B2 wait change SessionStart's latency (measure), and how often a real repository's first session gets no attribution (the worker measured the start-scan marker at 581 to 613 ms on a 5-file fixture against a 750 ms wait). Second and last round on this slice: blockers go to the human. (2) 001-90 (`38f85eb`, `109cb33`), first review: `squeal remove` deletes the store and temp directories. Probe: a daemon that restarts between stop and delete, a worktree whose path is gone, a store mid-write by a hook, `--config` in a linked worktree, permissions on another user's `/tmp/squeal-<uid>`, and that nothing outside `<common-dir>/squeal/` and this repository's temp keys is ever deleted.
