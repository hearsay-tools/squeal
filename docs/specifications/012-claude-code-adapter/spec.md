# 012 Claude Code adapter

Stage: shipped (inherited from 001, shipped 2026-10-06; this spec forked 2026-10-17). Source: `../001-core-loop/spec.md` at `cdd72a91`, frozen; split per `../001-core-loop/split-proposal.md` (the human's decisions Q1 to Q8, 2026-10-16 and 2026-10-17). Every paragraph tagged with an HTML comment is 001's text verbatim; text under a **Note** or in a section 001 did not have is new. Amendments after the fork are dated lines in `status.md` here and edits to this file.

## Scope

The Claude Code plugin is the first implementation of the hook contract (011 C8) and the harness 001 proved its goals with. It serves 011's goals 1, 2 and 6 through Claude Code's hook events, and goal 3's labels reach the agent through its headers. Every rule that holds for every harness lives in 011 (C5, C8, C9, C10); this spec holds Claude Code's events, packaging and session mechanics: `hooks/hooks.json`, the entries and their budgets, the `asyncRewake` idle waiter and its `-p` guard, forked agents, `CLAUDE_CODE_SESSION_ATTENDED`, `CLAUDE_PROJECT_DIR`, the per-session root, SubagentStart's isolated `cwd`, the plugin's skills and `bin/`, the marketplace install through `squeal init`, the committed `dist/` and its drift check. Excluded: the content of a delta, header or primer fact (011); wording (005 D4, D6); `src/harness/shared/**` (011 C8); Codex, Pi and OpenCode (002, 009, 008); the test-command deny's rule (005 D8).

## Non-goals

<!-- 001 spec.md@cdd72a91 lines 31 (Non-goals) -->
- Idle wake-up in Claude Code `-p` mode. Not possible without blocking the agent (research, claude-code-integration §4).

## Design

### CC1. Plugin, install and files

<!-- 001 spec.md@cdd72a91 lines 165 (D9) -->
Shipped as a Claude Code plugin in this repository (ADR 0003). `squeal init` adds the marketplace and the `enabledPlugins` entry to project settings and writes `squeal.config.json` if absent. It never writes raw hook commands into user-owned settings.

<!-- 001 spec.md@cdd72a91 lines 167 (D9) -->
Plugin contents:

<!-- 001 spec.md@cdd72a91 lines 179-180 (D9) -->
- `skills/squeal/SKILL.md`: described by its trigger, the agent being about to run tests (vitest, npm test) or to check whether a change broke something. Its body is steps first: keep working and read the reports; on a FAIL, `squeal why` from the report's last line; wait with `squeal status --wait` only when a result is needed before the next step, results arriving with the next tool call by default; claim only what status shows; run tests yourself only in the primer's cases. It says the full header at registration and Stop names the files changed since the last report, not the cause, and that the other reports carry only the news (task 001-407). Counts, commands and policy keys are reference in `skills/squeal/references/`, reached by pointers that name when to read them. Every pointer to `squeal status --wait`, in the skill and the primer, states the next-tool-call default first.
- `bin/squeal` so the CLI is on the Bash tool's path.

<!-- 001 spec.md@cdd72a91 lines 182 (D9) -->
Every hook script: dependency-free Node using `node:sqlite` and `node:net`; passes the CLI bundle it ships to the daemon-ensuring helper, so a plugin-only install can start a daemon; reads the store directly for deltas and status; uses the socket only for liveness and nudges with a 100 ms timeout; exits 0 with no output on any internal error; enabled plugins fire in every repository, so in a repository without `squeal.config.json` and without a store the script exits in a few milliseconds. PreToolUse and PostToolBatch, which fire per tool call, run Node only after a POSIX `sh` test, with no `git` or other process, finds Squeal from `$CLAUDE_PROJECT_DIR` or else the hook's working directory: `squeal.config.json` there or at the nearest ancestor with a `.git` entry, or a `squeal` entry in that worktree's common dir (the `.git` directory, or for a `.git` file its `gitdir:` and then that dir's `commondir`). Otherwise the command exits 0 with no output, budget 10 ms p95.

### CC2. Hook events

Each event below maps Claude Code's hook onto the hook contract (011 C8). The rules stated inside these bullets that hold for every harness are 011's; their wording is kept here because 001 wrote them per event.

<!-- 001 spec.md@cdd72a91 lines 169-176 (D9) -->
- `hooks/hooks.json` with every hook `timeout: 2` and scripts under `${CLAUDE_PLUGIN_ROOT}`:
  - `SessionStart`: ensure the daemon (D10), register the consumer, inject the status header followed by the primer. After spawning a daemon it waits up to 750 ms for the daemon's heartbeat, never for its start scan (D6). A loaded host can outlast that wait (a 1.1 s hook and the first heartbeat 1.5 s after the spawn at load 127, task 001-156), so a registration whose hook spawned a daemon that has not heartbeat yet, SessionStart's or any other's, says "A daemon is starting; results are as of revision N." in place of "No daemon is running", and the consumer is told the daemon is starting, as the time of the spawn, beside the told liveness (D6): its first heartbeat is no news, and a tool boundary says no daemon is validating only once 10 s passed since the spawn with no heartbeat (two default intervals, the deadline a running daemon's heartbeat has) or once it heartbeat and stopped. Before this rule the registration told the consumer the daemon was down and the next boundary said "a daemon is validating again" for a daemon that had never stopped. A hook from before the rule reads the told start as validating. With source `startup` or `resume` it first unregisters every other consumer of the session id, since that earlier run is gone; after `compact` the same run goes on, so it keeps every consumer and a registered main agent's view, and says only the primer, which compaction dropped. In a repository that has no store yet, SessionStart only spawns the daemon and injects the primer, and the first UserPromptSubmit (interactive) or PostToolBatch registers and injects the header. The **primer** is a short paragraph, the one place a hook tells the agent what to do, as decided by the human: Squeal runs the Vitest tests; do not run Vitest to learn whether edits broke something; results arrive with the next tool call, so keep working, and `squeal status --wait` only when a result is needed before the next step; run tests yourself only without a validating daemon, with unknown results, or when the repository's own gate requires it; what Squeal covers: only the runners the daemon itself would build, by its own selection rule (Vitest when its config is detected, node:test when `nodeTest` projects are configured), with the opening sentence naming those runners; each runner's projects by their configured identity (Vitest's config file or named projects, each `nodeTest` project with its globs), never inferred from old key rows; and the number of slow test files the runner listed, a long list folded into "and N more" and repeated command references compacted, so the primer and its whole closing sentence stay within 1,500 characters with any valid command path (task 001-250); and that typecheck, build and any other test suite are not covered, so run those yourself. Amended 2026-10-10 (task 001-234): the agent works out what is left from the list, since in 005's eval pilot every false "pass" came from a node:test suite Squeal did not cover. The registration is capped so that it and the primer stay within 10,000 characters. If interactive (`CLAUDE_CODE_SESSION_ATTENDED=1`, undocumented, guarded), arm the idle waiter.
  - `PostToolBatch`: deliver the delta for this consumer. Primary push channel. PostToolBatch and Stop also ensure the daemon when the recorded heartbeat is older than two intervals, a store read with no socket cost on the hot path. When that finds no daemon validating and starts none (one holds the lock and does not answer, D10, or there is no CLI to spawn), a batch whose tool calls may have changed files (any tool but the harness's known read-only ones, so a custom editing tool counts, or calls the harness does not name) adds one line at that boundary, every time, beside the liveness told once (D6): "Not validated: no daemon has validated since <time>; any change this call made has no result.", worded so a call that changed nothing is not said to have edited (`reviews/wave-11f.md` S1, S2) ("no daemon is running" when none ever heartbeat), so silence never reads as no failures (`lessons.md`, defect 22). A batch whose daemon the hook just spawned adds nothing: that daemon's start scan validates the edit. Without that line, a batch that may have changed files names, as amended (task 001-292, the human, 2026-10-13, on the eval in `status.md`), the code files (`.js .jsx .ts .tsx .mjs .cjs .mts .cts .py`, outside any `dist/`, still present) changed since the consumer registered that are neither a test file the daemon listed for this worktree nor in one of those files' closures as D6 trusts them (written by this worktree, or by one at this worktree's current key for the file; review wave 13as, B1): "No result for <paths>: no test Squeal runs reads it. Run whatever tests it yourself." ("them" for several; at most 3 paths, then " and N more"). Each path is named once per consumer and never again, whether it changes again or a test reads it later, kept in an `uncovered-told:<worktree>` `meta` row that worktree removal drops; a consumer that leaves takes its told paths into its parked registration and gets them back when it returns before that expires (review wave 13as, B2). Nothing is said before the daemon listed the worktree's test files or while one of them has no closure this worktree trusts. The line, with its `SQUEAL · `, is held to 1,000 characters before the delta is fitted: when 3 paths do not fit, fewer are named and the rest counted in " and N more", and when not even the first fits, it is named by its end after "…" (review wave 13as, B3). The line counts against the message cap. Policy `delivery.uncoveredEdits` turns it off. Verified to reach the model before its next step in the same turn; budget 80 ms p95 (about 50 ms Node start plus a store read).
  - `PreToolUse` on every tool: before the call runs, a registered consumer left idle goes back in a turn, in one small transaction, so a turn another Stop hook continued is a turn again from its first tool call. On `Edit`, `Write` and `NotebookEdit`: when policy `interrupt.onRegression` is on and the consumer's delta contains an undelivered regression, deny once with the regression entries as `permissionDecisionReason`, phrased as facts plus one sentence stating that the edit was not applied and can be re-issued. A regression is a `pass -> fail` of a check this worktree had seen pass, its own result or an inherited one, also when only unknown results (a runner crash between runs) came between the pass and the failure, which every delta reads as `pass -> fail`. A first-seen failure never denies, a baseline finding or a test file the agent just wrote alike; it is delivered at the next tool boundary. A worktree waiting for an install runs nothing, so no pass can be seen there and nothing denies (`lessons.md`, defect 17); a tier whose run overlapped a change of the install stores nothing (D5), so `npm ci` under a running daemon denies nothing either (task 001-107). The hook reads regressions through a peek that marks only those entries delivered, so recoveries and first-seen failures are not consumed by a denial and the same regression never denies twice. Recoveries never deny. No other tool is denied, `Bash` included, except an agent's own test command that Squeal has already answered, once per consumer, with spec 005 D8's opt-in `testCommand.denyWhenCurrent` (default off), run after the regression deny with one reason per call. Default on; the model reads the reason and continues in the same turn, but treats it as an obstacle rather than advice, so wording is a dogfooding item.
  - `Stop`: speak only with news, because any Stop context starts another model turn: a delta, a first registration that carries known failures, or a policy block. A main agent's Stop that says nothing ends the turn: its consumer becomes idle and records the test files pending at that moment, each at the key it is pending at (plus any with a difference not yet delivered, and, while the runner part of the revision is pending, checks first observed later, up to that revision); one that speaks keeps the turn going. A recorded file stops being waited for once its result at that key lands, told or not, or its key moves on, so an edit made after the turn, by the user or another session, does not wake the agent. On a worktree shared by sessions, the files pending at Stop include those another session's edits queued, so one session can be woken by a result of another's edit. Optionally wait up to `stop.waitMs` (capped at 1,500 ms by the 2 s hook budget) for pending checks of the current revision. `stop.blockOnKnownFailures` blocks only on failures that are current at this revision; failures whose re-run is pending are named as pending, never as existing. `stop.requireFullSuite` reads the checkpoint state. Re-arm the idle waiter if interactive.
  - `SubagentStart` and `SubagentStop`: same as SessionStart and Stop for the consumer `(session id, agent id)`, and SubagentStop unregisters that consumer afterwards, since a finished subagent can receive nothing more. Subagent context is isolated from the parent's in both directions, so each gets its own view. Claude Code's internal forked agents (prompt suggestions, `/btw`) are not consumers: they send SubagentStop, and no SubagentStart, with an empty `agent_type`, so a subagent event with an empty `agent_type` registers nothing, never blocks and delivers nothing. A SubagentStop whose consumer has no registration is treated the same way: a real subagent is registered by SubagentStart or its first PostToolBatch, so one that arrives unregistered ran no tool, and under `claude --agent <name>` a fork reports `<name>` and is caught only by this rule. PostToolBatch and PreToolUse ignore forks too.
  - `UserPromptSubmit`: re-arm the idle waiter, because an interrupted turn runs no Stop; Claude Code 2.1.291 also runs it for a turn the waiter wakes. Record a registered consumer as heard from, put it in a turn, and deliver its undelivered delta as context on the prompt: what the waiter did not wake the agent for, or everything since an interrupted turn. In an interactive session with no registration (a store created after SessionStart, or a consumer expired while idle), ensure the daemon, register, and inject the registration: context on a prompt starts no extra turn.
  - `SessionEnd`: unregister the consumer.

### CC3. Idle waiter

<!-- 001 spec.md@cdd72a91 lines 178 (D9) -->
- Idle waiter: one `asyncRewake` hook per session, started by SessionStart, UserPromptSubmit and Stop, with a per-consumer lock so only one runs. It blocks on the daemon until the consumer is idle and has a non-empty delta about the test files it recorded when its turn ended, prints only those entries to stderr and exits 2, which wakes an idle agent in about 40 ms; the wake puts the consumer in a turn. Every other difference waits for the next prompt or tool boundary. Each consumer has a turn state, no timer: a session starts idle and waiting for nothing; UserPromptSubmit, a wake or a tool call (PreToolUse before it runs, PostToolBatch after the batch) puts it in a turn, the tool call correcting an idle state that a Stop which was not the last word (another Stop hook blocked) or a failed UserPromptSubmit left, though a result that lands between such a Stop and the continuation's first tool call can still wake the waiter; a registration by UserPromptSubmit, PostToolBatch or Stop is in a turn in its own transaction; only a silent Stop makes it idle, so after an interrupted turn (no Stop) it stays in a turn and nothing wakes it. The state lives in `meta`, one row per worktree, beside the told liveness; a `consumers` column would need a schema step that every older hook and daemon sharing the store reads as "store version newer". A waiter message written mid-turn lands only at the next tool boundary, after PostToolBatch has delivered the same news with a newer header, so the waiter never speaks in a turn (`lessons.md`, defect 14). It is never armed in `-p` mode, where `asyncRewake` blocks the agent. Its `timeout` is explicit and long; expiry is silent, records the consumer as heard from (D10), and the next prompt or Stop re-arms it.

### CC4. Interactive liveness and lifecycle integration

The daemon's rules are 011 C9, verbatim there: an interactive main agent's liveness is its idle waiter, whose lock the OS releases when Claude Code kills it, so a consumer with a free waiter lock and no delivery or sign of life for 10 minutes expires; departures, step-down and `squeal stop` are the daemon's. Claude Code's side is the waiter lock (`src/core/waiter-lock`), the per-session root of 011 C8, and the leaving mark SubagentStop writes:

<!-- 001 spec.md@cdd72a91 lines 188 (D9) -->
Amended 2026-10-15 (task 001-416, review 001-423 B1): before it ensures the daemon or waits, SubagentStop marks its consumer leaving, as the time of the mark, in a per-consumer `meta` row (`leaving:<worktree>`). A block clears the mark and keeps the registration. A registration of that consumer clears it in its own transaction, and so does every later boundary of it except the stopping hook's own delivery: PostToolBatch, every PreToolUse (the peek and a turn resumed without one, a consumer already in its turn included) and UserPromptSubmit. So a subagent that kept working, or registered again, is never dropped. The normal end unregisters as before, and that removes the mark.

## Known seams

Coupling recorded by the split proposal (section 3), not changed by it. Each is a candidate row, never an implied one.

- The rules inside CC2's bullets that hold for every harness are 011 C8's; a change to one of them is a change for Codex, OpenCode and Pi too.
- `src/cli/init.ts` defaults to the Claude Code marketplace and takes `--harness codex` (002 D1); install, the launcher and `squeal setup` are 005 D3's.
- The primer's facts are 011's (C8, C10), its wording 005's (D4, D6), and `plugins/claude-code/skills/squeal` is one of four copies (human, 2026-10-12).
- The waiter lock lives in core (`src/core/waiter-lock`) and 011 C9 reads it for the 10-minute expiry.

## Testing

<!-- 001 spec.md@cdd72a91 lines 242 (Testing) -->
- **Hook scripts**: recorded hook JSON in, JSON out, for every event; a latency test asserting the p95 budget; behaviour with no store, with a newer schema, and with a dead daemon.

<!-- 001 spec.md@cdd72a91 lines 244 (Testing) -->
- **Manual**: dogfood on this repository with Claude Code interactive and `-p`, recording delivery latency, duplicate rate, and how the model reacts to a PreToolUse denial.

## Open questions

Numbering is 001's, so the lessons and reviews that cite a question keep resolving. Owner is the coordinator unless noted.

<!-- 001 spec.md@cdd72a91 lines 252 (Open questions) -->
3. PreToolUse denial wording and whether default-on survives dogfooding. Dogfooding (`lessons.md`): 4 denials in 2 of 18 editing sessions; the model re-issued the denied edit every time, never stalled or looped, and read the failure from the denial text, once reading the failing test in the same step as the re-issue and then fixing it. Cost: one extra tool call per denial. 2 of the 4 were transient mid-refactor failures. Claude Code prefixes the reason with "PreToolUse:Edit hook error:" without misleading the model. Proposed: keep default on and the current wording.

<!-- 001 spec.md@cdd72a91 lines 255 (Open questions) -->
6. Long tool calls delay delivery until they end (19 s observed). Whether to ship a plugin `monitor` is deferred to the dogfooding report. Dogfooding (`lessons.md`): during a 15 s Bash call the idle waiter took the delta 246 ms after the result and Claude Code queued it as a task notification until the call returned, 8.5 s later; a monitor's output would wait at the same boundary (inferred, not tested). The longest tool calls agents made were their own waits for pending checks (`sleep 20; squeal status`). Proposed: no monitor in v1; consider a blocking `squeal status --wait`.

## References

- `../001-core-loop/research/claude-code-integration.md`, `uncovered-suites.md`, `uncovered-trust.md`, `primer-skill-writing.md`
- ADR 0003 delivery model; 002 D5 (the shared hook code's move); 005 D3, D4, D6
- Split proposal: `../001-core-loop/split-proposal.md`

## Crosswalk from 001

Lines are those of `001-core-loop/spec.md` at `cdd72a91`. Bold targets are this spec's; the others name where the rest of a 001 section went.

| 001 section | Lines | Now in |
|---|---|---|
| Problem | 7, 9 | 011 Problem (7, 9) |
| Goals | 13, 15-21 | 011 Goals (13, 15-21) |
| Non-goals | 25-32 | 011 Non-goals (25-30, 32); **012 Non-goals** (31) |
| D1 | 38, 40, 42-44, 46, 48 | 011 C1 (38, 40, 42-44, 48); 011 C8 (46) |
| D2 | 52, 54, 56, 58, 60 | 011 C2 (52, 54, 56, 58, 60) |
| D3 | 64, 66-69, 71-73, 75 | 011 C3 (64, 66-68, 72-73, 75); 011 C11 (69, 71) |
| D4 | 79, 81-88, 90, 92 | 013 V1 (79); 013 V2 (81); 013 V3 (82-83, 85); 011 C12 (84); 013 V4 (86, 92); 013 V5 (87-88, 90) |
| D5 | 96, 98, 100-104, 106, 108, 110, 112, 114, 116, 118, 120, 122, 124, 126 | 011 C4 (96, 98, 100-104, 106, 108, 110, 114, 116, 118, 122, 124, 126); 013 V7 (112); 011 C11 (120) |
| D6 | 130, 132, 134, 136-137, 139, 141 | 011 C5 (130, 132, 134, 136-137, 139, 141) |
| D7 | 145, 147, 149 | 011 C6 (145, 147, 149) |
| D8 | 153, 155, 157, 159, 161 | 011 C7 (153, 155, 157, 159, 161) |
| D9 | 165, 167, 169-180, 182, 184, 186, 188 | **012 CC1** (165, 167, 179-180, 182); **012 CC2** (169-176); 011 C8 (177, 186); **012 CC3** (178); 011 C14 (184); **012 CC4** (188) |
| D10 | 192, 194, 196 | 011 C9 (192, 194, 196) |
| D11 | 200, 202-210, 212, 214-221, 223 | 011 C10 (200, 202-208, 210, 212, 214-221, 223); 013 V9 (209) |
| D12 | 227-235 | 011 C13 (227-235) |
| Testing | 239-244 | 011 Testing (239, 241, 243); 013 Testing (240); **012 Testing** (242, 244) |
| Open questions | 248, 250-258 | 011 Open questions (248, 250-251, 254, 256, 258); **012 Open questions** (252, 255); 013 Open questions (253, 257) |
| References | 262-264 | 011 References (262-264) |
