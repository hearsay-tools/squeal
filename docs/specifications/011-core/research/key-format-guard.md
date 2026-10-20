# Findings: when should a check key change across releases? (011-35)

Brief: `key-format-guard-brief.md`. Examined at `origin/main` 878b35bb (0.1.225, `KEY_FORMAT_VERSION` 16) and `origin/cand/0.1.226` 276ed939 (17). Read-only on the product. Probes and their output are in `probes/key-format-guard/` (throwaway). Experiments ran in worktrees under `/tmp/kfg-golden` with `HOME` and `XDG_*` there, once the one-minute load was below 24.

## Answers

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | What forced each raise, 9→10 to 16→17 | Of 8 raises, 3 had an (a) or (b) change: 9→10 (b), 11→12 (b, a stored label only), 12→13 (a). The other 5 were (c) only. Only 9→10 can make an old row read differently under the same key. | read in source code; rows verified by experiment |
| 2 | Is the validity path separable? | Partly. `src/core/keys/` and five small modules are already separate. The accept and store decisions sit inside `Ledger` (`ledger.ts`) and `recordTier` (`tiers.ts`), which also hold queueing and tier selection and changed in 7 of the 8 windows. | read in source code; verified by experiment |
| 3 | Mechanisms; prior art | Hashing the validity path's emitted (tree-shaken) code fires in 4 of 8 windows. An import closure fires in 8 of 8. Golden keys and rows change in 2 of 8. Tools with costly caches (ccache, Turborepo, Bazel) leave their release out of the key and bump a constant by hand only when stored entries change. | verified by experiment; read in docs and source |
| 4 | What could still trust a stale result | A path no golden case exercises; inputs persisted by older code (observed loads); runner run code left to adapter versions; acceptance code outside the entries. Each has a covering test (Q4). | inferred |
| 5 | Raises under the recommendation | 1 of 8 for certain, 2 if a changed stored label must re-key. Of the 7 re-keys that tagged releases cost users, 1 (or 2). | read in source code; inferred |

## Q1. History

`raises.sh` (git only) gives two windows per raise. The **forcing** window runs from the release that carried N-1 to the first version commit carrying N: what made the guard demand N. The **tag** window (`tag-windows.out`) runs between release tags: what users re-ran for. 12 never had a tag, so 0.1.215→0.1.222 was one re-key for users. No manifest changed beyond `version`, and no bundled package's lock entry changed; every raise came from `src/`.

| Raise | Forcing window | Files | (a) key inputs or computation | (b) stored meaning or acceptance | (c) | Change |
|---|---|---|---|---|---|---|
| 9→10 | 0.1.168..6c9fed9e | 18 | 7: the pytest adapter, a new runner with no stored rows | 1: `records.ts`, a module-level skip stores `skip` for its known checks (007-23) | 10 | pytest runner wired in |
| 10→11 | 0.1.199..a6c50b6e | 9 | 0 | 0 | 9 | `stop` cancels tiers (001-367) |
| 11→12 | 0.1.215..35abdccc | 16 | 0 | 3, label only: `records.ts`, `types/check.ts`, `state/fingerprint.ts` store `phase: "after-tests"` and its prefix (011-19) | 13 | 011-15 to 011-19: counts, retries, order, slow re-run |
| 12→13 | 0.1.219..87d7ced6 | 36 | 3: `keying.ts`, `keys/ignored-inputs.ts`, `keys/index.ts`, the slow artifact rule leaves closures (004-81) | 0 | 33 | slow preconditions removed |
| 13→14 | 0.1.222..05958848 | 14 | 0 | 0 | 14 | backlog width and wall budget (001-366) |
| 14→15 | 0.1.223..8515e737 | 9 | 0 | 0 | 9 | edit tier beside the backlog (011-21) |
| 15→16 | 0.1.224..70759ddf | 11 | 0 | 0 | 11 | slots; slot records committed together; the stability check moved verbatim (011-21) |
| 16→17 | 0.1.225..d3014a3e | 10 | 0 | 0 | 10 | catch-up order (011-22); `keysSince`, a read, and `StoredKeys` through the unchanged `Ledger.settle` (011-23) |

The calls were made by reading every hunk. Raises with any (a) or (b): **3 of 8**. Borderline calls:

- **007-23 (9→10)** is a real (b). A self-skipping module's old row has no test rows; the new code stores `skip` rows for the same run.
- **The `phase` label (11→12)** changes no outcome, key or accept decision. An old row reads "setup failed:" where a new one reads "error after its tests ran:".
- **The artifact rule (12→13)** removes paths from closures. That changes the affected keys by itself, so no old row is reachable under a new meaning. 001-378 and 001-424 behave the same way: both are environment-hash input changes absorbed into the 0.1.168→0.1.199 tag window.
- **Cancelled files (10→11) and withheld files (011-06, absorbed into 11)** were never stored before either. The changes only re-queue them.

The tag windows add the work absorbed before each tag. 0.1.168→0.1.199 (132 files) holds both (a) and (b): 001-378, 001-424, 001-361 (a stored error gains its phase and cause chain) and pytest failure scrubbing. That re-key was due. 0.1.199→0.1.215 (69 files) is all (c). 0.1.215→0.1.222 is 11→12 and 12→13 together.

## Q2. The path that decides validity

1. **Inputs.** Adapter environments and closures (`src/runners/*`, versioned per adapter, D4). Observed loads persisted in `meta` (`keys/observed.ts`). Policy `inputs` and `env.allowlist` (`core/daemon/policy.ts`). File hashes (`core/hash`).
2. **Key.** `WorktreeKeys` (`scheduler/keying.ts`) assembles closures. `environmentHash` (`keys/environment.ts`: `KEY_FORMAT_VERSION`, `ENVIRONMENT_ENCODING`, the adapter version) and `checkKey` (`keys/check-key.ts`, `KEY_ENCODING`) hash them.
3. **Row.** The runner's report goes through `recordsForFile` (`scheduler/records.ts`, with `describeFailure` passed in from `state/fingerprint.ts`), then `recordTier` (`scheduler/tiers.ts`: which files store under which key, with discard and withhold through `scheduler/stability.ts`), then `storeResults` (`scheduler/store-results.ts`, the only `putMany` caller), then `store/repos/results.ts`. Row shape has its own `SCHEMA_VERSION` migrations.
4. **Accepted.** `Ledger.settle` → `Ledger.probe` (`results.byKey`, then `heldFailure` in `state/inherited.ts` holds another worktree's unconfirmed fail) → `applyResults`. `state/sink.ts` derives states from the rows at a key.

Three moves make it separable. The accept rule of `probe` and `applyResults` goes into one module. `recordTier`'s store-or-discard decision leaves `tiers.ts`. Scheduling hints (`tierWidth`, `vitest/width.ts`) leave the adapter files. Two seams resist an import closure: `describeFailure` arrives as a parameter, and `stability.ts` imports `text.ts` (wording).

## Q3. Mechanisms

All runs patched `KEY_FORMAT_VERSION` to 0 in every checkout and dropped the `KEY_SOURCES_HASHES` table.

| Mechanism | Raise windows that fire | Misses | Tag |
|---|---|---|---|
| Today: all of `src/` less exemptions | 8 of 8 | nothing in `src/`; it cannot tell meaning from wording | read in source code |
| (a) Import closure of the key and acceptance entries | 8 of 8, with or without type-only edges. Closures hold 193 to 272 files, because barrels (`state/index.ts`, `types/index.ts`) and `Ledger` pull in whole directories (`closure.out`) | inputs passed as parameters | verified by experiment |
| (a′) The same entries bundled by esbuild 0.28.2, hashing the emitted code (comments, types and unused exports dropped) | with `recordTier`, which keeps `Ledger` whole: 5 of 8 (91 inputs). Without it (`no-tiers`, 65 to 75 inputs): **4 of 8**: 9→10, 11→12, 12→13, and 16→17 (only the `keysSince` read). Identical from 0.1.222 to 0.1.225 (`bundle.out`) | code outside the entries that changes what is stored | verified by experiment |
| (b) Golden keys and rows: fixed inputs to `environmentHash`, `checkKey` and `recordsForFile` | keys identical in all 17 checkouts. Rows change at 9→10 (`skip` rows) and 11→12 (label). In the 0.1.168→0.1.199 tag window, `phase: "load"` is also added. Nothing changes from 0.1.222 to 0.1.226 (`golden.out`, `golden-forcing.out`) | cases the corpus lacks: it missed 12→13 (no slow-artifact fixture). A case added with a change is pinned at the new output unless it is also run at the last release's code | verified by experiment |
| (c) Per-component versions | already present: the three adapter versions, `ENVIRONMENT_ENCODING` (never moved) and `KEY_ENCODING` (moved once, 001-105), and store `SCHEMA_VERSION`. Each re-keys only its own scope | changes between components, such as the scheduler choosing the key a row is stored under | read in source code |
| (d) Reading rows of older formats declared equivalent | a remedy rather than a trigger: a miss also looks up the equivalent formats' keys | costs one key and one lookup per equivalent format on a miss. The equivalence needs (a′) and (b) as evidence | inferred |

Prior art. None of these tools keys by its release and its whole source at once:

| Tool | Own version in the key? | Upgrade behaviour | Tag |
|---|---|---|---|
| Bazel (REAPI `Action`) | No: `command_digest`, `input_root_digest`, `timeout`, `platform`, and an optional `salt`, which "allows disowning an entire set of ActionResults that might have been poisoned by buggy software or tool failures" | tools are inputs; the salt is a manual flush for poisoned results | read in source code (remote-apis 6def1c5), official docs |
| Gradle | Yes: "The classpath of the Gradle distribution, buildSrc and plugins" | every upgrade misses | read in official docs |
| Turborepo | No release. A hand-kept `GLOBAL_CACHE_KEY` constant is a global hash input, and the documented global inputs name no turbo version | kept unless the constant changes | read in source code (turborepo 921155f), official docs |
| Nx | Docs: sources, configuration, "Versions of external dependencies", runtime, args. For `@nx/*` executors, the planner hashes the executor package and its dependencies | upgrading an executor package re-keys only the tasks it runs | read in official docs; read in source code (nx dc5dac1) |
| Jest transform cache | Yes: the cache directory holds Jest's `VERSION`, plus `CACHE_VERSION = '1'`, "To reset the cache for specific changesets (rather than package version)". babel-jest hashes its own source file | every release drops a cache that is cheap to rebuild | read in source code (jest v30.5.2) |
| ccache | No. `HASH_PREFIX = "4"`: "If, for any reason, we want to force the hash sum to be different for the same input in a new ccache version, we can just change this string. A typical example would be if the format of one of the files stored in the cache changes in a backwards-incompatible way". It also hashes the entry, result and manifest format versions. The manual's "Common hashed information" names no ccache version | kept unless a stored format changes | read in source code (ccache a71fe22), official docs |

Gradle and Jest key by their release and accept a full miss on every upgrade. They release far less often than Squeal, which raised the format in each of the five releases 0.1.222 to 0.1.226.

## Q4. Safety

A key hashes its inputs, so a change to what a key is computed from re-keys exactly the affected checks by itself (001-378, 001-424, 004-81). The global version is needed only when **the same key** can find a row that the new code would write or accept differently. That covers a changed row for the same run (007-23, 001-361), a changed accept rule, and a fix to what was observed or stored ("a pass stored while those loads went unkeyed runs once more", `node-test/version.ts`). Rule for the golden comparison: equal keys must give equal rows and decisions. A differing key is never by itself a reason to bump.

Under the recommendation, a stale result could still be trusted through:

1. **A changed line no golden case runs.** The alarm fires, but the outputs match. Caught by requiring the golden run, at the last release and at the candidate, to execute the changed lines (V8 coverage), not by the comparison alone.
2. **Inputs persisted by older code.** Observed loads in `meta` feed later keys. A fix to observation leaves the old, incomplete set in place, so the key stays the same. The adapter version must move. A test should store a set the old way and key it the new way.
3. **Runner run and report code** once adapters leave the global alarm. Caught by the same emitted-code pin per adapter directory, under that adapter's version.
4. **Acceptance outside the entries.** `no-tiers` leaves out `Ledger.probe`, `applyResults` and `recordTier`'s store decision. They must move into the entries (Q2) before the alarm narrows.
5. **Bad rows going forward**, for example a stability check weakened by mistake. No version helps here; the scheduler tests do, and the later fix falls under case 1.

## Q5. Effect

| Raise | Alarm (a′ `no-tiers`) | Golden: same key, different row? | Raised under the recommendation |
|---|---|---|---|
| 9→10 | fires | yes (`skip` rows) | **yes** |
| 10→11, 13→14, 14→15, 15→16 | silent | no | no |
| 11→12 | fires | label only | only if labels re-key |
| 12→13 | fires | no: those keys change by themselves (inferred; no fixture) | no |
| 16→17 | fires (`keysSince`) | no | no |

**1 of 8 raises, 2 if a changed stored label must re-key.** Users would have re-run after 1 of 7 tagged releases (0.1.168→0.1.199), or 2 counting 0.1.215→0.1.222. All five raises shipped in 0.1.222 to 0.1.226 would have been avoided.

## Recommendation

Keep `KEY_FORMAT_VERSION`, but tie its bump to changed output on the validity path instead of changed source.

1. **Rule.** Bump only when the same key could find a row from an earlier release that the new code would write or accept differently. A key-input change re-keys its own checks. A runner change bumps its adapter version.
2. **Alarm.** Replace the all-of-`src/` hash with a hash of the validity path's emitted code, pinned per version as today. First, move the accept rule and `recordTier`'s store decision into their own modules (Q2).
3. **Decision.** When the alarm fires, run the golden corpus (keys, rows, accept decisions) at the last release's code and at the candidate. If equal keys give equal outputs and the corpus executes the changed lines, re-pin under the same version. Otherwise bump. Every alarm adds its case to the corpus.
4. **Adapters.** Apply the same emitted-code pin per adapter, under each adapter's version.
5. **Optional (d).** Declare formats 13 to 17 equivalent, so the next release can read rows stored by 0.1.222 to 0.1.226. Their emitted validity code is identical except for the `keysSince` read.

The deciding tradeoff: today's guard needs no judgment and costs a full re-run per release. The recommendation costs a cross-release golden run in CI and two refactors, keeps rows across 7 of 8 historical raises, and leaves the four residual risks above, each with a covering test. This is the ccache, Turborepo and Bazel pattern: keys built from inputs only, plus a constant bumped by hand when stored entries stop being trustworthy.

## Open questions

1. **Should stored labels re-key?** Whether a changed `phase` or summary prefix (11→12) is worth a re-run is a product call. The verdict is unchanged, but the agent reads the old wording.
2. **Golden coverage of key assembly.** The corpus covers the hash functions and `recordsForFile` only. `WorktreeKeys` over a fixture repository, `Ledger.probe` and `heldFailure` need a store and Git. 12→13 is inferred, not measured.
3. **Old code in CI.** The probe ran old releases' sources with Node 24 type stripping and a `.js`→`.ts` resolve hook (`register.mjs`), with no install. Not determined: whether CI should do the same, or keep a golden file regenerated at each release.
4. **The cost of (d)** was not measured against 011's catch-up budget.
5. **One reader** sorted the hunks. A second reading of the 9→10 and 12→13 windows would confirm those calls.

## Sources

- Repository: tags `squeal--v0.1.168` to `squeal--v0.1.225`, `origin/cand/0.1.226`. `src/core/keys/{key-format,environment,check-key,observed}.ts`, `src/core/scheduler/{keying,records,stability,store-results,ledger,tiers,stored-keys}.ts`, `src/core/store/{schema.ts,repos/results.ts}`, `src/core/state/{inherited,fingerprint,sink}.ts`, `src/runners/*/version.ts`, `test/keys/key-format.test.ts`, `test/keys/key-sources.ts`. Spec 011 C3 "Key format version"; `research/issue-47.md` finding 4; `../../001-core-loop/research/fresh-worktree-reuse.md` Q2.
- Probes: `raises.sh`, `tag-windows.txt`, `closure.mjs`, `golden.sh`, `golden.mjs`, `bundle.mjs`, `register.mjs`, `resolve-ts.mjs`, with their `.out` files. Node v24.21.0; esbuild 0.28.2, the lock's version, installed in `/tmp/kfg-esb`.
- Gradle: https://docs.gradle.org/current/userguide/build_cache.html
- Turborepo: https://turborepo.com/docs/crafting-your-repository/caching; https://github.com/vercel/turborepo/blob/921155f01d4abe946ac0265f3b37a763108ec1b3/crates/turborepo-task-hash/src/global_hash.rs (line 19)
- Nx: https://nx.dev/docs/concepts/how-caching-works; https://github.com/nrwl/nx/blob/dc5dac119952d35a85e792c88888c99c09e67d7d/packages/nx/src/native/tasks/hash_planner.rs (lines 708–745)
- Jest: https://github.com/jestjs/jest/blob/202dd8a14777c270607c2416bd5034c3c0abc984/packages/jest-transform/src/ScriptTransformer.ts (lines 52, 66–67, 235–241); `packages/babel-jest/src/index.ts` (lines 33, 93–94); https://jestjs.io/docs/code-transformation
- ccache: https://ccache.dev/manual/latest.html ("Common hashed information"); https://github.com/ccache/ccache/blob/a71fe22a9f480e9c785ee65997c2fcaeeb8bc350/src/ccache/ccache.cpp (lines 103–108, 1688, 2602–2611)
- Bazel: https://bazel.build/remote/caching; https://github.com/bazelbuild/remote-apis/blob/6def1c5d27a527c400875c24ae8b1a160145d7e1/build/bazel/remote/execution/v2/remote_execution.proto (`message Action`)
