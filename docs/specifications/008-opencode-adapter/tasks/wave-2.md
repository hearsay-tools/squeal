# 008 wave 2: proof, and the test hardening the reviews asked for

Read `../spec.md` (as amended), `../status.md` and `../reviews/wave-1.5.md` first. Host test-run policy (the human, 2026-10-15, relayed by the 001 coordinator): your full-suite verdict is `squeal run --all --wait`, not `npx vitest run`; any independent full run uses `--maxWorkers=4` under `flock /run/user/$(id -u)/squeal-full-run.lock`. 008-19 and 008-21 run in parallel on disjoint files; 008-20 starts once 008-19 has landed, so the dogfood installs a package an end-to-end test has already proven.

## 008-19 end to end with the shipped OpenCode package

Use /worker. Outcome: the OpenCode package as it ships (copied from HEAD's tracked files, as `test/e2e/plugins.ts` copies the other plugins), installed with the real `opencode plugin file:<copy>/current -g` into an isolated home, validates a fixture repository: a baseline, a `PASS -> FAIL` in the next model request, the deny before an edit, one continuation then silence, a wake under `serve`, `squeal status` from the agent's shell credited to its consumer, silence with no daemon.

- Spec: Testing; goals 1 to 9; `research/wave-0-checks.md` "For later rows" (an e2e that spawns OpenCode another way sets the six directories, `OPENCODE_DISABLE_MODELS_FETCH`, seeds every config directory, and keeps its cwd in a git repository outside this one).
- Shape: slice.
- Seam: `test/e2e/opencode.test.ts` (new), modelled on `test/e2e/pi.test.ts`. First edit: a `runOpenCode` option (or a sibling helper) that runs `opencode plugin file:<copied package>/current -g` inside the run's isolated home before OpenCode starts, so the plugin loads from OpenCode's config, not from `OPENCODE_CONFIG_DIR/plugins/`.
- Owns: `test/e2e/opencode*.test.ts`, `test/e2e/opencode*.ts`, additive changes to `test/helpers/opencode.ts` (name them).
- Leaves alone: `src/**`, `install.sh`, `plugins/**`, the files 008-21 owns.
- Done when: the e2e file passes locally and in CI on Node 22 and 24 on your pushed branch (report the run); the daemon it starts is the shipped one from the copied package; lint, typecheck, full suite green or each load failure named.

## 008-20 dogfooding

Use /worker. Outcome: `lessons.md` resolves spec 008's open questions with evidence from real models using Squeal in OpenCode: does a `PASS -> FAIL` reach the agent and change what it does, does it leave the tests to Squeal, does it read a Squeal continuation or wake, which arrives as a user message, as Squeal's report (open question 4), and does an update with a session open behave as D1 says.

- Read: `../spec.md` goals 1 to 9, `../status.md`, `../research/opencode-sessions-and-wake.md` 1 and 2, `test/e2e/opencode.test.ts` and `test/helpers/opencode.ts`, and the 009 `lessons.md` for the report's shape.
- Shape: proof. You are the judge; the sessions you start are the users.
- Where: only as `squeal-e2e` (`sudo -n --preserve-env=CLIPROXY_API_KEY -u squeal-e2e -H env -i ...`, cwd `/`; OpenCode 1.18.35 is in its `~/.npm-global`), with its own config, data, cache and state directories under `/home/squeal-e2e/dogfood-008/`. Never the agent user's OpenCode, `claude` or `codex`. The key goes by name only, through a provider `apiKey: "{env:CLIPROXY_API_KEY}"`.
- Models: `cliproxy` at `https://cliproxy.home.jarka.pl/v1`. Claude models run only in Claude Code and Cursor (human rule, 2026-10-14): `gpt-6-luna` where only the daemon is observed; `gpt-6-astra` for an ordinary task where the agent's reading of Squeal's messages matters, and at least one such session on a Grok model.
- Install as a user would: `install.sh` of the landed release with `SQUEAL_SOURCE` pointing at a local `git archive`, then, with a TUI session open (tmux), an update to a later archive: what the open session does, then after a restart.
- Project: a real open-source TypeScript library with a Vitest suite of 50 to 300 test files, cloned at a pinned commit, with `squeal setup` run in it. Name it and why.
- Sessions: at least one Cezar-shaped `opencode serve` session (a copy of the installed Cezar `opencode-server-runner` driving it, as `research/probes/opencode-sessions-and-wake/` did), including an idle wake; one `opencode run`; one TUI session. Record the load average beside every timing; start sessions only below the host's CPU count.
- Defects: write each into `lessons.md` with its evidence and a proposed row. Fix nothing in `src/`.
- Owns: `docs/specifications/008-opencode-adapter/lessons.md`, `docs/specifications/008-opencode-adapter/dogfood/**` (scripts and condensed logs; no key, no session file with secrets).
- Done when: `lessons.md` answers open question 4, goals 1, 3, 4, 5, 7 and 8 observed with real models, the update behaviour, and each defect; nothing of the run is left running; the `squeal-e2e` home holds only `dogfood-008/`, the clone, the probes' earlier directories and the npm prefix.

## 008-21 test hardening and the bridge's environment

Use /worker. Outcome: the OpenCode tests no longer depend on process scheduling or leak processes when they fail, and the bridge does not pay a proxy setup it never uses.

- Inputs: `reviews/wave-1.5.md`'s note on process-log ordering in the input-overlap test (`test/harness/opencode/idle.test.ts`, which also failed once in a loaded full run and passed alone); `test/harness/opencode/bridge-client.test.ts` spawns `setInterval` grandchildren with no teardown, so a red run leaks them (one was found alive hours later); 008-12's finding that OpenCode passes `NODE_USE_ENV_PROXY` and proxy URLs to the bridge, so Node starts in about 90 ms instead of about 42.
- Shape: repair.
- Seam: the assertions that compare request-log order; assert the set and the causal facts (no continuation, the report once) instead. Then an `afterEach` that kills every pid a test recorded. Then the bridge's spawn environment in `src/harness/opencode/bridge-client.ts`: drop `NODE_USE_ENV_PROXY` for the bridge only (the bridge and the daemon it spawns make no HTTP requests; check that claim in the shared code before relying on it), with a test.
- Owns: `test/harness/opencode/idle.test.ts`, `test/harness/opencode/bridge-client.test.ts`, `src/harness/opencode/bridge-client.ts`.
- Done when: the idle test passes 10 runs in a row under a loaded full suite or at load above 24; a failing bridge-client test leaves no process; the bridge's spawn environment test; `latency.test.ts` reported at the load you have; lint, typecheck, full suite green or each load failure named.
