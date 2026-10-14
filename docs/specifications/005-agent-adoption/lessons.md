# 005 Agent adoption: dogfooding lessons

Board row 005-18, 2026-10-14. Spec 005 `## Testing`, the Proof bullets, with D7 and D8. Squeal at `f8d3c10a` (plugins 0.1.156). "Since the release" runs after the release and is not here.


## The Proof bullets, answered

| Proof bullet | Answer | n | Where |
| --- | --- | --- | --- |
| D8 (`testCommand.denyWhenCurrent`): how often it fires | **0 denies in 16 `d8-deny` sessions** (95% Wilson 0 to 19%). Every own test command carried a redirect or a chain, which D8 lets through by design; over this repository's real sessions, 0 of 1,989 test commands have a shape D8 recognizes | 16 sessions; 1,989 commands | Part 1 |
| D8: accepts or reruns at once | nothing to split: no deny | 0 | Part 1 |
| D8: any false claim after a deny | none possible: no deny. Across all 28 sessions, 28 of 28 final claims were true, 0 false passes | 28 | Part 1 |
| Squeal slower than the agent, sessions that end red | cold: 12 of 12 claims true; warm Haiku ran Vitest itself in 3 of 8 sessions, cold in 0 of 8: large, unconfirmed (Fisher p 0.2; 20 per arm would confirm) | 8 + 8 | Part 1 |
| Reworded gate | no cells, by the coordinator's decision: 005-02 measured it, part 3 measures it in real sessions | | Part 1, Part 3 |
| A fresh large worktree set up with `squeal setup`: time until every test file is current | **never, in either arm** (39 and 43 min measured): no checkpoint verdict. Files with no result at about 38 min: 291 of 651 (45%) on 2026-10-10, 0 of 819 with cezar's own config, 78 of 779 after `setup --yes` | 1 worktree per arm | Part 2 |
| Results reused | **687 of 779 files (88%) at registration** in a second worktree; the warm-up then re-ran all of them | 1 | Part 2 |
| The agent's claims about silence and about being done | 2 of 2 edit sessions said `unknown` with Squeal's pending count; none read silence as a pass or as broken delivery. 1 false claim in 4 sessions, about setup, not tests | 4 sessions | Part 2 |
| The metric since `97144d9` | own test runs per editing session 12.1 to 6.6 (-45%, p 1.4e-05); outside a gate 10.1 to 5.9 (-41%), short of goal 6's 4.5; full-suite Vitest 2.08 to 0.70 (-66%) | 232 and 255 sessions | Part 3 |
| Since the release | not here: it runs after the release | | |

Load: the brief asks for calm load. Sessions started only below 24 (the CPU count), and each session's load is listed. Other coordinators' processes still ran on the host: up to 29 CPUs at 06:55, during part 2's arm (a).

## Part 1: spec 006's atomic tier, with D8 on (`testCommand.denyWhenCurrent`)

### What ran

28 sessions, no retry, 2026-10-14 06:10 to 06:30 UTC, one-minute load at start 1.3 to 19.1 on 24 CPUs (each session's load is in `research/probes/dogfood/part1-cells.json`). Arms: `p0` (the plugin alone) against `d8-deny` (`evals/variants/d8-deny.json`), side by side, effort `medium`. The coordinator's cells:

| Run | Fixture | Scenario | Model | Reps per arm | Sessions | Results |
| --- | --- | --- | --- | --- | --- | --- |
| R1a | warm | a2-slow | Claude Code `claude-haiku-5-5` | 4 | 8 | `evals/results/2026-10-14-0.1.156.20261014T061010Z-9e6ed6.d8-deny.atomic-variant.json` |
| R1b | warm | a1-break | Claude Code `claude-haiku-5-5` | 2 | 4 | `…20261014T061428Z-a8e6fa.d8-deny.atomic-variant.json` |
| R1c | warm | a2-slow, a1-break | Codex `gpt-6-luna` | 1 | 4 | `…20261014T061644Z-e0169f.d8-deny.atomic-variant.json` |
| R2 | cold | a2-slow | `claude-haiku-5-5` 4, `gpt-6-luna` 2 | | 12 | `run-cell.mjs --cold`, run `r2cold-20261014T061909Z`; no results file, since `run-baseline.mjs` has no cold switch: `part1-cells.json` |

Each R1 run has its `atomic-compare.md` beside it. Cost: $0.09 for the 20 Claude Code sessions; Codex reports tokens only. The gate-squeal condition (the reworded gate) got no cells, by the coordinator's decision: 005-02 measured it (no full Vitest run in 5 of 5 sessions, against 5 of 5 under a Vitest gate) and part 3 measures it in real sessions.

Isolation: every session and the runner ran as `squeal-e2e` through `research/probes/dogfood/as-e2e.mjs`, 005-17's command line (`sudo -n [--preserve-env=<names>] -u squeal-e2e -H env [-i] …`, cwd `/`), with every scratch directory and `SQ_EVALS_ROOT` under `/home/squeal-e2e/runs/sq18-p1`. The repository went in as a `git bundle` of `f8d3c10a`, so the results files name the real commit (the coordinator's Q1). Credentials by name only (`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, the Codex provider's key variable); the runner's `$HOME/.codex/config.toml` holds `codexConfig`'s allow-listed fields only. The runner's own scan: 0 files held a secret in any cell.

"Cold" is real at the start: in every cold session the first Squeal evidence was "no daemon, every result unknown"; the agent edited before Squeal had any result, then waited for it (20 waits in 12 cold sessions, no sleep). On this fixture (7 fast files, one 12 s slow file) Squeal caught up within the session; part 2 is the large repository.

### How often D8 fires

**0 denies in 16 `d8-deny` sessions (0%, 95% Wilson 0 to 19%).** The accept-or-rerun split has n = 0: nothing to split. No claim followed a deny, so none could be false.

The arms are identical on every atomic measure (Fisher p 1.0 throughout): Haiku a2-slow `no-rerun-answered` 3/4 against 3/4, every `claim-true` and `no-false-pass` 4/4, 2/2 or 1/1.

Why it never fired: in 28 sessions only 3 ran Vitest themselves (all Haiku, warm a2-slow: 2 `p0`, 1 `d8-deny`), 9 commands, and **every one carried a redirect or a chain**, which D8's step 1 lets through by design: `npx vitest run test/invoice.test.ts 2>&1 | tail -40`, `npx vitest run test/clock.test.ts 2>&1 | grep -E "Tests|Test Files|FAIL|timed out" ; git diff --stat`. In the one `d8-deny` session with own runs, that third command ran while `test/clock.test.ts` held a current result: with the bare command, it would have been denied.

The same holds outside the lab. `research/probes/dogfood/d8-reach.py`, a port of `shellWords` and `vitestCommand` (`src/harness/shared/test-command.ts`, read, not imported), over this repository's 262 sessions since `97144d9` (part 3): **0 of 1,989 test commands have a shape D8 recognizes** (95% Wilson upper bound 0.2%). 55% carry a redirect (`2>&1`, nearly always with `| tail`), 38% are chained, the rest are expansions, pipes, other runners or leading assignments. This repository's agents also prefix `timeout 600`, which falls through as another command.

So as specified, D8 is safe and inert. It made no false claim possible, and it changed nothing in any session. Its reach is not limited by how often agents rerun answered results (2 of 28 sessions here; Haiku 1 to 3 in 20 in `ATOMIC.md`). It is limited by the shape of the command. **Proposed planned row** (D8, owner 005): recognize an output-only tail, `2>&1` alone or followed by one `| tail [-n] N`, `| head [-n] N` or `| grep …` stage reading only the command's stdout, as the same command. The deny's reason then stands in for the output the agent wanted to filter. Any other chain or redirect still falls through. Evidence: the 9 lab commands and the 1,989 real ones above. No count of sessions would confirm a fire rate before that row: a fire is impossible for these commands.

### Final claims, cold and warm, and sessions that end red

Every session ended red by design (a1-break and a2-slow break a test). **28 of 28 final claims were true** (`fail`, matching ground truth and Squeal's own verdict); 0 false passes (95% Wilson upper 12%). Cold made no difference to the claims: 12 of 12 true. It did change the agents' own runs: warm Haiku a2-slow ran Vitest in 3 of 8 sessions, cold in 0 of 8. That is a large gap, unconfirmed (Fisher p 0.2); 20 sessions per arm would confirm a gap of that size with 80% power (two-sided Fisher, 5%). One reading: in a cold session Squeal's first message says it is working, and Haiku waits for it rather than racing it.

### Every session

From `research/probes/dogfood/part1-cells.json` (`analyze-part1.py`): load is the one-minute load at the session's start; own runs are Vitest commands the agent ran itself; the claim is the session's final `TESTS:` word against ground truth.

| Run | Task, arm, rep | Model | Load at start | Wall, s | Own runs | D8 denies | Claim | Truth |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R1a | a2-slow d8-deny r1 | Claude Code `claude-haiku-5-5` | 8.64 | 31 | 0 | 0 | fail | fail |
| R1a | a2-slow d8-deny r2 | Claude Code `claude-haiku-5-5` | 6.37 | 26 | 0 | 0 | fail | fail |
| R1a | a2-slow d8-deny r3 | Claude Code `claude-haiku-5-5` | 5.32 | 42 | 3 | 0 | fail | fail |
| R1a | a2-slow d8-deny r4 | Claude Code `claude-haiku-5-5` | 3.75 | 31 | 0 | 0 | fail | fail |
| R1a | a2-slow p0 r1 | Claude Code `claude-haiku-5-5` | 9.6 | 42 | 3 | 0 | fail | fail |
| R1a | a2-slow p0 r2 | Claude Code `claude-haiku-5-5` | 6.75 | 27 | 0 | 0 | fail | fail |
| R1a | a2-slow p0 r3 | Claude Code `claude-haiku-5-5` | 4.82 | 33 | 0 | 0 | fail | fail |
| R1a | a2-slow p0 r4 | Claude Code `claude-haiku-5-5` | 4.27 | 44 | 3 | 0 | fail | fail |
| R1b | a1-break d8-deny r1 | Claude Code `claude-haiku-5-5` | 1.97 | 30 | 0 | 0 | fail | fail |
| R1b | a1-break d8-deny r2 | Claude Code `claude-haiku-5-5` | 3.37 | 32 | 0 | 0 | fail | fail |
| R1b | a1-break p0 r1 | Claude Code `claude-haiku-5-5` | 2.14 | 26 | 0 | 0 | fail | fail |
| R1b | a1-break p0 r2 | Claude Code `claude-haiku-5-5` | 2.25 | 28 | 0 | 0 | fail | fail |
| R1c | a1-break d8-deny r1 | Codex `gpt-6-luna` | 9.31 | 38 | 0 | 0 | fail | fail |
| R1c | a1-break p0 r1 | Codex `gpt-6-luna` | 3.03 | 40 | 0 | 0 | fail | fail |
| R1c | a2-slow d8-deny r1 | Codex `gpt-6-luna` | 7.41 | 30 | 0 | 0 | fail | fail |
| R1c | a2-slow p0 r1 | Codex `gpt-6-luna` | 8.47 | 26 | 0 | 0 | fail | fail |
| R2 cold | a2-slow d8-deny r1 | Claude Code `claude-haiku-5-5` | 4.8 | 41 | 0 | 0 | fail | fail |
| R2 cold | a2-slow d8-deny r2 | Claude Code `claude-haiku-5-5` | 3.28 | 36 | 0 | 0 | fail | fail |
| R2 cold | a2-slow d8-deny r3 | Claude Code `claude-haiku-5-5` | 3.4 | 35 | 0 | 0 | fail | fail |
| R2 cold | a2-slow d8-deny r4 | Claude Code `claude-haiku-5-5` | 1.28 | 34 | 0 | 0 | fail | fail |
| R2 cold | a2-slow d8-deny r1 | Codex `gpt-6-luna` | 17.68 | 31 | 0 | 0 | fail | fail |
| R2 cold | a2-slow d8-deny r2 | Codex `gpt-6-luna` | 12.81 | 33 | 0 | 0 | fail | fail |
| R2 cold | a2-slow p0 r1 | Claude Code `claude-haiku-5-5` | 6.4 | 35 | 0 | 0 | fail | fail |
| R2 cold | a2-slow p0 r2 | Claude Code `claude-haiku-5-5` | 3.78 | 37 | 0 | 0 | fail | fail |
| R2 cold | a2-slow p0 r3 | Claude Code `claude-haiku-5-5` | 2.7 | 36 | 0 | 0 | fail | fail |
| R2 cold | a2-slow p0 r4 | Claude Code `claude-haiku-5-5` | 1.6 | 45 | 0 | 0 | fail | fail |
| R2 cold | a2-slow p0 r1 | Codex `gpt-6-luna` | 3.42 | 35 | 0 | 0 | fail | fail |
| R2 cold | a2-slow p0 r2 | Codex `gpt-6-luna` | 19.12 | 36 | 0 | 0 | fail | fail |

## Part 2: cezar, set up with `squeal setup`

### What ran

Everything ran as `squeal-e2e` through `as-e2e.mjs`, under `/home/squeal-e2e/runs/sq18-cz`. Squeal is the pinned plugin build of `f8d3c10a` (0.1.156), the same as part 1. Cezar is `git archive` of `/home/agent/projects/cezar` at `5dbb4b09`, in three copies, each installed with `corepack pnpm install --frozen-lockfile` (pnpm 12.11.2, never `npm ci`) and built with `pnpm run build`:

- `asis/`: cezar as it is, with the `squeal.config.json` its agents wrote in `20880223` (#1017), `bbab66e9`, `af156319` and `5dbb4b09`. Arm (a).
- `fresh/`: a `git worktree` of `asis` at a commit that only removes `squeal.config.json`, so it shares `asis`'s store as a cezar task worktree shares its main checkout's. Arm (b): `squeal setup --yes` (every default, warm-up included).
- `skill/`: a separate clone, for the setup-skill sessions.

The real `/home/agent/projects/cezar` was only read (`git show`, `git grep`); nothing was written there. Drivers: `research/probes/dogfood/part2.sh`, `part2-sessions.sh` and `poll-status.sh` (`squeal status --json` every 30 s, into one line per poll); their outputs are in `research/probes/dogfood/part2/`.

Harness artifacts, not findings. The arms' plans ran with the plugins installed as `squeal@squeal`, so they report "plugin not installed". Before the sessions I renamed the case pin's marketplaces `hearsay`, as the eval runner does (`evals/lib/variant.mjs:52`), so both harnesses install `squeal@hearsay`, the id setup and its Codex trust step expect. The isolated user's PATH lacked `pnpm` until a corepack shim went in during arm (a).

### Does `setup --plan` notice a suite no runner enumerates?

**Not before a daemon has listed it.** The cezar coordinator's question was about its browser e2e: a Vitest project (`packages/web/e2e/vitest.config.ts`, `root: import.meta.dirname`, `include: ['**/*.e2e.ts']`) with a `globalSetup` that runs `.ai/scripts/test-env-up.sh`. On a copy with no store, `setup --plan` counts 744 test files; the daemon lists 819. The 75 missing are exactly the browser files: `listTestFiles` (`src/cli/setup/repo.ts:139`) falls back to the root config's text and reads `include` arrays there only, and cezar's root config names its projects by path. Its only trace in the plan is `not resolved statically: .:test:e2e = sh .ai/scripts/e2e.sh`. Two consequences:

- `setup --check` on cezar's own config exits 1, calling `slow.include` `packages/web/e2e/*.e2e.ts` and the `inputs` key of the same glob outdated ("selects no test file"). Both are right: the daemon puts all 75 files in the slow tier under them. Once a daemon has listed the worktree, `--check` reads the store and the false line goes away. **Defect, proposed row (005, D3 and `--check`):** the static listing reads each `test.projects` entry's own config file for `root` and `include`, or `--check` says it cannot tell instead of "selects no test file" when the root config names projects it did not read.
- Arm (b)'s fresh setup proposes no slow group for the browser suite. Its config marks only `packages/cezar/test/e2e/**` slow (below), so the 75 browser files run in the fast tier, in backlog tiers of up to 200 files beside unit tests.

### What cezar's own config does, measured (arm a)

`squeal warmup` in `asis/`, daemon spawned 06:35:22 UTC, load at start 7.4. Load over the run, polled 73 times: median 13, mean 20, maximum 74; most of the peaks were other users' processes on the host, my daemon's share was about 9 CPUs.

- **The warm-up gave no verdict, and no full-suite checkpoint completed at any revision.** `squeal warmup` itself returned at +237 s with exit 3, "revision 1 recorded after checkpoint's revision 0". The daemon kept running the checkpoint. **Every one of the 819 test files had a result after 39.0 minutes** (07:14:24), 816 of them current and 3 unknown; the checkpoint ended `abandoned`, as Squeal ends any checkpoint in which a file crashed or timed out (`src/core/scheduler/checkpoints.ts:221`). Four browser files crashed (Chrome, below) and one backlog tier timed out.
- **Results reused: none.** `asis` is the first worktree on its store.
- **What changed the worktree mid-checkpoint, 15 revisions, none by an agent:**
  - `packages/web/e2e/run-header-ci-wait.e2e.ts` writes `packages/web/.ci-header-<pid>.html` and `.tsx` (not ignored) and deletes them half a second later: two revisions per run, net change nil. It ran 5 times (revisions 1-2 and 8-15).
  - The e2e project's `globalSetup` runs `test-env-up.sh`, which runs `pnpm install --frozen-lockfile && VITE_CEZ_E2E=1 npm run build` in the worktree whenever its build cache is cold or the last build was a production one. It rewrote about 120 files of `packages/cezar/dist` and replaced the cockpit's `packages/cezar/web/dist` assets (revisions 3-7, 2 s). Both are declared inputs of both slow groups, so every slow file went stale.
- **Each of those revisions cancelled the backlog tier in flight.** The worst: run `1bcf1bec`, 200 fast files, 346 s, all 200 modules finished, `RUN END interrupted`, 0 results kept ("run cancelled: an edit arrived during a backlog tier"); the edit was the bootstrap's rebuild of `dist`, which none of the 200 files imports. Then revisions 8 to 15 cancelled the 138-file tier that followed 3 more times within 25 s (runs `e65a8a65`, `b14f2d6c`, `ec2e7f41`, each ended after 4 s), until the e2e file stopped re-running.
- **Squeal also ran about 200 cezar test files at once** in the first backlog tier: load 55 on 24 CPUs at 06:40, from Squeal alone.
- **Known failures at the end: 109 checks**, 72 of them browser files that did not load (below). The rest:
  - `.github/scripts/release-finalization.test.cjs`: 34 tests, `spawnSync pnpm ENOENT`: the isolated user's PATH had no `pnpm` until I added a corepack shim mid-run. PATH is not in the key (`env.allowlist` is empty), so the failures stay "current" after the fix. An artifact of the harness, not a cezar or Squeal defect.
  - `scripts/test-changed.test.mjs` (a `package_json_reader` error), `packages/cezar/src/runs/store.test.ts` (5 s timeout at load) and `packages/cezar/src/server/config-api.test.ts` (it reads a default agent model and got the isolated user's Codex model): environment, not judged here.
- **Daemon death in the second attempt.** About 20 s in, the daemon died: `autosave-timeout.test.ts:52-54` and `runner-shutdown-parity.test.ts:102-104` still call `process.kill(Number(<pid file>), 'SIGKILL')`, and an empty pid file is `kill(0)`, the test runner's own process group, which is Squeal's daemon (001-263, cezar issue #953, not fixed at `5dbb4b09`). Squeal's status names the cause ("a test that signals its own process group").
- **One file is slow outside any slow group.** `packages/cezar/src/core/harness-parity.test.ts` (Vitest, server project) ran 9.5 minutes alone after its tier timed out; cezar's CI records 98 to 111 s for it. It is in the 138-file tier that hit `runner.timeoutMs` (600 s).

### Can the browser suite run as `squeal-e2e`?

**No: two limits of this host and my layout, neither in cezar's code.** The bootstrap ran once `pnpm` was on the PATH, and downloaded agent-browser into the case HOME. Then `agent-browser doctor` failed: "Socket path would be 104 bytes (max 103)" under `/home/squeal-e2e/runs/sq18-cz/home/.agent-browser/…`. All 75 browser files then fail at load ("the agent-browser provider is not installed (installed Chrome failed to launch…)"), or crash, so what runs of the browser suite is its `globalSetup` and its failure path. Arm (b) and the sessions set `AGENT_BROWSER_SOCKET_DIR=/tmp/sq18-ab`. The next failure is Chrome itself: "No usable sandbox" (FATAL in `zygote_host_impl_linux.cc`). This host sets `kernel.apparmor_restrict_unprivileged_userns=1`, and cezar's launcher adds `--no-sandbox` only inside a container (`.ai/scripts/resolve-browser-launch.mjs:45`). I did not change cezar's launch settings. So no browser spec ran as `squeal-e2e`. What runs is the bootstrap (install, e2e build, server boot) and the failure path. In arm (b) the 75 browser files ran once, together in one fast-tier run that crashed after 16.5 s, and were not retried in the 43 minutes that followed.

### Cezar's config, key by key

Each row: the key, what cezar has, what it should be, the evidence, and the cost of the difference. "Fresh" is what `squeal setup --yes` wrote in arm (b).

| Key | Cezar (`5dbb4b09`) | Fresh setup | Should be | Evidence | Cost |
| --- | --- | --- | --- | --- | --- |
| `nodeTest` `root:test:unit` | `.github/scripts/*.test.cjs`, `scripts/*.test.mjs`, `--import ./scripts/test-git-env.mjs` | missing: "script test:unit … is not `node [flags...] --test <globs...>` (a chain); add its nodeTest entry by hand", and `--yes` leaves it out | cezar's | root `test:unit` is `npm run test:unit -w … && node --import ./scripts/test-git-env.mjs --test .github/scripts/*.test.cjs scripts/*.test.mjs` | Fresh: 40 test files (37 + 3) no runner covers; an agent editing a workflow gets no result |
| `nodeTest` `test:unit`, `test:package` | as fresh, `test:package` with `slow: true` | seeded, same argv and include | either | `packages/cezar/package.json` | none |
| `slow.include` | `packages/web/e2e/*.e2e.ts` | `packages/cezar/test/e2e/**` | cezar's, plus `test:package` (cezar marks it `slow: true` in its project) | the 75 browser files share one server and one Chrome (`fileParallelism: false`); setup never listed them (above) | Fresh: 75 browser files in the fast tier, each run booting the env |
| `slow.maxWorkers`, `slow.maxParallel` | 1, 1 | 2, 4 (defaults) | cezar's | one shared test env (port 4321) and one browser session: parallel browser specs fight over both (cezar's own comment in `packages/web/e2e/vitest.config.ts`) | Fresh: browser files in parallel tiers on one server, if they ran |
| `inputs` `packages/web/e2e/*.e2e.ts` | `packages/cezar/dist/**`, `packages/cezar/web/dist/**`, `.ai/scripts/test-env-up.sh`, `.ai/browsers/agent-browser.md`, `packages/web/e2e/**`, `pnpm-lock.yaml` | none | cezar's, without `pnpm-lock.yaml`; and the bootstrap should not write them (below) | the specs drive the built server and cockpit; `test-env-up.sh` decides the env | see "the bootstrap writes its own inputs" |
| `inputs` `packages/cezar/test/e2e/*.test.ts` | `dist/**`, `web/dist/**`, `scripts/**`, `package.json`, `alias-cezarion/**`, `pnpm-lock.yaml` | `packages/cezar/dist/**` only | cezar's, `pnpm-lock.yaml` kept only if a test reads the lockfile itself | 9 of 13 files name `dist/`, 2 name `web/dist`; `npm pack` puts `scripts/` and `web/dist` in the tarball (`package.json` `files`) | Fresh: a cockpit rebuild, a script or an `alias-cezarion` change re-runs nothing in the packaged suite: a missed regression |
| `inputs` `.github/scripts/*.test.cjs` | 18 globs for all 37 files: `.github/workflows/**`, `AGENTS.md`, `CLAUDE.md`, `docs/sdlc/ci.md`, `packages/web/e2e/**`, `pnpm-lock.yaml`, … | none | one entry per file or small group (the map form exists for this, spec 001 D11) | test files naming each input, an upper bound by token: `packages/web/e2e` 3 of 37, `AGENTS.md` 3, `CLAUDE.md` 3, `.ai/upstream` 7, `pnpm-lock` 5, `.github/codex` 2, `.github/schemas` 2, workflows 21 | too broad: 127 of cezar's 354 commits since 2026-09-14 touch `packages/web/e2e`, 21 touch `AGENTS.md`; each re-runs all 37 files (54 s of check time) where at most 3 read it |
| `inputs` `scripts/*.test.mjs` (2 keys) | config files, `packages/web/e2e/smoke.e2e.ts`, `environment.ts`, `test-env-up.sh`; `test-changed.mjs` | none | cezar's, without `pnpm-lock.yaml` | `scripts/squeal-browser.test.mjs` checks cezar's Squeal wiring | small |
| `inputs` `test/unit` (3 keys) | per file: the mock, the launcher scripts, three manifests | none | cezar's | Squeal's own note names exactly these 3 files as reaching paths through a spawn or a read | Fresh: those 3 files never re-run when their scripts change |
| `pnpm-lock.yaml` in 5 input lists | yes | no | only where a test reads the lockfile as a file (5 `.github/scripts` tests do) | Squeal already keys installed dependencies by the lockfile closure of each test's packages (`src/core/keys/dependencies.ts`, 001-105) | too broad: a lockfile change re-runs the whole slow tier, about 4.5 min of check time, beside what the dependency key re-runs anyway; 1 lockfile commit in 354, so small in practice |
| `baseline.onStart` | `lookup-only` | `lookup-then-run-missing` | the default, once the warm-up and the bootstrap stop churning | `lookup-only` never runs a fresh worktree's misses at session start; in arm (b) 92 of 779 files had no inherited result | cezar: those 92 stay unknown until an edit touches them or someone runs `run --all`; the agent sees unknown and, under cezar's own AGENTS.md, runs them through npm |
| `stop.*`, `interrupt`, `runner.tierSize`, `runner.timeoutMs`, `env`, `daemon`, `store` | the defaults, written out | the defaults, plus the keys added since (`testCommand`, `observe`, `delivery`, `slow.maxLoadPerCpu`, `maxDeferMs`, `stop.slowWaitMs`, `runner.backlogTierSize`) | either | `src/core/types/policy.ts:176` | none |
| `.ai/qa/test-env.json` as an input | not declared | not declared | not declared, rightly | the bootstrap rewrites it each boot (runtime state, ignored); keying on it would re-run the browser suite on every boot | none |

**The bootstrap writes its own inputs.** The browser `globalSetup` rebuilds `packages/cezar/dist` and `web/dist` in the worktree with `VITE_CEZ_E2E=1`, and both are declared inputs of both slow groups. So:

- a production `npm run build` by the agent and the next browser run flip the build back and forth; each flip re-runs all 88 slow files, and
- each flip, as a revision, cancels any backlog tier in flight (run `1bcf1bec` above).

**Recommendation for cezar (to the human, not committed there):** build the e2e bundle where tests read it but the worktree's own build does not live, for example `.ai/qa/build/`, ignored and not an input; write `.ci-header` fixtures under a temp or ignored directory; and fix #953's `kill(0)`.

**Proposed Squeal rows:**

1. (001, scheduler) A backlog tier is cancelled only when the revision touches the closure of a file in it, or the finished files' results are kept: 200 finished files lost to an edit of `dist`, which none of them reads.
2. (005 D5) Gate rewording skips negated and already-Squeal lines, and never appends after a line that does not end a sentence. In arm (b) `--yes` rewrote AGENTS.md:185, inside cezar's own hand-written Squeal paragraph, from "Do not duplicate those background runs with `npm test`," to "Do not duplicate those background runs with `squeal run --all --wait 110000`,. If it exits 3 … run `npm test` instead." The instruction is inverted and the sentence broken. 4 more lines were reworded: 172 (a wait-discipline scan "on `npm test`"), 201 ("`npm test` and `npm run test:watch` select only the four unit projects"), 237 ("the fast unit gate") and 326 (the CI gate list), each with the exit-3 sentence appended mid-paragraph or after a table row. Setup also reported "no Squeal block" and wrote a second, managed one after cezar's existing Squeal paragraph.
3. (001, node:test adapter) `bareNote` (`src/runners/node-test/adapter-project.ts:232`) names files whose inputs are already declared: in arm (a) it named 21 files as needing inputs, and every one of them already had declared inputs.
4. (005 setup) Seed node:test projects from a chained script's `node --test` segment: cezar's root `test:unit` (40 files) was refused as "a chain".
5. (001, scheduler) The backlog tier's budget, 300 s of last known file time (`src/core/scheduler/backlog.ts:14`), sums file times as if the files ran one after another. Cezar's heavy server files take 80 to 145 s each, so its last 30 fresh files ran 1 to 3 per tier, serially, at load 2 to 6 on 24 CPUs.
6. (001, CLI) `squeal stop` returns at once ("Stop requested; the daemon … is finishing the tier in flight") and exits 0 while the daemon finishes a backlog tier of up to 200 files: in `skill/` the daemon was still running after two stops 2 minutes apart, and `fresh/`'s ignored SIGTERM for 30 s; I terminated both. Anything that removes the store after `stop` races a live daemon.
7. (005 warm-up) `squeal warmup` ends with exit 3 on a revision whose net change is nil (a fixture written and deleted), and its closing advice is "or npx vitest run", against cezar's AGENTS.md ("use npm, never `npx vitest`").

### Fresh setup, timed (arm b)

`squeal setup --yes` in `fresh/` at 07:18:02 UTC, load 4.9 (`research/probes/dogfood/part2/b-setup.log`, `b-poll.log`). Load over the next 43 minutes: median 9.7, mean 13.4, maximum 44. From 07:44 the setup-skill sessions' own daemon in `skill/` ran beside it; its backlog tier added up to about 10 CPUs.

- **Results reused: 16,071 results for 687 of 779 test files (88%) at registration**, inherited from `asis` at `fa994be` (the same tree but the config). The 92 without one are the 75 browser files (none passed in `asis`), the 13 packaged-CLI files (their declared inputs differ between the two configs, so their keys do) and 4 more that failed or did not finish in `asis`.
- **The warm-up threw that reuse away.** It runs every file, "current ones too, to record the ignored paths each reads", so the inherited count fell to 0 by revision 7. A fresh cezar worktree's agent would have had 88% current at once without the warm-up.
- **Setup's own warm-up gave no verdict after 15 s.** Exit 3, "revision 1 was recorded after the checkpoint's revision 0": the 75 browser files, now in the fast tier, ran in the first backlog tier, and their `globalSetup` rebuilt `dist` and `web/dist` (revisions 1 to 5 within 3 s).
- **Time until every file had a result: never, in the 43 minutes measured.** The checkpoint reached 742 of 779 files at 07:22:41 (4.7 min), then 775 at 07:51:37 (33.6 min), serially on the heavy tail (proposed row 5). At 08:01 it stood at 775 of 779, with 78 files that never had a result (the 75 browser files from their one crashed run, never retried, and 3 more) and no checkpoint verdict.
- **An agent's edit waits behind the previous edit's tier.** `edit-codex`'s revision 9 (07:57) queued 5,179 checks; at 08:00, 3 minutes later, Squeal had started none of them, because a 4-file tier from `edit-claude`'s revision 7 was still running (run `06cb0c36`, 6 minutes in). Both edit sessions' `status --wait 60000` ended with no result for their own edited test file.

**Against the 2026-10-10 session** (`1a9234b5`, no setup: 651 files, no reuse, a baseline at load 35, 291 files never run after 38 minutes, `spec.md`'s background):

| | 2026-10-10, no setup | Arm (a), cezar's config, first worktree | Arm (b), `setup --yes`, second worktree |
| --- | --- | --- | --- |
| Test files | 651 | 819 | 779 (no `root:test:unit`) |
| Reused at start | 0 | 0 (first on its store) | 687 (88%) |
| Files with no result at about 38 min | 291 (45%) | 0 at 39.0 min (3 of them unknown: Chrome) | 78 (10%) at 43 min |
| Checkpoint verdict | none | none: abandoned (crashes, a timed-out tier) | none: still running |
| Load | 35 | median 13, mean 20 | median 10, mean 13 |

The effect on files reached is large: from 45% never run to none (a) or 10% (b), with n = 1 worktree per arm, so unconfirmed; the one-arm-per-condition design gives no p. Reuse across worktrees works (88% at registration) where 2026-10-10 had none. What still fails is the verdict: with cezar's bootstrap writing its own inputs, a browser suite that cannot start here, and a scheduler that cancels or serializes, neither arm reached "every test file current" or a full-suite verdict. Confirming a time to current needs a host where Chrome starts and the bootstrap's build lives outside the worktree; at that point 3 worktrees per arm would show whether it lands under 15 minutes.

### Sessions

Four sessions, 2026-10-14, effort `medium`, no retry. Transcripts, as one line per command, edit, SQUEAL delivery or reply: `research/probes/dogfood/part2/<id>.timeline.txt`, from `session-timeline.py`, which also flags any command that reads Squeal's store, sockets, logs or plugin files, and each test command the agent ran itself.

| Session | Copy | Harness, model | Load at start | Wall, s | Commands | Squeal internals read | Own test runs | Final claim | Truth | Claims false |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `skill-claude` | `skill/`, `/squeal:setup` | Claude Code `claude-sonnet-5-5` | 9.4 | 90 | 4 | 0 | 0 | warm-up "didn't finish… no verdict", 763 files without a result | true | 1: "the seeded `test:unit` project … already covers the node:test unit files, so you may not need" `root:test:unit` (it misses 40 files) |
| `skill-codex` | `skill/` after a reset, `$squeal:setup` | Codex `gpt-6-luna` | 18.8 | 160 | 16 | 0 | 0 | warm-up "still running and has not produced a verdict" | true | 0 |
| `edit-claude` | `fresh/`, the retry-backoff edit | Claude Code `claude-sonnet-5-5` | 19.3 | 98 | 5 | 0 | 1 (`npm test -- …/retry-backoff.test.ts`, 5 of 5) | `TESTS: unknown`, 4,956 checks pending | unknown is right: Squeal had no result; the edited file passes (5 of 5, run as `squeal-e2e` after) | 0 |
| `edit-codex` | `fresh/`, the same edit after a revert | Codex `gpt-6-luna` | 16.3 | 165 | 5 | 0 | 0 | `TESTS: unknown`, 5,179 queued | as above (`part2/truth-edit-codex.txt`) | 0 (it called 13 current slow files "stale"; status said "sources changed since") |

- **Claims about being done: 2 of 2 edit sessions said `unknown` with Squeal's pending count as evidence;** neither claimed a pass Squeal had not given, and both named the one known failure as predating the edit. No session read silence as broken delivery or as a pass (the 2026-10-10 session did both). n = 2 per question: the direction matches 005's goal, the size is unconfirmed.
- **Did the setup skill keep the agent out of Squeal's internals? In 2 of 2 skill sessions, 0 of 20 commands read Squeal's store, sockets, logs or plugin source.** Codex called the CLI by its plugin path, as its skill says, and installed the launcher into `~/.local/bin`; Claude Code used `squeal` from the PATH. Whether the skill is what stops probing needs a control without it; not measured here.
- **Both skill sessions rejected setup's gate rewording.** Claude Code reverted `AGENTS.md` and re-ran setup with `--gate …=keep` for all 5 lines; Codex accepted the defaults, then repaired the 5 rewritten lines by hand, and that edit ended its own warm-up with no verdict. Both told the user why. The defect is setup's (proposed row 2); the agents caught it.
- **Neither edit agent waited long enough to get a result,** and could not have: `status --wait 60000` returned with the edit's files still queued behind the previous tier (above). `edit-claude` then ran the edited file itself, which arm (b)'s rewritten AGENTS.md:185 now tells it to do ("run `npm test` instead").
- Cost: $0.20 (`skill-claude`) and $0.19 (`edit-claude`); Codex reports tokens only.

## Part 3: this repository's sessions since `97144d9`

`research/probes/adoption-baseline/metric.mjs` (005-01's instrument, unchanged) over every Claude Code transcript and Codex rollout of this repository's Cezar worktrees holding `SQUEAL · registered`, selected as 005-01 selected them (`research/probes/dogfood/select-sessions.mjs`), this session left out. Store: a copy of this repository's `store.sqlite` at 2026-10-14 06:05 UTC. Read-only, run as `agent`; no model.

To compare like with like, the same script and selection ran over the sessions before `97144d9` (2026-10-04 to 2026-10-09 15:32 UTC). Its numbers differ slightly from 005-01's (10.8 own runs, 9.0 outside a gate) because the records are live and a few late sessions of 2026-10-09 fall on the other side of the cut. `research/probes/dogfood/compare-metric.py` tests each per-session count two-sided (Mann-Whitney U); "P(before > after)" is the chance that a random session before had more than a random session after.

| Per editing session | Before `97144d9` (n 232) | After (n 255) | Change | P(before > after) | p |
| --- | --- | --- | --- | --- | --- |
| Own test runs | 12.1 | 6.6 | -45% | 0.61 | 1.4e-05 |
| Own runs outside a full-suite gate | 10.1 | 5.9 | -41% | 0.59 | 0.0004 |
| Own full-suite Vitest runs | 2.08 | 0.70 | -66% | 0.72 | 3.5e-19 |
| Test wall time, min (mean; median) | 7.4; 3.4 | 5.7; 3.8 | -23% mean | 0.53 | 0.31 |
| Sessions pulling Squeal | 33% | 66% | x2 | | |

Workers alone (n 148 before, 96 after): own runs 12.2 to 8.9 (p 0.002); outside a gate 10.8 to 8.5 (-21%, p 0.07, not confirmed at this n); full-suite Vitest 1.44 to 0.34 per session (-76%, P 0.84, p 9e-22); test wall time 5.9 to 3.5 min (p 2e-06). Reviewers (62, 102): own runs 7.5 to 4.2, but wall time up from 7.8 to 8.3 min mean (median 3.0 to 8.4): reviewers keep `npx vitest run` as the independent check by rule, and the suite has grown.

Against goal 6's targets (the human, 2026-10-09):

- **Agent-run Vitest outside a gate at most half of 9.0 per editing session (4.5): not met.** 5.9 overall, 8.5 for workers. The fall is real (-41%, p 0.0004) but short of the target by 1.4 runs per session overall.
- **Workers' full-suite Vitest near zero: not met, though down 76%.** 34 full runs in 96 worker sessions.
- By harness, the fall is Claude Code's: 13.5 to 8.2 own runs per session. Codex was already low (3.5 to 3.4) and still is; its runs are 30% gate runs and 93% of its test wall time.

The day-by-day rate does not trend down after the rewording (5.6 to 8.9 own runs per session per day from 2026-10-09 to 10-13), so the step happened at the rewording and the 001 and 005 releases since have not moved it further at this n.

D8's reach over the same sessions (`d8-reach.py`): 0 of 1,989 test commands have a shape it recognizes; see part 1.
