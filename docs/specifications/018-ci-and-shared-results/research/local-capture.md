# local-capture: collecting the results of tests agents run themselves (row 018-22)

Researcher for spec 018, 2026-11-09. Topic `local-capture` in `README.md` (the human, 2026-11-09). Squeal source at `57fda39b7` (0.1.419); Vitest 5.0.3 (this repository) and 4.1.10 (cezar); Node v24.22.1. Records: Claude Code transcripts and Codex rollouts of squeal's and cezar's worktrees, 2026-11-02 00:00Z to 2026-11-09 00:00Z (7 days); a copy of squeal's store. Docs fetched 2026-11-09: Claude Code `hooks.md` and `permissions.md` (code.claude.com), Codex config reference (developers.openai.com). No agent CLI ran; no test suite ran; one two-test fixture ran once. Load 21 to 37 on 24 vCPUs, so no timing was measured. Probes: `probes/local-capture/` (throwaway). Tags: **[exp]** verified by experiment, **[docs]** read in official docs, **[src]** read in source code, **[inf]** inferred.

## Questions answered

| # | Question | Answer |
|---|---|---|
| 1 | How often, at what cost | squeal: 477 runs in 7 days (68 a day) in 84 of 221 sessions, about 31,000 test-seconds, about 7% of the file-seconds Squeal itself recorded in that window. cezar: 1,784 Vitest runs plus 300 node:test and 401 other script runs (355 a day); the Vitest runs cost about 137,500 test-seconds, about 8% of Squeal's background rate there. Squeal keeps no record of these runs; only transcripts hold them **[exp][src][inf]** |
| 2 | Ways to capture | Alias and PATH shim: no; they reach 1 of 11 command forms. Hook rewrite: works in all four harnesses but changes which permission rules match. A Vitest reporter in the project's config: reaches every form in every harness, output and exit code unchanged, but needs a project change that re-keys the project once. Session environment injection carries the recorder in every harness without touching the command, but cannot attach a reporter alone **[exp][docs][src]** |
| 3 | Which runs are valid at the daemon's key | Only a run whose closure did not change from start to end, whose resolved config equals the daemon's except three named fields, that wrote no snapshot, without a name filter. A plain `vitest run <paths>` differs from the daemon in `snapshotOptions.updateSnapshot`, `includeTaskLocation` and coverage only. `-t`, `-u`, `--coverage`, `--bail`, `--retry`, `--pool` and 9 more flags change a keyed field. About two thirds of the runs have a storable shape **[exp][src][inf]** |
| 4 | Answer instead of run | The existing deny (`testCommand.denyWhenCurrent`, off in both projects) recognizes 0 of 2,962 commands: agents pipe 85 to 95% of runs and use `pnpm exec vitest` or `npm test -- <files>`, which it never accepts. A broader answer needs a substitute with a result contract (005 `hook-levers.md`) and removes the agent's independent check **[exp][src]** |
| 5 | Fit with principles 1, 3, 5, 8 | Capture through the project's reporter fits all four if passes are stored silently, ingested in the background, and the reporter is a project opt-in. A rewrite or an automatic approval does not fit principle 8 **[inf]** |

## 1. What Squeal knows, and how often agents run tests

**What Squeal knows at a test command today** **[src]**. Every harness's pre-tool hook (`claude-code/hooks/pre-tool-use.ts`, `codex/handlers.ts`, `pi/run.ts`, `opencode/bridge-turn.ts`) calls `testCommandOf` (`deny.ts:70`), which returns `null` unless `testCommand.denyWhenCurrent` is on. Then `recognizeTestCommand` (`test-command.ts:17`) splits the text with `shellWords`, which refuses any pipe, chain, redirect, subshell, expansion, glob or leading assignment, and asks each runner's description. Vitest accepts only `vitest run` or `npx vitest run` with filename filters, `--silent` and `--reporter`, from the worktree root, or `npm test`/`npm run <s>` with no arguments when the script is exactly that form (`runners/vitest/describe.ts:98-150`). `resolveTestFiles` maps the filters onto Squeal's own listing; `denyCurrentTestCommand` denies once per consumer when every file has a current result, and records only that it denied (`test-command-denied.ts`). The reason names the files, revision, outcomes, failures and inherited sources (`test-command-reason.ts`). So Squeal knows the command text, the working directory, the consumer, the files a narrow command runs and their current states. It records nothing about a command it lets run, and nothing about its output. Neither project sets `denyWhenCurrent` (both `squeal.config.json`).

**The record** **[exp]** (`manual-runs.mjs`, `summarize.mts`, `out-manual-runs.txt`). 7 days, same classifier as 005-01's `metric.mjs` with a stricter command position:

| | squeal | cezar |
|---|---|---|
| Sessions with a shell command / with a test run | 221 / 84 | 1,623 / 276 |
| Runs (a day) | 477 (68): Claude Code 372, Codex 105 | 2,485 (355): Codex 1,282, Claude Code 1,203 |
| What | Vitest 477: `pnpm exec vitest` 424, `node_modules/.bin/vitest` 53 | `npm test -- …` (Vitest) 1,727, `npx vitest` 52, `node --test` 300, `test:e2e` 148, `test:package` 105, `test:parity` 101, others 52 |
| With a pipe, chain or redirect | 404 (85%) | 2,360 (95%) |
| Name filter (`-t`) | 77 (16%) | 441 (18%) |
| Outcome read (pass / fail / unknown) | 223 / 91 / 163 | 491 / 153 / 1,841 |
| Wall time | 12,118 s (29 min a day) | Vitest 41,251 s; node:test 3,820 s; other scripts 74,447 s |
| Test-seconds | 16,559 s for the 300 runs whose paths priced from the store (wall ratio 2.58); about 31,000 s for all **[inf]** | 13,604 s summed from 342 Vitest summaries (ratio 3.41 to wall); about 137,500 s for all Vitest runs **[inf]** |

Comparison **[inf]**: in the same 7 days squeal's store recorded 430,710 s of file-level results (one row per check and key, so a low bound on Squeal's own work); manual runs are about 7% of it. For cezar, `main-results.md` 1 measured 243,500 background file-seconds a day (2026-10-29 to 11-07); manual Vitest runs are about 19,650 a day, about 8%. The 401 cezar script runs (`test:e2e`, `test:package`, `test:parity`) are suites Squeal does not run here (`e2e` is `at: manual`), so no capture inside Squeal's Vitest key reaches them. Older evidence (005 `adoption-baseline.md` 2, October): 22% of agent runs were redundant at start, 50% partly current, 28% not covered.

## 2. Ways to capture a manual run

| Way | Needs | Harnesses | Command forms it sees | Output, exit code |
|---|---|---|---|---|
| Shell alias | the developer's rc file | Claude Code keeps aliases in its shell snapshot (`# Aliases`, `shopt -s expand_aliases` in `~/.claude/shell-snapshots/*`) **[exp]**; Codex runs `bash -c`, non-login (002 `wave-0-checks.md`), where `expand_aliases` is off **[exp]** | the first word only, so not `pnpm exec vitest`, `npx vitest` or `npm test` **[inf]** | unchanged |
| `vitest` shim first on `PATH` | the developer's `PATH` | all | 1 of 11 forms: bare `vitest`. `npx`, `npm exec`, `pnpm exec`, `pnpm vitest`, npm and pnpm scripts and `node_modules/.bin` all ran the local binary **[exp]** (`out-shim-reach.txt`) | unchanged |
| Hook rewrite to `squeal ci record -- <cmd>` | Squeal's harness hook | Claude Code `updatedInput` **[exp]** (005 `hook-levers.md` 1); Codex only with `permissionDecision: "allow"` **[exp][src]** (same, 2); Pi `tool_call` input is mutable (009 `pi-extension-events.md` 1) **[src]**; OpenCode `tool.execute.before` args are mutable (008 `opencode-plugins.md`) **[src]** | any form the hook can parse | Claude Code "evaluates permission rules … against the input your hook returns"; an allow rule matches past only "certain known-safe environment variables" and a fixed wrapper list (`timeout`, `time`, `nice`, `nohup`, `stdbuf`) **[docs]**. A wrapper or a `NODE_OPTIONS=` prefix stops a user's `Bash(npm test *)` rule from matching, so new prompts appear; Codex's rewrite is also an approval |
| Vitest reporter in the project config, writing a part file (D8 format) when a capture switch is set | one edit to `vitest.config.*` | all, humans and IDEs too | every form that loads the config | none: `--reporter` changes no keyed field **[exp]** (`out-config-local.txt`); the daemon passes its own `reporters`, which wins over the config **[src]** (`adapter.ts:224-227`). The config file is keyed, so the edit re-keys that project's results once **[src]** (`environment.ts` `environmentFiles`) |
| Session environment injection (`NODE_OPTIONS=--import <recorder>`, a capture switch) | Squeal's harness integration; Codex: the user's or project's `config.toml` | Claude Code SessionStart `CLAUDE_ENV_FILE` persists variables "for the shell commands Claude runs later" **[docs]**; Codex `shell_environment_policy.set`, "explicit environment values injected" **[docs]**; Pi passes its own environment to `bash` **[exp]** (009); OpenCode `shell.env` per call **[exp]** (008) | every Node process | none; the command text is unchanged, so permission rules are unchanged **[inf]**. Vitest 5.0.3 reads no environment variable for reporters (`VITEST_*` read in its dist: worker id, pool, max workers, mode, blob label, others) **[src]**, so injection carries the recorder and the switch, not results |
| `squeal ci record` (spec D8) typed by a person | a habit or a script | all | what the person types | passes through, by D8's design **[src]** (spec) |

## 3. Which runs can be stored at the key the daemon computes

The daemon trusts its own tier only when the key's inputs are equal before and after the run: it snapshots the stat cache when the tier starts and re-stats every closure path after (`scheduler/stability.ts` `snapshotInputs`, `changedSince`; spec 001 D5), and it adds runtime reads to the observed set, refusing a path first hashed after the run began (`scheduler/observed.ts`) **[src]**. A manual run needs the same proof, with the daemon told when the run starts and ends **[inf]**.

Environment, measured with `createVitest` and Vitest's own `parseCLI` against the daemon's options (`config-local.mjs`) **[exp]**:

- `vitest run`, with or without path filters, `--reporter`, `--silent`, `--outputFile` or `--maxWorkers`: differs only in `snapshotOptions.updateSnapshot` (`new` against the daemon's `none`) and `includeTaskLocation` (unset against `true`). With Squeal's coverage provider on, as here by default, the daemon's key also holds the provider marker where a manual run has coverage off **[src]** (`canonicalConfig`).
- Bare `vitest` with an agent variable set: `watch` also differs. Vitest's default is `watch: !isCI && process.stdin.isTTY && !isAgent` **[src]**, so an agent never enters watch mode.
- A keyed field differs for `-t` (`testNamePattern`), `-u` (`updateSnapshot: all`), `--coverage`, `--bail`, `--retry`, `--testTimeout`, `--sequence.shuffle`, `--no-isolate`, `--pool`, `--allowOnly=false`, `--passWithNoTests`, `--changed`, `--globals`, `--disableConsoleIntercept`, and in 5.0.3 `--shard` (the coverage temp directory).
- `-t` reports every other test as `skipped` with exit 0 **[exp]**: stored, it would read as a real skip. The keyed `testNamePattern` already refuses it.
- A run with `updateSnapshot: new` writes a missing snapshot and passes where `none` fails (`ci-step.md` 3) **[exp]**: store only a run that wrote no snapshot, which the recorder's write records or Vitest's snapshot summary show **[inf]**.

Other conditions **[inf]**: the run must be at the worktree root with the project's own config (not `--config`, `--root` or a `cd` elsewhere, 18 squeal and 189 cezar runs); no leading assignment, since variables outside `env.allowlist` are not keyed (`keys/environment.ts`); the same `process.version` as the daemon; and, for a run without the recorder, only files the daemon already holds an observed entry for. Passes and skips only, as D2 exports: an agent's failure under load is often a flake (005-01 found 3 of 9 disagreements were flakes), and the daemon's held-failure path should confirm it.

Storable shape in the record (no `-t`, `-u`, `--coverage`, other directory or keyed flag) **[exp]**: squeal 322 of 477 Vitest runs (68%), cezar 1,135 of 1,784 (64%; 121 of them with `--project`, which this probe did not test). The prize is smaller than those shares, because the daemon often runs the same file at the same content within seconds: 005-01 measured own-change runs starting about 10 s after the edit at p50 **[inf]**.

## 4. Answering a manual run from current results

**What exists** **[src][exp]**. D8's deny is off by default and, when on, recognizes 0 of the 2,962 commands in this window (0 of 477 squeal, 0 of 2,485 cezar). Only 20 cezar commands would match after removing `timeout` and `2>&1` by hand. 005 `lessons.md` found the same: 0 of 1,989. The causes are the pipe and redirect refusal, `pnpm exec`, and `npm test -- <files>`.

**Risk** **[src][inf]**. A substitute must state its scope, revision, reused against executed counts, and a failure-aware exit code (005 `hook-levers.md` 3); Claude distrusted a cached "0 test files" in every rewrite session there. A partial answer is the main principle 2 risk: a piped command expects real runner output, and Squeal holds file-level results without console output. The agent's own run also found Squeal wrong 5 times in 005-01 (runtime reads, spawned processes, a stale module cache, load). A capture gives that check for free: an equal key with a different outcome is a flake or a key gap worth a status note, not an overwrite.

## Recommendation for Squeal

1. **Do not use aliases, PATH shims or a hook rewrite to capture.** The first two miss most command forms (measured). A rewrite changes which permission rules match in Claude Code and is an approval in Codex (principle 8).
2. **If capture is built, build it as a project opt-in Vitest reporter** that writes D8's part format only when a capture switch is set, plus the observed-read recorder through each harness's session environment where one exists. The daemon ingests a part in the background like one of its own tiers: stability check from the run's start to end, environment equal except `updateSnapshot`, `includeTaskLocation` and coverage, no snapshot written, passes and skips only, silent (principle 1). The reporter reuses D8's recorder and format, so most of the code comes with row 018-16.
3. **Measure before building.** The ceiling is about 7 to 8% of Squeal's own test-seconds in these two projects, minus runs the daemon repeats anyway. One cheap row: join the transcript runs of storable shape with the store's runs of the same file and closure within the run's span, to count runs the daemon had not yet done at that content.
4. **Do not widen the answer-instead-of-run path now.** It needs the substitute contract of 005, and it removes the independent check that capture can turn into a signal.

## Open questions

1. Whether a config `reporters` list that adds Squeal's reporter keeps Vitest's agent output, or replaces it (output change). Not tested.
2. Whether `--project` changes a keyed field (121 cezar runs). Not tested; the fixture had one unnamed project.
3. The real saving: runs of storable shape that the daemon had not run at that content (recommendation 3). Not determined, because it needs per-run closure content at run time.
4. Whether a Codex plugin can set shell variables per session. Only `config.toml` was read; Codex hook source was not.

## Sources

- Squeal at `57fda39b7`: `src/harness/shared/{test-command,test-command-files,test-command-reason,deny}.ts`, `src/runners/descriptions.ts`, `src/runners/vitest/{describe,adapter,environment}.ts`, `src/core/delivery/test-command-denied.ts`, `src/core/scheduler/{stability,observed}.ts`, `src/core/keys/environment.ts`, `src/runners/observe/recorder.cjs`; both `squeal.config.json`; cezar `package.json` (scripts).
- Vitest 5.0.3 dist (`node_modules/vitest/dist`, `chunks/defaults.*.js:53`, `VITEST_*` reads).
- Claude Code docs, fetched 2026-11-09: https://code.claude.com/docs/en/hooks.md (`CLAUDE_ENV_FILE`, line 1354; `updatedInput`, line 1975), https://code.claude.com/docs/en/permissions.md ("Wrappers", lines 227-235). Codex: https://developers.openai.com/codex/config-reference (`shell_environment_policy.set`).
- Earlier findings: `specifications/005-agent-adoption/research/{adoption-baseline,hook-levers}.md`, `005-agent-adoption/lessons.md`; `specifications/002-codex-adapter/research/wave-0-checks.md`; `specifications/008-opencode-adapter/research/{opencode-plugins,opencode-sessions-and-wake}.md`; `specifications/009-pi-adapter/research/pi-extension-events.md`; this folder's `ci-step.md`, `main-results.md`.
- Records: `~/.claude/projects/-home-agent-projects-{squeal,cezar}*` (main and `subagents/` files), `~/.codex/sessions/2026/11/*`, this session excluded; squeal store copy 2026-11-09 14:08 local (deleted). Probes and outputs: `probes/local-capture/`.
