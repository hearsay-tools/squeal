# Review: wave 1, 002-12 and 002-13 (task 002-14)

Reviewer task 002-14 for spec 002, 2026-10-07. Range: the 002 commits of `68aeb58..f9b55f4`, as landed in 0.1.16:

- `ebcca17`, `17b26cb`, `26b6ae4`, `c8be49b`: 002-13. The plugin package, `hooks.json` with the `$PWD` fast path, the trust-hash port and pin, `squeal init --harness codex`, `--print-launcher-config`, the status line, and `check:version` over `plugins/codex/dist`.
- `baa0593`, `2939339`, `bc9295e`, `064b815`, `82a9947`, `f9b55f4`: 002-12. The Codex entries on the shared hook code, the shared plugin build, the bundle tests, and the `createRequire` banner.
- `7a56a92`: the coordinator's rebuild of both plugins, version 0.1.16.

I read them against the spec as amended 2026-10-07, `status.md`, `research/wave-0-checks.md`, the wave-1 brief and the five questions of 002-14. I also read Codex 0.160.1 source (tag `rust-v0.160.1`: `codex-rs/hooks`, `codex-rs/core/src/hook_runtime.rs`) and ran Codex 0.160.1 itself against the bundles, in scratch `CODEX_HOME`s, as described under Probes. The 003 commits in the range belong to 003-15 and are not reviewed here.

## Verdict

**PASS at `626b616`.** Counts: 0 blockers, 3 should-fix, 6 nits.

- No Codex hook blocks or speaks falsely in the cases the brief names. `stop_hook_active`, Interrupt, subagent routing, the fast path and an inherited `CLAUDE_*` value are each handled. A mutation of each guard fails a test.
- The shared build is behaviour-neutral for the Claude Code hooks. Each committed hook bundle differs from 0.1.15 by the three banner lines only, and the banner is inert in them.
- The install path respects trust. `init --harness codex` writes only `squeal.config.json`. The nine pinned hashes equal the `currentHash` that Codex 0.160.1 reports for the installed plugin. `--print-launcher-config` output, passed as `thread/start` `config`, was accepted and trusted, and every hook ran with no bypass flag.
- SubagentStart: Codex takes `additionalContext` there and puts it in the subagent's first model request (proven). Squeal's SubagentStart says nothing, so a Codex subagent works with no header and no primer (S2).
- Latency: measured at load 3.90. Every bundled Codex hook is under 80 ms p95; Stop is the slowest at 76 ms. The fast path is 3.1 ms p95 at load 4.35.
- One honesty defect (S1): `squeal status` in a Codex shell can say the hooks have not run in a session whose hooks did run.

## Verification

The candidate is `626b616`, one commit past `f9b55f4`. That commit changes only `docs/board.md`, the two `status.md` files and the two wave-1 briefs (`git diff --stat f9b55f4 626b616 -- src test plugins` is empty), so the code under test is the range's. I ran everything in this worktree at `626b616`.

```
$ git rev-parse HEAD
626b61684ec6863147c7f38bf1a866a64da0625d
$ npm ci
found 0 vulnerabilities
npm warn install-scripts ... @parcel/watcher, esbuild ... (exit 0)
$ npm run lint
Checked 453 files in 240ms. No fixes applied.
$ npm run typecheck
tsc --noEmit   (no output, exit 0)
$ npm run build
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
(exit 0)
$ git status --porcelain
(empty: both committed plugins match the build)
```

Full suite, first run, at load average 27.9 to 32.5 on 24 cores:

```
$ npx vitest run
 FAIL  test/daemon/bootstrapped.test.ts > ... is written after the start scan   (a heartbeat not met in 60000 ms)
 FAIL  test/harness/stop.test.ts > Stop within its 2 s hook timeout > gives up on a locked store   (1886 ms, budget 1875)
 FAIL  test/harness/codex/plugin.test.ts > committed Codex plugin > has the bundles exactly as `npm run build:plugin` produces them   (Test timed out in 5000ms)
 Test Files  3 failed | 154 passed (157)
      Tests  3 failed | 1319 passed | 7 skipped (1329)
```

All three passed in isolation at once (`4 passed (4)`, 33 tests, load 28.8). Full suite, second run, at load 3.67:

```
$ npx vitest run
 Test Files  157 passed (157)
      Tests  1322 passed | 7 skipped (1329)
   Duration  52.49s
```

The first two failures are timing tests outside the range. The third is in the range (S3).

Latency, `test/harness/codex/latency.test.ts` and `test/plugins/codex/fast-path.test.ts` with `--reporter=verbose`, bundles built to a temp directory by the tests:

```
Codex fast path without Squeal: p50 2.5 ms, p95 3.1 ms, load 4.35
Codex hook latency ms, best of up to 3 rounds of 20 cold runs, load 3.90
 session-start               p50 61  p95 70  max 73
 user-prompt-submit          p50 56  p95 65  max 65
 pre-tool-use (apply_patch)  p50 48  p95 53  max 58
 pre-tool-use (Bash, silent) p50 42  p95 45  max 47
 post-tool-use               p50 58  p95 61  max 64
 post-tool-use (silent)      p50 53  p95 59  max 60
 stop                        p50 62  p95 76  max 81
 stop (silent)               p50 58  p95 69  max 71
 subagent-start (silent)     p50 60  p95 69  max 70
 subagent-stop (silent)      p50 41  p95 47  max 47
 interrupt (silent)          p50 50  p95 56  max 57
 session-end (silent)        p50 44  p95 47  max 50
 Tests  6 passed (6)
```

The load was 3.90, under the test's threshold of 4, so the 80 ms assertion ran and passed. The committed `plugins/codex/dist` equals these bundles, because the build left the tree clean.

Mutations. I ran `npx vitest run test/harness/codex` for each one and reverted it before the next:

| Mutation | Fails |
|---|---|
| M1: Stop ignores `stop_hook_active` (`handlers.ts:77`) | 2 behaviour tests: "blocks on known failures, then never again under stop_hook_active" and the recorded `exec stop-hook-active` |
| M2: `agent_id` never parsed (`input.ts:41`) | 8 or more: the subagent fixtures, "deliver a subagent's tool events only to (session_id, agent_id)", "deny a subagent's apply_patch without touching the parent's regression" |
| M3: every tool counts as an edit (`handlers.ts:52`) | 6 behaviour tests: "denies apply_patch once per regression and never Bash", the recorded PreToolUse of each mode, the end-to-end bundle run |
| M4: Interrupt does not end the turn (`handlers.ts:110`) | 1: "ends the turn at an interrupt and keeps the delta for the next prompt" |

Each mutation also failed the bundle drift check, as it should.

## Probes

All probes ran under `/tmp/rev002-14`, with `HOME=/tmp/rev002-14/fakehome` (still empty at the end) and a scratch `CODEX_HOME`. `~/.codex` was never read, written or used as `CODEX_HOME`: its `config.toml` mtime stayed 18:48, before this task. No credential was involved. Codex talked to a 40-line local mock of the Responses API (`model_providers.mock`, `base_url = "http://127.0.0.1:47611/v1"`, `wire_api = "responses"`, `requires_openai_auth = false`, `supports_websockets = false`). The mock logged each request body. It answered the first request with a `multi_agent_v1` `spawn_agent` call and every other request with a message. The scratch repositories were `/tmp/rev002-14/repo` and `repo2`, and I killed their two Squeal daemons afterwards. The probes are not committed.

- **P1, plugin trust hashes.** `codex plugin marketplace add <this worktree>` and then `codex plugin add squeal@squeal` installed `0.1.16` into the scratch cache. Codex wrote the marketplace and the plugin entries into the scratch `config.toml` itself. `hooks/list` listed nine hooks, all `untrusted`. Each `currentHash` equals the `PINNED` value in `test/plugins/codex/hooks-json.test.ts:33` for the same key (for example `pre_tool_use:0:0` `sha256:0c132913…`, `stop:0:0` `sha256:f8c8dc32…`, `interrupt:0:0` `sha256:6d3a0b16…`).
- **P2, init.** `squeal init --harness codex` in `repo`, run from the committed bundle, wrote `squeal.config.json` and printed the two plugin commands and the trust step. Nothing changed under the scratch `HOME` or `CODEX_HOME` (`find -newer` was empty).
- **P3, launcher config.** I used a second scratch home with no plugin installed. `squeal init --harness codex --print-launcher-config` gave nine `hooks.<Event>` keys and a `hooks.state` table. I passed that output as `thread/start` `config` to `codex app-server` and started one turn. Codex ran SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, SubagentStart, the subagent's UserPromptSubmit and Stop, all `completed` in 80 to 290 ms, with no bypass flag. On the second run, with a store present, SessionStart's `SQUEAL · registered at revision 0` and the primer were in the parent's first model request. On the first run the store did not exist yet, so SessionStart and UserPromptSubmit said nothing, as designed. PostToolUse's registration then reached the model as a developer message before its next step, in the same turn.
- **P4, SubagentStart `additionalContext`.** I added one probe handler to the P3 config, an extra SubagentStart group printing `{"hookSpecificOutput":{"hookEventName":"SubagentStart","additionalContext":"SUBSTART-CONTEXT-PROBE"}}`, trusted with the port's hash. Codex recorded the entry as `context`. The subagent's first model request contained `SUBSTART-CONTEXT-PROBE` and no `SQUEAL` text and no primer. Source agrees: `hooks/src/engine/output_parser.rs:102` parses SubagentStart like SessionStart, and `hooks/src/events/session_start.rs:218` documents it as "context-injection-only".
- **P5, the status line.** See S1.

## Blockers

None.

## Should-fix

**S1. `squeal status` says Codex hooks have not run in a session whose hooks ran.** Proven. `src/cli/codex/status.ts:24-32`.

Scenario: a repository with `squeal.config.json` and no store yet, which is the first Codex session after `squeal init --harness codex`. SessionStart ensures the daemon but finds no store, so it registers nothing (`shared/session.ts:63`). UserPromptSubmit finds no store either, and PreToolUse on `Bash` never registers. If the agent's first tool call is `squeal status`, the store exists by then but no consumer of the session does. Reproduced with the committed bundles in `repo2`: `session-start.mjs`, `user-prompt-submit.mjs` and `pre-tool-use.mjs` (`tool_name: Bash`) each exit 0, then `CODEX_SESSION_ID=<same id> squeal status` ends with:

```
Codex: Squeal's hooks have not run in this session (no consumer for CODEX_SESSION_ID 01a11800-…). If the plugin is installed, open the Codex TUI, run /hooks and trust the hooks of squeal@squeal; otherwise run squeal init --harness codex.
```

All three hooks ran. P3 shows the same sequence under a real app-server thread. The line meets D6's literal trigger ("no consumer of that session exists"), so it breaks no goal. It still states a fact that is false and sends the user to a trust step they already took (vision, principle 2; spec D6 calls it "the only place a user learns why Squeal is quiet").

Fix, one worker: state only what is known. For example: "No Squeal consumer is registered for this Codex session yet (CODEX_SESSION_ID …). Its hooks are not trusted, or none has reached a tool boundary since the store was created." Keep the trust step. Optionally, also let the Codex PreToolUse register a missing consumer silently when a store exists, which closes the window. Test: the three-hook sequence above, then the status line.

**S2. A Codex subagent gets neither the header nor the primer; SubagentStart should inject both.** Proven (P4), and a spec amendment. `src/harness/codex/handlers.ts:89-93`.

SubagentStart registers and returns `null`. The subagent's UserPromptSubmit and its first PostToolUse then find the consumer registered, so they return only a delta. The primer ("do not run Vitest to learn whether your edits broke something") is never said to a Codex subagent. It is said only when SubagentStart failed, because then the subagent's prompt or tool boundary registers it with the primer. That is the opposite of the intent. Codex 0.160.1 accepts SubagentStart `additionalContext` and puts it in the subagent's first request (P4). The header costs a subagent nothing, since start context needs no extra turn.

Fix, one worker: amend D3 so that SubagentStart injects the registration and the primer. Return `additionalContext("SubagentStart", text)`, which needs `"SubagentStart"` added to `ContextEvent` in `output.ts:33` and the text that `startSession` already returns. Also update the hash-neutral handler test. `hooks.json` stays the same, so no trust is lost.

**S3. The Codex drift test runs on the default 5 s timeout and failed under load.** Proven once, at load 32 in the full suite. It passed alone and at load 3.7. `test/harness/codex/plugin.test.ts:164`.

`expectSameFiles` compares Buffers with `toEqual` (`test/harness/bundle-helpers.ts:119`). `toEqual` walks a Buffer byte by byte, and the CLI bundle is 422 kB. That this cost is why the test ran 5.8 s is plausible, not measured. The Claude Code drift test passes `{ timeout: 60_000 }` (`test/harness/plugin.test.ts:22,129`); the Codex one has none.

Fix: give the test the same `BUILD` timeout, and compare with `Buffer.equals` plus the file name in the message, in `expectSameFiles`, for both plugins.

## Nits

- **N1. `--print-launcher-config` pins the absolute path of whichever checkout ran the CLI** (`launcher.ts:53`). Plausible. Run from a Cezar worktree, the printed hooks point into a directory Cezar later removes. Each hook then fails with a Node start (Codex shows a failed hook, not the model), and the hashes change with the path. The README or the command's output could tell launchers to print from a stable checkout.
- **N2. The printed marketplace source `hearsay-tools/squeal` is a private repository** (`gh repo view`: `PRIVATE`; `codex/init.ts:16`). Unverified: whether `codex plugin marketplace add owner/repo` uses the user's git credentials. If it does not, `init`'s first command fails for every user until the repository is public. Worth one line in the README either way.
- **N3. SessionEnd sweeps only the store of its own `cwd`** (`handlers.ts:116`). Plausible. After a `turn/start` `cwd` override into another repository, SessionEnd runs there (`research/wave-0-checks.md` 2). The first repository's consumer then falls to expiry. The Claude Code adapter passes several locations to `endSession`, and this one passes one.
- **N4. Internal Codex subagents fire tool hooks with no `agent_id`.** Plausible, read in source, not probed. `thread_spawn_subagent_hook_context` (`core/src/hook_runtime.rs:1042`) returns `None` for every `SubAgentSource` except `ThreadSpawn` (for example `Review`). If such a thread runs tools under the parent's `session_id`, its PostToolUse delivers the parent's delta into the review thread's context and marks it delivered. Check during 002-16 dogfooding with `/review`.
- **N5. Stop's p95 was 76 ms against the 80 ms budget at load 3.9.** The 4 ms headroom is the smallest of the twelve hooks. Watch it in 002-16.
- **N6. The status line checks consumers of this worktree only** (`status.ts:25`). An agent that runs `squeal status` from a linked worktree of the same repository gets the S1 line too. S1's rewording covers this.

## What fits

The next wave need not re-check these:

- **Identity (D2).** The consumer is `(session_id, agent_id ?? "main")`. `parseCodexInput` drops an empty `agent_id`. Codex source confirms that a `ThreadSpawn` subagent's tool events and its UserPromptSubmit carry `agent_id`, that its turns run SubagentStop and never Stop, and that Interrupt and SessionEnd are root-only (`hook_runtime.rs:400,480,507`). So the handlers' routing matches what Codex sends.
- **`stop_hook_active`.** It ends the turn and delivers nothing (`handlers.ts:77-82`), so news is never marked delivered unseen, and the delta waits for the next prompt or tool call. A first Stop blocks once with news or policy (`block(...)`).
- **Interrupt.** One `endTurn`, no output.
- **SessionStart sources.** `clear` maps to `startup`, `compact` gets the primer only, and `fork` is a new consumer.
- **The 8,000-character cap.** It applies to all model-visible text, and a trailing primer is kept whole.
- **PostToolUse.** `hookSpecificOutput.additionalContext` reaches the model before its next step in the same turn (P3).
- **The fast path (D4).** `s "$PWD"` is the 001 function with `$PWD` only. It walks to the nearest `.git`, follows `gitdir:` and `commondir`, and handles `/`, a subdirectory, a linked worktree and a config-only repository. It ignores `CLAUDE_PROJECT_DIR`, and tests cover each case. No string `CLAUDE_` occurs in a Codex hook bundle or in `src/harness/shared`, `src/harness/codex` or `src/core`. Codex does set `CLAUDE_PLUGIN_ROOT` for plugin hooks, and nothing reads it.
- **The shared build.** `src/harness/build.ts` reproduces 0.1.15's esbuild options plus the banner. Claude Code hook bundles differ only by the banner, which no hook bundle calls. `claude-code/build.ts` keeps `REPO_ROOT`, `PLUGIN_DIST`, `bundleOptions` and `writePluginVersions` for `test/e2e`. `npm run build:plugin` builds both plugins and leaves the tree clean. The skill copy and the node:test runtime copy are covered by drift checks.
- **Trust.** The hash port matches Codex 0.160.1 on all nine plugin handlers (P1) and was accepted for launcher hooks (P3). The pin fails on any change to a handler's identity (command, timeout, matcher, `statusMessage`, a non-default `additionalContextLimit`) and on any added, removed or reordered group or handler, because keys move. A change to `description` correctly does not fail it. `init --harness codex` writes nothing under `HOME` or `CODEX_HOME` (P2 and `test/cli/codex.test.ts:85`).
- **`check:version`.** It fails a `plugins/codex/dist` change without a raise and names the plugin that changed.

## Inputs for the next wave

- **A fix row for S1 to S3**, one worker. It owns `src/cli/codex/status.ts` (S1), `src/harness/codex/{handlers,output}.ts` and a D3 amendment (S2), and `test/harness/bundle-helpers.ts` plus `test/harness/codex/plugin.test.ts` (S3). S2 changes Codex bundles, so the coordinator rebuilds, raises the version, and the D1 pin stays unchanged.
- **002-15 (e2e over both plugins).** Archive each plugin from HEAD and drive the bundles with the recorded JSON in `test/fixtures/codex-hooks/`. Give each drift and build test the 60 s `BUILD` timeout from the start (S3).
- **002-16 (proof and dogfooding).** The mock-provider setup above runs every Codex hook and a real spawned subagent with no credential and no `~/.codex` read. It suits a deterministic part of the proof, alongside the model run. Observe there: N4 (`/review` threads), N5 (Stop p95), and spec open question 5 (late PostToolUse after `write_stdin`).
- **002-17 (trust through Codex).** `hooks/list` in a scratch home lists the nine handlers with `currentHash`, `trustStatus` and `pluginId`. That is the input `config/batchWrite` needs, as `research/wave-0-checks.md` 3b says.
- **Board and status drift, for the coordinator.** Board row 002-12 says "latency unverified, load 22 to 70". `status.md` says the 80 ms p95 "was not measured at calm load". It is now measured at load 3.90 and within budget. The SubagentStart open item in `status.md` is answered by P4 and S2.
- **Seen outside the range, not reviewed.** In `repo2`, where Vitest cannot start, `squeal status` printed `Full-suite checkpoint: completed at revision 0` beside notes that the runner failed. That is core status (spec 001). The cause is unverified, and the 001 coordinator may want to look at it.
