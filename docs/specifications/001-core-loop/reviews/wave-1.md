# Wave 1 review

Reviewer task for spec 001, 2026-10-04. Range `935e251..a93c5b4` (22 commits): tasks 001-10 store, 001-11 hashing and keys (with `src/core/revision`), 001-12 watcher, 001-13 Vitest adapter.

## Verdict

The four modules are individually solid. Every board "done when" row is met except one missing watcher test (rename storm). Lint, typecheck and tests are green. No `any`, no file over 300 lines.

They do not yet fit together without glue, and two defects would let a wrong result pose as current. Both are about what a key does not cover: a closure leaves out files that do not exist yet, and `KeyIndex` hashes a path it was never told about as "missing". Wave 2 builds lookup and inheritance on top of exactly these keys, so fix both before 001-20 starts. Everything else is should-fix or nit and can run in parallel with wave 2.

Counts: 2 blockers, 10 should-fix, 8 nits.

## Verification

```
$ npm ci
found 0 vulnerabilities
npm warn install-scripts @parcel/watcher@2.6.0 (install: node scripts/build-from-source.js) not covered by allowScripts

$ npm run lint
Checked 113 files in 30ms. No fixes applied.

$ npm run typecheck
tsc --noEmit   (no output, exit 0)

$ npx vitest run
 Test Files  29 passed (29)
      Tests  213 passed | 5 skipped (218)
   Duration  5.86s
```

The 5 skipped tests are the @parcel/watcher backend suite, which runs only on darwin (`test/watcher/backend.test.ts:19`). This is expected; macOS is a non-goal in v1. The warm-run timing test (`test/runners/vitest/run.test.ts:134`) ran and passed this time. It skips itself when the load average is high.

One throwaway probe (git-ignored scratch dir, deleted afterwards) checked two suspicions against the real adapter on the `basic` fixture:

```
PROBE env keys in resolvedConfig.env: 4 has PATH: false has probe var: false
PROBE resolvedConfig equal across env change: true
PROBE closure of test with missing import: ["test/missing.test.ts"]
PROBE run: completed ["Cannot find module '../src/not-yet' imported from test/missing.test.ts"]
PROBE affected after creating target: [{"project":"","path":"test/missing.test.ts"}]
```

The process environment does not leak into the environment hash (suspicion dismissed). An unresolved import is not part of the closure (confirmed, blocker B1).

## Blockers

### B1. A closure leaves out files that do not exist yet, so a result is inherited where its inputs differ

- **Where:** `src/runners/vitest/adapter.ts:136-138`. The closure is `graph.files` plus the snapshot only `if (existsSync(snapshot))`. `graph.missing` is computed (`graph.ts:15`) and then dropped.
- **What is wrong:** the key covers the content of files that exist. It does not cover whether a file that would change the result exists. Spec D5 step 3 and ADR 0002 make a new worktree's baseline "a lookup: hash all files from the git index, compute keys from stored closure lists, look them up". Research R4 says this holds "because a closure is a function of its files' contents, resolver config and file existence". The existence part is only true incrementally, through `closuresToReresolve` and `affected()`. It is false at bootstrap.
- **Failure scenario 1, unresolved import:** in worktree A, `test/api.test.ts` imports `../src/client`, which does not exist yet. The closure is `["test/api.test.ts"]`. The run stores a file-level `fail` ("Cannot find module '../src/client'") under key K = f(env, hash(test file)). Worktree B was created from a branch that has `src/client.ts`. B takes the stored closure list, computes K, gets a hit and reports the `fail` as current and inherited. Nothing runs. Spec goal 3: "Everything the agent is told is true at the moment it is told".
- **Failure scenario 2, snapshot:** A has no `test/__snapshots__/strings.test.ts.snap`. With `update: 'none'` the snapshot test fails and is stored under K. B has the snapshot committed. B computes K from A's closure list and inherits the `fail`.
- **Failure scenario 3, declared inputs:** `selectDeclaredInputs` matches only files that exist (`src/core/keys/closure.ts:36`). The stored closure list carries A's matches. A fixture that exists only in B never enters B's key at bootstrap.
- **Suggested fix (one task, 001-13 owner):** `closure()` always includes `snapshotPath(project, abs)`, whether the file exists or not. For each `graph.missing` target it includes the target plus its resolution candidates (`<target><ext>` and `<target>/index<ext>` for each entry of the project's `resolve.extensions`). Missing paths hash as `-` (`check-key.ts:15`), so the key changes as soon as one appears, both incrementally and at bootstrap. Add a test that keys a test file from a stored closure list in a second directory where the import target exists, and asserts a different key. Scenario 3 is a wave 2 rule: bootstrap re-applies `selectDeclaredInputs` to the local file list (see 001-20 inputs).

### B2. `KeyIndex` treats "never hashed" as "deleted", so gitignored closure files never change a key

- **Where:** `src/core/keys/key-index.ts:136-145` (`acquire` reads `hashOf(path)`), with `StatCache.hashOf` returning `null` for any path not in the cache (`src/core/hash/stat-cache.ts:70`).
- **What is wrong:** the stat cache only ever holds paths that came through the watcher, a reconciliation pass or `seedStatCache`. All three drop gitignored files. Spec D2: "Gitignored files that appear in a known closure (generated code) are added to the stat cache and watched individually". Nothing reports which closure paths are missing from the cache, and `KeyIndex` silently encodes them as missing.
- **Failure scenario:** `src/gen/client.ts` is gitignored codegen (Prisma, GraphQL, protobuf). `test/api.test.ts` imports it. The closure contains it and its segment is `src/gen/client.ts\0-\0`. Codegen rewrites it with a breaking change: the watcher never sees it (excluded dir), and even a forced `rekey` re-reads `null`. The stored `pass` stays current. A second worktree with different generated code gets the same key and inherits the `pass`.
- **Suggested fix (one task, 001-11 owner):** make the hash source tri-state, `FileHash | null` (known, absent) or `undefined` (not tracked). `KeyIndex.setClosure` returns the untracked closure paths alongside its `KeyChange[]`, and refuses to key a test file while any path is untracked. Add a test that a closure with an ignored generated file stays unkeyed until the path is hashed, then re-keys on change. Wiring the returned paths into `seedStatCache` and `ChangeFeed.setExtraFiles` is a 001-20 task (see inputs).

## Should-fix

### S1. `CandidateBatch` does not feed `reconcile()` as is, and the watcher's stats are thrown away

- **Where:** `src/core/types/watcher.ts:96-115`, `src/core/revision/reconcile.ts:95-119`, `src/core/watcher/candidates.ts:187`, `src/core/hash/hasher.ts:26`.
- **What is wrong:** `reconcile()` takes `Iterable<RelativePath>` and a context carrying `trigger`. The daemon must map `batch.paths.map(p => p.path)` and build a context per batch from `batch.trigger`. `CandidatePath.stat` is read nowhere in `src`. Every path is `lstat`ed by the watcher and then `stat`ed again by `Hasher.stat`. The two stats differ for symlinks: the watcher describes the link (`FileStat` doc: "Symlinks are described, not followed"), the hasher follows it. The `watcher.ts:103` comment ("The revision task (001-11) compares each stat with the stat cache") describes code that does not exist.
- **Also:** `reconcile.ts:90-93` says to flush the stat cache "ideally in the transaction that appends the revision". That is impossible: `append` runs inside `reconcile` (line 105), and `reconcile` is async while `Store.transaction` is sync. A crash between append and flush re-detects the same change as a second revision on restart.
- **Suggested fix (one task):** `reconcile(batch: CandidateBatch, ...)` takes the trigger from the batch and uses `CandidatePath.stat` as the post-event stat. Pick one stat definition (follow symlinks or not) for watcher, hasher and stat cache, and document it once. Split `reconcile` so the caller can `await head()` first and then append plus flush in one `store.transaction`. Add one test that feeds a real `ChangeFeed` batch for a touch into `reconcile` and asserts no revision. Today that board row is covered by two tests that never meet (`change-feed.test.ts:150` says "deciding there is no revision is 001-11 work").

### S2. Two implementations of the same helpers

| Thing | Copies | Difference that matters |
|---|---|---|
| git runner | `src/core/hash/git.ts:20`, `src/core/watcher/git.ts:17` | Watcher copy does not clear `GIT_OBJECT_DIRECTORY`; error formats differ; only the watcher copy has `okCodes`, so `git-index.ts:92` parses `" exited 1 "` out of an error message instead |
| `splitNul` | `hash/git.ts:52`, `watcher/git.ts:45` | One drops only the trailing field, the other every empty field |
| `isMissing` | `hash/blob.ts:31`, `watcher/paths.ts:46`, inline in `store/paths.ts:65` | Only the hash copy treats `EISDIR` as missing |
| `FileStat` | `types/watcher.ts:88`, `hash/stat-cache.ts:11` | Identical shape, two names to keep in sync |
| git blob hash | `core/hash/blob.ts:14`, `runners/vitest/paths.ts:20` | Adapter copy is SHA-1 only and synchronous; see S3 |
| path relativizer | `watcher/paths.ts:6`, `runners/vitest/paths.ts:39`, `keys/closure.ts:15` | Three rules for "inside the worktree": the watcher copy (`rel.startsWith("..")`) also rejects a root-level file named `..foo`, the adapter copy does not |
| code-unit compare | `keys/closure.ts:86`, `runners/vitest/results.ts:61`, inline in `runners/vitest/environment.ts:39,67` | Same function three times |

- **Suggested fix (one task):** a `src/core/fs` (or `src/core/git`) module with one `runGit({ input, okCodes })`, `splitNul`, `isMissing`, `toRelative`/`toAbsolute` and `compare`. Delete the copies; keep `FileStat` in `types` only.

### S3. The adapter hashes environment files with its own SHA-1 hasher, behind a signature the core cannot satisfy

- **Where:** `src/runners/vitest/index.ts:22-25`, `src/runners/vitest/adapter.ts:51`, `src/runners/vitest/environment.ts:30`.
- **What is wrong:** spec D3: "One definition everywhere", including `objectFormat=sha256`. The adapter's `hashFile` is `(AbsolutePath) => FileHash`: synchronous, absolute, never null. The core's hashers are async (`hashFile`) or relative and nullable (`StatCache.hashOf`). The daemon cannot pass the stat cache without a wrapper that falls back to a read. With the default, a sha256 repository gets SHA-1 hashes in the environment and every `environment()` call re-reads config and setup files, bypassing the stat cache.
- **Suggested fix (one task):** `RunnerEnvironment.files` carries paths only (`readonly RelativePath[]`). The core hashes them with the stat cache, like closure paths, and folds them into `environmentHash`. This also gives the daemon the list it needs to know when to recompute an environment (see 001-20 inputs). Delete `gitBlobHash`.

### S4. Known state has no `skip`, although D6 does

- **Where:** `src/core/types/state.ts:10`, `src/core/store/repos/states.ts:24`, `src/core/store/repos/consumers.ts:20`, stale comment at `src/core/types/check.ts:36`.
- **What is wrong:** spec D6 (amended 2026-10-04 in `status.md`): known state is "`pass`, `fail`, `skip` (skipped or todo in the runner; counted separately, never a failure, never notable in a delta), `unknown`". The type and both row decoders accept only `pass | fail | unknown`. A `skip` written to `known_states` reads back as a `TypeError` (`codec.ts:39`).
- **Suggested fix (one task, before 001-21 starts):** add `skip` to `KnownOutcome`, the two `OUTCOMES` lists and the round-trip test in `test/store/repos.test.ts:277`. Fix the `check.ts` comment.

### S5. No way to retire a check: deleted tests stay known, and file-level errors would resurrect them

- **Where:** `src/core/types/store.ts:68-71` (`CheckRepo`), `:98-102` (`KnownStateRepo`), `:121-125` (`ViewRepo`); `src/core/store/repos/test-files.ts:130`; `src/core/store/prune.ts` never touches `checks`.
- **What is wrong:** `checks` only grows. `CheckRepo.listByTestFile` returns every check ever seen in a file. There is no delete for `known_states` or `consumer_views` rows of one check. Spec D4: file-level errors "become a `fail` for every check previously known in that file".
- **Failure scenario:** the agent renames `it("old name")` to `it("new name")`, then introduces an import error. If the expansion uses `listByTestFile`, both `old name` and `new name` become `fail`, and `old name` is reported as a regression of a test that no longer exists. Even without file-level errors, `known_states` keeps `old name` at its last outcome forever. If that was `fail`, status reports a known failure that cannot be fixed.
- **Suggested fix (one task):** `KnownStateRepo.removeMany(worktreeId, checks)` and `ViewRepo.removeMany(consumer, checks)`, plus `ResultRepo.checksForKey(key)` (or reuse `byKey`) so the expansion uses the checks of the file's previous key, not every historical check. Pruning drops `checks` rows that no result, known state, view or transition references.

### S6. "Full suite" is a property of a run, but D5 runs in tiers

- **Where:** `src/core/types/store-records.ts:131` (`RunRecord.fullSuite`), `src/core/store/repos/results.ts:154` (`lastFullSuite`), `src/core/store/prune.ts:32-38`.
- **What is wrong:** D5: `run --all` queues every test file, and runs go "in tiers of a configurable size (default 4 test files)". One `squeal run --all` is many `RunRecord`s. `lastFullSuite` returns the newest completed one: one tier of four files. D7 needs "whether a full-suite result exists for this revision and at which revision the last one completed".
- **Suggested fix (one task, store owner, before 001-20 and 001-22):** a `checkpoints` record (id, worktree, revision, requested test files, started, completed, end) that tier runs reference, or derive "full suite current" from `test_file_keys` plus results. Pick one and amend D7/D8.

### S7. An unhandled error with no owning file fails every completed file, and the fail is stored under content keys

- **Where:** `src/runners/vitest/run.ts:109-114`.
- **What is wrong:** when Vitest reports an unhandled error without `VITEST_TEST_PATH`, the error is attached as a file-level error to every completed file. The core turns each into a `fail` for every check in those files and stores them under their keys. Another worktree with the same keys inherits them. D12 handles an untrustworthy run as `unknown`, which is never stored: "an `unknown` under a key would be inherited as a hit" (D8). The comment says "the run is not trusted", but the code reports it as trusted failures.
- **Failure scenario:** a tier of four files where one leaks a rejected promise that surfaces after its module ended. Three innocent files go `PASS -> FAIL`, three deliveries fire, and those fails are inherited by the next worktree.
- **Suggested fix (one task):** an unattributed unhandled error ends the run as `crashed` with the error text in `failure`, so D12 applies. Add the missing test: only the attributed case is tested today (`edge-cases.test.ts:23`).

### S8. Installed dependencies are hashed but never watched

- **Where:** `src/core/keys/environment.ts:88-98` reads `node_modules/.package-lock.json` and friends. `buildWatchSpec` (`src/core/watcher/watch-spec.ts:21`) excludes `node_modules/` as ignored, and reconciliation passes skip ignored files.
- **What is wrong:** D3 puts "the installed-dependency fingerprint" into the environment hash. D2 never watches it. After `npm install` in a running daemon, no revision is created and no environment is recomputed. Every key stays the same and every result stays current against the old dependencies.
- **Suggested fix (one task, or part of 001-20):** add the lockfile path that `installedDependenciesFingerprint` found to `ChangeFeed.setExtraFiles`, and recompute the core environment when it changes. Amend D2 to list it next to generated closure files.

### S9. Board row 001-12 "rename storm" has no test, and the key-stability test does not use the adapter

- **Where:** `test/watcher/change-feed.test.ts`, `test/keys/worktree.test.ts:26-57`.
- **What is wrong:** the board's 001-12 row requires fixture tests for "atomic save, rename storm, new nested worktree, touch without change (no revision), missed event caught by reconciliation". Rename storm is missing. `change-feed.test.ts:104` renames one directory once. Touch without change is split across two modules (see S1). `worktree.test.ts` proves key stability with a hand-written `RunnerEnvironment` (`resolvedConfig: "{}"`) and a hand-written closure. `inspect.test.ts:88` separately shows the adapter's environment inputs are path-independent, but nothing proves the two together.
- **Suggested fix (one task):** a rename storm test (for example 200 files renamed in a loop with `mv a b; mv b a` and a final directory rename, asserting the final batch set matches the final disk state). One key-stability test that builds keys from `createVitestAdapter` output in a worktree and in a `git worktree add` copy.

### S10. Policy inputs are left out of the environment hash, and failure text is deduplicated by text, not fingerprint, without a spec change

- **Where:** `src/core/types/keys.ts:64-66`, `src/core/store/repos/results.ts:91-105`.
- **What is wrong:** D3 lists "extra inputs declared in policy" in the environment hash. The code applies them to closures only, with a reason in a comment. D8 says "Failure text is deduplicated by fingerprint". The code hashes the text, also with a reason. Both choices are defensible. The styleguide: "interfaces change through a spec update". Today the spec and the code disagree.
- **Suggested fix (coordinator, no code):** amend D3 and D8 to match the code, or ask for the code to change. My recommendation is to amend the spec. Both code choices avoid double counting and lossy deduplication.

## Nits

- **N1.** `src/runners/vitest/adapter.ts:107-117`: any add or delete calls `invalidateAll`, dropping every cached transform in every project. The reason is sound (Vite keeps unresolved specifiers), but agents create files often. The next `affected()` pays the cold walk, about 100 to 400 ms per 50 files in research. Measure on this repository during dogfooding. Record the deviation from D4's "calls `invalidateFile` for each path" in the spec.
- **N2.** `src/core/watcher/candidates.ts:113-125`: a reconciliation pass `lstat`s every tracked path one at a time, and `reconcile` then `stat`s them again 64 at a time. Every 30 s idle, on a 10k-file worktree. Use `mapConcurrent`, or drop one of the two stats (S1).
- **N3.** Swallowed errors without a trace: `adapter.ts:211` (`close()` of a hung instance) and `run.ts:55,58` (`cancelCurrentRun`). The styleguide says "Never swallow an error silently". Send them to the run log or the daemon log once one exists. The other empty catches (`graph.ts:51`, `affected.ts:34`, `hash/git.ts:46`, `connection.ts:82`) handle a specific case and say why.
- **N4.** Two tests in one file with the same `fullName` share one `CheckId` (`results.ts:44`). The second result replaces the first in `results` (`INSERT OR REPLACE`), so a pass can hide a fail. Vitest allows duplicate names. Record it as an open question for D4, or disambiguate with a suffix taken from location.
- **N5.** `prune.ts:110` evicts by `recorded_at`, which is least recently recorded, not least recently used as D8 says. An old result inherited daily by new worktrees is evicted before a fresher unused one. Live keys are protected, so this only matters once the cap is reached.
- **N6.** `RunReport.completedFiles` keeps results of files that finished before a timeout (`run.ts:87-91`). D12 says "every check in the tier becomes `unknown`". The adapter's choice saves work and is probably right. Decide in 001-20 and amend D12.
- **N7.** The `watcher.ts:103` and `check.ts:36` comments describe ownership and spec state that are no longer true (see S1, S4).
- **N8.** `npm ci` warns that the `@parcel/watcher` install script is not in `allowScripts`. On Linux the prebuilt binary loads anyway, and the backend is macOS-only and lazily imported. Before the macOS run (open question 7), confirm the prebuilt `darwin-arm64` binary loads without its install script.

## What fits

So that wave 2 does not re-check these:

- Store: WAL, `synchronous=NORMAL`, busy timeout on every connection, `BEGIN IMMEDIATE` with nested savepoints, transactional `user_version` migrations, newer-schema refusal, integrity-checked recovery under a lock, multi-process and SIGKILL tests. All match D8, D12 and the board row.
- `resolveCommonDir` (`store/paths.ts`) implements the D1 no-git rule for hooks, including relative `commondir` and submodules.
- Clean-index shortcut (`hash/git-index.ts`): goes beyond D3 (`ident`, `working-tree-encoding`, `core.autocrlf`, assume-unchanged, skip-worktree) and pairs index oids with before/after stats, so a racing write falls back to hashing bytes.
- `KeyIndex` re-keys 5,000 closures of 300 paths well under 1 s, and its incremental path reads exactly one hash for one changed path.
- Vitest adapter: results only from reporter hooks, generation guard against hooks from abandoned instances, `process.exitCode` restored, config and global-setup recreate, syntax-error fallback walk, importers of deleted files added to `affected()`. Every research Q5 case has a test.
- Watcher: three ignore layers, nested repositories detected by a `.git` entry at batch time and at reconciliation, `.gitignore` and `.git` changes rebuild the spec, idle and dropped-events reconciliation.

## Inputs for wave 2

### 001-20 scheduler and validity

- **Daemon loop glue.** No module owns it yet. Per `CandidateBatch`: `diffCandidates` or `reconcile` (S1), then `FileChange` to `InvalidatedPath` (`oldHash === null` is `add`, `newHash === null` is `delete`, else `change`), then `runner.invalidate`. Process batches strictly one at a time; `reconcile` must not overlap on one `StatCache`.
- **Environment refresh.** Call `runner.environment()` and `KeyIndex.setEnvironment` when `invalidate` returns `recreatedProjects`, when a changed path is in any `RunnerEnvironment.files` (setup files are not recreate triggers), and when the installed lockfile changes (S8). `environmentHash(coreEnvironmentInputs(...), runnerEnv)` per project.
- **Re-keying.** `KeyIndex.rekey(changedPaths)` covers content. For structure, re-fetch `runner.closure()` for the union of `closuresToReresolve(changes, index.reverse, isDeclaredInput)` and `runner.affected(changedPaths)`, then `assembleClosure(runnerClosure, selectDeclaredInputs(globs, localFiles))`, then `KeyIndex.setClosure` and `store.testFiles.put`. `rekey` alone misses a newly created import target or snapshot (B1).
- **Untracked closure paths (B2).** After each `setClosure`, hash every closure path the stat cache lacks (`seedStatCache` with those paths). Pass the gitignored ones to `ChangeFeed.setExtraFiles`. Never key a test file with an unhashed path.
- **Bootstrap.** Seed the stat cache with `seedStatCache` over tracked plus untracked files. Take closure lists from `store.testFiles.list()`. Re-apply local declared inputs (`assembleClosure({ testFile, paths: stored.paths }, selectDeclaredInputs(globs, localFiles))`). Look keys up with `store.results.byKey`. A non-empty answer is a hit only because results are written per completed file. Write results for one file in one `putMany`.
- **Results.** Only `RunReport.completedFiles` are trustworthy. `fileErrors` need expansion against the checks of the file's previous key (S5), not `CheckRepo.listByTestFile`. Decide N6 (timeout keeps completed files or not) and S7 (unattributed unhandled error is a crash).
- **Adapter behaviour.** Every adapter call is serialized behind the running tier, so `affected()` during a tier waits for it. This matches "a tier in flight is never cancelled". A broken config makes every adapter call reject until it is fixed (`#start` retries on each call): map that to `unknown` for the project with one status note, never to stored results. `testFiles()` excludes typecheck specs. `enumerate()` flags `test.each` as `templated`.
- **Stability check after a tier.** Use `diffCandidates(closurePaths, cache, hasher)` without applying updates. Any change means the file's results are discarded and the file re-queued.
- **Full suite.** `RunRecord.fullSuite` is per tier (S6). Settle the checkpoint model before writing `run --all`.

### 001-21 known state, transitions, delivery views

- Add `skip` to `KnownOutcome` and the store decoders first (S4).
- `ResultRecord.fingerprint` and `summary` are the caller's to compute. The adapter supplies `CheckError` with relativized `message`, `stack`, `diff` and `location` (first frame inside the worktree, outside `node_modules`). Fingerprint: normalized first line of `errors[0].message` plus `location`.
- Failure text is stored once per distinct `(summary, errors)` text, not per fingerprint (S10).
- `ConsumerRepo.register` drops the old view. Seed the new view in the same `store.transaction`. Transactions nest as savepoints. Read the delta and `ViewRepo.writeMany` in one transaction. The hook default busy timeout is 1 s (`DEFAULT_BUSY_TIMEOUT_MS`), inside the 2 s hook budget.
- Retiring checks needs `KnownStateRepo` and `ViewRepo` removals (S5). Without them a renamed test keeps its last state forever.
- `consumers.expire(cutoff)` implements the 12 h rule (`CONSUMER_EXPIRY_MS`). It requires both `last_seen_at` and `last_delivered_at` to be older than the cutoff.
- Duplicate `fullName` in one file collapses to one check (N4).

### 001-22 status and why

- Open without creating: `openStore(resolveCommonDir(root), { create: false })` returns `{ reason: "missing" | "newer-schema" | "corrupt" }` or a `Store`. Never pass `checkIntegrity` from a CLI or hook; it is for daemon start.
- Worktree id: `worktreeIdFor(root)` is sha256 of the realpath, first 16 hex characters. A symlinked spelling of the root gives the same id.
- "Baseline was lost": `meta.get(META_STORE_RECOVERED)` holds `{ at, movedTo, reason }`.
- Liveness: `worktrees.get(id).daemon` with `heartbeatAt` and `heartbeatIntervalMs`. `null` means no daemon was ever recorded or it was cleared.
- Counts: `knownStates.list(worktreeId)` validity and outcome. Inherited count from `origin.kind === "inherited"`. Pending phase is on both `known_states` and `test_file_keys`; read one, and agree with 001-20 which one is authoritative.
- Full-suite line: blocked on S6. `runs.lastFullSuite` today returns one tier.
- Closure method: `CLOSURE_METHOD` from `src/core/keys`.
- `squeal why`: `transitions.history`, `results.latestForCheck` (across worktrees, newest first), and `runs.get(runId).logDir`. The log dir holds `vitest.log` (absolute paths kept) and `report.json` (relativized).
