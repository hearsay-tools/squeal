# Review: wave 2, 003-20, 003-23 and 003-16 (task 003-17)

Reviewer task 003-17 for spec 003, 2026-10-07. Range: the 003 commits of `8c58e12..6fde336`:

- 003-20: `5e0b976`, `0b1d82f`;
- 003-23: `6193bba`, plus the Codex parity commit `73bea14`;
- 003-16: `5b01795`, `0c0e53c`, `565b6f0`, `ec3e1c0`, `dc6d050`;
- the rebuilds `ac0d494` (0.1.19) and `6fde336` (0.1.21), as far as they ship node:test.

The 001 and 002 commits in the range belong to other rows. I read the range against spec D1 to D7 and goals 5 to 8, as amended through `5265b61`, and against the three briefs in `tasks/wave-2.md`. All probes ran under `/tmp/rev17`, on copies, with their own stores. The cezar repository was only read and copied.

## Verdict

**FAIL at `faa202d`.** Counts: 1 blocker, 2 should-fix, 6 nits.

The one blocker is a stale pass. A file that a preload loads through a computed `import()` is in no closure, no environment file and no `affected`, and nothing notes it (B1). It is narrow, proven, and one small fix.

The five questions of the brief:

1. **Can an inherited node:test result pose as current?**
   - **Fine:**
     - two daemons writing the meta key at once (one `BEGIN IMMEDIATE` read-merge-write);
     - a worktree that starts after the write (it reads the key and keys with the path);
     - a path present in one worktree and absent in another (it hashes as absent, so the keys differ and the file runs);
     - the first result under the pre-observation key (later worktrees key with the path and miss).
   - **Broken:**
     - a worktree whose daemon was already running when another worktree wrote the key never learns the path (S2);
     - a path a preload loads by a computed import is never recorded at all (B1).
   - **Preload edits:** a statically reached preload edit re-keys through `environment().files` and makes every file transitive. That holds.
2. **Two runners in one store.**
   - **Ids:** check ids and keys carry the project, so the same test path under a Vitest and a node:test project does not collide. Vitest's unnamed root project is `""` and node:test names are non-empty.
   - **Failures:** a missing Node stays inside its project, as designed. An adapter that cannot be built takes every check of the worktree with it, Vitest's included (S1, proven with a daemon).
3. **003-20 on cezarion's layout.**
   - **Layout:** cezarion has no root `tsconfig.base.json` and no `paths`. `packages/cezar/tsconfig.json` stands alone, and `"type": "module"` holds throughout. Only S3's relative preload `../../scripts/test-git-env.mjs` is exercised.
   - **Closures:** on a copy, all 10 unit files ran under `runNodeTest`, and every observed path was inside the static closure. That is 0 misses, the computed `import()` in `resolve-browser-launch.test.ts` included.
   - **Preload:** the closure is `scripts/test-git-env.mjs` plus three manifests.
   - **Results:** the failing tests' names match `npm run test:unit` run directly, 17 named failures in both. The copy has no `dist`.
4. **`squeal init` on cezarion.**
   - **Seeds:** the two `packages/cezar` scripts seed with the right `cwd`, `argv` and `include`.
   - **Refused:** the root `test:unit` (`npm run ... && node ... --test ...`) is refused as a chain and printed as a template.
   - **Existing config:** the copy's existing config was kept byte for byte.
   - **Nits:** naming and the existing-config case (N1, N2).
5. **Start cost.**
   - **Bundle:** the CLI grew from 515,802 to 1,137,324 bytes, and `--version` went from 69 to 79 ms. The hook bundles are unchanged at 110,383 bytes, so the hook path pays nothing.
   - **1,000 modules:** a fresh-process graph build takes 268 to 468 ms at load 35. The daemon waits for it before `ready`.
   - **10,000 modules:** the build takes 2.9 s and holds 136 MB of heap. The first `closure()` builds the index in 271 to 291 ms. The first `affected` after that takes 1.6 to 2.9 ms, and an add's re-resolve takes 1.9 to 2.4 s. These numbers are inputs for 003-19, not findings.

## Verification

HEAD is `faa202d`, two commits past the range's end `6fde336`. Both commits change only docs: `docs/board.md`, 002's `tasks/wave-2.md`, and 003's `spec.md`, `status.md` and `tasks/wave-2.md` (`git diff --stat 6fde336 HEAD`). I ran everything at `faa202d`.

```
$ git rev-parse HEAD
faa202d75a9d74119924e00a545a7fb40d71c522
$ node --version
v24.21.0
$ npm ci
(install-scripts warning for esbuild only)
$ npm run lint
Checked 483 files in 256ms. No fixes applied.
$ npm run typecheck
tsc --noEmit   (no output, exit 0)
$ npm run build
tsc -p tsconfig.build.json && npm run build:plugin   (exit 0)
$ git status --porcelain
(empty: the committed dist matches the build)
$ npx vitest run            (Node 24.21.0, load average 20 to 24 on 24 cores)
 Test Files  1 failed | 170 passed (171)
      Tests  1 failed | 1448 passed | 8 skipped (1457)
 FAIL test/runners/node-test/enumerate.test.ts > enumeration cost > enumerates 200 generated test files under 200 ms
      AssertionError: expected 210.8129060000001 to be less than 200
$ npx vitest run test/runners/node-test/enumerate.test.ts
 Tests  15 passed (15)
$ PATH=~/.nvm/versions/node/v22.23.3/bin:$PATH npx vitest run test/runners/node-test test/fixtures/node-test \
    test/integration/node-test.test.ts test/cli/init-node-test.test.ts test/daemon
 v22.23.3
 Test Files  1 failed | 32 passed (33)
      Tests  1 failed | 233 passed (234)
 (the same enumeration-cost assertion; the integration test passed)
$ PATH=~/.nvm/versions/node/v22.23.3/bin:$PATH npx vitest run test/runners/node-test/enumerate.test.ts
 Tests  15 passed (15)
$ npx vitest run test/runners/node-test/graph-cost.test.ts --silent=false   (load 35)
 cold: '194.97 ms', coldMedian: '198.49 ms', edit: '0.35 ms'   (passed)
```

The one failing test is a wall-clock bound from wave 1 (`1516ea2`), outside this range. It fails only in the full suite under load and passes alone on both Node versions, so this review counts it against nothing. 003-18 should make it relative, like `graph-cost.test.ts`.

## Blockers

### B1. A file a preload loads through a computed `import()` never enters any key (proven)

The adapter's `record` (`src/runners/node-test/adapter.ts:102-122`) takes only `ObservedClosure.paths`. The recorder files everything a preload reaches under `preloadPaths`, and nothing reads that field after a run. `graph.preloads().incomplete` names the computed import, but neither `environment()` nor `notes()` carries it, so the gap is silent.

Goal 5: "Every run checks the static closure against the files the test actually loaded: an observed path outside the static closure makes the result incomplete, is stored with its hash, blocks inheritance when its content differs, and schedules the file when it changes." Vision, principle 2: "An old result never gets to pose as the current truth."

Probe (`/tmp/rev17/probe/preload-computed.mts`, deleted):
- **Setup:** `argv` `["--import", "./scripts/setup.mjs", "--import", "tsx"]`. `setup.mjs` runs `await import("./helper" + ".mjs")`, and `helper.mjs` sets a global that the test asserts on.
- **Run:** `completed`, `pass`. The recorder's `graph-0-<pid>.ndjson` holds the `setup.mjs -> helper.mjs` edge.
- **After the run:**
  - `environment()[0].files` is `["package.json", "scripts/setup.mjs"]`;
  - `closure(a.test.ts)` is `["package.json", "test/a.test.ts"]`;
  - `affected(["scripts/helper.mjs"])` is `{ direct: [], transitive: [] }`;
  - there are no notes.

So an edit to `helper.mjs` that breaks the test changes no key and schedules nothing. Every pass of the project stays current. A second worktree with a different `helper.mjs` inherits them.

Fix (one worker, `adapter.ts`, `src/core/daemon/node-test-runners.ts`, `graph/`):
1. In `record`, take each completed file's `preloadPaths` minus `graph.preloads().paths`.
2. Persist them per project with the same transactional merge, for example as a reserved entry of `nodeTest.observed.<project>` or a sibling key `nodeTest.observedPreloads.<project>`. Read them at start.
3. Add them to `environment().files`, which re-keys every file of the project. Have `graph.affected` treat them as preload paths, so every file is transitive.
4. Note each `preloads().incomplete` reason once, the way `graph.notes()` notes the unrecognized loaders.
5. Test with this probe's shape: after one run, an edit of `helper.mjs` re-runs the file, and a worktree with a different `helper.mjs` misses.

## Should-fix

### S1. One node:test project whose graph cannot be built makes the whole worktree unlisted, Vitest included (proven)

`createNodeTestAdapter` rejects when the graph cannot be built. `createNodeTestGraph` calls `realpathSync(options.cwd)` (`graph/index.ts:57`), so a `cwd` that does not exist is enough. The recovering runner then rejects every call (`src/core/daemon/runner.ts:87-92`). The composite rejects `testFiles()` and `environment()` as a whole (`composite-runner.ts:43-51, 81-88`), so the scheduler lists nothing for any runner. 003-16 moved the missing-Node case inside the adapter for exactly this reason (`status.md`, wave 2 003-16 entry), but the graph build stayed outside.

D1: "a bad entry is a problem note with that project skipped, never a crash". Goal 8: one daemon "validates both". The brief's question 2 asks this directly.

Probe (`/tmp/rev17/probe/missing-cwd.mts`, deleted; a daemon from the sources, as the integration test starts it):
- **Repository:** a Vitest suite, `nodeTest` project `a` (`packages/a`), and project `gone` (`cwd` `packages/gone`, absent).
- **Control without `gone`:** `{"current":4, ...}`, no notes.
- **With `gone`, after 180 s:** `{"current":0,"pending":0,"stale":0,"unknown":0}` with `testFilesWithoutChecks` all 0. The notes say `node-test could not start: ENOENT ... packages/gone (node-test project "gone")`, `runner environment failed: ...` and `runner testFiles failed: ...`.

Status stays honest. It renders "the daemon has not listed this worktree's test files yet", so no stale result poses as current. That is why this is should-fix and not a blocker. But one typo in a `cwd`, or a configured package missing from an older branch's worktree, silences every Vitest and node:test check of that worktree. 003-19 can hit this.

Fix (one worker, `adapter.ts`, `adapter-files.ts`):
1. Treat a project whose `cwd` is absent or not a directory like a missing Node: build the graph over no files, `runnerVersion` `unavailable`, one note, runs `crashed`, and recreated on the batch that adds the directory.
2. More generally, catch the graph build inside `createNodeTestAdapter` and degrade to that state, so no node:test project can reject composite calls.
3. Test with the probe's repository: the Vitest file and project `a` are current, and `gone`'s note is present.

### S2. A daemon already running when another worktree writes an observed path never learns it (proven at the adapter; end to end by reading)

`createNodeTestAdapter` reads `nodeTest.observed.<project>` once, at creation (`adapter.ts:86-89`). `closure()` and `affected()` then use only that snapshot plus this worktree's own runs. D3: "A fresh worktree reads the key before its first run." The case D3 leaves open is a worktree that is not fresh.

Probe (`/tmp/rev17/probe/observed-race.mts`, deleted): two adapters A and B over one store, both created before any run, with the integration test's `hidden.test.ts` (a computed `import()` of `src/hidden.ts`).
- **A runs:** `pass`. The key becomes `{"test/hidden.test.ts":["src/hidden.ts"]}`, and A's `closure()` includes `src/hidden.ts`.
- **B afterwards:**
  - `closure()` is still `["package.json", "test/hidden.test.ts"]`;
  - after `B.invalidate([{ path: "src/hidden.ts", kind: "change" }])`, `B.affected(["src/hidden.ts"])` is `{ direct: [], transitive: [] }`.
- **A third adapter created after the write:** it has the path in `closure()`, and `hidden.test.ts` is transitive.

End to end, by reading: `selectTier` looks each queued key up once more before running it (`src/core/scheduler/tiers.ts:63-69`), "because another worktree may have stored it meanwhile". Suppose B queued `hidden.test.ts` under the static key K0 and A's result lands first. Then B applies A's pass under K0 without running. From then on, B's edits of `src/hidden.ts` schedule nothing and change no key. If B's copy already differed, B holds a pass for content it never ran. D3 accepts the first result being "current only where the observed paths are still unknown, which the next run in that worktree corrects". In B no next run comes.

This is plausible end to end, so it is not blocking. The window is real for the first validation of a repository by parallel Cezar workers started together.

Fix (one worker, `adapter.ts`):
1. In `invalidate`, re-read the key (one `meta.get`) and merge it into the in-memory map and `graph.recordObserved`.
2. When a test file's known set grew, report its project in `recreatedProjects` so the scheduler re-fetches its closures. Growth is rare, so the re-key is cheap enough. A narrower route needs a scheduler change, out of this row.
3. Test with two adapters over one store, as in the probe: after B's next `invalidate`, `B.closure()` holds the path and `B.affected` names the file.

## Nits

- **N1. Init names a seeded project after a refused script (proven).** In cezarion the root `test:unit` is refused (a chain), yet it still counts towards the name collision in `seedNodeTest` (`src/cli/node-test-seed.ts:41-47`). So the seeded entry becomes `packages/cezar:test:unit`, while `test:package` keeps its plain name and the printed template is named `test:unit`. Count only seeded scripts when deciding whether to prefix.
- **N2. Init with an existing config says nothing about node:test (proven).** On the cezarion copy with its real `squeal.config.json`, which has no `nodeTest`, `squeal init` printed `kept squeal.config.json` and no seed or hint. The config was rightly not overwritten, but the human never learns that two suites go unvalidated. When the kept config has no `nodeTest`, print the seeded entries as a suggestion.
- **N3. Prose in comments and strings marks a module incomplete (proven).** `REQUIRE_CALL` (`graph/parse.ts:29`) matches `require (` anywhere: `// these tests require (at least) Node 22` and `"require(x)"` each add a `require() with a computed specifier` reason. Reasons reach no user today (see N4), so the effect is nil. It matters once they are surfaced. Skip comments and string literals, or match only where es-module-lexer saw no string.
- **N4. Incompleteness reasons are never surfaced (proven by reading).** The adapter's `closure()` (`adapter.ts:147-153`) drops `complete` and `incomplete`, and `RunnerClosure` has no field for them. D3: "A non-literal `import()` marks the closure `complete: false` with the specifier's location as the reason, before any run." Core already treats every v1 closure as incomplete, so status is not wrong. But before a file's first run nothing names the computed import that its key cannot see. One note per incomplete closure, deduplicated like `notes()`, would do. B1's fix covers the preload half.
- **N5. `status.md` misstates the bundle growth (proven).** The 003-16 entry says "The CLI bundle grew from 422 to 504 kB". `plugins/claude-code/dist/cli/squeal.mjs` is 515,802 bytes at `c61a98e` (0.1.20) and 1,137,324 at `6fde336` (0.1.21). The coordinator should correct the line.
- **N6. Board table drift (proven).** In `docs/board.md` the 003-17 row has three cells. Its done-when, "`reviews/wave-2.md` committed.", sits as a fifth cell on the 003-22 row below it (lines 278 to 279).

## What fits

These need no re-check in the next wave.

**Observed store** (`src/core/daemon/node-test-runners.ts`)
- **Merge:** one transaction reads, merges per test file and writes the key sorted. A malformed key reads as empty.
- **Stored closure:** the same transaction adds the paths to the test file's stored closure. A later `storeClosures` from a daemon that lacks the path can drop it again, but the bootstrap re-checks every stored-closure hit against the adapter's own `closure()` (`scheduler/bootstrap.ts:103-113`). The final key is the adapter's, which includes the key it read at start.
- **Read once at start:** two daemons, an absent path in one worktree, and the pre-observation result all behave as the verdict says. The integration test proves a differing copy misses and runs (`wt3`), and an unchanged one inherits with zero runs (`wt2`).

**Adapter** (`src/runners/node-test/adapter.ts`)
- **Call order:** `invalidate` before `affected`. `setTestFiles` runs only when an add or delete changed the listing. Each run's `logDir` is `<logDir>/node-test/<encoded name>`.
- **Environment:** `TMPDIR`, `TMP` and `TEMP` are the daemon's. `NODE_TEST_CONTEXT` is removed from the probe. The record carries the runner name `node-test`, the project's `node --version` and the resolved `execPath` (relative when inside the worktree), the canonical config (node, argv, sorted env, cwd, include, exclude), `files` from `preloads()`, and `root` set to the project's `cwd`.
- **Missing Node:** `runnerVersion` `unavailable`, one note, runs `crashed`. Each batch probes again, and a recovery recreates the project. Every check of that project is `unknown` and no other project is touched.
- **Results:** recording takes only listed, completed files and subtracts the static closure.

**Composite with two runner kinds**
- **Run:** a node:test part that rejects in `run` is that part's crash. The Vitest part keeps its results (`composite-runner.ts:120-138`).
- **Collisions:** keys and check ids carry the project, so the same path under two projects cannot collide. A named Vitest project that equals a `nodeTest` name fails the listing with "rename one". That is honest, pre-existing (003-10), and has a clear note.

**Graph fixes** (003-20)
- **S1:** the `extends` chain's `paths` rebase onto their defining file.
- **S2:** `.cts`/`.cjs`, and `.ts`/`.js` without `"type": "module"`, resolve static imports with `require` conditions, while `import()` keeps `import`. The deciding `package.json` is a read.
- **S3:** bare preloads resolve from `cwd`. A worktree one roots the preload closure.
- **N3, N6:** absent `node_modules` directories are no candidates, and a computed `require` marks the closure incomplete.
- **Evidence:** each fix has a fixture test equal to the recorder's observed closure (`test/fixtures/node-test/monorepo/`). On cezarion: 0 misses over 10 files.

**Enumeration** (`enumerate.ts`)
- **Identity:** it uses `identity.ts`'s `suffixDuplicates` and `NAME_SEPARATOR`.
- **Skips and names:** it does not descend into `.skip` or a literal truthy `skip`, and a computed `skip` keeps its children. A function or options-first call is named by the function or `<anonymous>`.
- **Warning:** `stripTypeScriptTypes`'s `ExperimentalWarning` is dropped around the call only.

**Init**
- **Never overwrites:** an existing config is kept byte for byte by both `squeal init` and `--harness codex`.
- **Refusals:** a script with `|`, `&`, `;`, a redirection, an expansion or an environment assignment gets a template and a note.

**Bundle**
- **Contents:** both plugins ship `dist/node-test/{reporter,recorder}.mjs`.
- **Import check:** the bundle check accepts bare builtins through `isBuiltin` (`dc6d050`).
- **Hooks:** the hook bundles did not grow.

## Inputs for the next wave

### Fix wave (before 003-19)

- **Order:** B1, S1 and S2 are independent and each fits one worker inside `src/runners/node-test/adapter*.ts`, with B1 also in `src/core/daemon/node-test-runners.ts`. Land B1 before 003-19, since a dogfooding repository with a computed import in its preload would show the stale pass.
- **No interface change:** B1 and S2 need no change to `RunnerAdapter`. B1 uses `environment().files`. S2 uses `recreatedProjects`.

### 003-18 (e2e)

- **Fixture:** the shipped plugin against `test/fixtures/node-test/reference`, launched as the hooks launch it.
- **Lifecycle:** cover start, a `PASS -> FAIL` and a `FAIL -> PASS` through `post-tool-batch`, an observed-only path, and stop.
- **Budgets:** the daemon awaits every node:test graph before `ready` (`daemon.ts`, the `Promise.all` before `createDaemonLoop`). Give `ready` the integration test's 120 s settle budget and assert ratios, never wall-clock bounds. The enumeration-cost test above shows a fixed 200 ms bound failing under CI-like load.
- **Two Node versions:** the integration test passed on Node 22.23.3 and 24.21.0. Keep both in the e2e matrix.

### 003-19 (dogfooding on cezarion)

- **Config:**
  - Seed with `squeal init` on a cezarion worktree whose `squeal.config.json` has been moved aside. The current one is untracked and has no `nodeTest`, and init keeps it (N2).
  - Expect the names `packages/cezar:test:unit` and `test:package` (N1).
  - Add the root `test:unit`'s second half by hand if wanted: `cwd` root, `argv` `["--import", "./scripts/test-git-env.mjs"]`, `include` `[".github/scripts/*.test.cjs", "scripts/*.test.mjs"]`.
- **Closures:**
  - 4 of 10 unit files have a closure of two paths: the file and a manifest. They spawn processes or read fixtures, as `cursor-hang-stdin.test.ts` spawns `scripts/mock-cursor-hang-stdin.mjs`. Open question 3 applies: they need declared `inputs`, or they re-run only on their own edits.
  - `test:package` has two files with computed imports (`delegation.test.ts`, `inline-contract.test.ts`). The observed net covers them after the first run.
- **Cost:**
  - Two projects over one package build two graphs, at 61 to 78 ms each on the copy.
  - At 10,000 modules and 2,000 files a build takes about 2.9 s with 136 MB heap, and the first `closure()` 0.3 s. Record cezarion's actual start-to-ready time and the daemon's RSS in `lessons.md`.
- **Failures in a copy:** a copy without `dist` fails 17 named unit tests both under `npm run test:unit` and under Squeal. Dogfood on a built worktree, or the baseline will be red for reasons unrelated to Squeal.
- **Still missing:** node:test package entries for per-package keys (003-22); node:test files keep the whole-lockfile fingerprint.
