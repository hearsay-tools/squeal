# Research: result-import (row 018-02)

Researcher, 2026-10-31. Source read at commit `6053220eb` (Squeal 0.1.387, `KEY_FORMAT_VERSION` 20, Vitest adapter version 3). Experiments ran Squeal 0.1.387 (the installed plugin) on a seven-file Vitest 5.0.3 fixture, Node v24.22.1, pnpm 12.15.0, Linux x64, load 8 to 11 on 24 CPUs. Probes: `probes/result-import/` (throwaway). Tags: **[exp]** verified by experiment, **[docs]** read in official docs, **[src]** read in source code, **[inf]** inferred.

## Questions answered

| # | Question | Answer |
|---|---|---|
| 1 | Are keys portable? | Yes for path, user, HOME, pnpm store, clone depth and file mode: 7 of 7 keys equal **[exp]**. No when Node's patch version, `CI=true`, `core.autocrlf` or install staleness differ: 0 of 7 equal **[exp]**. A linked worktree and a plain clone differ for test files that read `.git` (1 of 7 here, 9 of 1,557 in this repository) **[exp]**. In this repository, CI's settings (Node 22.19 and a floating 24, `CI=true`) match no developer key today **[src][inf]**. |
| 2 | What "imported" means for the agent | A result at the key the local daemon computed is `current` by the existing rule, as an inherited result is today **[src]**. It needs its own origin ("imported from CI run R at commit C, Node V") **[inf]**. Turborepo names the source of a hit; Nx treats a remote hit like a local one **[docs]**. |
| 3 | Which results to trust | Only runs on pushes to the default branch of the same repository. Every tool's guidance is "only CI or protected branches write" **[docs]**. The local daemon recomputes each key itself, so an import cannot attach a result to other content; the remaining risk is a false pass at a true key **[src][inf]**. |
| 4 | When to import | Applying one main commit's export takes about 0.4 s locally (0.14 s parse, 0.26 s insert) **[exp]**, plus the download (topic `remote-store`). Best fit: in the background at daemon start and when `HEAD` moves, plus on demand; never on a hook's path **[inf]**. |
| 5 | Format and size | One main commit: 1,358 test files, 11,881 results, 29.6 MB as JSON, 1.6 MB gzipped. Closures are 60% of it. No run logs needed **[exp]**. |
| 6 | Existing rules | Both sides need the same `KEY_FORMAT_VERSION` and adapter version **[src]**. Imported failures fit the held-failure rule **[src][inf]**. Under `lookup-only` an import is only more data to look up and queues nothing **[inf]**. |

## Findings

### Q1. Key inputs and portability

**Inputs, from source [src]** (`src/core/keys/environment.ts`, `check-key.ts`, `dependencies.ts`, `packages.ts`, `closure.ts`, `observed.ts`, `src/runners/vitest/environment.ts`, `src/core/hash/git-index.ts`). "Machine" marks an input that can differ between two machines with the same commit.

| Input | Where | Machine? |
|---|---|---|
| Encoding tags, `KEY_FORMAT_VERSION`, runner name and version, adapter version | environment hash | Only through the Squeal release and the installed Vitest |
| `process.version` (full, e.g. `v24.22.1`) | environment hash | **Yes** |
| `process.platform`, `process.arch` | environment hash | **Yes** (by design: native packages differ) |
| Installed-dependency fingerprint: pnpm `node_modules/.pnpm/lock.yaml` or npm's hidden lockfile, without the project's own versions, plus the bytes of `patches/` | environment hash | Only through what is installed. **Yes** for staleness: a package folder with an mtime newer than the lockfile switches the fingerprint to a folder scan (`pnpm-install.ts:117-170`) |
| Variables in policy `env.allowlist` (default empty) | environment hash | Only when the user lists one |
| Resolved Vitest config (`serializedConfig` without `sequence.seed`, injected env, `disableColors`, `isAgent`, `maxWorkers`), strings with the worktree root made relative | environment hash | **Yes** through `CI`. An absolute path outside the worktree also stays absolute |
| Config files and setup-file closures, by git blob hash | environment hash | No |
| Project name, test path | check key | No |
| Per-package segment: `location@version#integrity`, locations relative to the install | check key | No |
| Closure: static imports, snapshot files, declared `inputs`, observed runtime reads | check key | Through the observed set, which is per store (`meta`, merged, never pruned) |
| File hash: git blob id of the bytes on disk; the index oid only for clean files without converting attributes, and never with `core.autocrlf` on | check key | **Yes** for line endings |
| `.git` entry, keyed by its kind (directory or file), not its bytes (`gitEntryByKind`) | check key, when observed | **Yes**: a clone has a directory, a linked worktree a file |

Not in any key: the absolute root, the user, HOME, the working directory, the commit, clone depth, file mode, the Squeal release, and the pnpm store path.

**Experiment [exp].** Clone A of the fixture at `$TMPDIR/result-import/a/fixture`. Each variant is a fresh clone, an offline install, `squeal start`, `squeal run --all --wait`, `squeal stop`, then the keys read from a copy of the store. The fixture's seven test files cover a pure import, an installed package (acorn), a runtime file read, a snapshot, a read of `.git`, HOME and cwd, and a child process.

| Variant against A | Equal keys | Why |
|---|---|---|
| Other path, deeper, other directory name | 7/7 | Paths are relative everywhere |
| Shallow clone (`--depth 1`) | 7/7 | History is not an input |
| Other OS user (`squeal-e2e`), own HOME, own pnpm store, install from the registry, same Node binary | 7/7 | No user or store path enters |
| `chmod +x` on a closure file (dirty in git) | 7/7 | The blob hash holds no mode |
| Linked worktree of A (same store) | 6/7 | `test/gitentry.test.ts` differs: `.git` is a file there |
| `core.autocrlf=true` | 0/7 | Bytes on disk are CRLF, and the config file is in the environment hash |
| `CI=true` | 0/7 | Vitest changes `allowOnly` (true to false), `snapshotOptions.updateSnapshot` (`new` to `none`), `browser.headless`, `browser.ui`, `browser.screenshotFailures` (`serialized-config.mjs` diff) |
| Node v24.21.0 | 0/7 | Full `process.version` |
| A package folder touched after install | 0/7 | Status note: "`lock.yaml` does not describe the installed packages"; the fingerprint changes |

`test/machine.test.ts` reads HOME and cwd, and its key was equal for both users. A result that depends on such a value is a false hit across machines. This is the known incomplete closure (decision 0002), not new.

**This repository [src].** `.github/workflows/ci.yml` (last changed `9958710a9`) runs the sharded suite on Node `22.19` and the nightly suite on `node-version: 24`, which floats. GitHub Actions sets `CI=true`. Developers here run Node v24.22.1. So even with Squeal in CI, no CI key would equal a local key today **[inf]**. In the store copy, 9 of 1,557 test files observe `.git` (for example `test/daemon/drain.test.ts`, `test/kit/vitest.test.ts`); they would not match between CI's clone and an agent's linked worktree **[exp]**. CI also runs `vitest` directly, so it computes no keys today (topic `ci-run`).

**The closures must travel too [src].** A daemon computes a key from the closure list stored for the test file (`test_files.closure_paths` plus the `observed.<project>` map). A fresh clone has no store, so it has no closure to key with until it runs the file. The fixture clones got equal keys only because each one ran its tests first. An export must carry the closure lists and observed sets, or it is useless to a fresh clone. It is still useful to a store that already knows the closures.

**Smallest changes for the same toolchain, with their cost [inf]:**

1. `CI`. Two options. (a) An import accepts a CI result whose environment differs from the local one only in those five fields, and only for passes and skips. A CI pass under `allowOnly: false` and `updateSnapshot: none` implies no `.only` and a snapshot that exists and matches, so the same content passes locally too. False hits: none found by this reasoning, for non-browser projects. A CI failure can be a local pass (a missing snapshot, a `.only`), so a failure must not import as current. (b) Run Squeal in CI with `CI` unset. That needs no Squeal change, but it gives up Vitest's CI guards; that is for topic `ci-run` to weigh.
2. Node version. Either the project pins one Node for CI and developers (`node-version-file`), which needs no change in Squeal, or Squeal keys Node by major or major.minor. A coarser key adds false hits when a patch release changes behaviour. Spec 001 chose the full version because it "can only cost misses, never a wrong hit" (`environment.ts:103-106`).
3. `.git` by kind. Keep it. Squeal's own tests tell a clone from a worktree, so a shared kind would give false hits. It costs 9 of 1,557 files here.
4. Line endings and staleness. Keep them. Different bytes are different content. CI that caches the pnpm store, not `node_modules` (this repository's `cache: pnpm`), installs fresh, so the install is not stale.

### Q2. What "imported" means for the agent

The validity rule is one line: a check is `current` when its result's key equals the key the worktree computed (`src/core/state/derive.ts:65-75`) **[src]**. Today a result from another worktree is already `current`, with origin `{kind: "inherited", worktreeId, commit}`. `status --full` prints it as "Inherited from other worktrees: 13 current results ... from `<root>` at 73828ce" (fixture, linked worktree) **[exp]**. An imported pass at the local key is the same content and environment as far as the key can tell, so principle 2 lets it be `current` **[inf]**. The worktree id and the root mean nothing for a CI result. It needs a third origin kind naming the source (CI provider and run id or URL), the commit, and the machine (platform, arch, Node), shown where "inherited" is shown today (`status --full`, `why`, failure provenance) **[inf]**.

Prior art. Turborepo logs `cache hit, replaying logs <hash>`, and its run metrics carry "Cache hit/miss status and source" per task **[docs]**. Nx: a remote hit "behaves like a local cache hit without running the task again" **[docs]**. Nx caches only successes unless `NX_CACHE_FAILURES=true` (`001-core-loop/research/result-fingerprinting-prior-art.md` F1) **[src][docs]**.

Imported failures, three options. Notify: this goes against principle 1 when the failure is not the agent's, and a CI failure can be a local pass (Q1, `CI`). Ignore. Hold: today's rule for an inherited failure under `lookup-only` is to hold it and queue the file once for a local confirming run, and `why` says "Inherited FAIL from `<worktree>` at `<commit>`, being confirmed" (011 C4, row 011-159) **[src]**. Hold fits without a new rule. Main seldom fails: the export measured in Q5 holds 0 failures **[exp]**.

### Q3. Which results to trust

Prior art **[docs]**:

- Turborepo signs artifacts with HMAC-SHA256 when `remoteCache.signature: true` and `TURBO_REMOTE_CACHE_SIGNATURE_KEY` are set; "Any artifacts that fail to verify will be ignored and treated as a cache miss". It has `--cache=local:rw,remote:r` for read-only clients.
- Nx Cloud: "use read-write tokens only on protected branches"; on other branches "a read-only token reads the shared cache and writes to a cache isolated to that run, so a pull request can't change what main restores". It names CREEP (CVE-2025-36852), where an untrusted pull request writes an artifact that a trusted build later restores. Entries are immutable.
- Bazel: "Take care in who has the ability to write to the remote cache. You may want only your CI system to be able to write"; `--remote_upload_local_results=false` makes a client read-only.
- Gradle 9.8.2: "your continuous integration server populates it from clean builds while developers only load from it" (`isPush = isCiServer`).

**For Squeal [inf].** A poisoned result is a pass recorded for a key whose test fails. The local daemon computes every key itself and takes only results at its own key. So a forged export cannot make a pass stand for other content. It can only lie about the outcome at a real key. The cost is a hidden failure that stays hidden until the closure changes, or until a full run. "What merges to main" gives the rule the tools share: take only results produced by a workflow run triggered by a push to the default branch of the same repository, never by `pull_request` runs, and fork runs least of all. Whether the transport can prove that (GitHub run metadata, artifact attestation, a signature) belongs to topic `remote-store`. A signature such as Turborepo's is needed only where the store is not GitHub itself.

### Q4. When to import

- Applying one export (11,881 results, 11,881 checks, 1,358 closures, 1.46 MB gzipped) into an empty store with the real schema took 0.40, 0.40 and 0.39 s in three runs: 0.13 to 0.16 s parse, 0.25 to 0.27 s insert (`import-time.mjs`) **[exp]**. The download time is topic `remote-store`'s, and so is today's baseline lookup time.
- Worktrees of one clone already share the store, so an import gains nothing there. It gains in a fresh clone, on a teammate's machine, and on main commits that no local worktree has run **[inf]**.
- Triggers. Daemon start and a `HEAD` move (pull, fetch plus checkout) are the events where main's results become relevant. Squeal already sees both. On demand covers the rest. A hook process must never wait on a download (principle 3). The baseline lookup goes first, and imported results arrive later as one more lookup, as inherited results do today **[inf]**.

### Q5. Format and size

From a copy of this repository's store (`.git/squeal/store.sqlite`, 1.3 GB, 1,826,446 results, plus 446 MB of run logs), read only: the export of the current keys of this worktree at main `6053220eb` (`export-size.mjs`) **[exp]**:

| Part | Rows | JSON | gzip |
|---|---|---|---|
| Keys (project, path, key) | 1,358 | 0.20 MB | 0.06 MB |
| Results (outcome, duration, location, fingerprint, failure id, commit, time) | 11,881 (11,857 pass, 24 skip) | 4.16 MB | 0.28 MB |
| Checks (names, locations) | 11,881 | 3.88 MB | 0.37 MB |
| Failure texts | 0 | 0 | 0 |
| Closure lists | 1,358 | 17.82 MB | 0.74 MB |
| Observed maps (`observed`, `observedDirect`, `observedModules`) | 3 | 3.55 MB | 0.15 MB |
| **All** | | **29.6 MB** | **1.6 MB** |

The results "of" main `6053220eb` were recorded at many commits (5,809 at `20f31004e`, 2,471 at `fff846aca`, and so on), because keys are content. An export for a commit is "the results at the keys that commit's tree gives", not the results tagged with that commit **[exp]**. Run logs, `known_states`, transitions, consumers, revisions and file hashes are local state and stay out **[src]**. Coverage records (`code.sqlite`, 3.6 GB) were not measured.

### Q6. Relation to existing rules

- `KEY_FORMAT_VERSION` and the adapter version are in every environment hash, so CI and a developer must run Squeal releases with the same key format. The formats in `KEY_FORMATS_READ_AS_ONE` (13 to 19) widen that **[src]**. "Results survive releases" (row 011-35) is what makes this workable: a release seldom raises the format. A raise leaves every export unusable until CI runs at the new format **[inf]**.
- Held failures (001 D6, 011 C4, row 011-159): an imported failure fits as a held one **[src][inf]**.
- `baseline.onStart: lookup-only`, "lookup only means lookup only" (the human, 2026-10-20): an import adds results to look up and queues nothing, apart from the confirmation run the held rule already allows **[inf]**.

## Recommendation for Squeal

Importing results is sound in principle and fits the model as it is. A result keyed on CI is valid locally exactly when the key the local daemon computes equals the key CI computed. Paths, users, HOME, the pnpm store and clone depth do not stop that (verified). In practice keys match only when CI and the developer use the same Node patch version and the same `CI` setting. Neither holds in this repository. So the work has three parts: make the environments meet (pin Node; treat a CI pass as valid across the five `CI` fields, for passes only), ship the closures with the results, and add an "imported" origin beside "inherited". Import only from pushes to the default branch. Import passes and skips as `current`. Import failures as held. Never block a hook on the import. Without Node pinning the feature gives nothing, so the first check is whether the human accepts that requirement.

## Open questions for the human

1. **Same Node everywhere?** Shared results work only when CI and developers run the same Node version, down to the patch number (24.22.1 is not 24.21.0). Today this repository's CI uses 22.19 and "the latest 24", and developers use 24.22.1. Do we ask projects to pin one version, or should Squeal accept results from the same major Node version, at some risk of a wrong pass?
2. **CI's stricter settings.** On CI, Vitest refuses `.only` and refuses to write new snapshots. That changes every key. May Squeal treat a CI *pass* as valid on a developer's machine despite this? (A pass under the strict settings implies a local pass.)
3. **CI failures.** If main's CI recorded a failure, should a developer's agent see it as a failure to confirm locally (today's rule for failures from other worktrees), or not see it at all?
4. **Trust.** Is "only runs triggered by pushes to main in this repository" trust enough, or must results also be signed?

Not determined: macOS and Windows (not tested; platform and arch are in the key, so they never match Linux CI, by source); npm's hidden-lockfile path across machines (read in source only: identities hold relative locations, so it should match like pnpm's); Nx's exact terminal wording for a remote hit (the fetched pages do not show it).

## Sources

- Squeal source at `6053220eb`: `src/core/keys/environment.ts`, `check-key.ts`, `key-format.ts`, `dependencies.ts`, `packages.ts`, `pnpm-install.ts`, `closure.ts`, `observed.ts`, `runtime-files.ts`; `src/runners/vitest/environment.ts`; `src/core/fs/worktree-paths.ts`; `src/core/hash/git-index.ts`; `src/core/store/schema.ts`; `src/core/state/derive.ts`; `src/core/delivery/provenance.ts`; `.github/workflows/ci.yml`; `docs/specifications/011-core/spec.md` C4; `docs/decisions/0002-content-keyed-shared-store.md`.
- Probes: `probes/result-import/` (`make-fixture.sh`, `run-clone.sh`, `run-variant.sh`, `other-user.sh`, `serialized-config.mjs`, `dump-keys.mjs`, `compare.mjs`, `export-size.mjs`, `import-time.mjs`). The clones, store copies and fetched pages lived under `$TMPDIR` and were removed.
- Turborepo docs (3.0), retrieved 2026-10-31: https://turborepo.com/docs/core-concepts/remote-caching, https://turborepo.com/docs/reference/configuration (`remoteCache.signature`, `errorsOnlyShowHash`, run metrics), https://turborepo.com/docs/reference/run (`--cache`).
- Nx docs (v24, page updated 2026-10-30), retrieved 2026-10-31: https://nx.dev/docs/concepts/ci-concepts/cache-security, https://nx.dev/docs/features/ci-features/remote-cache, https://nx.dev/docs/concepts/how-caching-works.
- Bazel docs, retrieved 2026-10-31: https://bazel.build/remote/caching ("Read from and write to the remote cache", "Known issues").
- Gradle 9.8.2 docs, retrieved 2026-10-31: https://docs.gradle.org/current/userguide/build_cache.html.
- Earlier research extended here, not repeated: `docs/specifications/001-core-loop/research/result-fingerprinting-prior-art.md`.
