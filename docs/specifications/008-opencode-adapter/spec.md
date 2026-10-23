# 008 OpenCode adapter

Stage: shipped 2026-10-15 (0.1.192); approved 2026-10-14 by the human. Amendments: `status.md`. Research: `research/opencode-plugins.md` (008-01) and `research/opencode-sessions-and-wake.md` (008-02), both on OpenCode 1.18.35 (embedded Bun 1.3.14), Linux, model `cliproxy/gpt-6-luna`, run as `squeal-e2e`. Spec 001 D6 (state and delivery views), D9 (the Claude Code adapter), D10 (daemon) and D11 (policy) hold, and specs 002 (Codex) and 009 (Pi) are the precedents, unless a section here says otherwise.

## Problem

Squeal delivers to Claude Code, Codex and Pi. An OpenCode session editing a project under validation hears about no `PASS -> FAIL`, is not stopped before editing over an undelivered regression, and is not told to leave the tests to Squeal. Cezar already runs OpenCode workers. OpenCode differs from the other three in the way that shapes everything below: it extends through plugins loaded into its own process, and that process is Bun, which has no `node:sqlite` (research, plugins 6). So the plugin cannot run Squeal's shared code where it is loaded, as Pi's extension does, and OpenCode has no hook processes that could run it elsewhere, as Codex's do.

## Goals

Each goal is testable, and each holds under `opencode run`, under `opencode serve` driven as Cezar drives it, and in the TUI, unless it names a mode.

1. An agent learns about a `PASS -> FAIL` in the result of the tool call during which the result became known, in the same turn, without running tests itself; asserted by the model's next request containing the report.
2. The matching `FAIL -> PASS` arrives the same way. Nothing arrives for `PASS -> PASS` or an unchanged failure. Parallel tool calls deliver each entry at most once.
3. With `interrupt.onRegression` on, the next `edit`, `write` or `apply_patch` after an undelivered regression is blocked once with the regression entries as the reason; the turn continues and the model can re-issue the edit. `bash` is never blocked, except 005 D8's opt-in test-command deny.
4. The end of a turn speaks only with news, as one continuation, and never twice in a row; a turn with no news costs no model request. Under `opencode run`, which exits at idle, the news is stored in the session and read at its next resume.
5. A primer telling the agent to leave the tests to Squeal, with the CLI's absolute path, is in every model request of the session, including after compaction and in a subagent's session.
6. No Squeal hook holds OpenCode longer than its deadline (D4), a dead or missing daemon, store or `node` degrades to silence, a hook never throws except to block an edit, and nothing Squeal starts keeps `opencode run` alive after its turn.
7. Where the OpenCode process stays open (`serve`, the TUI), an idle agent whose pending tests finish with news is woken once with the report (D5).
8. `install.sh` installs Squeal through OpenCode's own `opencode plugin` command at user scope, with no trust step and no file written by Squeal under `~/.config/opencode`; `squeal status` in an OpenCode shell where the plugin never ran says so.
9. A subagent (the `task` tool's child session) is its own consumer, told the primer, and its tool calls deliver and block for it, not for its parent.

## Non-goals

- Running the store in Bun (`bun:sqlite`): a second store driver with its own locking and busy semantics, for a store every other harness reads through `node:sqlite`.
- A delivery RPC on the daemon's socket: a new protocol surface is a core change (status, 2026-10-14), and the per-event `node` process is the shape 002 already proved.
- Delivery through Cezar's `opencode serve` port: a plugin holds a client to the same API in-process, and the port exists only under `serve` (research, sessions 1).
- Project-scope install (`.opencode/plugin/` or a project `opencode.json`): it writes into the repository.
- Publishing to npm (human, 2026-10-14: install as Pi does). OpenCode's experimental worktree routes. OpenCode on Windows or macOS.

## Design

### D1. Package and install

The adapter ships as an OpenCode plugin package in this repository, `plugins/opencode/`: a `package.json` whose `exports["./server"]` names `./dist/plugin.mjs` (the module shape `opencode plugin` loaded in research, sessions 4) and `engines.opencode`; and `dist/` committed: the plugin bundle (D4), the bridge entry, the CLI, the daemon, the pytest runtime files, and `bin/` with the launcher. `npm run build:plugin` builds it beside the other three; CI's drift check and the version-raise rule cover `plugins/opencode/dist/`.

Install is OpenCode's own command on a local directory, as 009 D1 does for Pi: `install.sh` (005 D3), when `opencode` is on the PATH, unpacks this release's `plugins/opencode/` from the tag's source archive into `${XDG_DATA_HOME:-~/.local/share}/squeal/opencode/<version>/`, points the symlink `.../squeal/opencode/current` at it, and, once, runs `opencode plugin file:<...>/opencode/current -g`, which writes the global config itself (research, sessions 4: `p1`). A `file:` install links the directory rather than copying it, and the plugin loads from the link's resolved target, so an update unpacks the next version and repoints `current`; OpenCode loads it at its next start, and the config keeps one entry (`research/wave-0-checks.md` 3). `opencode plugin file:<new> -g --force` is never used: OpenCode 1.18.35 has no remove command and `--force` does not replace a `file:` entry, so both versions would load. An update removes older version directories as 009 does for Pi: it keeps the newest older one and any a running process names, because an open session loaded the older plugin and its bridge runs from that directory. `install.sh` never edits OpenCode's config. `--uninstall`, the install record, `squeal update` and the launcher's search follow what 009 built for Pi, with `opencode` beside `pi`.

### D2. Consumers and identity

A root session's consumer is `(sessionID, "main")`; a child session, created by the `task` tool with `parentID`, is `(rootSessionID, childSessionID)`, as a Codex subagent is `(session_id, agent_id)`. Every hook carries `sessionID`. The plugin keeps a map from session id to parent id, filled from `session.created` and, for a session it has not seen (a resume, a restarted process), from one `client.session.get`. The ids survive `--continue`, `--session` and Cezar's Continue; `--fork` mints a new root (research, sessions 3).

The agent's shell has no session id of its own: OpenCode sets only `OPENCODE=1` and `OPENCODE_PID`. The plugin's `shell.env` hook sets `OPENCODE_SESSION_ID` to the root id and `OPENCODE_AGENT_ID` to the consumer's agent, so a `squeal status` pull is attributable as `CODEX_SESSION_ID` makes it (verified for the child's shell, research, sessions 3), and prepends the package's `bin/` to `PATH`, so `squeal` in that shell is this version's. The consumer's `HarnessProcess` is the OpenCode process (`process.pid` in the plugin, which equals `OPENCODE_PID`). The worktree is the plugin's `worktree` input, never `project.worktree`, which names the first registered checkout (research, sessions 6).

### D3. Hooks

The plugin returns these hooks; each hands its event to the bridge (D4) and maps the answer onto OpenCode's output shapes.

- `chat.message`: the prompt boundary, 001's UserPromptSubmit. It fires for every user message, including the first after a resume, a Cezar steer and a Squeal wake. Register the consumer if this instance has not (ensure the daemon, 001 D10, spawned detached by the bridge), cancel the idle wait (D5), `startTurn`, and put the registration header on a first registration and the undelivered delta into the message as one added text part marked `synthetic`. The part reaches the model in the same user message, and must carry an `id` starting `prt` that sorts after the message's last part: without one OpenCode fails the user's whole prompt (`research/wave-0-checks.md` 4). The plugin derives that id and, if it cannot, adds nothing.
- `experimental.chat.system.transform`: append the primer, fixed text plus the CLI's absolute path, capped at 8,000 characters as 002 D3. It runs for every request, so the primer survives compaction and reaches child sessions. It does not call the bridge.
- `tool.execute.before`: put an idle consumer back in a turn (001-93). On `edit`, `write` and `apply_patch` with `interrupt.onRegression` on, a `peek` of regressions; with entries, throw an `Error` whose message is the reason, phrased as facts plus one sentence that the edit was not applied and can be re-issued. The model sees a failed tool call and retries (research, plugins 4). On `bash`, 005 D8's opt-in test-command deny from `args.command`. Any other failure is caught and the call proceeds, because a throw is a deny.
- `tool.execute.after`: `onToolBoundary`, appended to `output.output` after a blank line and starting with "Squeal:". It fires once per call; the delivery view makes the second call of a parallel batch find nothing. This is the primary push (research, plugins 3: the model read a 32 KiB tail).
- `event` `session.idle` of a root session: the end of a turn, 002's Stop, except that idle cannot hold the turn. With news (a delta, a first registration carrying known failures, a policy block), and when this turn has not been continued by Squeal, call `client.session.promptAsync` with the report, which starts one more turn; the flag clears at the next `chat.message` that is not Squeal's own. Otherwise end the turn and record the pending files as 001 D9. `stop.waitMs` (capped at 1,500 ms), `stop.blockOnKnownFailures` and `stop.requireFullSuite` keep their meaning. An idle preceded by a `session.error` carrying `MessageAbortedError` is 002's Interrupt: end the turn, no continuation. Then arm the idle wait (D5).
- `event` `session.idle` of a child session: unregister the child, 002's SubagentStop.
- `event` `session.deleted`: unregister the session's consumers. `dispose` (at `run` exit and TUI hang-up, not at `serve`'s SIGTERM): stop the idle waiters and unregister what this instance registered, within 3 s. Every consumer this instance never unregisters ends by 001 D10's process liveness on `OPENCODE_PID`, which is how a Cezar-stopped `serve` ends (research, sessions 5).

Every text Squeal adds starts by naming Squeal, since a continuation or a wake reaches the model as a user message (research, sessions 2).

### D4. The plugin and the bridge

The plugin bundle, `dist/plugin.mjs`, runs in OpenCode's Bun and imports only `node:fs`, `node:path` and `node:child_process`, never `src/harness/shared/` or anything that reaches `node:sqlite`; a build test asserts its import list. The plugin has three jobs. First, the fast path: at init it checks, in-process, whether `worktree` is a Squeal repository as 001 D9's `sh` test does; outside one it returns no hooks, so the plugin costs nothing in other projects. Second, it finds a Node of at least Squeal's minimum on the `PATH` once at init, never `process.execPath`, which is OpenCode. With none, it returns no hooks and writes one line to OpenCode's log through `client.app.log`, since no Squeal CLI can run without Node either. Third, the bridge.

The bridge, one entry per request kind, `dist/hooks/<kind>.mjs` (amended 2026-10-15: 008-12 split the single `dist/hooks/opencode.mjs`), is a short `node` process per event, as 002's hook processes are: the plugin spawns it in its own process group with cwd at `directory`, writes one JSON event to stdin, and reads one JSON answer from stdout. It runs `src/harness/shared/` unchanged. The plugin awaits it against a deadline: 2 s for `chat.message`, `tool.execute.before` and `tool.execute.after`, `stop.waitMs` plus 500 ms at idle, 3 s at `dispose`. A missed deadline kills the process group and is silence: no text, no block, no continuation. A non-zero exit, invalid JSON or a spawn error is the same. OpenCode awaits plugin hooks in series with no timeout (research, plugins 6), so this deadline is the whole bound, and nothing the plugin does synchronously may block.

The cost is a Node start per tool call: 25 ms p50 and 30 ms p95 for an empty Node at calm load (research, plugins 6), plus the shared handler, which 002 measured at under 80 ms p95 per Codex hook. Wave 0 measures the bridge against that 80 ms p95.

### D5. Idle wake

After a root session's idle, the plugin starts the shared idle waiter (`src/harness/shared/waiter.ts`) as one more bridge process with no deadline but the waiter's own, which exits when `OPENCODE_PID` dies. It waits for `waitForDelta` (001 D9 as amended by 001-85: only entries of the test files pending when the turn ended). On a delta the plugin calls `client.session.promptAsync` with the report, which starts one turn on an idle session (research, sessions 2: busy 18 ms after the call under `serve`, 16 ms in the TUI). A user message first (`chat.message`) cancels the wait, and `dispose` kills it.

The rule follows OpenCode's process, not a launcher, as 009 D5 does for Pi (human, 2026-10-14: ship the wake). Under `opencode run` the process exits at idle and `dispose` kills the waiter; a continuation sent at that idle is stored in the session and read at its next resume. In Cezar, whose non-interactive steps end the server 250 ms after idle, a later wake dies with the server and its news waits for Continue; a woken turn is one Cezar did not start, which Cezar's transcript shows (research, sessions 2).

### D6. Shared code and bundles

`src/harness/opencode/` holds the plugin (the hooks of D3, the session map of D2, the fast path, the bridge client), the bridge entries (one per request kind under `entries/hooks/`, each reading one request and writing one answer over `src/harness/shared/`; amended 2026-10-15), and the build step. The shared code changes only where a host that is not its own hook process needs it, as 009 found `HookDeps` already takes a caller's harness process and consumer. The Claude Code, Codex and Pi recorded-JSON suites stay green with no fixture change. The plugin's OpenCode types are pinned to `@opencode-ai/plugin` 1.18.35, as a devDependency or a local copy as 009 chose.

### D7. Status under OpenCode

`squeal status` and the header are unchanged. Run where `OPENCODE=1` is set, either with `OPENCODE_SESSION_ID` set and no consumer of that session in this worktree, or with no `OPENCODE_SESSION_ID` at all (the plugin never ran), `squeal status` adds one `OpenCode:` line naming the cause it knows, with the install command. The primer and the FAIL report's `squeal why` line name the CLI by absolute path, `"<node>" "<package>/dist/cli/squeal.mjs"`, with the Node the plugin found, as 009 D7 does.

### D8. Daemon and worktrees

001 D10 holds. The bridge spawns the daemon detached, so it leaves OpenCode's process group and outlives `run`, a TUI exit and the group SIGTERM and SIGKILL Cezar sends to `serve` (research, sessions 5). OpenCode's `run`, `serve` and TUI never create or remove worktrees.

### D9. Policy

No new keys. `interrupt.onRegression` governs the `edit`, `write` and `apply_patch` block.

## Testing

- Isolation first, as 009 did: `test/fixtures/opencode/isolation-check.sh`, run as `squeal-e2e`, showed that with `HOME`, `TMPDIR` and the four `XDG_*` directories in a run directory, `OPENCODE_DISABLE_MODELS_FETCH=1`, every config directory seeded with `@opencode-ai/plugin`, and the project a git repository outside any other, OpenCode 1.18.35 writes, reads and connects to nothing outside the run (`research/wave-0-checks.md` 1). Tests start OpenCode as the agent user only through `runOpenCode` (`test/helpers/opencode.ts`), which sets them all and refuses overrides; an OpenCode upgrade re-runs the check. OpenCode and `@opencode-ai/plugin` are pinned devDependencies.
- A scripted provider as the fixture under `test/fixtures/opencode/`: a local HTTP server speaking the OpenAI-compatible API that plays planned tool calls and records every request, configured as a provider in the run's `opencode.json`, so tests need no credentials and no network. Whether 1.18.35 loads that provider without fetching a package is a wave-0 check.
- Unit tests on the plugin with recorded hook inputs from the research logs: each D3 shape; one delivery over three parallel `tool.execute.after`; the block once per regression, never on `bash` by default; a bridge failure never throws; the continuation flag; abort is no continuation; a child's consumer and its unregistering; the fast path returns no hooks outside a Squeal repository; the bundle imports no `node:sqlite`.
- The bridge: a stalled bridge misses its deadline and the hook returns silence within it, its process group gone; a missing store, config or Node is silent; per-call cost at calm load asserted as 002 does, skipped above a load threshold.
- Real OpenCode with the scripted provider, under `run` and `serve`: each delivery asserted in the next request; a block then a re-issued edit; one continuation then silence; the primer in a child session; a dead daemon without a crash; `run` exits promptly after its turn; a wake under `serve`; `squeal status` from the agent's shell credited to its consumer.
- End to end, as 001's `test/e2e`: the OpenCode package archived from HEAD, installed with `opencode plugin file:<dir> -g` into an isolated home, a fixture repository, the shipped daemon.
- Proof: a dogfooding row with a Cezar worker on OpenCode and a TUI session as `squeal-e2e`, reported in `lessons.md`, including whether a real model reads a Squeal continuation, a user message, as Squeal's report.

## Open questions

Owner is the coordinator unless noted.

1. Closed 2026-10-14 by `research/wave-0-checks.md` 3: a `file:` install links; `--force` does not replace a `file:` entry; a stable `current` link installed once and repointed does (D1).
2. Closed 2026-10-14 by `research/wave-0-checks.md` 4: an added part with a `prt` id reaches the model; without an id the prompt fails (D3).
3. The bridge's per-call p95 against 002's 80 ms. 008-10 measured it only at load 32 on 24 CPUs: 98 ms for Node start plus the bridge, 148 ms for a registration. Re-measured by the coordinator at load 8.2 beside Codex's latency test in the same minute: bridge p95 85 ms bare and 107 ms registering, Codex hooks 42 to 83 ms (PostToolUse 60, SessionStart 71). The bridge is 25 to 45 ms slower than the hook it replaces, with Node start common to both; 008-12 brings it within 10 ms of Codex's per hook.
4. Whether a real model treats a Squeal continuation or wake, which arrives as a user message, as Squeal's report and not an instruction from the user. Dogfooding.
5. Whether to tell Cezar's maintainers that a plugin can start a turn Cezar did not submit (research, sessions open questions). The human's.
6. `install.sh`, the launcher and `squeal update` are shared with 009's rows; 008's install row runs after 009's install rows land.

## References

- Spec 001: `../001-core-loop/spec.md` D6, D9, D10, D11. Spec 002: `../002-codex-adapter/spec.md` D2 to D6. Spec 005 D3 (`install.sh`) and D8 (the test-command deny). Spec 009: `../009-pi-adapter/spec.md` D1, D5, D7.
- Research: `research/opencode-plugins.md`, `research/opencode-sessions-and-wake.md`, probes under `research/probes/`.
- OpenCode 1.18.35, https://github.com/sst/opencode/tree/v1.18.35 (`53d1eab`): `packages/plugin/src/index.ts`, `packages/opencode/src/plugin/`, `src/cli/cmd/{run,serve,plug}.ts`, `src/tool/shell.ts`.
- Cezar's OpenCode runner: the installed cezarion `dist/core/opencode-server-runner.js`.
