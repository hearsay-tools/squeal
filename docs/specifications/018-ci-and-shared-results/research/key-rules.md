# key-rules: the two key rules that cost matches in the import trial (row 018-15)

Researcher bc47fd69 for spec 018, 2026-11-09. Brief: `tasks/wave-4.md`, topic `key-rules` in `README.md`. Squeal source read at `fdb16d0f6` (package version 0.1.419). cezarion read at `721c19b0` (the export's commit) and its main commits 20 before and 6 after, with `git ls-tree`/`cat-file` only. Store: a copy of cezar's `store.sqlite` with `-wal` and `-shm`, taken 2026-11-09 12:20:25Z to 12:20:38Z while cezar's daemons ran (3,783,974,912 bytes plus a 1,916,244,992-byte WAL); the live store was only read by `cp`. Export: CI run 42596322864 (`squeal-results/1`, key format 21, 1,716 test files). Node v24.22.1. Host load was 25 to 38 on 24 vCPUs, so I measured no times. No daemon was started and no clone was made. Probes: `probes/key-rules/` (throwaway). Tags: **[exp]** verified by experiment, **[src]** read in source code, **[docs]** read in official docs, **[inf]** inferred.

## Questions answered

| # | Question | Answer |
|---|---|---|
| 1a | What else in the node:test environment is machine-specific | Only `execPath` for cezar's config. Also machine-specific when a user writes them: an absolute `node`, and paths inside `argv` or `env` values, which are keyed as text. Everything else is relative or a content hash **[src][exp]** |
| 1b | Can keying by `process.version` plus platform and arch give a wrong pass | Yes, in principle: two builds of one version can differ by configure options (`--without-intl`, `small-icu`, `system-icu`) and by bundled or system libraries. `process.versions` and `process.config` show this, and the path does not. Keyed with them, two copies of one build at different paths are equal **[docs][exp]** |
| 1c | What the change costs | A one-time re-key of every node:test result. In cezar: 126 files, 573 s of summed file time at the main checkout's keys. In this repository: none (no `nodeTest` project). Vitest and pytest keys do not move **[exp][src]** |
| 2a | What the union adds over a file's own run | For 271 of 1,716 exported files, the shared union holds paths that CI's own run did not read. For 241 of them, these paths change the key. CI's run read no path that the union lacks (0 of 1,716 files) **[exp]** |
| 2b | Accept when local list ⊇ exported list and extras are union paths only | Matches all 1,589 Vitest files at the export's commit (today: 1,353). Safe at that commit. Not safe in general: at nearby commits it accepts 6 to 22 files per commit that today's rule runs again (about 1.5%) **[exp]** |
| 2c | Key a result by its own run's observed set | The same matches and the same exposure as 2b. It also needs a stored list per result and several candidate keys per lookup **[exp][src][inf]** |
| 2d | Prune the union | Pruning absent paths gives 0 more matches (absent paths enter no key), and at most 5 from listings. No per-path time or run is stored, so an age rule cannot be measured. Pruning down to the last run is 2c **[exp][src]** |
| 2e | A fourth option the data shows | Re-key CI's results at import under the local closure list and the export commit's blob ids (Squeal's file hashes are git blob ids). This matches all 1,589 at the commit in a fresh clone, and has the same exposure as today **[exp][inf]** |

## 1. node:test and `execPath`

**What is keyed** **[src]**. `projectEnvironment` (`src/runners/node-test/adapter-environment.ts:61-95`) puts into `resolvedConfig`: `node` (the config text, default `"node"`), `execPath` (relative when inside the worktree, else absolute, line 70), `argv`, `env` entries, `cwd` (relative), `include`, `exclude`, the coverage marker. Then `runnerVersion` is the probe's `process.version`, and `files` are the preloads (relative paths and blob ids). The core adds `nodeVersion`, `platform` and `arch` from the **daemon's** process (`src/core/keys/environment.ts:45-47`), `installedDependencies`, the allow-listed env, and `ci` (`environment-descriptor.ts`).

**Which fields depend on the machine** **[exp]**. `probes/key-rules/node-env.ts` runs Squeal's own `probeNode` and `projectEnvironment` twice. The first run uses nvm's `v24.22.1/bin/node`. The second uses a copy of the same binary at `$TMPDIR/…/opt/hostedtoolcache/node/24.22.1/x64/bin/node` (the CI layout). With `node` unset and the copy first on the daemon's PATH, as in cezar's config, **only `execPath` differs**. `process.versions` and `process.config` are equal (`counts/node-env-path.txt`). With `node` given as a path, `node` differs too (`counts/node-env.txt`). With the directory put in the project's `env`, the whole PATH value is keyed as text. That was a mistake in my first probe run, and it shows that `env` values are keyed as text. In the trial, `installedDependencies`, the env hash and `files` were equal between CI and this host, and `execPath` was the only difference (`import-trial.md` count 1) **[exp]**. Against v24.21.0, `process.versions` and `process.config` both differ **[exp]**.

**Wrong-pass risk of version plus platform plus arch** **[docs][inf]**. Node's `BUILDING.md` at v24.22.1 lists builds of one version with different behaviour: `--with-intl=small-icu` ("only English data is included"), `--without-intl` ("The `Intl` object will not be available, nor some other APIs such as `String.normalize`"), `--with-intl=system-icu`. `doc/api/process.md`: `process.config` "contain[s] the JavaScript representation of the configure options used to compile the current Node.js executable", and `process.versions` lists "the version strings of Node.js and its dependencies" (openssl, icu, tz, unicode, uv, …). So a key with only the version could pass a test on a distro or custom build that fails on another build. The path does not guard this well either. Two builds at the same path (an in-place package upgrade with a new shared OpenSSL) keep the same `execPath` **[inf]**. Keying the probe's `process.versions` and a hash of `process.config` closes the build gap. Two more points:
- The descriptor's `platform` and `arch` are the daemon's. The project's `node` can differ from the daemon's Node, so the probe should report them too **[src][inf]**.
- Still unkeyed, today as after the change: runtime ICU data (`NODE_ICU_DATA`), and flags that a `node` wrapper script adds. `execPath` names the real binary, not the wrapper **[inf]**.

**Cost** **[exp][src]**. A changed node:test descriptor changes each node:test project's environment hash once. Then every stored node:test result is non-current at the next key, in every store. In cezar's store copy, the main checkout's current keys hold 115 `root:test:unit` files (350.8 s summed) and 11 `test:unit` files (222.0 s). This is one rerun per clone. Vitest keys do not move: the change is in the node:test adapter only. This repository has no `nodeTest` project. The alternative with no re-key: the import could treat descriptors that differ only by `execPath` as equal and translate the keys. That needs the same equivalence rule, kept in the importer **[inf]**.

## 2. Observed sets

**Mechanism** **[src]**. A closure is the static closure plus `effectiveObserved(union)` (`keying.ts` `setClosure`). The union `observed.<project>` is "shared by every worktree … merged and never pruned" (`observed.ts:11-16`). A run's own reads are not stored: `record-tier.ts` passes only `growth.add` to `addObserved`, and `runs/<id>/report.json` holds durations and files only (read on cezar's newest run). A result is stored under the key that includes what its run read. A path with no file enters no key segment (`check-key.ts`, task 011-158). A listing path always enters, as a marker when absent (`ABSENT_LISTING`). CI's export holds per file the closure list `E` and CI's own reads `Eo`: one run at one commit from an empty store.

**Count, first step** **[exp]** (`union-extras.mjs`; per file in `counts/union-adds-per-file.tsv`). Here `X` is the union for the file minus `E`, and `M` is `Eo` minus the union.

| Project | Exported | Union adds paths | Of them, key moves | Key equal today | `M` non-empty |
|---|---|---|---|---|---|
| server | 1,166 | 257 | 231 | 935 | 0 |
| web | 390 | 9 | 5 | 385 | 0 |
| contract, api-client | 33 | 0 | 0 | 33 | 0 |
| root:test:unit | 116 | 1 | 1 | 115 | 0 |
| test:unit | 11 | 4 | 4 | 7 | 0 |
| **All** | **1,716** | **271** | **241** | **1,475** | **0** |

The Vitest rows equal the trial's count 2 exactly (server 935 and 231, web 385 and 5), which was measured with Squeal itself about 40 minutes before this copy. So this model matches the daemon. The added paths: 10,530 tracked files, 363 listings of tracked directories, 18 listings of other directories, 1,887 untracked paths, 170 build or `.ai` paths, 51 uuid-named paths. The most common key-moving ones are child-process and worker entries: `packages/cezar/src/runs/transcript-facts-worker.ts` (88 files), `scripts/pi-ci-wait.mjs` (83), `mock-pi-rpc.mjs`, `pi-project-skills.mjs`, `pi-retry-degraded-service.mjs` (81 each), `mock-codex-app-server.mjs` (80) (`counts/union-adds-top-paths.txt`). This is not a recorder blind spot, because CI's run did read these for other files: the worker for 65 files, `pi-ci-wait.mjs` for 72 **[exp]**.

**Does a run's read set vary at equal content?** It can. `transcript-facts-queue.ts` at `721c19b0` creates the worker only when a job starts, inside a `setImmediate` callback (`schedule`, lines 101-111; `start`, line 138). A `stop()` before that callback clears it (`fail`, lines 207-209), and no worker starts **[src]**. So whether a test reads `transcript-facts-worker.ts` can depend on whether the test stops the queue before the next event-loop turn. The union keeps such reads, and a single run can miss them. Whether this happened in the trial, rather than reads from other commits, is not determined, because it needs repeated runs of one file (see open questions).

**Matches per option at the export's commit** (Vitest 1,589; node:test 127 more only once the environment is fixed):

| Option | Vitest files matched | Wrong-pass exposure |
|---|---|---|
| Today (busy store) | 1,353 **[exp]** | baseline |
| a. Superset, extras only union paths | 1,589 **[exp]** | none at this commit; elsewhere see below |
| b. Key by the run's own observed set | 1,589 **[exp]** | as a |
| c. Prune absent paths | 1,353 (at most 5 more, files whose only extras are listings) **[exp][src]** | as today |
| d. Re-key the import under the local list at the export commit's blobs | 1,589 in a fresh clone **[exp][inf]** | as today |

**Exposure at other commits** **[exp]** (`exposure.mjs`, `counts/exposure.json`). For each main commit near `721c19b0`, I took tracked content from `git ls-tree` and listings from tree names. `eqE` counts the files whose `E` content is unchanged: a and b accept these. `eqL` counts the files whose `E` content and union-only path content are both unchanged: d accepts these, and a busy store today accepts at most these.

| Distance from `721c19b0` | Files `eqE` | Files `eqL` | a or b accept, union rule reruns |
|---|---|---|---|
| 1 to 4 after | 1,455 to 1,459 | 1,433 to 1,438 | 21 to 22 |
| 5 to 6 after | 1,153 | 1,137 | 16 |
| 1 to 4 before | 1,458 to 1,553 | 1,449 to 1,547 | 6 to 9 |
| 5 to 20 before | 383 to 574 | 375 to 566 | 8 |

The union-only paths changed most under these accepted files: `packages/web/src/lib/` and `cez-idle.ts` (98 file-commit pairs), `application-update/*.ts` (90), `mock-codex-app-server.mjs` (80), `mock-omp-rpc.mjs` (76). Here is why an accepted file of this kind is a wrong pass only when its read set varies. When every path that CI's run read is unchanged, a deterministic test reads the same paths again. A changed path that only the union names can then matter only through a timing-dependent read like the worker above, or through a read the recorder does not see. The second gap is the same for every option **[inf]**. Note that a fresh clone has this exposure today: the import adds CI's lists where the store has none (`addMissingEntries`), so until local runs grow the union, the clone keys with CI's own sets (`import-trial.md` count 1) **[src][exp]**.

**Option d in detail** **[exp][inf]**. Squeal's file hashes are git blob ids: `package.json` → `d42c73b0…` and `scripts/test-sandbox.mjs` → `ae823d83…`, both in the export's descriptor and in `git rev-parse 721c19b0:<path>`. So an importer that has the export's commit can compute, for each exported file, the key of the **local** list over that commit's blobs (listings from tree names, absent paths as today). It can then store CI's results under that key. The daemon's ordinary lookup accepts them exactly when all paths of the local list match. This is the same condition as a same-key inherit today, so it adds no new trust. It cannot check an untracked path that exists in the worktree but not in the commit (build output): 19 files have such paths in `X`, and 12 have listings of untracked directories. These would miss, as they do today. It needs the commit's tree locally, which is the transport topic's concern.

## Recommendation for Squeal

1. **node:test**: take `execPath` out of the key. Key the project's Node by what the probe already runs: `process.version`, `process.versions`, a hash of `process.config`, and the project Node's own `platform` and `arch`. This fixes the trial's 127 misses (7% of the export) and closes the build gap that `execPath` covers only by accident. The cost is one rerun of node:test files per store (cezar: 126 files, about 10 min of summed file time).
2. **Observed sets**: keep the union for keys. Do not accept on a superset alone, and do not key by the run's own set: both trade the union's guard against timing-dependent reads for 236 more matches at the commit, and they accept 6 to 22 files per nearby commit that the union rule runs again. Get the same matches at the commit with option d: re-key the import under the local list at the export commit's blob ids. Pruning gives no matches. It would only shrink the list text (uuid-named and absent paths), and the size is a separate question.
3. The import's reason text should say "observed set differs" when the static lists agree. `import-trial.md` recommendation 5 already asks for this. Option d makes the case rare.

## Open questions

- Whether cezar's read sets vary between runs at equal content. One file (for example `packages/cezar/src/artifacts/lifecycle.test.ts`) would need 5 to 10 runs in a fresh clone with an empty store each time. Not determined, because it needs a cezar clone, an install and repeated daemon starts, and the host was at load 25 to 38 on 24 vCPUs. Proposed as a later probe.
- Whether the fresh-clone exposure above (a clone keys with CI's own sets until it runs files) is acceptable, or whether the import should also add CI's sets to an existing union. A coordinator's decision **[inf]**.
- Vitest has the same theoretical build gap: its environment has only the daemon's version, platform and arch. Adding `process.versions` to the core would re-key every result of every runner once. That is not proposed here.
- The exposure 6 or more commits after `721c19b0` was not measured: the local refs held only 6 later main commits.

## Sources

- Squeal at `fdb16d0f6` (0.1.419): `src/runners/node-test/adapter-environment.ts`, `src/core/keys/observed.ts`, `src/core/keys/check-key.ts`, `src/core/keys/closure.ts` (`isClosurePath`), `src/core/keys/environment.ts`, `src/core/keys/environment-descriptor.ts`, `src/core/keys/modules.ts`, `src/core/scheduler/keying.ts` (`setClosure`, `addObserved`, `effectiveObserved`), `src/core/scheduler/record-tier.ts` (`recordCompleted`), `src/core/scheduler/revision.ts` (`storeClosures`), `src/core/status/imports.ts` (`reasonOf`), `src/core/store/schema.ts`, `src/core/types/policy.ts`; `docs/specifications/001-core-loop/status.md` (001-132, 001-134).
- cezarion `721c19b0`: `packages/cezar/src/runs/transcript-facts-queue.ts`; tree listings of 26 main commits from `git -C ~/projects/cezar ls-tree` (read only); `squeal.config.json`.
- CI export: `gh run download 42596322864 -R hearsay-tools/cezarion -n squeal-results-721c19b004d5f4453488d2b4e859fd6a6256f97b` (expires 2026-11-16), deleted after use.
- Node.js v24.22.1, retrieved 2026-11-09: https://raw.githubusercontent.com/nodejs/node/v24.22.1/BUILDING.md (sections "Trimmed: small-icu", "Building without Intl support", "Use existing installed ICU") and https://raw.githubusercontent.com/nodejs/node/v24.22.1/doc/api/process.md (`process.config`, `process.versions`, `process.execPath`).
- `research/import-trial.md` counts 1 and 2; probes and outputs in `probes/key-rules/`.
