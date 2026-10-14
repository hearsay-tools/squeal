# 008 wave 2: proof, and the test hardening the reviews asked for

Read `../spec.md` (as amended), `../status.md` and `../reviews/wave-1.5.md` first. Host test-run policy (the human, 2026-10-15, relayed by the 001 coordinator): your full-suite verdict is `squeal run --all --wait`, not `npx vitest run`; any independent full run uses `--maxWorkers=4` under `flock /run/user/$(id -u)/squeal-full-run.lock`. 008-19 and 008-21 run in parallel on disjoint files; 008-20 starts once 008-19 has landed, so the dogfood installs a package an end-to-end test has already proven. Landing (`docs/process.md` steps 5 and 6): the coordinator integrates 008-19 and 008-21 onto `cand/<version>`, and a reviewer passes that exact SHA before main; workers never raise the version.

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

## 008-22 the primer after a first registration at a tool boundary

Use /worker. Outcome: an OpenCode session that starts in a repository with no store yet (the first session after `squeal setup`, before any daemon ran) carries the primer from the first request after its consumer exists, not only after the next user message (goal 5; found by 008-19).

- Defect: `chat.message`'s `register` answers `registered: false` with no store, so `squealHooks`' `primer` stays `null`. The bridge's `after` starts the daemon and registers the consumer at the first tool call, but only `register()` sets `primer` (`src/harness/opencode/hooks.ts` near `primer = answer.primer ?? primer`), so under `opencode run` the whole session goes without it.
- Shape: repair.
- Seam: `OcAnswers.after` (and `prompt`) in `src/harness/opencode/protocol.ts` carry `primer` and `stopWaitMs` when the bridge registered or found the consumer; `hooks.ts` takes them as `register()` does. First edit: a `hooks` unit test where `register` answers `registered: false`, `after` answers a primer, and the next `experimental.chat.system.transform` carries it.
- Owns: `src/harness/opencode/**` except `bridge-client.ts`'s `bridgeStart`, `test/harness/opencode/**`. Leaves alone: `test/e2e/**`, `test/helpers/opencode.ts` (008-19). Do not commit `plugins/*/dist`, raise the version or the key format.
- Done when: the unit test fails before and passes after; a real-OpenCode run through `runOpenCode` in a fresh repository whose second model request carries the primer; lint, typecheck, the opencode tests green.

## 008-23 review of `cand/0.1.184` (wave 2)

Use /reviewer. Outcome: `reviews/wave-2.md` committed with a verdict on the exact candidate SHA the spawn names. Every finding is labelled proven, plausible or unverified, and it is this candidate's landing gate (`docs/process.md` step 6).

- Range: the spawn names it, from `origin/main` to the candidate: 008-21, 008-22 and 008-19 cherry-picked, the coordinator's test commit, then the version and bundle commit. Spec: D2 to D5, goals 1 to 9 as amended; `reviews/wave-1.5.md`.
- Questions:
  - 008-21: does `bridgeStart`'s `--import data:` preload restore `NODE_USE_ENV_PROXY` exactly, with an empty value and with none, for what the bridge spawns, including the daemon and the tests it runs (001 D11)? Can it break the bridge on Node 22.13?
  - 008-22: can `after` or `prompt` now carry a primer for a consumer that does not exist, or one stale against D3's cap? Is the second store open per user message within D4's deadline?
  - 008-19: does the e2e run the shipped copy, never the source tree, and stay off the real `HOME`?
  - The coordinator's change to `opencode-hooks.test.ts:131`: is weakening the root-consumer assertion honest given 001 D10's sweep?
- Writes only `docs/specifications/008-opencode-adapter/reviews/wave-2.md`. Runs real OpenCode only through `runOpenCode`. Takes the full-suite verdict from `squeal run --all --wait`; any independent full run uses `--maxWorkers=4` under `flock /run/user/$(id -u)/squeal-full-run.lock`.
