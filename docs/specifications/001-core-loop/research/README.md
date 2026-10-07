# Research brief for spec 001

Read `docs/vision.md` and `docs/styleguide.md` first. Then `../status.md` for the decisions already made.

Each topic below is one researcher task. Write your findings to `research/<topic>.md` in this folder. Commit when done.

## Rules for findings documents

- Length: 1 to 3 pages. Signal over completeness.
- Structure: Questions answered, Findings, Recommendation for Squeal, Open questions, Sources.
- Mark every finding as one of: `verified by experiment`, `read in official docs`, `read in source code`, `inferred`. Name the version you looked at.
- Prefer experiments over reading when an experiment is cheap. Throwaway probes go under `research/probes/<topic>/` and must say they are throwaway in a README. No product code anywhere else.
- Reference URLs and file paths. Do not paste large code; a few lines to prove a point is fine.
- Do not design Squeal. Answer the questions and recommend. The spec is written by the coordinator from these documents.
- Do not touch anything outside `docs/specifications/001-core-loop/research/`.

## Topic: vitest-internals

Squeal will keep one warm Vitest instance per worktree, feed it file changes from its own watcher, compute which test files are affected, run only those, and read per-test results.

1. Using `vitest/node` (latest stable; state the version), how do we create an instance with Vitest's own watcher disabled, keep it alive, and run an explicit list of test files repeatedly? Verify by experiment on a small fixture project.
2. Given a changed source file, how do we compute the set of affected test files from Vitest's module graph? Is the graph available before a test file has ever run, or only after collection or a first run? Can we collect without running? Verify.
3. For each test file, can we enumerate its full dependency closure (every file whose content affects the result)? This is what Squeal will hash. Include config files, setup files and snapshot files in the answer.
4. What does a per-test result look like: id, full name, state, duration, error message, stack, source location of the failure? Which reporter hook or API gives it reliably? Are test ids stable across runs and across worktrees?
5. What happens on `invalidateFile` for a file that imports changed, a deleted file, a new test file, a changed config file?
6. Cost: how long does collection-only take on a fixture of about 50 test files versus a run? Rough numbers are fine.
7. Any sharp edges: workspaces/projects, browser mode, typecheck mode, coverage, snapshot updates.

## Topic: claude-code-integration

Squeal needs to deliver validation deltas to a Claude Code agent as early as possible, including in the middle of a long turn, and let the agent pull status on demand.

1. Packaging: what does a Claude Code plugin contain (hooks.json, skills, commands, agents), how is it installed and enabled, how do plugin hooks reference their own scripts, and how does that compare with writing hooks into `.claude/settings.json` via an init command? Recommend one.
2. PreToolUse: confirm by experiment that a hook can deny a tool call with `permissionDecision: "deny"` and that `permissionDecisionReason` is shown to the model so it can react. Confirm the same for exit code 2 with stderr. Does the model see the reason in the same turn and continue? Which matcher catches all file-editing tools (Edit, Write, MultiEdit, NotebookEdit) and Bash?
3. PostToolBatch and PostToolUse: confirm `additionalContext` is injected before the next model step, within the same turn. Measure the gap between a tool finishing and the hook output being visible to the model, if you can.
4. `asyncRewake`: confirm by experiment what happens when a background hook exits 2 while the model is (a) idle waiting for the user, (b) mid-turn between tool calls, (c) inside a long-running Bash tool call. Is the message delivered, when, and how is the hook re-armed after it fires?
5. Which identifiers can hooks use to tell sessions apart (`session_id`, `agent_id` for subagents)? Do subagents get their own hook events (SubagentStart, SubagentStop) and can they receive injected context separately?
6. Hook timeouts and failure modes: what happens to the agent if a hook command hangs or the Squeal daemon is dead? What must the hook scripts do to never block the agent?
7. Briefly: what are the equivalent injection points in Codex, Pi and OpenCode, so Squeal's adapter interface is not shaped only by Claude Code? One paragraph each, docs only.

Experiments should use `claude -p` in non-interactive mode or an interactive session in tmux if available. Record exact hook JSON and observed transcript excerpts.

## Topic: result-fingerprinting-prior-art

Squeal will store results in one shared store per repository, in the main worktree, used by every worktree. A result must be reusable wherever the inputs that produced it are identical, so that a new worktree inherits the baseline from main without re-running, and uncommitted edits in one worktree never contaminate another.

1. How do testmon (pytest), Wallaby, Jest `--findRelatedTests` and `--changedSince`, Vitest `related` and `--changed`, Bazel test caching, Nx and Turborepo compute what to re-run and what to reuse? For each: what is hashed (file contents, dependency closure, environment, command line), how are dependencies discovered, how is staleness handled, what are known failure modes.
2. Compare keying results by git commit SHA versus by content hash of the dependency closure versus a hybrid. Consider: uncommitted changes, worktrees on different commits, rebases, generated files, environment and installed dependency versions, snapshot files.
3. Recommend a fingerprint scheme for Squeal that answers: when is a stored result current for a given check in a given worktree? How should per-file hashes, per-check closure hashes, and commit SHAs relate? What is the cheapest way to compute and update them incrementally on each file change?
4. How should the scheme handle a check whose dependency closure is unknown because it has never been collected?
5. How large does such a store get for a repo with 5,000 tests and 50 revisions a day, and what should be pruned?

## Topic: watcher-daemon-and-shared-store

Squeal runs one daemon per worktree. All daemons of one repository read and write one shared store in the main worktree. Agents' hook scripts read from that store too.

1. Watchers on Linux and macOS: compare chokidar, @parcel/watcher and Node's recursive `fs.watch`. Reliability, latency, gitignore support, handling of atomic saves and rename storms, directory-count limits. Recommend one for Squeal.
2. How should the watcher honour `.gitignore` and exclude nested worktrees (directories under the root that are themselves git worktrees, e.g. `.ai/cezar/worktrees/*`)? How do we detect a nested worktree cheaply?
3. Locating the shared store: from any worktree, how do we find the main worktree reliably (`git rev-parse --git-common-dir`, `git worktree list --porcelain`), including bare repos and the case where the main checkout is on another commit?
4. Shared store format and concurrency: several daemons and many short-lived hook scripts read and write concurrently. Compare SQLite (node:sqlite in Node 22+, better-sqlite3) against JSON files with atomic rename and a lock file. Consider crash safety, read latency for hook scripts that must respond in under 100 ms, and schema migration.
5. Daemon lifecycle: how should a hook script start a detached daemon if none is running, discover a running one, and avoid starting two? pid files, unix sockets, lock files, stale detection after a crash or machine sleep. How does the daemon learn that its worktree was removed?
6. How should hook scripts talk to the daemon: read files only, unix socket, or local HTTP? Weigh dependency-free scripts, latency and failure isolation.

## Topic: pull-advances-push

Added 2026-10-07 after a dogfooding report: a Stop or PostToolBatch report sometimes repeats news the agent already read through `squeal status --wait`, because a pull never touches the consumer's delivery view (D6, D7, D9: "push transitions, pull state"). Question: can a pull inside a session advance that session's view without ever losing a transition, and if not, what else avoids the repeat?

1. What a Bash tool subprocess can see of its Claude Code session and agent identity (environment variables, inherited file descriptors, parent process, anything Squeal's hooks could record for it), at Claude Code 2.1.292, in an interactive session (tmux), in `-p` mode, and inside a subagent (`Task` / `claude --agent`). Verify by experiment on a scratch repository, never this repository's store. Record exact variable names and values seen.
2. If 1 gives a reliable identity: can `status --wait` advance the consumer's view without losing a transition? Name the race (a transition recorded between the read and the advance, two pulls racing a push, a subagent pulling for the main agent) and what a store transaction in `src/core/delivery/` would need. Read the code; probe if cheap.
3. If 1 does not: the fallback. For example a hook-side rule that drops from a push the transitions already printed by a pull, keyed by something both sides can see. Compare at most two options by cost and by what could be lost.
4. What Codex, Pi and OpenCode expose to a tool subprocess for the same purpose, docs only, one line each, so the design is not Claude-only.

Recommendation: feasible or not; the design; the D6, D7, D9 sentences it would change; and what a board row's done-when would be.
