# What Squeal's environment changes in test processes

Board row 001-387, researcher, 2026-10-14. Squeal 0.1.180 (`fe7b6f08`; built CLI `plugins/claude-code/dist/cli/squeal.mjs`), Node 22.23.3 and 24.21.0, Vitest 5.0.4. The probes are throwaway and live under `/tmp/r387/`. Each ran with a temporary `HOME`, `XDG_CONFIG_HOME` and `XDG_RUNTIME_DIR`, and the daemon probe ran under `env -i`, so it saw only dummy values set by the probe. Per the brief, only this file is committed.

Tags: **[exp]** verified by experiment, **[docs]** read in official docs, **[src]** read in source code, **[inf]** inferred.

## Questions answered

| # | Question | Answer |
| --- | --- | --- |
| 1 | The exact cause | Every `--require` preload goes through `Module._resolveFilename`, and that calls `trySelf(process.cwd() + sep)`. `trySelf` parses the nearest `package.json` above the child's cwd, so a file that is not JSON throws `ERR_INVALID_PACKAGE_CONFIG` before the entry runs **[src][exp]**. |
| 1b | Does `--import` of a `file:` URL avoid it? | Yes, on both Nodes, in a plain child, a Vitest forks worker and a Vitest threads worker. This needs the spawn patch to inject `--import` too **[exp]**. Costs are listed under option O1. |
| 2 | What else the injection changes | A child's env gains `NODE_OPTIONS` and `SQUEAL_OBSERVE` even when the test passed `env: {}` **[exp]**. `TMPDIR` can make a parent and a child that has a minimal env disagree **[exp]**. Spawned Node children start slower, and CLI-spawning tests missed deadlines under contention (prior measurement). Children of other or old Node versions and non-Node children are only partly determined. |
| 3 | Options | O1 to O6 below, with costs. |
| 4 | Is a verdict that differs from the project's runner ever acceptable? | Not silently. See "Fidelity" below; the trade is the human's. |
| 5 | Inherited environment (scope added by the human) | Config, plugins and `globalSetup` run in the daemon's own process with the daemon's env **[exp]**. A later session's tests get an earlier session's task variables and token **[exp, real daemon]**. Options S1 to S3. |

## Findings

**F1. The cause.** Node 24.21.0's `lib/internal/modules/cjs/loader.js` builds preloads with a parent `new Module('internal/preload', null)` (line 2211). `trySelfParentPath` returns `process.cwd() + path.sep` for that parent (lines 643-645). `_resolveFilename` calls `trySelf(parentPath, request)` for every request, absolute paths included (line 1548), and `trySelf` calls `packageJsonReader.getNearestParentPackageJSON(parentPath)` (line 662). v22.23.3 is the same: lines 596 and 1405-1406 **[src]**.

The child's stack shows exactly that path: `Error: Invalid package config /tmp/r387/bad/package.json.` at `getNearestParentPackageJSON`, then `trySelf (loader:662)`, then `Module._resolveFilename (loader:1548)`, exit 1 **[exp]**. Plain `node child.mjs` in the same cwd exits 0. A `.cjs` entry outside that directory fails the same way under `--require` and passes under `--import` **[exp]**.

The fixture is a node:test file. It writes `export const value = 1;` to `<mkdtemp>/package.json`, then spawns `node child.mjs` with `cwd` set to that directory:

| Run (both Nodes unless noted) | `env: { ...process.env }` | `env: {}` |
| --- | --- | --- |
| plain `node --test` | pass | pass |
| `--require` in argv only (node:test runner's form) | pass (24.21.0) | not run |
| `NODE_OPTIONS=--require <empty stub>` | **fail** `ERR_INVALID_PACKAGE_CONFIG` | pass |
| `NODE_OPTIONS=--require <Squeal recorder>` + `SQUEAL_OBSERVE` | **fail** | **fail** (the spawn patch re-injects) |
| Vitest 5.0.4 `createVitest({ env })` with the recorder, as `adapter.ts:151` delivers it | **fail** | **fail** |
| `NODE_OPTIONS=--import file://<stub or recorder>` | pass | pass |

**[exp]** Plain Node fails the same way under any project `--require` in `NODE_OPTIONS` (dotenv, ts-node). The recorder makes that failure universal, and it overrides `env: {}`.

**F2. Which Squeal paths put a `--require` into a child's env** **[src]**:

- Vitest while `observe.runtimeInputs` holds, which is the default: `observeEnv` (`src/runners/observe/runtime.ts`) through `createVitest`'s `env`, then `spawn.cjs` `injected()` at every spawn and Worker.
- The node:test warm-up checkpoint with `observeIgnored` (`run/reads.ts`), which re-injects the same way.
- The node:test module recorder in `NODE_OPTIONS` (`run/run.ts` `childEnv`), only for a slow project or a `NODE_OPTIONS` that already holds a `--require`. Its argv `--require` reaches no child (row 2 of the table above). This path does not override `env: {}`.

Cezar's `scripts/test-changed.test.mjs` is in a node:test project that is not slow (`root:test:unit`, argv `--import ./scripts/test-git-env.mjs`). So in the trigger, the `--require` came from the warm-up path or from a `NODE_OPTIONS` the daemon inherited. Which one is not determined, because I read no daemon or store of cezar's. Cezar has already worked around it: its fixture now writes `{}` for JSON inputs (line 59 comment).

**F3. `--import` keeps observation** **[exp]**. In a probe-only copy of the recorder, `spawn.cjs` injects `--import "<file: URL>"` instead of `--require "<path>"`. With it, the grandchild in the bad directory passes and its read of `data2.txt` is recorded, on both Nodes. A `Worker` with `env: {}` is recorded. The Vitest forks and threads pools both pass and record the child, with the recorder given to `createVitest` as `--import`.

Delivery must change in both places. With `--import` only in `spawn.cjs` and `--require` still in the Vitest workers' env, the `{ ...process.env }` case still failed: `injected()` skips a `NODE_OPTIONS` that already names the recorder **[exp]**.

**F4. What `--import` loses or risks.**

- (a) Node runs every `--require` before any `--import` (cli.md v24.21.0, `--require`: "Modules preloaded with `--require` will run before modules preloaded with `--import`") **[docs]**. A project `--require` preload's read of a file was recorded with the recorder as `--require` and not as `--import`, on both Nodes **[exp]**. Plain Node already reads cwd's `package.json` whenever a project `--require` is present, so the recorder could keep `--require` exactly then and lose nothing in fidelity **[inf]**.
- (b) `--import` was added in v19.0.0 and v18.18.0 and is "Stability: 1 - Experimental" in the v24.21.0 docs **[docs]**. A test that spawns an older Node would get an option that Node does not know. Not tested, because no such Node is installed.
- (c) Start-up of one spawned child that reads one file. The host load was 95 to 110 on 24 CPUs, so these are indicative only. On 22.23.3, p50 was 147 ms with nothing, 153 with `--require` and 266 with `--import`. On 24.21.0 it was 120, 150 and 154 **[exp, under load]**. Not determined on a calm host.
- (d) The recorder version (`RECORDER_VERSION`) would move, so observed passes run once more **[src]**.

**F5. Other changes the injection makes** **[exp unless tagged]**:

- *Env-asserting tests.* A grandchild given `env: { ONLY: "1" }` sees `NODE_OPTIONS,ONLY,SQUEAL_OBSERVE` under the recorder, on both Nodes. Vitest workers also carry `SQUEAL_DAEMON_CHILD` (`escaped.ts`) **[src]**. The recorder printed no warning: stderr was 0 bytes with and without it.
- *`TMPDIR` (D10).* The test writes a marker in `os.tmpdir()`, then a child spawned with `env: { PATH }` looks for it:

  | Environment | Result |
  | --- | --- |
  | `TMPDIR` unset | pass |
  | `TMPDIR` set by the harness | fail |
  | `TMPDIR` like D10's (`/tmp/squeal-<uid>/tmp/<16 hex>`) | fail |

  Squeal differs from the project's run only where the user's env had no `TMPDIR`, which is the usual Linux shell. Then every daemon run applies D10's override. Squeal's temp path is 37 characters, against 78 for this harness's own `TMPDIR`. The directory is also emptied when a daemon starts, so a cache a test keeps in `os.tmpdir()` across runs is lost **[src, D10]**.
- *Non-Node children.* A shell inherits `NODE_OPTIONS` and passes it to any Node it starts **[inf]**. What a non-Node child reads is not observed (D4).
- *Other Node versions.* The recorder loads and records on 22.23.3 and 24.21.0. `registerHooks` is guarded (`recorder.cjs:191`) **[src]**. Below 22.15, older Node versions, Bun and single-executable apps are not determined, because nothing was run on them. A Node that a long-lived descendant spawns after the plugin's recorder file moves fails with `Cannot find module` (`observed-runtime-inputs.md`) **[inf]**.
- *Cost and timing.* On cezar's 640 files, a file's time with the recorder over its time without was 0.97 at p50 and 1.50 at p90 (D4, `tasks/001-132/notes.md`). `artifacts/cli` and `discovery/cli` missed their 15 s deadline under contention only with the recorder. The cause was synchronous appends before each `postMessage` (`tasks/001-137`). D11 Capacity also runs every test process at `nice` 10 **[spec]**.

## Inherited environment (scope added 2026-10-14)

**I1. What runs before any setup file, in the daemon's process and with the daemon's env.** A driver standing in for the daemon held `CEZ_TASK_ID=dummy-task-A` and called `createVitest`, as `adapter.ts` does. Each of the following logged the variable as present, with the driver's pid **[exp]**:

- the top level of `vitest.config.mjs`;
- a plugin's `configResolved`;
- the plugin's `transform` of the test file;
- `globalSetup`, and an `sh -c` it started, which stands for cezar's `test-env-up.sh` from `packages/web/e2e/vitest.config.ts:29`.

The worker had a different pid. There, `setupFiles` saw the variable before clearing it, and the test body saw it absent.

For node:test, Squeal starts `node … --import <preload> --test <file>` with the daemon's env (`run.ts`, `adapter-project.ts` `childEnvOf`). On 24.21.0 the `--import` preload ran only in the file's process: it logged the file process's pid, and the `node --test` parent logged nothing **[exp]**. So cezar's `test-git-env.mjs` clears the variables before any test code there. The parent keeps them but runs no project code.

The daemon's own child processes also carry the env: the node:test environment probe (`adapter-environment.ts`), pytest processes, and Squeal's own `git` calls **[src]**.

**I2. A later session gets an earlier session's variables** **[exp, real daemon 0.1.180]**.

- Fixture `/tmp/r387/dm`: one Vitest test appends the `CEZ_TASK_ID` it sees, and whether `CEZ_DELEGATION_TOKEN` is set.
- Session A: `env -i … CEZ_TASK_ID=dummy-task-A CEZ_DELEGATION_TOKEN=dummy-token-A squeal start`, then `run --all --wait`.
- Session A's shell then ended.
- Session B, under `CEZ_TASK_ID=dummy-task-B`, ran `run --all --force --wait`, then edited the test so the run was caused by an edit.
- Session C had no `CEZ_*` at all.

All four runs logged `CEZ_TASK_ID=dummy-task-A CEZ_DELEGATION_TOKEN=set`, each in a new worker with the same parent pid, the daemon's. The daemon's process env held the variable names `CEZ_DELEGATION_TOKEN CEZ_TASK_ID HOME PATH XDG_CONFIG_HOME XDG_RUNTIME_DIR`. The daemon lives until `daemon.idleExitMinutes` (60 by default) passes with no consumer (D11), so a worktree that a later task reuses inside that window gets the earlier task's token. Under Squeal, cezar's workers and node:test file processes clear the variables. What does not clear them is I1's list: the config, plugins, `globalSetup` and what they spawn.

**I3. The environment hash.** `coreEnvironmentInputs` hashes the allow-listed names from the daemon's `process.env` (`src/core/keys/environment.ts:95-100`), and an unset name is left out **[src]**. Results under one key are shared by every worktree (D8), whatever the rest of each daemon's env holds. That is already true today across daemons that inherited different envs **[src, D8]**.

## Fidelity: is a different verdict ever acceptable?

I found no sentence named "fidelity" in D6. My reading **[inf]**: D11 lets Squeal run "only the project's own Vitest configuration" and inherit the hook's env "with only the additions" of D10 and D4. D10 justifies its one addition by fidelity: the temp directory lies outside every repository, "as the `os.tmpdir()` of a test under `vitest run` does, so a test … sees the same thing under the daemon". D6 refuses to let Squeal decide on its own that a failure is environmental. The vision makes the project's runners "the source of truth for results". So each addition is justified only while a test cannot tell it is there. F1, F5 (`TMPDIR`) and the env-asserting case break that, and so does I2, against CI and the agent's own shell.

Two kinds of error are at stake. A false FAIL from the injection is visible and costs a turn. A false current PASS from an input nobody observed is invisible, and the recorder exists to prevent it. Neither kind is acceptable silently. My recommendation is that a verdict the project's runner would not give is a defect when Squeal's additions cause it. Where Squeal keeps an addition that can change a verdict, the delivery says so. The human decides whether a known false FAIL is an acceptable price for observation.

## Options and costs

The package.json failure and the injection:

| Option | Fixes the trigger? | Costs |
| --- | --- | --- |
| **O1** Deliver the recorder as `--import <file: URL>` (Vitest `env`, `spawn.cjs`, node:test `reads.ts`). Keep `--require` when the env already holds a `--require`. | Yes **[exp]** | F4: older-Node children (b, untested), Experimental status, Node 22 start-up (c, not determined), one re-run of every observed file. The hybrid rule is untested. The 003 module recorder stays `--require` in argv; its `NODE_OPTIONS` form for slow projects needs the same rule. |
| **O2** Stop overriding an explicit `env` (`{}` or one without `NODE_OPTIONS`) | **No**: `{ ...process.env }` inherits it (F1, stub row) | Children started with an allowlist go unobserved. This is the cezar mock-cursor case from 001-132, so their fixtures need `inputs`. It fixes the env-asserting tests. |
| **O3** Per-project or per-file opt-out (`observe.runtimeInputs` as a glob map) | Only once someone notices | Those files key by static imports and `inputs` alone; adds config surface. |
| **O4** The delivery states that a failure ran under the recorder | No, it explains | Said always, it is noise. It could be said only on signatures such as `ERR_INVALID_PACKAGE_CONFIG` or a missing `recorder.cjs` **[inf]**. |
| **O5** A run without the recorder when the agent asks (`squeal retry --reason …`) | Gives a verdict | An unobserved pass must not be stored under the key, because its closure may lack inputs. It would need a known state outside the key, like the setup check (D6). |
| **O6** Re-run a new failure automatically without the recorder | Gives a verdict | It confounds 001-171's flake re-run and goes against the human's 001-348 rule ("never decides it alone"). |

`TMPDIR`: keep D10. Its reasons (reaping, one path) still hold, and the difference appears only with a minimal child env and a user env without `TMPDIR`. O4's statement could name it.

The inherited environment:

| Option | Effect | Environment hash and D8 |
| --- | --- | --- |
| **S1** `env.remove` in `squeal.config.json`, applied to the daemon's `process.env` at start | Covers I1's list: config, plugins, `globalSetup`, every runner child and git. The project declares its intent, as cezar already does twice. Changing the list needs a daemon restart, since a removed value cannot come back. It differs from the agent's own shell, as CI does. | Apply it before hashing, so an allow-listed name that was removed hashes as unset. Sharing improves: envs grow more alike. |
| **S2** A built-in strip list of harness session variables (`CEZ_*`, `CODEX_SESSION_ID`, `CODEX_THREAD_ID`, `PI_SESSION_ID`, `CLAUDECODE` …) | Needs no config. Squeal's own tests need this: reviewers run `env -u CODEX_SESSION_ID … npx vitest run` (`reviews/wave-13aa.md:31`), because `squeal status` reads it (`src/cli/codex/status.ts:27`). The list needs maintenance, and Squeal would remove things the project did not ask it to remove. | Same as S1. A project that allow-lists a stripped name would need an opt-out. |
| **S3** A fresh env per run, taken from the requesting session | Edit-caused and backlog tiers have no requesting session. Hooks would have to ship their env, tokens included, over the socket at each boundary. Several consumers share one daemon. | Allow-listed values would vary per requester, so keys would be computed per run. D8 sharing would be unchanged for everything else. |
| **Pin** (today) | Simple and stable. I2 shows the leak: an ended task's token reaches config, plugins and `globalSetup`. | Unchanged. |

## Decisions for the human

1. Change the delivery to O1 (`--import`, keeping `--require` beside a project `--require`)? If yes, a probe should first check an older-Node child and start-up on a calm host. O2 alone does not fix the trigger.
2. Is a known false FAIL from the recorder acceptable? If so, should the delivery say "ran under Squeal's recorder" (O4), and should the agent be able to ask for an unobserved run (O5)?
3. Should D10's `TMPDIR` stay as it is? I recommend keeping it.
4. For the inherited env: S1 (project-declared), S2 (built-in), both, or neither? Should the daemon also exit, or restart its runner, when the session that started it ends?
5. Should D11's sentence "with only the additions" gain a fidelity clause: an addition that a test can observe is named in the delivery?

## Open questions

- Which path put the `--require` into cezar's child: the warm-up, or a `NODE_OPTIONS` the daemon inherited? Not determined, because no cezar store or daemon was read.
- Start-up cost of `--import` on a calm host, and how a Node older than 18.18, Bun or a single-executable app treats the injected `NODE_OPTIONS`: not determined, nothing run.
- Whether `transform` in Vitest's process sees per-session env in any reuse pattern beyond I2: not tested.
- `hearsay-tools/cezarion#953`, as cited by cezar's comment, is titled "Test cleanups that read a pid file can SIGKILL the whole test run". Cezar's comment ties the env clearing to it.

## Sources

- Node `lib/internal/modules/cjs/loader.js` at v24.21.0 and v22.23.3: https://raw.githubusercontent.com/nodejs/node/v24.21.0/lib/internal/modules/cjs/loader.js (lines 638-650, 659-673, 1526, 1548, 2205-2220), and https://raw.githubusercontent.com/nodejs/node/v22.23.3/lib/internal/modules/cjs/loader.js (591-597, 1405).
- Node `doc/api/cli.md` v24.21.0, `--import` and `--require`: https://raw.githubusercontent.com/nodejs/node/v24.21.0/doc/api/cli.md
- Squeal: `src/runners/observe/{spawn.cjs,recorder.cjs,runtime.ts}`, `src/runners/vitest/{adapter.ts,observe.ts}`, `src/runners/node-test/run/{run.ts,reads.ts}`, `src/runners/node-test/runtime/recorder.cjs`, `src/runners/node-test/adapter-project.ts`, `src/core/keys/environment.ts`, `src/core/daemon/escaped.ts`, `src/cli/codex/status.ts`; spec 001 D4, D6, D8, D10, D11; `research/observed-runtime-inputs.md`; `tasks/001-132/notes.md`.
- Cezar, read only, at `95916017`: `scripts/test-git-env.mjs`, `packages/cezar/vitest.setup.ts`, `squeal.config.json`, `packages/web/e2e/vitest.config.ts:29`, `scripts/test-changed.test.mjs:28,59`; https://github.com/hearsay-tools/cezarion/issues/953
- Probes (throwaway, not committed): `/tmp/r387/probe/proj` (node:test fixture, stub, the `--import`-patched recorder copy, bench), `/tmp/r387/vt` (Vitest 5.0.4 driver, inherit fixture), `/tmp/r387/dm` (real daemon fixture).
