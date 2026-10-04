# Wave 3 review

Reviewer task for spec 001, 2026-10-04. Range `8da4ca9..21c9dac` (17 commits): task 001-30 daemon and CLI (`src/core/daemon`, `src/core/types/daemon.ts`, `src/cli/{daemon,start,stop,run,daemon-access}.ts`), task 001-31 Claude Code plugin (`src/harness/claude-code`, `plugins/claude-code` including the committed bundles under `dist/`, `src/cli/init.ts`), and the integration commit `21c9dac` that replaced the plugin's `ensureDaemon` shim with the daemon's implementation. Read against D9 to D12 with the amendments in `status.md` and the "Inputs for wave 3" section of `reviews/wave-2.md`.

## Verdict

The loop works once a daemon runs. With the plugin loaded through `claude --plugin-dir` and `SQUEAL_CLI` pointing at the `tsc` build, a SessionStart hook spawned the daemon, an edit that broke a test reached the model as `PASS -> FAIL` through PostToolBatch in the same turn, and the fix reached it as `FAIL -> PASS`. PreToolUse denied one edit with the regression and the model re-issued it. A Stop block on known failures fired once and `stop_hook_active` stopped the loop. A subagent got its own consumer and its own delivery. A SIGKILLed daemon was replaced by the next SessionStart. A SIGSTOPped daemon cost the hook 170 ms, not a stall. Lint, typecheck, build and tests are green, and the committed bundles are byte-identical to a fresh `npm run build`.

The loop does not run from a plugin install. Without `SQUEAL_CLI`, which nothing sets outside tests, no hook can start a daemon: `daemonCliEntry` points at a file that exists in no plugin layout. If it did, the CLI bundle it would run cannot load (its static `import "vitest/node"` resolves from the plugin directory), and in this repository, where Vitest does resolve, the bundled daemon crashes in its constructor reading a `package.json` that does not exist. A user who follows the README gets hooks that fire, exit 0, and say nothing, and a `squeal status` on the Bash path that prints a stack trace. Both 001-40 and 001-41 are blocked until this is fixed.

Counts: 2 blockers, 8 should-fix, 11 nits.

## Verification

```
$ npm ci
npm warn install-scripts 2 packages have install scripts not yet covered by allowScripts:
npm warn install-scripts   @parcel/watcher@2.6.0 (install: node scripts/build-from-source.js)
npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)

$ npm run lint
Checked 274 files in 62ms. No fixes applied.

$ npm run typecheck
tsc --noEmit   (no output, exit 0)

$ npm run build
tsc -p tsconfig.build.json && npm run build:plugin   (exit 0)
$ git status --porcelain
(empty: the committed plugins/claude-code/dist/ is byte-identical to the fresh build)

$ uptime
load average: 5.70, 5.71, 5.68
$ npx vitest run
 Test Files  74 passed (74)
      Tests  594 passed | 5 skipped (599)
   Duration  46.69s

$ npx vitest run test/harness/latency.test.ts --reporter=verbose   (load 1.95)
hook latency ms, best of up to 3 rounds of 20 cold runs
 session-start   p50 55  p95 70  max 75
 post-tool-batch p50 49  p95 71  max 77
 pre-tool-use    p50 48  p95 67  max 67
 stop            p50 53  p95 74  max 74
 session-end     p50 39  p95 44  max 46
 waiter          p50 32  p95 34  max 35
```

The 5 skipped tests are the @parcel/watcher backend tests, which run only on darwin. The full run was above the latency test's `MAX_LOAD` of 4, so its p95 was measured again on its own at load 1.95: under 80 ms for every hook, with 6 to 13 ms of headroom on a fixture store with 3 checks.

### Probe

A throwaway probe under `/tmp/squeal-w3-probe` (outside every checkout, so no `node_modules` above it; deleted afterwards, worktree clean). Claude Code 2.1.288, model `claude-sonnet-5-5`, real HOME for authentication with `--setting-sources project --strict-mcp-config` so no user plugin, hook or MCP server loaded, `DISABLE_AUTOUPDATER=1`.

- `proj/`: `git init`, `src/math.ts` (`add`, `mul`), `test/math.test.ts` (2 tests), `vitest.config.ts`, `npm install -D vitest@5.0.3` in the project. `npx vitest run`: 2 passed.
- `cache/squeal/squeal/0.0.0/`: `git archive HEAD plugins/claude-code`, the tree a marketplace install copies, in the `<cache>/<marketplace>/<plugin>/<version>/` shape.
- `squeal init` from the `tsc` build (`node dist/cli/index.js init`), because the plugin's CLI cannot load (A1). It wrote `squeal.config.json` and `.claude/settings.json` as documented. Committed.

**A. The plugin's CLI and daemon entry, without Claude Code**

```
$ cd proj && $PL/bin/squeal --version            # PL = the installed copy
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'vitest' imported from
  /tmp/squeal-w3-probe/cache/squeal/squeal/0.0.0/dist/cli/squeal.mjs
exit 1
$ $PL/bin/squeal status                          # same error, exit 1

$ plugins/claude-code/bin/squeal --version       # in this repository, Vitest resolves from ./node_modules
0.0.0

# daemonCliEntry() as the hook bundle computes it (new URL("../../cli/index.js", import.meta.url)):
in-repo plugin:   .../worktree/plugins/cli/index.js                     (does not exist)
installed plugin: /tmp/squeal-w3-probe/cache/squeal/squeal/cli/index.js (does not exist)

# squealVersion() as the CLI bundle computes it (new URL("../../../package.json", import.meta.url)):
.../worktree/plugins/package.json                                       (does not exist)

$ node plugins/claude-code/dist/cli/squeal.mjs daemon /tmp/squeal-w3-probe/proj
Error: ENOENT: no such file or directory, open '.../plugins/package.json'
    at squealVersion (.../dist/cli/squeal.mjs:9231:29)
    at new Daemon (.../dist/cli/squeal.mjs:9250:14)
    at startDaemon (.../dist/cli/squeal.mjs:9247:10)
exit 1
$ ls proj/.git/squeal
locks  store.sqlite  store.sqlite-shm  store.sqlite-wal     # store created, no note, no daemon
```

**B1. `claude -p` with the installed plugin, as a user would run it**

```
cd proj && DISABLE_AUTOUPDATER=1 claude -p --plugin-dir $PL --setting-sources project \
  --strict-mcp-config --model claude-sonnet-5-5 --permission-mode acceptEdits \
  --allowedTools "Bash(sleep:*)" Read Edit --output-format stream-json --verbose --include-hook-events \
  "... 1) Edit src/math.ts so that add returns a - b ... 2) sleep 6 3) Read test/math.test.ts 4) sleep 4
   5) Read src/math.ts. Then reply with every note whose text starts with SQUEAL ..., or say NONE."
```

```
INIT plugins: [{"name":"squeal","path":"/tmp/squeal-w3-probe/cache/squeal/squeal/0.0.0","source":"squeal@inline"}, ...]
HOOK_RESPONSE SessionStart  exit 0 stdout ""   (x2: session-start and waiter)
HOOK_RESPONSE PreToolUse    exit 0 stdout ""
HOOK_RESPONSE PostToolBatch exit 0 stdout ""   (x5)
HOOK_RESPONSE Stop          exit 0 stdout ""   (x2)
ASSISTANT: NONE. No hook note starting with SQUEAL appeared in any tool result.
$ ls proj/.git/squeal  -> No such file or directory      (no store, no daemon process)
```

**B2. Same, with `SQUEAL_CLI=<worktree>/dist/cli/index.js`** (the `tsc` build, the only CLI that can run a daemon). Steps: read, `sleep 8`, break `add`, `sleep 6`, read, `sleep 3`, fix `add`, `sleep 6`, read.

```
HOOK_RESPONSE SessionStart exit 0 (empty)            # spawned the daemon; no store yet, so no registration
after step 1, PostToolBatch: "SQUEAL · registered at revision 0\nRevision 0: 3 current, 0 pending, 0 stale,
  0 unknown. Full suite: completed at revision 0.\nKnown failures: 0"
after step 4, PostToolBatch: "SQUEAL · 1 check changed at revision 1\n...\nFAIL  test/math.test.ts > math > adds
  \n      PASS -> FAIL\n      expected -1 to be 3 // Object.is equality\n      at test/math.test.ts:6:23"
after step 8, PostToolBatch: "SQUEAL · 1 check changed at revision 2\n...\nPASS  test/math.test.ts > math > adds
  \n      FAIL -> PASS\n      at test/math.test.ts:5:3"
nothing after steps 2, 3, 5, 6, 7, 9; the model quoted all three verbatim.
$ pgrep -af "cli/index.js daemon"  -> node .../dist/cli/index.js daemon /tmp/squeal-w3-probe/proj
consumers after the session: []                      # SessionEnd unregistered it
```

**C. PreToolUse and Stop policy** (`stop.blockOnKnownFailures: true`, `stop.waitMs: 1000`, same `SQUEAL_CLI`). Steps: read, `sleep 4`, break `add`, write `notes.txt`, `sleep 2`, end the turn without fixing.

```
SessionStart: "SQUEAL · registered at revision 3 ..."            # store exists now, so SessionStart registers
PreToolUse (Write notes.txt): permissionDecision "deny", reason "SQUEAL · 1 check changed at revision 4 ...
  FAIL  test/math.test.ts > math > adds\n      PASS -> FAIL ...\n\nSqueal policy interrupt.onRegression
  denied this Write call, so the edit was not applied. The same call can be re-issued; this regression does
  not deny again."
ASSISTANT: "The hook blocked the Write because the `add` edit broke `test/math.test.ts`. That break is what the
  script intended, and the hook says the call can be re-issued, so I'm retrying it unchanged."
PreToolUse (same Write, again): exit 0 (empty)                   # no second denial
Stop: {"decision":"block","reason":"Squeal policy stop.blockOnKnownFailures is on and 1 known failure exists at
  revision 5: test/math.test.ts > math > adds.\n\nSQUEAL · status at revision 5 ..."}
ASSISTANT: "The `adds` failure is still there, and I'm leaving it ..."
Stop (stop_hook_active): exit 0 (empty)                          # no loop
```

**H. Hung, dead and misconfigured daemon** (hook bundles run directly with recorded JSON, timed).

```
daemon alive:        session-start rc=0 153 ms, registration injected
kill -STOP <daemon>: session-start rc=0 170 ms, registration injected (no word that the daemon is not answering)
                     post-tool-batch rc=0 60 ms, stop rc=0 59 ms
kill -9 <daemon>:    socket file left behind; session-start rc=0 108 ms; 1.5 s later a new daemon serves,
                     squeal status: "Daemon: running, last heartbeat 2 s ago"
squeal.config.json with "stop.waitMs": "500" and "runner.tierSzie": 2, three SessionStarts 1.5 s apart:
  daemons=0 after each; status notes: 3 x "daemon exited: .../squeal.config.json: "stop.waitMs" must be a
  number >= 0, got "500"; unknown key "runner.tierSzie""
```

**E. Stop right after a fix, with a failure pending.** A second test file that takes 2.5 s, break `add` with new content (so no stored result matches), deliver, then fix with new content and run the Stop bundle 300 ms later (`blockOnKnownFailures: true`, `waitMs: 0`).

```
PostToolBatch: "SQUEAL · 2 checks changed at revision 12 ... FAIL test/math.test.ts > math > adds ...
  FAIL test/slow.test.ts > adds slowly ..."
Stop: {"decision":"block","reason":"Squeal policy stop.blockOnKnownFailures is on and 2 known failures exist
  at revision 13: test/math.test.ts > math > adds, test/slow.test.ts > adds slowly.\n\nSQUEAL · status at
  revision 13\nRevision 13: 0 current, 5 pending, 0 stale, 0 unknown. ..."}
6 s later, squeal status: "Revision: 13 / Known failures: 0 / Affected checks: 5 passed"
```

**F and G. Does Stop context alone continue the turn?** Break `add`, then reply `DONE` (`waitMs: 1500`, no block policy). With the 2.5 s test in the same tier, Stop waited 1.5 s and delivered nothing (F). Without it (G):

```
ASSISTANT: DONE
Stop: {"hookSpecificOutput":{"hookEventName":"Stop","additionalContext":"SQUEAL · 1 check changed at revision
  19 ... PASS -> FAIL ...\nKnown failures: 1"}}
ASSISTANT: "I was told to make `add` return `a - b + 0 * 5652` and then reply DONE. A hook then reported that
  `test/math.test.ts > adds` now fails (expected 3, got -1), and I'm not editing anything further."
```

Stop `additionalContext` starts another model turn. The README's reason for "Stop speaks only with news" is correct.

**S. Subagent.** The main agent launched a foreground general-purpose subagent that broke `add` and slept.

```
SubagentStart: "SQUEAL · registered at revision 20 ..."     # the subagent's own consumer
subagent PostToolBatch: "SQUEAL · 1 check changed at revision 21 ... PASS -> FAIL"
SubagentStop: exit 0 (empty)
main PostToolBatch after the Agent tool: the same PASS -> FAIL, delivered to the main consumer separately
consumers after SessionEnd: only the two left by the H probes (fed by hand, no SessionEnd)
```

Not probed: the interactive idle waiter (needs an attended session), macOS, a GitHub marketplace install (the repository is not reachable from here).

## Blockers

### B1. A plugin install cannot start a daemon

- **Where:** `src/core/daemon/ensure.ts:66-67` and `:84-87`; `src/core/daemon/version.ts:9` with `src/core/daemon/daemon.ts:71`; `src/core/daemon/desk.ts:46-48` with `src/harness/claude-code/build.ts:33`.
- **What is wrong, three breaks in a row:**
  1. `daemonCliEntry()` returns `new URL("../../cli/index.js", import.meta.url)`. That is right for `dist/core/daemon/ensure.js` in the `tsc` build. Bundled into `plugins/claude-code/dist/session-start.mjs` it resolves to `plugins/cli/index.js`, or `<cache>/<marketplace>/<plugin>/cli/index.js` in an install. Neither exists, so `existsSync(cli)` fails and `ensureDaemon` returns `unavailable` without spawning (probe A, B1). `hooks.json` does not set `SQUEAL_CLI`; only tests do.
  2. With the right path (`dist/cli/squeal.mjs`), the daemon still dies: `squealVersion()` reads `../../../package.json` from the bundle, which is `plugins/package.json`. The exception escapes the `Daemon` constructor after the store was created and the lock taken, so the process exits 1 with no note in the store, and `squeal status` shows only "no daemon running" (probe A). `main.ts` reads `../../package.json` and gets the plugin's file, so the two version readers disagree on where the manifest is.
  3. The front desk worker is loaded from `./front-desk.js` beside the module. The build bundles no such entry, so the shipped daemon would serve its socket on the main thread, the case the worker exists to avoid (pings past 100 ms while Vitest loads, and a hook that then reports `unavailable` instead of spawning).
- **Failure scenario:** the README install path. SessionStart, PostToolBatch, PreToolUse and Stop all fire and exit 0 with empty output. No store, no daemon, no delivery. The model reports "NONE" (B1 probe). Silence here reads as "nothing broke".
- **Suggested fix:** the hook passes the CLI it ships. `ensureDaemon(root, { cli })` takes the entry explicitly; the hooks pass `fileURLToPath(new URL("./cli/squeal.mjs", import.meta.url))` (the bundles sit in `dist/`, the CLI in `dist/cli/`), the CLI's `squeal start` passes its own `process.argv[1]`, and `SQUEAL_CLI` stays a test override. One version source for both bundles: esbuild `define: { __SQUEAL_VERSION__: ... }` from the root `package.json`, falling back to the manifest walk in the `tsc` build. Bundle `src/core/daemon/front-desk.ts` as `cli/front-desk.mjs` and let `prepareFrontDesk` find either name. Write a note before any step that can throw after the store opens, so a daemon that dies at start leaves a reason.

### B2. The plugin's `squeal` CLI cannot load: Vitest is resolved from the plugin, never from the project

- **Where:** `src/runners/vitest/adapter.ts:1` (static `import { createVitest, version } from "vitest/node"`), `src/harness/claude-code/build.ts:42` (`external: ["vitest", "vitest/*", "@parcel/watcher"]`), `plugins/claude-code/bin/squeal`.
- **What is wrong:** an ES module import resolves relative to the importing file. In `dist/cli/squeal.mjs` the import is a top-level `import` statement (esbuild hoists it out of the lazy `__esm` wrapper), so it is resolved when the bundle loads, for every command. From a plugin install there is no `node_modules` above the bundle. The build comment says "Runner-side packages the daemon loads from the project, never from the plugin"; nothing implements that. In this repository the import silently finds Squeal's own dev copy of Vitest, which is why `plugin.test.ts:95` passes.
- **Failure scenario:** probe A. In a project with Vitest installed, `bin/squeal --version` and `bin/squeal status` from the installed plugin both fail with `ERR_MODULE_NOT_FOUND: Cannot find package 'vitest' imported from .../dist/cli/squeal.mjs`. The skill tells the agent to "Run `squeal status` and read it" before claiming completion; that pull path prints a stack trace. `squeal why`, `squeal run --all`, `squeal init` and the daemon itself fail the same way.
- **Suggested fix:** load Vitest lazily and from the project. In the adapter, `createRequire(join(root, "package.json")).resolve("vitest/node")` and `await import(pathToFileURL(resolved).href)`; a project without Vitest becomes a runner failure (a state with a note, D5), not a crash. Keep only type imports from `vitest/node` at the top level so `status`, `why`, `init` and `--version` never touch it. The same applies to `@parcel/watcher` on macOS (N11). Then the daemon runs the project's Vitest version, which the environment hash already records.

## Should-fix

### S1. The Stop block calls pending failures "existing" at the current revision

- **Where:** `src/harness/claude-code/hooks/stop.ts:42-46`, `src/harness/claude-code/text.ts:59-62`.
- **What is wrong:** `failures` takes every known state with outcome `fail`, whatever its validity. The reason then says "N known failures exist at revision R". A failure whose re-run is queued at R was observed at an earlier revision; whether it exists at R is unknown. Vision: "an old result never gets to pose as the current truth".
- **Failure scenario:** probe E. The agent fixes the code and ends its turn. Stop blocks with "2 known failures exist at revision 13" while the header beside it says "0 current, 5 pending". Both pass 3 s later. The agent is sent back to fix failures that no longer exist. `stop.waitMs` is capped at 1500 ms and a tier commits all its files at once (probe F), so any tier slower than 1.5 s produces this.
- **Suggested fix:** block only on `current` failures; when some are `pending`, say so in the reason ("2 checks last failed at revision 12; their re-run at revision 13 is pending") and let the block policy decide whether pending failures block (a new key, or block with the honest wording). Test with a slow fixture file.

### S2. Delivered text never says whether a daemon is validating, and only SessionStart restarts one

- **Where:** `src/core/delivery/format.ts` `headerLine` (no liveness), `src/harness/claude-code/hooks/session-start.ts:16` (the only `ensureDaemon` call), `post-tool-batch.ts` and `stop.ts` (none).
- **What is wrong:** D12: "Dead daemon: hooks still serve status and deltas from the store; status says the daemon is down and since when." Only `squeal status` says it. Registrations, deltas and Stop blocks carry revision and counts as if validation were running. D10: "A hook that finds no live socket spawns"; in practice only SessionStart and SubagentStart do.
- **Failure scenarios:** (a) probe H: with the daemon SIGSTOPped, SessionStart injects "registered at revision 6 ... 3 current" and nothing changes again for the session. (b) Probe H: with a bad policy file the daemon exits at every start, and every hook says "3 current" at a revision no daemon will ever advance. (c) An interactive session idle overnight: its waiter polls but does not count as "heard from", so the consumer expires after 12 h, the waiter exits, no Stop re-arms it, and the daemon idles out 60 min later. The next prompt's PostToolBatch re-registers the consumer, nobody restarts the daemon, and the session gets silence for the rest of the day. The skill says "No report means nothing changed".
- **Suggested fix:** put daemon liveness in `StatusHeader` from the heartbeat the hooks already can read (`worktrees.daemon`), and print it in the header line when the daemon is not alive ("No daemon has validated since 14:02; results are as of revision 6"). Deliver that line once per consumer when liveness changes, through the same view mechanism. PostToolBatch and Stop call `ensureDaemon` when the heartbeat is older than two intervals: a store read, no socket cost on the hot path. Add the liveness caveat to the skill's "No report means" sentence.

### S3. Two policy readers that disagree; a bad policy is an exit and a respawn loop; the daemon never reloads policy

- **Where:** `src/harness/claude-code/policy.ts:8-13` ("this stand-in goes when that loader lands"; it did not go at integration), `src/core/daemon/daemon.ts:105-108`, `src/core/daemon/policy.ts`.
- **What is wrong:** the daemon rejects unknown keys and wrong types and exits; the hooks ignore both and apply the rest. Policy is read once at daemon start; `inputs` and `env.allowlist` change keys (D3), so an edit to them is ignored until the daemon happens to restart, which a registered consumer prevents.
- **Failure scenarios:** probe H: `"stop.waitMs": "500"` makes the daemon exit at every SessionStart and SubagentStart, each attempt runs `integrity_check` on the shared store and appends a note (the 20-note list fills with copies, pushing out the runner notes status needs), while the hooks keep applying the other keys. Separately: an agent adds `"inputs": ["fixtures/**"]` to fix a stale result; nothing re-keys for the rest of the session.
- **Suggested fix:** one loader (`loadPolicy`) used by daemon and hooks, returning the defaults plus problems instead of throwing. A bad policy is a state, like a broken Vitest config: the daemon keeps running on defaults for the bad keys, persists one note, and the hooks deliver one factual line. Treat a revision that changes `squeal.config.json` like a config change: reload, re-key what `inputs` and `env.allowlist` touch, note the reload.

### S4. `squeal init` writes a marketplace entry the CLI's schema reads differently, and the install path has no first step

- **Where:** `src/cli/init.ts:19`, `plugins/claude-code/README.md` "Install in a project".
- **What is wrong:** Claude Code 2.1.288's schema for a `github` marketplace source describes `path` as "Path to marketplace.json within repo (defaults to .claude-plugin/marketplace.json)". `init` writes the directory `plugins/claude-code`. Not verified against GitHub from here; `claude plugin validate plugins/claude-code` passes, which checks only the manifest. Separately, the README's first command is `squeal init`, but the package is `"private": true`, and the plugin's `bin/squeal` is only on the Bash tool's path once the plugin is enabled, which is what `init` does (and B2 stops it from loading at all).
- **Suggested fix:** write `path: "plugins/claude-code/.claude-plugin/marketplace.json"` (and check how `source: "."` resolves for a marketplace below the repository root, or move `marketplace.json` to the repository root with `source: "./plugins/claude-code"`). Verify with one real `claude plugin install squeal@squeal --scope project` in 001-41 and record the transcript. Document a first step that works without a global install, for example `claude --plugin-dir` once and `squeal init` from the Bash tool, or `npx` from the repository.

### S5. No test runs the plugin the way it ships, so B1 and B2 pass CI

- **Where:** `test/harness/bundles.test.ts` (every SessionStart call sets `SQUEAL_CLI`, lines 108, 125 and on), `test/harness/plugin.test.ts:95` (`bin/squeal --version` run inside the repository, where `node_modules` resolves), `test/daemon/helpers.ts:43-63` (daemon tests run a `tsc` build only; nothing runs `dist/cli/squeal.mjs daemon`).
- **Suggested fix:** one test that copies the plugin with `git archive HEAD plugins/claude-code` into a directory with no `node_modules` above it, installs nothing, and against a fixture project with its own Vitest runs: `bin/squeal --version`, `bin/squeal status`, then the session-start bundle with no `SQUEAL_CLI`, then waits for the socket and asserts a PostToolBatch delta after an edit. That test would have failed on all three B1 breaks and on B2. It is also the core of 001-40.

### S6. Subagent consumers stay registered until SessionEnd, each with a full seeded view

- **Where:** `src/harness/claude-code/hooks/stop.ts` (SubagentStop never unregisters), `src/harness/claude-code/hooks/session-end.ts:57-68`.
- **What is wrong:** a finished subagent can receive nothing more (the waiter is never armed for it, and its agent id is not reused). Its consumer row keeps the daemon from idling, and `register` wrote one view row per known check at SubagentStart. A long interactive session that runs 30 subagents on a 5,000-check project leaves 150,000 view rows until SessionEnd, or for 12 h when the session dies without one. The registration cost itself (one insert per check inside a 2 s hook) was measured only on a 3-check fixture.
- **Suggested fix:** SubagentStop delivers, then unregisters its consumer. Amend D9. Add the registration cost at 5,000 checks to the latency test or the dogfooding measurements.

### S7. D9 changes made in code but not recorded as amendments

- Stop speaks only with news (a delta, a first registration with known failures, or a block), not "the status header plus delta". Justified: probe G shows Stop `additionalContext` starts another model turn.
- `stop.waitMs` is capped at 1500 ms by the 2 s hook timeout (D11 says nothing).
- In a repository without a store, SessionStart spawns the daemon and registers nothing; the first PostToolBatch registers and injects the header (probe B2). D9 places registration at SessionStart.
- SubagentStop unregistering, if S6 is accepted.
- **Suggested fix:** one amendment line in `status.md` and the matching sentences in D9 and D11.

### S8. Socket path and spawn checks that can be wrong for a different environment or user

- **Where:** `src/core/daemon/paths.ts:14` and `:32`, `src/core/daemon/server.ts:29-30`, `src/core/daemon/ensure.ts` (`probeDaemon` computes the path, never reads the one the daemon recorded), `src/core/daemon/open.ts:57` and `:76`.
- **What is wrong:** without `XDG_RUNTIME_DIR` the socket is `/tmp/squeal-<id>.sock`, a fixed name in a shared, sticky directory. `mkdirSync(dirname, { mode: 0o700 })` protects nothing there because `/tmp` exists. Another local user can bind that name first: hooks then ping a stranger's socket, believe a daemon is alive and never spawn, and the real daemon's `rmSync` fails with `EPERM` at every start. Separately, a daemon started from a shell whose `XDG_RUNTIME_DIR` differs from Claude Code's (tmux, `su`, cron) records `/run/user/...` while the hooks probe `/tmp/...`: every SessionStart spawns a daemon that loses the lock, after running `integrity_check` on the shared store, because the store opens before the lock.
- **Suggested fix:** use a per-user directory (`<tmpdir>/squeal-<uid>/`, created 0700 and checked for owner and mode) when there is no runtime dir. In `probeDaemon`, try the socket recorded in `worktrees.daemon` first when its heartbeat is fresh, as `daemonSocket` in the CLI already does. Take the lock before `openStore({ checkIntegrity: true })`; the lock file needs only the store directory.

## Nits

- **N1.** `src/cli/main.ts:26` still says "Commands from spec 001 still to come: init.", and `init` is missing from the usage list.
- **N2.** `init` claims "Nothing is written unless every file can be" but writes `squeal.config.json` (`init.ts:67`) before `settings.json` (`:90`). A settings write that fails leaves the config behind.
- **N3.** `waiter-lock.ts:41` unlinks the lock file before closing the database that holds the lock. A waiter starting in between creates a new file and locks it while the old holder still runs. Close first, then unlink only if a fresh `acquire` succeeds (as `removeWaiterLock` does).
- **N4.** Stop can exceed its own 2 s timeout: about 50 ms Node start, 1500 ms `STOP_WAIT_CAP_MS`, then up to 1000 ms `STATUS_BUSY_TIMEOUT_MS` on the delivery transaction. Claude Code then kills the hook and nothing is delivered (nothing is consumed either). Cap the wait at 2000 minus the busy timeout minus a margin, or use a shorter busy timeout after the wait.
- **N5.** Header counts include file-level checks: the 2-test fixture reports "3 current" and status "3 passed". Correct per D6, but an agent reads them as tests. Consider counting them separately or naming them in the skill.
- **N6.** `squeal start | head -1` crashes with an unhandled `EPIPE` from `process.stdout.write` (seen in the probe). Ignore `EPIPE` on stdout in `src/cli/index.ts`.
- **N7.** The daemon's stdio is ignored and there is no log file, while D12 refers to "one line in the daemon log if reachable". Either log to `<store>/logs/<worktree-hash>.log` (bounded) or amend D12 to say notes replace the log.
- **N8.** `ownSignals` (`src/core/daemon/signals.ts`) replaces `process.on` and friends for the daemon's lifetime and drops every SIGINT, SIGTERM and SIGHUP listener any dependency registers. Documented and scoped to the daemon; worth a test that a Vitest worker pool still shuts down on SIGTERM.
- **N9.** `test/harness/hooks.test.ts` is 358 lines (styleguide: about 300 is a signal to split).
- **N10.** CI already fails on stale bundles: `plugin.test.ts:101` builds into a temp dir and compares every `.mjs`, and CI's Test step runs it. Cheap belt and braces: `git diff --exit-code -- plugins/claude-code/dist` after the Build step, which also catches a build that only CI's Node version produces differently.
- **N11.** `@parcel/watcher` is external in the CLI bundle and can never resolve from a plugin install, so the macOS watcher backend cannot load there. Add to the macOS list (open question 7) or resolve it from the project as in B2.

## What fits

So that wave 4 does not re-check these:

- **Start and shutdown order** follow the wave 2 inputs: realpath, common dir from git, worktree id, store with `integrity_check` and a note on a newer schema, exclusive lock (losers exit 0), worktree row and `setDaemon` with socket and heartbeat, policy, recovering runner, sink, `createDaemonLoop` with `describeFailure`. The socket binds before registration and before Vitest loads, a documented deviation that keeps the spawn-to-serve time short. Shutdown: loop, runner, `setDaemon(null)`, store, socket (unlinked), lock last.
- **Singleton:** SQLite `BEGIN EXCLUSIVE` with `locking_mode=EXCLUSIVE`, released by the OS on any death. Tests: five concurrent starts yield one daemon; a SIGKILLed daemon is replaced within 200 ms of the spawn. Probe H: a stale socket file is replaced and the new daemon serves within 1.5 s of the next SessionStart.
- **Socket answers from memory:** handlers are synchronous; `run --all` is handed to the scheduler and polled with `run-all-status`, never awaited in a handler. In the `tsc` build a worker thread serves the socket, and a ping answers in under 100 ms while a tier runs (tested).
- **Broken Vitest config is a state:** `createRecoveringRunner` turns a failed `createVitestAdapter` into rejected calls, which the scheduler maps to `unknown` with one note, and retries on every batch. Tested at start and during a run.
- **Exit conditions:** root deleted, linked worktree entry removed, newer schema, idle with no consumers (tested with a short interval), consumer expiry every minute.
- **Hooks never stall:** every synchronous hook has `timeout: 2`; socket probes have 100 ms; a SIGSTOPped daemon cost 170 ms (probe H); every internal error, missing store, newer schema, corrupt store and non-Squeal repository exits 0 silently (tested per bundle); in a repository without a store or `squeal.config.json`, SessionStart spawns nothing. The daemon spawn is detached with `stdio: "ignore"` and `unref()`.
- **`-p` guard:** the waiter requires `CLAUDE_CODE_SESSION_ATTENDED=1` and an entrypoint other than `sdk-cli`, and returns before opening the store; in every `-p` probe its hook response was immediate and empty. Subagents never arm it.
- **PreToolUse peek** marks only regressions delivered: probe C denied once, the re-issued call passed, and recoveries stayed for PostToolBatch (tested).
- **Stop** reads pending counts through `readHeader`, which B2 of wave 2 made atomic with the revision: probe E shows "0 current, 5 pending" 300 ms after an edit. `stop_hook_active` prevents a second block (probe C). Stop context continues the turn (probe G), which justifies speaking only with news.
- **Consumers:** `(worktree, session, agent id or "main")`; subagent deliveries are isolated from the parent's (probe S); SessionEnd unregisters every consumer of the session, subagents included; PostToolBatch registers a consumer that SessionStart could not (probe B2).
- **Delivered text is factual** apart from S1: header, failures first, location, summary; the denial sentence states that the edit was not applied and can be re-issued, and the model read it that way (probe C).
- **Bundles:** reproducible (zero diff after `npm run build`), checked in CI by `plugin.test.ts:101`; hook bundles import only `node:` modules (tested from the esbuild metafile); p95 67 to 74 ms on this machine.
- **`squeal init`** is idempotent, keeps every unrelated key and the file's indentation, and never writes hook commands (tested).

## Inputs for wave 4

### Before 001-40 and 001-41: a fix task for B1, B2 and S5

They are one change: ship a CLI that the hooks can find and that loads the project's Vitest, and a test that proves it from an installed copy. Without it, 001-40 can only pass by setting `SQUEAL_CLI` to a `tsc` build, which no user has, and 001-41 cannot start a daemon from the plugin at all (this repository's `node_modules` makes B2 invisible here, but B1 breaks 1 and 2 still apply). S1, S2 and S3 should land in the same wave because dogfooding would otherwise measure their effects instead of the design.

### 001-40 end to end

- Run from a plugin copy made with `git archive HEAD plugins/claude-code` in a temp directory with no `node_modules` above it, and a fixture repository with its own `npm install` of Vitest. No `SQUEAL_CLI` anywhere. CI has no Claude Code, so drive the bundles with recorded hook JSON (`test/harness/recorded/`) and the real daemon the session-start bundle spawns.
- Scenarios from spec Testing: one `PASS -> FAIL` then one `FAIL -> PASS` on PostToolBatch; break and recover between two PostToolBatch calls is silent; a second worktree's daemon bootstraps with zero runs and inherited provenance in its registration; an edit in the second worktree runs only its affected files and delivers nothing to the first worktree's consumer.
- Add from this review: PreToolUse denies once and leaves the recovery for PostToolBatch; Stop with `blockOnKnownFailures` blocks only on current failures (S1, use a slow fixture file); a SIGKILLed daemon is replaced by the next SessionStart and the delivered header says the daemon was down (S2); a bad `squeal.config.json` yields one note and a running daemon (S3).
- The content-keyed lookup makes repeated edits instant: in the probe, restoring a file to content seen before produced its result in under 150 ms with no run. Scenario steps must use fresh content (for example a counter in a comment) when a run is the thing under test.

### 001-41 dogfooding

- Load with `claude --plugin-dir plugins/claude-code` in this repository, once B1 is fixed, and separately install once through the marketplace entry `squeal init` writes (S4). Record both transcripts.
- Measure: transition-to-delivery latency (edit to PostToolBatch), duplicate rate, and hook p95 on this repository's store size rather than a 3-check fixture, including SubagentStart registration cost (S6).
- PreToolUse (open question 3): probe C is the first data point. Told the edit "can be re-issued", the model re-issued it unchanged and said why. Record whether, without a scripted instruction, it looks at the failure first.
- Stop: how often `stop.waitMs` capped at 1500 ms actually catches a result (probe F: never, when the tier holds a file slower than the cap), and how the model reacts to a Stop delta that restarts its turn (probe G: it summarised and stopped).
- Interactive waiter: wake latency while idle, behaviour across `/clear`, compaction and `--resume`, and how often it consumes a delta mid-turn ahead of PostToolBatch (both poll the same view; nothing double-delivers, but the waiter's text is framed as a Stop hook error).
- Daemon liveness: how often sessions run with the daemon down, and whether agents notice once S2 prints it.
