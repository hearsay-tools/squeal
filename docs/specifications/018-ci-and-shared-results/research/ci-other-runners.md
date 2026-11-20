# ci-other-runners: CI record, export and import for node:test and pytest

Researcher 7eba4a3d for spec 018, 2026-11-20. Brief: the human's question in task e326838a, "Can we research node --test, pytest etc for CI import / export?". Not a board row. Squeal source read at `47bc78ce4` (package version 0.1.577); probes ran the CLI bundle committed there (`plugins/claude-code/dist`, 0.1.577). cezar read at main `cd415ac2` with `git show` only; its 148 node:test files ran in two fresh clones under my `$TMPDIR` (section 4). Node v22.23.3, v24.21.0 and v26.13.0 (nvm); Python 3.13.14 (uv-managed), pytest 9.1.1, uv 0.12.2. Host load (one-minute average) was 12 to 25 on 24 vCPUs, so I report no timing as a measurement. Probes: `probes/ci-other-runners/` (throwaway). Tags: **[exp]** verified by experiment, **[docs]** read in official docs, **[src]** read in source code, **[inf]** inferred.

## Questions answered

| # | Question | Answer |
|---|---|---|
| 1 | node:test today; what a recording needs; what the Vitest path reuses | The daemon runs one `node --test <file>` process per file, with its module recorder and its own reporter. Only module loads key a node:test file. A recording needs, per file: checks named as the daemon names them (needs each test's line), skip and todo as `skip`, the module-load graph of the file's process and of processes it spawns, read evidence, and the project Node's probe. Export core, export format, D11 re-keying, import, status and publish are runner-neutral; `ci record`, the part header, the part builder, the export command's adapter and D10 are Vitest-wired **[src][exp]** |
| 2 | node:test in cezar's CI; can `ci record` attach | Job `unit-tests`, matrix `package`/`scripts`, plain `node --test` with globs, no sharding, **on Node 24.21.0**, while `.node-version` and the export job use 26.13.0. A `NODE_OPTIONS` preload reaches every test file's process on Node 22, 24 and 26, with the file in `argv[1]`, so module loads attribute per file. Results are the hard part: a reporter in `NODE_OPTIONS` keeps output equal only when the command names no reporter **[src][exp]** |
| 3 | pytest | Squeal's own plugin attaches to a plain `pytest` command through `PYTEST_ADDOPTS=-p squeal_pytest` and `PYTHONPATH`, with output unchanged. Keys do not travel today: the interpreter's real path, `pyvenv.cfg` (raw bytes, absolute paths) and site-packages entry names are keyed **[exp][src][docs]** |
| 4 | Portability, measured | node:test, yes. Fixture: a CI-shaped clone (other path, HOME, TMPDIR, Node copied to a tool-cache path; with and without `CI`/`GITHUB_ACTIONS`) keyed 3 of 3 files equal and the import made 3 of 3 current. cezar: 148 of 148 keys equal between a developer clone and a CI-shaped clone at `cd415ac2`; no key part differed. pytest: equal only with the same interpreter at the same path; an interpreter copy or a stdlib venv changes every key pytest fixture: equal only with the same interpreter at the same path; an interpreter copy or a stdlib venv changes every key **[exp]** |
| 5 | Other runners | `src/runners/` holds three runners: Vitest, node:test, pytest. `python/` is pytest's parser; `observe/` and `process/` are shared code. Lint keeps its own store and is not exported **[src]** |
| 6 | Size and order | node:test first: no key or export-format change, a new recording path of about the Vitest path's size minus snapshots and the Vitest wrap. pytest later: it needs a key change first, and no project here uses it **[inf]** |

## 1. node:test today

**How it runs** **[src]**. `runNodeTest` (`src/runners/node-test/run/run.ts`) starts one process per test file: `<node> --enable-source-maps --require <recorder.cjs> <argv...> --test --test-reporter=<reporter.mjs> --test-reporter-destination=<logDir>/events-<i>.ndjson <file>`, from the project `cwd`, with the recorder also first in `NODE_OPTIONS` so processes the test spawns record too (row 020-36). The recorder (`runtime/recorder.cjs`) appends one edge per resolved import or require to `<SQUEAL_NODE_TEST_GRAPH>-<pid>.ndjson`, through a synchronous `module.registerHooks` resolve hook (Node 22.15 and later). `observedClosure` (`run/observed.ts`) roots the edges at the test file; loads before the entry point go to the project's preloads (`environmentObserved`). Fs reads key nothing: "Only module loads key a node:test file" (`run/reads.ts`).

**What keys it** **[src]**. `projectEnvironment` (`adapter-environment.ts`): `resolvedConfig` holds `node` (the config text), `nodeBuild` (sha256 of the probe's `process.versions`, `process.config`, `platform`, `arch`; 018 D12), `argv`, `env` entries, relative `cwd`, `include`, `exclude`, and the coverage marker when coverage is on; `runnerVersion` is the probe's `process.version`; `files` are the preloads. The core adds the daemon's Node, platform, arch, the installed-dependency fingerprint and the allow-listed variables. Check identity (`identify.ts`): suite and test names joined with ` > `; a repeated full name gets `(line N)`. Skip and todo are `skip` (`run/report.ts`). `NODE_TEST_ADAPTER_VERSION` is 12.

**What a recording must capture** so `ci export` reproduces the daemon's key **[src][inf]**:
- per file: completion, each check's full name and line (for the repeated-name suffix and the location), outcome with skip and todo as `skip`, duration;
- per file: the module-load edges of the file's own process and of every process it spawns, and the written directories (`written`, 016 D4);
- read evidence for each loaded module (D9's rule), which the generic evidence hooks already take;
- per project: the probe the run used (`process.version` and the `nodeBuild` hash) and the argv the run's processes had, so the export can refuse a run whose Node or flags differ from the `nodeTest` entry;
- whether coverage ran (the key holds a coverage marker; see open question 3); records only if wanted, as 020 D13 does for Vitest.

**What the Vitest machinery gives as is** **[src]** (`src/core/ci/`, `src/core/store/transfer-*.ts`, read at `47bc78ce4`):

| Part | Reusable as is | Vitest-shaped |
|---|---|---|
| `ci record` attach | Command spawn and exit code pass-through (`core/ci/command.ts`); evidence hooks (`vitest/ci-runtime/evidence*.cjs`, `descriptors.cjs`) are plain Node hooks | Runner detection (`vitestResolves`), the wrap of `Vitest.prototype.start` (`vitest-ci.cjs`), the appended Vitest reporter, `includeTaskLocation`, coverage through `configOverride` |
| Part file `squeal-ci-part/4` | `testFiles[]` (outcome, checks, durations, observed), shard, commit, dirty, `evidence` | `header.runner: "vitest"` is a literal type; `snapshotOptions`, `updateSnapshot`; coverage fields; `ci-runs.ts` builds parts from Vitest reporter state |
| `ci export` | `ciExport` takes any `RunnerAdapter` (`environment`, `testFiles`, `closure`); refusals for key format, commits, shards, duplicate files, environment between parts | `ci-export.ts` refuses without Vitest and always builds `createVitestAdapter`; snapshot refusals; check naming assumes Vitest's report |
| Export `squeal-results/1`, import, D11 | Runner-neutral: re-keying works on closure lists, keys and `keyParts` only (`transfer-rekey.ts`). **[exp]**: importing a node:test export re-keyed 3 of 3 files and made them current | — |
| D10 tolerance | — | `importDifferences` tolerates fields only when both sides are `vitest` (`environment-descriptor.ts`) |

Attribution differs: Vitest's observe recorder takes the test file from `globalThis.__vitest_worker__` (`observe/recorder.cjs`); a `node --test` child has no such global but has the file in `argv[1]` (section 2).

## 2. node:test in CI

**cezar at `cd415ac2`** **[src]**. `ci.yml` job `unit-tests`, matrix `suite: [package, scripts]`, runs `npm run test:unit:<suite>`: `node --import ../../scripts/test-home-env.mjs --import tsx --test test/unit/*.test.ts` in `packages/cezar` (8 files) and `node --import ./scripts/test-home-env.mjs --test .github/scripts/*.test.cjs scripts/*.test.mjs .ai/skills/*/scripts/*.test.mjs` (140 files). The argv equals the `nodeTest` entries of `squeal.config.json`. No `--test-shard`. The job pins `node-version: '24.21.0'`; the comment above it says the build and package tests "verify the exact engines.node minimum", and that "Vitest and browser shards run the .node-version developers use" (26.13.0). The export job `squeal-export` sets up `.node-version`. So a node:test part from this job would carry Node 24.21.0 and could not match a developer on 26.13.0, and the export would key it for the wrong Node unless it compares the part's probe.

**Attach by `NODE_OPTIONS`** **[exp]** (`probes/ci-other-runners/attach/`, Node 22.23.3, 24.21.0, 26.13.0). `node --test a b c` with `NODE_OPTIONS=--require probe.cjs`:
- The `node --test` parent loads the preload with `NODE_TEST_CONTEXT` unset and `argv[1]` set to the first glob argument (not a test file it runs).
- Each test file runs in its own child with `NODE_TEST_CONTEXT=child-v8` and the absolute test file in `argv[1]`; every module load resolves there, so loads attribute per file as in the daemon.
- A process the test spawns inherits `NODE_TEST_CONTEXT=child-v8` too, so the context alone cannot tell it from a test file's process. A variable the test file's process sets before test code runs reaches it and names the file (verified), as the daemon's `SQUEAL_NODE_TEST_STARTED` does.
- With `--test-isolation=none` (`--experimental-test-isolation=none` on 22) every file runs in the parent; loads cannot be attributed by process, and the run shape differs from the daemon's. The docs: "When `mode` is `'none'`, all test files run in the same process as the test runner. The default isolation mode is `'process'`." **[docs]**

**Results** **[exp][docs]**. The daemon reads its own reporter's events. In CI, three ways were tried:
- A reporter pair in `NODE_OPTIONS` (`--test-reporter=spec --test-reporter-destination=stdout --test-reporter=<squeal> --test-reporter-destination=<file>`): output identical to the plain command when the command names no reporter (Node 26). If the command names a reporter with a destination, both print and Node warns `MaxListenersExceededWarning`; if it names a reporter without a destination, Node refuses to start: "The argument '--test-reporter' must match the number of specified '--test-reporter-destination'". `NODE_OPTIONS` values come first. Node 22's default on non-TTY stdout is `tap` (v23 changed it to `spec`), so the re-added default depends on the Node major.
- Root-level `beforeEach`/`afterEach` hooks registered by the preload in the test file's process: outputs equal (spec and tap, apart from pids and durations); `t.fullName` uses ` > ` as Squeal does; but skipped tests run no hook and todo reads `passed: true`, and no line is given. Not enough for the daemon's identity and outcomes.
- The reporter pair written in the project's command: output identical. This is a change the project writes: `node --test --test-reporter=spec --test-reporter-destination=stdout --test-reporter=<squeal reporter> --test-reporter-destination=<dir>` (or a `node.config.json` with the same keys). How `squeal ci record` finds the reporter file and the directory is a design question.

## 3. pytest

**How the daemon runs and keys it** **[src]** (`src/runners/pytest/`). `<env>/bin/python -m pytest -c <config> -p squeal_pytest --continue-on-collection-errors <args> --maxfail=0 [-n 0] [--no-cov]`, 5 files per process, the plugin's directory on `PYTHONPATH` beside a `sitecustomize.py` that records imports in spawned Python processes. Only imports are observed (wrapped `__import__` and `import_module`), attributed to the collector or item in progress. The environment hash holds the interpreter's real path, `sys.version`, implementation, cache tag, `pyvenv.cfg` bytes (worktree root replaced), site-packages entry names, `.pth` and `direct_url.json` bytes, config bytes, the project's `python`, `args`, `env`, seven `PYTHON*`/`PYTEST_*` variables, and `files` (config, in-tree plugins, and `.venv/pyvenv.cfg` as raw bytes). Checks are the node id after `::`, parametrized suffixes included. No coverage records (`--no-cov`). `PYTEST_ADAPTER_VERSION` is 4.

**Attach** **[exp][docs]**. In the fixture, `PYTEST_ADDOPTS="-p squeal_pytest" PYTHONPATH=<runtime dir>` around the project's plain `python -m pytest`: identical output, 102 events (items, phases, 55 import edges). With `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1` it still loads. pytest docs: `PYTEST_ADDOPTS` "will be **prepended** to the command line"; with autoload disabled "Only plugins explicitly specified in `PYTEST_PLUGINS` or with `-p` will be loaded". Limits **[docs][inf]**: `python -I` or `-E` ignores `PYTHONPATH` ("Ignore all `PYTHON*` environment variables"); `-S` skips `site` and so `sitecustomize`; `pytest-xdist` (`-n`) runs items in worker processes, a shape the daemon avoids with `-n 0`.

**Can keys match** **[exp]** (`probes/ci-other-runners/port/run-pytest.sh`; `test/fixtures/pytest/small` with one `pytest` entry; developer side `uv sync --locked`):

| CI-shaped clone (other path, HOME, TMPDIR) | Keys equal | What differs |
|---|---|---|
| `uv sync --locked`, same interpreter at the same path | 3 of 3 | nothing |
| `uv sync --locked`, a copy of the interpreter at `opt/hostedtoolcache/Python/3.13.14/x64` | 0 of 3 | interpreter real path; `pyvenv.cfg` (`home =`, and uv wrote `version_info = 3.13.14` instead of `3.13`) in both the config hash and `files` |
| stdlib `python -m venv`, locked set installed with `uv pip` | 0 of 3 | `pyvenv.cfg` format; site-packages names (`pip`, `pip-26.1.2.dist-info` present; `_virtualenv.pth`, `_virtualenv.py` absent) |
| two stdlib venvs at two paths, one machine | 0 of 3 | only `files`' raw `.venv/pyvenv.cfg`: its `command = … -m venv <absolute path>/.venv` line |

So on GitHub's runner, where setup-python installs under `/opt/hostedtoolcache/Python/<version>/x64`, no pytest key can equal a developer's today, whatever installer both use **[inf from exp]**. `sys.version` also carries the build date and compiler, so two builds of one version differ **[src][inf]**; the same build at two paths should be equal once paths leave the key, as D12 did for node:test.

## 4. Portability, measured

**node:test fixture** **[exp]** (`probes/ci-other-runners/port/run-node.sh`, three files, one spawning a child). Clone A at a developer path with the real HOME and nvm's Node 26.13.0; clone B at `home/runner/work/port-node/port-node` with its own HOME and TMPDIR and Node 26.13.0 copied to `opt/hostedtoolcache/node/26.13.0/x64/bin`. Each daemon ran the files and exported. Without `CI`/`GITHUB_ACTIONS`: environment equal, 3 of 3 keys equal, `import --dry-run` "Environment of project "unit": equal", the import made 3 of 3 current. With `CI=true GITHUB_ACTIONS=true`: the same 3 of 3; only the descriptor's `ci` hint differs, which no key holds. Since D12, node:test has no key part that names a path or the CI variables.

**cezar, 148 node:test files** **[exp]** (`port/run-cezar.sh`, outputs in `port/out/`). Two fresh clones of cezar at `cd415ac2`, each with its own empty store and `pnpm install --frozen-lockfile`; origin pointed at a missing path, so `shared.ref` fetched nothing. A: developer path, real HOME, nvm's Node 26.13.0 (`.node-version`, D18). B: `home/runner/work/cezar/cezar`, its own HOME and TMPDIR, Node 26.13.0 copied to `opt/hostedtoolcache/node/26.13.0/x64/bin`, `CI` and `GITHUB_ACTIONS` unset. Each daemon ran only the 148 node:test files (`squeal run tests <148 paths>`), not the suite.
- A: 148 of 148 passed and were exported (2,127 results), in 525 s wall at load 12 to 25 on 24 vCPUs.
- B, before its own run: `import --dry-run` of A's export: both projects' environments "equal to this worktree's"; 147 of 148 files re-keyed to B's lists at `cd415ac2` (I did not determine which file was not); 23 observed entries would be added.
- B's own run, 537 s at load 16 to 19: **148 of 148 current keys equal A's** (B's store, read-only). The environment descriptors are equal for both projects.
- 5 files failed in B at the key where they passed in A: `pr-snapshot.test.cjs`, `release-finalization.test.cjs`, `web-typecheck.test.ts`, `e2e-lanes.test.mjs`, `test-changed.test.mjs`, each with `spawnSync npm ENOENT` or `spawnSync pnpm ENOENT`. My B had only `node` on its PATH. This is the probe's fault, not the key's; but it shows that tools a test starts from `PATH` (npm, pnpm, git and their versions) are not keyed, for Vitest as for node:test. A pass on CI at an equal key stands for a machine that has those tools **[exp][src]**.

So, for cezar, the same Node and an equal install are enough for every node:test key to match across machines and paths, without removing the CI variables. What stops CI from giving node:test results today is only that nothing records them, and that cezar's node:test job runs Node 24.21.0.

## 5. Other runners

**[src]** `src/runners/` holds `vitest/`, `node-test/`, `pytest/`; `python/` is the tree-sitter grammar for pytest's graph and the code counter; `observe/` and `process/` are shared recorders and process helpers. No other runner exists. Two neighbours:
- Vitest browser projects (cezar's 97 `at: manual` files): CI runs them with `vitest run --config packages/web/e2e/vitest.config.ts` in its own sharded job, so today's Vitest `ci record` applies as is; D10 keeps `browser.*` keyed, and the CI job's `CI=true` browser fields would decide matches **[src][inf]**.
- Lint (ESLint, oxlint) keeps its own store (`src/core/lint/store/`); exports carry only `test`, `file` and `setup` kinds. Lint is cheap to recompute; the approach does not apply without a format of its own **[src][inf]**.

## 6. Size, risks, order

| Runner | What is new | Formats | Main risks |
|---|---|---|---|
| node:test | A recording runtime (attribution by `argv[1]` and an inherited variable, the existing module recorder writing per pid, the existing reporter), a part builder, a node:test adapter in `ci export`, the part header's `runner` widened, refusals for `--test-isolation=none`, name filters and a probe or argv that differ from the entry. Roughly the size of `ci-record.ts` + `ci-runs.ts` + part of `vitest-ci.cjs`, without snapshots; about 1 to 1.5 times one Vitest-path row **[inf]** | Part format raise (`squeal-ci-part/5`: a second `runner` value); export format and `KEY_FORMAT_VERSION` unchanged; no adapter version raise **[src][inf]** | Results capture needs a project command change, or `NODE_OPTIONS` reporters that change or break some commands; the CI Node must equal the developers' (cezar runs node:test on 24.21.0); coverage marker in the key **[exp][src]** |
| pytest | The plugin and recorder exist; new: a part builder and export path, and before that a key change so the interpreter and venv do not key by path | Part format as above; `PYTEST_ADAPTER_VERSION` raise (every pytest result re-runs once per store) **[inf]** | Installer and interpreter variety on teams (pip vs uv, setup-python vs uv-managed builds); `-I`, `-S`, xdist; no user here to measure gain **[exp][inf]** |

## Recommendation

1. node:test first. Its keys already travel (D12): a CI-shaped clone keyed the fixture equal, with or without the CI variables, and the import's re-keying works for it. The work is the recording, not the key. In cezar all 148 node:test keys matched between a developer clone and a CI-shaped clone; recorded in CI on the developers' Node, they would add about 148 of 1,956 files (72% to 80% of cezar's files from CI, the brief's count).
2. Decide the results capture before a row: either the project writes a reporter pair in its node:test command (a one-line change, output unchanged), or `ci record` adds reporters through `NODE_OPTIONS` and refuses commands it would change. The first is simpler and safer; the second needs no edit by the project.
3. cezar needs a node:test run on `.node-version` to profit: today its only node:test run is on the engines minimum, 24.21.0.
4. pytest later, and only with a user. First a key change like D12 (interpreter by build, `pyvenv.cfg` without paths), measured on a setup-python runner against a developer's uv or pyenv build. Without it no CI export can match.

## Open questions for the human

1. node:test results in CI: may Squeal ask the project to add a reporter pair to its node:test command, or must `ci record` work on the unchanged command?
2. cezar runs node:test on Node 24.21.0 to check its engines minimum. Is a second, recorded node:test run on 26.13.0 in the merge group acceptable (about 148 files; its cost was not measured on CI)?
3. node:test keys hold a coverage marker when coverage is on, as developers run it. Should CI recording add Squeal's coverage to node:test (as 020 D13 did for Vitest), or should the import tolerate the marker as D10 does for Vitest?
4. pytest: is there a project that wants it? Without one, the key change of recommendation 4 has no measurement.
5. Tools a test starts from `PATH` (npm, pnpm, git) are not keyed, for any runner. In cezar, 5 of 148 node:test files pass or fail by their presence at an equal key (section 4). Is "CI had the tools" an acceptable assumption for imported passes, as it is today for Vitest?

## Sources

- Squeal at `47bc78ce4`: `src/runners/node-test/{adapter.ts,adapter-environment.ts,adapter-project.ts,recorders.ts,identity.ts,version.ts,coverage.ts}`, `run/{run.ts,observed.ts,reads.ts,report.ts}`, `runtime/recorder.cjs`; `src/runners/pytest/**` (`run/command.ts`, `run/run.ts`, `environment/hash.ts`, `adapter-environment.ts`, `runtime/squeal_pytest.py`, `runtime/sitecustomize.py`, `version.ts`); `src/runners/vitest/{ci-record.ts,ci-runs.ts,ci-runtime/*.cjs}`; `src/runners/observe/recorder.cjs`; `src/cli/{ci.ts,ci-export.ts}`; `src/core/ci/{parts.ts,export.ts,export-check.ts,reuse.ts,command.ts}`; `src/core/store/{transfer-bundle.ts,transfer-rekey.ts,transfer-import.ts}`; `src/core/keys/{environment.ts,environment-descriptor.ts,key-format.ts}`; `src/core/lint/store/`. Spec 018 D8 to D12; `research/key-rules.md`, `ci-step.md`, `import-trial.md`.
- cezar `cd415ac2` (read with `git show`): `.github/workflows/ci.yml` jobs `unit-tests`, `vitest`, `squeal-export`, `cockpit-browser`; `package.json`, `packages/cezar/package.json`, `squeal.config.json`, `.node-version`, `.ai/scripts/e2e.sh`.
- Node.js v24.21.0 docs, retrieved 2026-11-20: https://raw.githubusercontent.com/nodejs/node/v24.21.0/doc/api/test.md (reporters, v23 default change, `afterEach`, `context.fullName`) and https://raw.githubusercontent.com/nodejs/node/v24.21.0/doc/api/cli.md (`--test-isolation`, `--test-shard`, `NODE_OPTIONS` allowed options and precedence).
- pytest 9.1.1 docs, retrieved 2026-11-20: https://raw.githubusercontent.com/pytest-dev/pytest/9.1.1/doc/en/reference/reference.rst (`PYTEST_ADDOPTS`, `PYTEST_PLUGINS`, `PYTEST_DISABLE_PLUGIN_AUTOLOAD`).
- CPython 3.13.14 docs, retrieved 2026-11-20: https://raw.githubusercontent.com/python/cpython/v3.13.14/Doc/library/site.rst, https://raw.githubusercontent.com/python/cpython/v3.13.14/Doc/using/cmdline.rst (`-E`, `-I`, `-S`).
- Probes and outputs: `probes/ci-other-runners/` (`attach/`, `port/`).
