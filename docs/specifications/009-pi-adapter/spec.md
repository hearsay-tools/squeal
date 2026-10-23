# 009 Pi adapter

Stage: shipped 2026-10-14 (009-20 dogfooding, no blocker); approved 2026-10-14 by the human. Amendments: `status.md`. Research: `research/pi-extension-events.md` (009-01), `research/pi-sessions-and-packaging.md` (009-02), both on Pi 1.0.4, Linux, with a scripted fake provider. Spec 001 D6 (state and delivery views), D9 (the Claude Code adapter), D10 (daemon) and D11 (policy) hold, and spec 002 is the closest precedent, unless a section here says otherwise.

## Problem

Squeal delivers to Claude Code and Codex. A Pi session editing a project under validation hears about no `PASS -> FAIL`, is not stopped before editing over an undelivered regression, and is not told to leave the tests to Squeal. Pi differs from both harnesses in one way that shapes everything below: it has no hook processes. An extension is a module loaded into the Pi process, subscribed to events for the session's life, with no timeout on any handler (research, events 6). That gives Squeal a cheaper push, a real idle wake and a system-prompt primer, and takes away the bound that a 2 s hook timeout gave 002 for free.

## Goals

Each goal is testable, and each holds under `pi -p`, under a Cezar-shaped `pi --mode rpc` session, and in the TUI, unless it names a mode.

1. An agent learns about a `PASS -> FAIL` before its next model request after the tool call in which the result became known, in the same run, without running tests itself; asserted by the fake provider seeing the report in that request.
2. The matching `FAIL -> PASS` arrives the same way. Nothing arrives for `PASS -> PASS` or an unchanged failure. Parallel tool calls from one assistant message deliver at most once.
3. With `interrupt.onRegression` on, the next `edit` or `write` after an undelivered regression is blocked once with the regression entries as the reason; the run continues and the model can re-issue the edit. `bash` is never blocked, except 005 D8's opt-in test-command deny.
4. The end of a run speaks only with news, as one continuation; a run with no news costs no model request; Squeal never continues a run twice.
5. A primer telling the agent to leave the tests to Squeal, with the CLI's absolute path, is in every model request of the session, including after compaction.
6. No Squeal handler holds Pi for longer than its deadline (D4), a dead or missing daemon or store degrades to silence, and nothing Squeal opens crashes Pi or keeps `pi -p` alive after its run.
7. In the TUI and an RPC session that stays open, an idle agent whose pending tests finish with news is woken with the report (D5); never under `-p` or `json`.
8. Pi's own `pi install` installs Squeal at user scope with no project trust step and no file written by Squeal under `~/.pi`; `squeal status` in a Pi shell where the extension never ran says so.

## Non-goals

- Pi subagents as consumers of their parent. Pi 1.0.4 ships none; the example and third-party subagents are separate `pi` processes with their own session id, so one that loads Squeal is its own consumer and its parent cannot tell (research, events 7).
- Delivery relayed by Cezar through RPC `prompt` or `steer`: an extension reaches the model directly.
- A held socket to the daemon. The store is read as the other adapters read it (D4); a socket would add a crash path (an `error` with no listener kills Pi) and a leak path (it keeps `pi -p` alive) for a 0.4 ms saving.
- Project-scope install (`pi install -l`): it needs project trust and writes a project file.
- OpenCode (spec 008) and Pi on Windows or macOS.

## Design

### D1. Package and install

The adapter ships as a Pi package in this repository, `plugins/pi/`: a `package.json` with `"pi": { "extensions": ["./dist/extension.mjs"], "skills": ["./skills"] }` and Pi's host packages as `peerDependencies` with range `"*"`, never bundled; `skills/squeal/` copied from the Claude Code plugin's source by `npm run build:plugin`, as `plugins/codex/` does; and `dist/` committed: the extension bundle, the CLI, the daemon and the pytest runtime files. The bundle is ESM and declared explicitly, because Pi's directory scan ignores a bare `.mjs` (research, packaging 4). It imports only Node built-ins and the peer packages, finds its sibling files from `import.meta.url`, and runs on the Node that runs Pi (22.19 or later, so `node:sqlite` is there). CI's drift check and the version-raise rule cover `plugins/pi/dist/`.

Install is Pi's own command on a local directory: `pi install <dir>` at user scope writes Pi's settings itself and loads with no trust step; a local source is referenced in place, never copied (research, packaging 3). `install.sh` (005 D3) gains a step: when `pi` is on the PATH, unpack the release's Pi package into `${XDG_DATA_HOME:-~/.local/share}/squeal/pi/<version>/` and run `pi install` on it; an update installs the new directory and `pi remove`s the old one, and `--uninstall` removes what it recorded, as for the other harnesses. The package reaches `install.sh` as a release asset beside `install.sh` itself (process step 6a); the asset's name and the hub's role are a wave-0 check. A git install of this repository is not the route: Pi resolves a repository, not a subdirectory, so it would need a root manifest, and would clone the repository and `npm install` its runtime dependencies for a bundle that needs none.

### D2. Consumers and identity

A consumer is `(ctx.sessionManager.getSessionId(), "main")`, read from the handler's context on every event and never cached across `session_shutdown`. The agent's `bash` sees the same id as `PI_SESSION_ID`, so a `squeal status` pull is attributable without a new consumer field, and the consumer record does not name its harness (002 D2). The id survives `--continue`, `--session`, `--resume` and compaction; `--fork`, RPC `fork` and `new_session` mint a new one (research, packaging 6). Every consumer is `main`: Pi has no subagent inside one process.

`session_start` registers. Over RPC it arrives twice for one replacement, so registration is idempotent: a second start for a session this extension instance has registered changes nothing, and neither a duplicate start nor compaction clears a delivery view. Reasons `startup` and `resume` act as 001's (unregister every other consumer of the session, register, inject); `new` and `fork` are a new consumer; `reload` re-registers in place. The consumer's `HarnessProcess` is Pi's own process (`process.pid`), not the ancestor walk the hook processes use.

### D3. Events

- `session_start`: start the delivery host (D4), ensure the daemon (001 D10, spawned detached, `stdio: "ignore"`, unreferenced), register, and queue the registration header with `pi.sendMessage(<custom squeal>, { deliverAs: "nextTurn" })`, which reaches the next prompt at no extra request.
- `before_agent_start`: set `systemPromptOptions.sections.squeal` to the primer, which is fixed text plus the CLI path, so Pi stores it once and sends no delta per run; capped at 8,000 characters as 002 D3. Then `startTurn` and, with news, return it as the run's `message`.
- `input`: cancel the idle wait (D5); it resets no run flag, because input steered into a running continuation arrives as `input` too (review wave 1, B1).
- `turn_end` of an assistant message that made tool calls: `onToolBoundary`, returned as one `custom_message` entry (`customType: "squeal"`, `display: true`) without `continue`. It fires once after every parallel result, so it is 002's PostToolUse and 001's PostToolBatch in one. The final `turn_end` of a run, whose message made no tool calls, delivers nothing: that entry would wait for the next prompt, so the end of the run speaks instead.
- `tool_call`: on `edit` and `write` with `interrupt.onRegression` on, a `peek` of regressions; with entries, `{ block: true, reason }`, phrased as facts plus one sentence that the edit was not applied and can be re-issued. On `bash`, 005 D8's opt-in test-command deny from `input.command`. A blocked call is an error tool result whose text is the reason. The handler never throws, because a throw blocks the tool.
- `agent_before_settle`: 002's Stop. With news, a first registration carrying known failures, or a policy block, return the report as a `custom_message` entry and `continue: true`, only when the run's outcome is `completed`, the session has not shut down, and Squeal has not continued this run. Pi has no loop guard, so that flag, set here and cleared at `before_agent_start` (which a settle continuation does not re-fire), is `stop_hook_active`. Otherwise return nothing, which costs nothing, end the turn and record the pending files as 001 D9. `stop.waitMs`, `stop.blockOnKnownFailures` and `stop.requireFullSuite` keep their meaning.
- `agent_settled`: end the turn if `agent_before_settle` did not, which is the abort case (RPC `abort`, Escape), 002's Interrupt; then arm the idle wake (D5).
- `session_shutdown`: unregister on `quit`, and for `new`, `resume` and `fork` the outgoing session; cancel timers and the waiter, stop the delivery host. Idempotent. Every later event of the same instance is silent: closing RPC stdin mid-run fires `agent_before_settle` after shutdown (research, events 4).

Every text Squeal adds arrives at the model as plain user text, since Pi adds no wrapper (research, events 2), so each starts by naming Squeal, as the Codex Stop reason does.

### D4. Running inside Pi

Pi awaits handlers in series with no timeout, a hung handler stalls the run for good, and `abort` does not recover it (research, events 6). The shared code reads the store synchronously through `node:sqlite` with a busy timeout, which inside Pi's main thread would freeze the TUI and the RPC stream for up to that timeout. So the extension runs the shared code in a `worker_threads` worker it owns, started at `session_start` (never in the factory, which also runs without a session) and unreferenced. Each handler posts one request and awaits it against a deadline: 2 s for `turn_end`, `tool_call`, `before_agent_start` and `session_start`, `stop.waitMs` plus 500 ms for `agent_before_settle`, 3 s at `session_shutdown`. A missed deadline is silence (no entry, no block, no continuation); the worker is terminated and the next event starts a fresh one. A worker that dies or throws is the same. Every emitter Squeal creates has an `error` listener. Nothing the extension holds keeps the process alive after `session_shutdown`, with one bound: a worker blocked inside a native call (a SQLite busy wait) cannot be terminated until that call returns, so the handler is silent at its deadline but the process may live on for up to the store's busy timeout, 1 s (review wave 0, S2).

A per-event child process, the hook shape, was weighed and rejected: it costs a Node start per tool call, 140 to 200 ms on this host under load (002 D4). Wave 0 measures the worker's round trip per tool call against 002's 80 ms p95.

### D5. Idle wake

After `agent_settled`, in modes `tui` and `rpc` only, the extension arms `waitForDelta` (001 D9 as amended by 001-85: only entries of the test files pending when the turn ended). On a delta it calls `pi.sendMessage(<custom squeal>, { triggerTurn: true, deliverAs: "followUp" })`, which starts one run while the session is idle; a prompt from the user first cancels the wait. Under `-p` and `json` Pi exits after its run, and no wake is armed (research, packaging 1).

The rule follows Pi, not a launcher: any RPC client gets a run it did not request, as Claude Code's waiter wakes any interactive session (001 D9). Cezar is one such client (human, 2026-10-14: the adapter is not bound to how Cezar works); a Cezar session that ends 250 ms after settling simply loses a later wake, and its news waits for the next prompt.

### D6. Shared code and bundles

`src/harness/pi/` holds the extension: the event handlers of D3, the delivery host and its worker entry, the context reader of D2, and the build step. It imports `src/harness/shared/` for register and inject, deliver, peek and deny, Stop news and turn state, ensure and the waiter, and changes none of it beyond what a host that is not a hook process needs (a caller-supplied `HarnessProcess`, a caller-supplied consumer). The Claude Code and Codex recorded-JSON suites stay green with no fixture change.

### D7. Status under Pi

`squeal status` and the header are unchanged. Run in a shell where `PI_SESSION_ID` is set and no consumer of that session exists, `squeal status` adds one line: the Squeal Pi extension has not run in this session, with the install command. The primer and the FAIL report's `squeal why` line name the CLI by its absolute path, `"<process.execPath>" --disable-warning=ExperimentalWarning "<package>/dist/cli/squeal.mjs"`, since installing a Pi package puts nothing on the PATH and Pi's Node need not be on it either (research, packaging 4).

### D8. Daemon and worktrees

001 D10 holds. A detached daemon outlives `-p` end, TUI quit, RPC EOF, `SIGTERM` and `SIGKILL`; `session_shutdown` fires in every case but `SIGKILL`, which falls to 001 D10's process liveness and expiry (research, packaging 5). Pi has no worktrees of its own.

### D9. Policy

No new keys. `interrupt.onRegression` governs the `edit` and `write` block.

## Testing

- The fake provider becomes a test fixture under `test/fixtures/pi/`: an extension registering a scripted provider that plays planned tool calls and records every request it receives, as `research/probes/pi-extension-events/` built it. Pi 1.0.4 is a pinned devDependency, so the real Pi runs in tests with no credentials and no network (`PI_OFFLINE=1`).
- Isolation: a test that starts Pi goes through `runPi` (`test/helpers/pi.ts`), which sets `HOME`, `TMPDIR` and `PI_CODING_AGENT_DIR` into a run directory outside any repository, refuses a caller's override of them, and passes `--no-context-files --no-skills --no-approve` so a project inside a repository reads nothing of it; then Pi touches nothing outside the run (`research/wave-0-checks.md`), and the test runs locally, under Cezar and in CI.
- Unit tests on the handlers with recorded event payloads: the D3 shapes; one delivery per `turn_end` over three parallel calls; no delivery on a final `turn_end`; the block once per regression and never on `bash` by default; the continuation flag; abort ends the turn; silence after shutdown; idempotent duplicate starts.
- The delivery host: a stalled worker misses its deadline and the handler returns silence within it; a dead worker is replaced; a missing store, missing config and a newer schema are silent; per-call cost at calm load asserted as 001 does, skipped above a load threshold.
- Real Pi with the fake provider, in `-p`, `json` and `rpc`: each delivery asserted in the next request; a block then a re-issued edit; one continuation then silence; the primer after `compact`; a dead daemon without a crash; `pi -p` exits promptly after its run; a wake in RPC.
- End to end, as 001's `test/e2e`: the Pi package archived from HEAD, installed into a temp agent dir with `pi install`, a fixture repository, the shipped daemon.
- Proof: a dogfooding row with a Cezar worker on Pi and a TUI session, reported in `lessons.md`, including whether a real model reads a Squeal message as Squeal's and not the user's.

## Open questions

Owner is the coordinator unless noted.

1. Decided 2026-10-14 by the human: idle wake follows Pi's modes, not a launcher; it is armed in `tui` and `rpc`, with no Cezar case and no policy key (D5).
2. Whether a real model treats a Squeal `custom_message`, which reaches it as bare user text, as Squeal's report and not an instruction from the user. Dogfooding.
3. The release asset that carries the Pi package, its name, and whether the hub lists it. Wave-0 check.
4. Pi 1.0.4 delivers `session_start` twice per RPC replacement and runs a settle continuation after `session_shutdown` (research, events 7 and 4). D2 and D3 tolerate both; whether to report them upstream.
5. Decided 2026-10-14 by `research/wave-0-checks.md`: `PI_CODING_AGENT_DIR` alone leaks caches into `os.tmpdir()` and reads `~/.agents/skills`; moving `HOME` and `TMPDIR` too isolates Pi (Testing).

## References

- Spec 001: `../001-core-loop/spec.md` D6, D9, D10, D11. Spec 002: `../002-codex-adapter/spec.md` D1 to D4. Spec 005 D3 (`install.sh`) and D8 (the test-command deny).
- Research: `research/pi-extension-events.md`, `research/pi-sessions-and-packaging.md`, probes under `research/probes/`.
- Pi 1.0.4: the installed `@earendil-works/pi-coding-agent` `docs/extensions.md`, `docs/packages.md`, `docs/rpc.md`, `dist/core/extensions/types.d.ts`; https://github.com/earendil-works/pi.
- Cezar's Pi runner: the installed cezarion `dist/core/pi-runner.js`.
