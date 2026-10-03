# Research: result-fingerprinting-prior-art

Date: 2026-10-03. Researcher task for spec 001. Probes: `probes/result-fingerprinting-prior-art/` (raw output in `results.txt`).

Evidence tags: **[exp]** verified by experiment, **[docs]** read in official docs, **[src]** read in source code, **[inf]** inferred.

## Questions answered

1. How seven tools decide what to re-run and what to reuse: F1.
2. Commit SHA vs content hash vs hybrid: F2.
3. Fingerprint scheme for Squeal: R1 to R5.
4. Checks with an unknown closure: R6.
5. Store size and pruning: F4, R7.

## Findings

### F1. What each tool hashes, how it finds dependencies, how it handles staleness (Q1)

| Tool, version | Reuse unit and key | Dependency discovery | Staleness and failures | Known failure modes |
|---|---|---|---|---|
| testmon 2.2.0 (pytest) | Per test. Per file: git-blob-style SHA-1 (`fsha`). Per test: CRC32 of each code block (function body) it executed. Environment row: name, installed packages with patch version dropped, Python version. **[src]** | coverage.py at runtime. **[src][docs]** | Clean files take `fsha` from `git ls-files --stage -m`; dirty files are hashed in Python. `fsha` mismatch falls back to comparing block checksums. Any package change reruns everything. Failed tests always rerun. **[src]** | Sees only traced Python code: data files, env vars and non-Python inputs are invisible. "Limits ... are pretty much the same as limits of coverage.py". **[docs]** Its fallback hash differs from git's blob id for UTF-8, CRLF and form-feed files, so two hash definitions share one key space. **[exp]** |
| Wallaby (docs for v3, CLI 1.0.28, closed source) | Per test. Hashing method not disclosed. **[docs]** | "Runs only the tests actually affected, often just a single test", including file-loading chains; `ignoreFileLoadingDependencyTracking` narrows this to tests "directly using affected files exported functionality". **[docs]** Mechanism undisclosed, presumably per-test runtime coverage. **[inf]** | On startup shows cached results "for unchanged test files and their dependent source files", then re-executes them "in the background to verify they're still valid". A change not linked to any code reruns all tests, except that the default is `false` for Jest and Vitest (`runAllTestsWhenNoAffectedTests`). **[docs]** | With Vitest, a changed fixture or other non-code file reruns nothing by default. Config is read once at start; changes need a restart. **[docs][inf]** |
| Jest 30.5.2 | **No result reuse.** `perf-cache-<id>` keeps `{duration, failed}` per test path, for ordering only. Transform cache key = sha1(content, config string, instrument flag, filename, transformer key, Node version when stripping types). **[src]** | `--findRelatedTests`: reverse walk over haste-map deps found by regex (`import`, `require`, literal `import()`), plus sibling `__mocks__`. A `.snap` path maps to its test via the snapshot resolver. `--onlyChanged`/`--changedSince`: git file lists (`diff --name-only <since>...HEAD`, `diff --cached`, `ls-files --other --modified --exclude-standard`) fed into the same walk. **[src]** | Paths that no longer exist are dropped (`hasteFS.exists`), so a deleted file selects nothing. **[src]** | Non-literal requires, `fs` reads, deleted files. **[src][inf]** |
| Vitest 5.0.3 | **No result reuse.** `results.json` key is `project:relative/path`, value `{duration, failed}`, for ordering only; no content in the key. **[src][exp]** Experimental `fsModuleCache` transform key = sha1(id, content, env hash of config, plugin names, config-file contents, `NODE_ENV`, Vitest version). Whole cache dropped when the *installed* lockfile hash changes (`node_modules/.package-lock.json`, `node_modules/.pnpm/lock.yaml`, ... plus `patches/` mtime). **[src]** | `related`: per project, reverse walk over `transformRequest` `deps` + `dynamicDeps`, skipping `node_modules` and non-existent paths. Uses transforms, not execution. `--changed`: same git commands as Jest. **[src]** | `forceRerunTriggers` (default `**/package.json`, `**/{vitest,vite}.config.*`, plus `setupFiles`, `snapshotSerializers`, `diff`) select the whole suite. **[src]** | Not selected by `related`: a fixture read with `fs`, the test's `.snap` file, a module imported only by a setup file. A template-literal `import()` is over-approximated to the whole directory. **[exp]** Bails out of `fsModuleCache` on `import.meta.glob`. **[src]** |
| Bazel 9.2.0 | Per test target. Action key = digest of `Action` {Command digest (argv, env vars, output paths), input-root Merkle digest, platform, timeout, salt}. **[src: REAPI proto]** File digests cached by (path, inode, ctime, mtime, size). **[src]** | Declared in BUILD files; sandbox enforces hermeticity. **[docs]** | `--cache_test_results=auto` reruns if inputs changed, tag `external`, `--runs_per_test`, or "the test previously failed". **[src]** | Non-hermetic tests (undeclared files, env, network) get false hits; a flaky pass is cached. **[docs][inf]** |
| Nx 23.2.1 | Per task (project:target). Hash instructions: project file sets (`inputs`), workspace files, project config, tsconfig, external deps (lockfile integrity hash or version), runtime commands' output, env vars, cwd, args, dependency task outputs. File hash = xxh3 of content, skipped when an mtime-keyed archive matches. **[src]** | Project graph plus `inputs`/`namedInputs`. **[docs]** | Successes cached; failures only with `NX_CACHE_FAILURES=true`. Cache at `~/.nx/<id>/cache` shared by the main checkout, every worktree and other clones; id from Nx Cloud id or git remote. LRU over `maxCacheSize` (default 10% of disk, max 10 GB); entries kept a week. **[src][docs]** | Inputs too narrow give false hits; too wide give misses. **[inf]** |
| Turborepo 2.11.7 | Per task (package#task). xxh64 over capnp of: global hash (global files, root lockfile closure, env, flags, passthrough args), package file hashes, external deps hash, dependency task hashes, env, outputs config, command override. **[src][docs]** | Package graph; default inputs = all git-tracked files in the package. **[docs]** | File hashes are git blob ids from `ls-tree`/index for clean files; only dirty and untracked files are rehashed. Only successful runs are saved (`only_successful_task_runs_save_outputs`). Linked worktrees automatically use the main worktree's `.turbo/cache`. **[src][docs]** | Replicates CRLF normalization so manual hashes match git, but handles only the root `.gitattributes` and not `eol=`. Outputs containing absolute worktree paths leak between worktrees. **[src][docs]** |

Cross-cutting **[inf]**:

- No JS test runner reuses test *results*. Jest and Vitest persist only ordering hints. Reuse across checkouts exists only in build systems, at task granularity, and is always keyed by content, never by commit SHA.
- Two production tools already share one result cache across git worktrees (Turborepo, Nx). Squeal's shared-store model has precedent.
- Every tool that reuses results keys on environment too, and treats installed dependencies as an input (lockfile or installed metadata).
- Build caches do not serve failures by default. Bazel reruns previously failed tests. Wallaby serves cached results but verifies them in the background.

### F2. Commit SHA vs closure content hash vs hybrid (Q2) **[inf]**, probes **[exp]**

| Concern | Key = commit SHA | Key = content hash of closure | Hybrid: content key, commit as provenance |
|---|---|---|---|
| Uncommitted edits | Cannot represent them. Must invalidate everything or lie. | Exact. | Exact. |
| Worktrees on different commits | Nothing shared, although most files are identical. | Shared wherever the closure is identical. | Same as content. |
| Rebase, amend | New SHA, everything stale. | Survives unless closure content changed. | Same as content. |
| Generated, gitignored files | Invisible. | Covered if in the closure; must hash bytes (no index oid). | Same as content. |
| Env and installed deps | Not covered. `node_modules` is gitignored and per worktree. | Not covered unless added explicitly. | Explicit env component in both. |
| Snapshot files | Covered if committed. | Covered only if added to the closure; not in the module graph **[exp]**. | Same as content. |
| Cost | Free. | Per-file hashes nearly free from the git index; closures about 0.1 ms each **[exp]**. | Same as content. |
| Human explanation | Easy. | Needs provenance. | Provenance carries the commit. |

### F3. Cost and correctness of git-index hashes **[exp]** (Node 24.21.0, git 2.43.0, Linux, warm cache)

- Nx repo, 10,719 files: `git ls-files -s` 24 ms, `git status` 64 ms, `lstat` all 54 ms, read and blob-hash all in Node 297 ms. Vitest repo, 3,146 files: 9 / 16 / 18 / 107 ms.
- A fresh `git worktree add` at the same commit has identical oids for 10,719/10,719 files. Its first `git status` takes 235 ms (index refresh).
- The index oid is **not** the hash of the bytes on disk for files with eol attributes: 2 of 10,719 in Nx (`gradlew.bat`), 1 of 3,146 in Vitest (`eol=crlf`), while git reports the tree clean.
- Recomputing 5,000 closure hashes of about 300 files each: 0.5 to 0.6 s in total.

### F4. Store size (Q5) **[exp]**, model assumptions **[inf]**

Model: 5,000 tests in 500 test files, 50 revisions a day, each revision re-keys 10% of test files, 2% of results fail with about 2 KB of message and stack. SQLite via `node:sqlite`.

| Layout | 1 day | 30 days | Pruned to newest key per test file |
|---|---|---|---|
| Closure members (path, oid) stored for every key | 72 MB | 1.8 GB | 10.4 MB |
| Closure path list kept only for the newest key per test file | 14 MB | 148 MB (about 4.6 MB/day, mostly result rows) | 7.5 MB |

## Recommendation for Squeal

**R1. Key by content, record the commit as provenance.** A stored result is current for check C in worktree W if and only if `result.key == key(C, W)`. Commit SHA, dirty flag, revision and worktree id are stored next to the result and shown to agents. They are never part of the key.

**R2. Three hash levels.**

- *File hash*: git blob id of the bytes on disk, `sha1("blob <len>\0" + bytes)` (SHA-256 in `objectFormat=sha256` repos). Take it from `git ls-files -s` only when git reports the file clean and no eol or filter attribute applies; otherwise hash the bytes. Use one definition everywhere; testmon shows what mixing two costs.
- *Environment hash*, per Vitest project and worktree: Squeal adapter version, Vitest version, Node version, platform and arch, resolved config plus contents of config files and their imports, the setup-file closure, the installed-dependency fingerprint (Vitest's `getLockfileHash` approach: installed lockfile metadata plus `patches/`), allow-listed env vars, CLI args.
- *Check key*: `sha256(envHash, checkId, sorted (path, fileHash) over the closure)`. Closure = test file, its transitive static and dynamic imports from Vitest's graph, its snapshot file(s), and declared extra inputs (fixtures). One key per test file; its tests share it.

**R3. Incremental update.** Keep an in-memory stat cache `path -> (mtime, ctime, size, inode, oid)`, as Bazel, Nx and the git index do. On a watcher event, re-stat; rehash only if stat changed. Keep a reverse index `path -> test files` and recompute only those keys (about 0.1 ms each). A file add or delete re-resolves the closures of nearby importers and glob imports, because resolution can change without any closure file's content changing (a new `foo/index.ts` shadowing `foo.ts`).

**R4. New worktree bootstrap is a lookup.** One `git ls-files -s` plus `git status` (about 100 to 250 ms for 10k files) yields every file hash. Take the newest recorded closure path list for each test file from the shared store, compute keys, look them up. Hits are current with no run. This holds because a closure is a function of its files' contents, resolver config and file existence; R3 covers the existence case.

**R5. Store failures too, rerun them first.** Unlike Turborepo and Nx, Squeal reports state, so a reused failure is real information. Reused results carry their origin (worktree, revision, commit). The scheduler still reruns inherited failures at priority 1, matching the vision and Bazel's rule. Whether inherited passes also get Wallaby-style background confirmation is a policy choice (open question 3).

**R6. Unknown closure (Q4).** State is `unknown`. Never borrow a result by commit SHA or file path alone. In order of preference:

1. Compute the closure statically. Vitest 5.0.3's `related` builds it from `transformRequest` without running tests **[src]**; the vitest-internals topic should confirm the cost.
2. Fallback key for uncollected checks: environment hash plus a whole-workspace hash (HEAD tree oid if clean, plus a hash of the dirty set, as in Turborepo's dirty hash). A result under this key is reusable only by a worktree in exactly the same full state, which still covers "new clean worktree on main's commit".
3. Once collected, re-key under R2 and drop the fallback entry.

**R7. Pruning (Q5).** Store the closure path list per test file once, not (path, oid) per key: this alone is about 12x smaller. Keep results whose key is current in any live worktree, plus the newest result per check on the main worktree. Drop other keys after 7 days (Nx's default) and everything owned by removed worktrees. Deduplicate failure text by fingerprint. Add a size cap with LRU eviction as a backstop, as Nx does. Expected steady state for the F4 model: about 40 MB (7 days at 4.6 MB/day plus a 7.5 MB baseline).

## Open questions

1. Runtime file reads (fixtures via `fs`) are invisible to testmon, Jest, Vitest and, with Vitest, to Wallaby's default. Declared input globs in config, or a coarse rule such as "any non-code change under `test/` re-keys the project"?
2. Node version granularity in the environment hash: full version (safe, more misses) or major.minor (testmon drops patch versions)?
3. Should an inherited pass be reported as current at once, or as `stale` until confirmed in the background as Wallaby does? This trades speed against the vision's "stale result escape rate".
4. Cost of detecting eol and filter attributes (`git check-attr` per path at startup) was not measured.
5. Per-test closures from coverage (testmon) would be more precise than per-file closures. Worth it after v1?
6. Template-literal `import()` and `import.meta.glob` make a closure depend on directory contents. R3's add/delete rule must cover them; not verified.

## Sources

Source code, pinned to the versions read:

- testmon v2.2.0: https://github.com/tarpas/pytest-testmon/tree/v2.2.0/testmon (`testmon_core.py`, `process_code.py`, `db.py`, `common.py`, `pytest_testmon.py`)
- Jest v30.5.2: https://github.com/jestjs/jest/tree/v30.5.2/packages (`jest-core/src/SearchSource.ts`, `jest-resolve-dependencies/src/index.ts`, `jest-changed-files/src/git.ts`, `jest-transform/src/ScriptTransformer.ts`, `jest-test-sequencer/src/index.ts`, `jest-haste-map/src/lib/dependencyExtractor.ts`)
- Vitest v5.0.3: https://github.com/vitest-dev/vitest/tree/v5.0.3/packages/vitest/src/node (`specifications.ts`, `vcs/git.ts`, `cache/results.ts`, `cache/fsModuleCache.ts`, `config/resolveConfig.ts`), `src/defaults.ts`, `docs/config/changed.md`, `docs/guide/cli.md`
- Bazel 9.2.0: https://github.com/bazelbuild/bazel/blob/9.2.0/src/main/java/com/google/devtools/build/lib/analysis/test/TestConfiguration.java, https://github.com/bazelbuild/bazel/blob/9.2.0/src/main/java/com/google/devtools/build/lib/vfs/DigestUtils.java
- Remote Execution API (main, retrieved 2026-10-03): https://github.com/bazelbuild/remote-apis/blob/main/build/bazel/remote/execution/v2/remote_execution.proto
- Nx 23.2.1: https://github.com/nrwl/nx/tree/23.2.1/packages/nx/src (`native/tasks/types.rs`, `native/tasks/hashers/*.rs`, `native/workspace/files_hashing.rs`, `native/hasher.rs`, `tasks-runner/task-orchestrator.ts`)
- Turborepo v2.11.7: https://github.com/vercel/turborepo/tree/v2.11.7/crates (`turborepo-scm/src/{package_deps,repo_index,crlf,worktree}.rs`, `turborepo-hash/src/{lib,traits}.rs`, `turborepo-config/src/lib.rs`, `turborepo-task-executor/src/exec.rs`)

Official docs:

- testmon: https://testmon.org/blog/determining-affected-tests/
- Wallaby: https://wallabyjs.com/docs/, https://wallabyjs.com/docs/config/overview.html, https://wallabyjs.com/docs/features/streaming-caching/
- Bazel: https://bazel.build/reference/test-encyclopedia, https://bazel.build/remote/caching
- Nx 23.2.1 docs in repo: `astro-docs/src/content/docs/concepts/how-caching-works.mdoc`, `kb/change-cache-location.mdoc`, `reference/nx-json.mdoc`, `reference/environment-variables.mdoc`
- Turborepo 2.11.7 docs in repo: `apps/docs/content/docs/crafting-your-repository/caching.mdx`, `reference/watch.mdx`

Probes (throwaway): `probes/result-fingerprinting-prior-art/` with `hash-cost.mjs`, `testmon-fsha.py`, `store-size.mjs`, `vitest-related-gaps.sh`, `results.txt`.
