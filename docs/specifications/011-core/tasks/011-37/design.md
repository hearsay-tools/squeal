# 011-37: a key format version that moves only when stored results change, a design for the human

Board row 011-37, a docs-only design draft (brief `brief.md`). The human approved the row on 2026-10-20 from 011-35's findings (`research/key-format-guard.md`): the mechanism as recommended, formats 13 to 17 read as one, and a change of stored wording re-keys nothing. Their reason: real users must not re-run everything for a minor improvement.

Nothing here is in `spec.md` until the human accepts it. On acceptance, the drafts in "Spec text" replace 011 C3's "Key format version" bullet (tasks 001-199, 001-203) and amend C4 step 3, C7, C12 and C14. `status.md` gets a dated line, and the board numbers the code rows of section 6.

Sources: `research/key-format-guard.md` and `research/probes/key-format-guard/`; 011 C3, C4, C7, C12, C14 and `status.md`; `test/keys/key-format.test.ts`, `test/keys/key-sources.ts` and `src/core/keys/`. The validity path's modules the findings name were read at main `ad2a9bd9` (0.1.225, format 16) and at `origin/cand/0.1.226` `276ed939` (format 17). For question 4 I also read 013's `tasks/013-01/design.md` and `wip/001-365` at `1457d60b`. Probe: `probes/alias-cost.sh`, output `probes/alias-cost.out` (section 4), run at a one-minute load of 19.36 on 24 CPUs. Evidence tags follow `docs/process.md`.

## Summary

- **The rule.** `KEY_FORMAT_VERSION` moves only when a key this release computes can find something an earlier release stored, and this release would have stored it or decided on it differently. That covers a run's rows and a decision read from stored rows. A change to what a key is computed from re-keys its own checks and moves nothing. A change to what a runner observes and keeps moves that runner's version. Wording is not meaning: a stored row keeps its wording until its file runs again. Under this rule, 1 of the 8 raises from 9→10 to 16→17 was due (9→10).
- **The alarm.** It hashes the emitted code of the validity path: an esbuild bundle of its entries, tree-shaken, with comments and types gone. It compares that with the same bundle built from the last release's tag. There is no pin table: the last release is the pin. Each runner adapter and the shared recorder get the same comparison under their own versions. The guard's `GUARDED`, `EXEMPT` and `SEAMS` lists retire, and so does `KEY_SOURCES_HASHES`.
- **The decision.** When the emitted code differs, a corpus of cases runs through one harness at both trees. It covers keys, rows, kept observed sets, and decisions over a store the last release wrote and over one the candidate wrote. Two things must hold. Every case with equal keys gives equal rows (wording aside), equal sets and equal decisions. V8 coverage shows that every changed emitted line ran in some case. Then the version stays. Otherwise it is raised, and a raise must carry a case whose outputs differ.
- **Formats 13 to 17 read as one.** A lookup that misses at its key computes the key at each listed format. It copies the newest set stored under one of them to the current key, with its provenance intact, and only where nothing is stored yet. Then it looks up as today. Measured: about 0.17 ms per missed file and 0.6 ms per copied set, once per daemon (section 4).
- **013-02 with 001-365 joins.** 013-02 only narrows what a touch withholds, so every row 17 stores is a row 18 stores the same way. 001-365 changes a note. That release's format (18 under today's guard) joins the list. If R1 is ready by then, it ships in that release, and the release re-keys nothing for users of 0.1.222 to 0.1.226.
- **The refactors.** The accept rule leaves `Ledger` for `scheduler/accept.ts`. `recordTier`'s per-file decision leaves `tiers.ts` for `scheduler/store-decision.ts`. Vitest's widths leave the adapter class for a hints object that `index.ts` passes in.
- **Four code rows**, R1 to R4 (section 6). R1 (read as one) comes first and stands alone. R2 (corpus and comparison, tests only) follows. R3 (refactors) and R4 (the alarm replaces the guard) ship in one release, which keeps the last release's format.

## Decisions for the human

**Decided 2026-10-20 by the human:** D1 to D6 as recommended. The spec text below is in 011 C3, C4 step 3, C7, C12 and C14 (`status.md` 2026-10-20). R1 to R4 are board rows 011-38 to 011-41.

Already decided by the human on 2026-10-20: the mechanism; formats 13 to 17 read as one; stored wording re-keys nothing. The table holds what this design adds. The spec text follows the recommendations.

| # | Question | Options | Recommendation |
| --- | --- | --- | --- |
| D1 | What counts as "stored differently"? | (a) Rows, kept observed sets, and decisions. Decisions are read by this release's code over a store the last release wrote and over one this release wrote. (b) As (a), but decisions are compared at each release's own code (011-35's "equal keys must give equal rows and decisions"). (c) Rows only. | (a). (b) raises for every deliberate change of the accept rule, even when old rows read exactly like new ones: 12→13's slow inheritance is one such change (section 1). (c) misses observed sets (011-35 Q4, risk 2) and a decision that starts reading a field old rows lack. |
| D2 | What is the alarm's pin? | (a) The last release's tag: build the same bundle from it and compare. (b) A hash table beside the constant, re-pinned under the same version after a passing comparison (011-35 recommendation 2, read literally). (c) Today's guard. | (a). There is nothing to re-pin, and the comparison runs in the suite, so Squeal shows it to a worker during the edit. (b) adds a commit per re-pin. (c) raises once per release. |
| D3 | How is the last release's code obtained? | (a) `git archive` of its tag into a temporary directory, with the candidate's harness bundled against each tree. (b) A baseline bundle committed at each release. (c) A golden output file regenerated at each release. (d) Node type stripping of the old sources, as 011-35's probe did. | (a). (b) and (c) add a release step and can drift. (c) also cannot run a case added after the release at the old code, and that is the case a change brings. (d) runs a transform other than the shipped one. |
| D4 | How are formats 13 to 17 read? | (a) On a miss, copy the newest set at a listed format to the current key, then look up. (b) Read through on every lookup, never copy. (c) Only a daemon's start reads them. | (a). Under (b), pruning drops a set it still reads, because C7's age rule protects only keys current in a live worktree. Claims, `keysSince` and the heal would each have to learn the old keys. Under (c), rows an older daemon stores after the upgrade are lost. |
| D5 | Does the release of 013-02 and 001-365 join the list? | (a) Yes. R1 rides in that release if reviewed by then; the release is not held for it. (b) Yes, and hold the release for R1. (c) No. | (a). Section 4. |
| D6 | Must a raise carry a case that differs? | (a) Yes. (b) No. | (a). Without it, a raise is the cheap way past a coverage gap, and that is exactly the re-key the human ruled out. |

## 1. The rule (brief question 1)

**Today.** C3 says a guard test hashes everything that can change what a stored result means or whether one is accepted. That is all of `src/` and the build's inputs, less a named exempt list. C3 says to bump "for any change the guard reports, a comment included". Every release from 0.1.222 to 0.1.226 raised the format (findings Q1). *read in source code*

**The rule.** An earlier release can leave three kinds of thing that a key this release computes may find:

1. **Rows.** The checks a run stores for its file, and per check its outcome and its fingerprint as `sameFingerprint` reads it (011-14). 9→10 is the example: a module-level skip now stores `skip` rows for the checks it knew, where the old set had none (007-23). *read in source code; verified by experiment (`golden.out`, `moduleSkip`)*
2. **Kept observed sets.** These are the paths a run read, kept in `meta` under `observed.<project>` and merged into later closures (C3, C12). Suppose a fix to observation would have seen one path more. The set kept earlier stays as it was, keys over it equal the old keys, and the old rows stay current (findings Q4, risk 2). A key-only rule cannot catch this. So a change to what is observed and kept moves the version of whatever records it: the adapter's version (D4), or `RECORDER_VERSION` for the shared recorder (`src/runners/observe/runtime.ts:13`, C12). *inferred*
3. **Decisions read from stored rows.** These are accept or hold (`heldFailure`), the state the rows give (`derive.ts` `stateFromResult`, `classify`), and the checks a set retires. This release's code reads them twice: once over a store the last release wrote and once over a store it wrote itself, from the same runs. The two readings differ only when this release reads something the last release stored differently, or did not store. A changed rule that reads old and new rows alike moves nothing. A daemon's start looks up every file (C4: the baseline is step 3 for all test files; `src/core/scheduler/bootstrap.ts:140-153`), so the new rule reaches old rows at the next start. *read in source code*

A change to what a key is computed from re-keys exactly the affected checks, and moves no version (001-378, 001-424, 004-81; findings Q4). A differing key is never by itself a reason to raise.

**A refinement of the findings.** 011-35 compared decisions at each release's own code. That reading raises for every deliberate change of the accept rule. The 12→13 window holds one such change that the findings did not list. 004-81 removed `inheritsAcrossWorktrees` (`src/core/slow/inherit.ts` at `2639208a`). Since then, a slow file whose declared inputs hold no artifact inherits another worktree's row, which 12 refused. 12's rows for such a file are the rows 13 writes, so 13 reads them as it reads its own. That is no raise under D1 (a), and a raise under the findings' reading. *read in source code (`git diff 2639208a 87d7ced6 -- src/core/slow/inherit.ts`)*

**Wording.** The human decided that a change of stored wording re-keys nothing (2026-10-20). Wording is what a row carries for its reader and no decision reads: the summary, the error text (message, stack and diff), and an error's `phase`, `causes`, `code` and recorder note. Today `phase` only picks the summary's opening words (`src/core/state/fingerprint.ts:152-156`, read at `:181`). `failsAfterTestsPassed` reads outcomes and check kinds, not `phase` (`src/core/scheduler/rerun.ts:48`). *read in source code*

An old row keeps its wording until its file runs again: when its key changes, or on a forced run (`run --all --force`, `retry`). So one worktree can show "setup failed:" on a row an earlier release stored, and "error after its tests ran:" on the same kind of failure stored later (11→12, 011-19). The corpus keeps this boundary honest. A decision that starts reading a wording field changes a decision output, and decisions are compared in full (section 3).

**History under the rule.** 9→10 raises (rows). 11→12 is wording. In 12→13 the keys change by themselves, because artifact paths leave closures, and the accept change reads old rows as it reads new ones. That verdict stays inferred until R2's assembly cases run (section 4). The other five raises are neither. That makes 1 raise of 8. Of the 7 re-keys that tagged releases cost users, 1 would remain (0.1.168→0.1.199). *read in source code; inferred*

## 2. The alarm (brief question 2)

**What is hashed.** The alarm builds one esbuild bundle of the validity entries the way the shipped bundles are built: `bundleOptions`' target, `platform: "node"`, `format: "esm"`. It uses `packages: "external"`, no minifying and no legal comments, and drops esbuild's `// path` markers. 011-35's `bundle.mjs` built it this way (variant `no-tiers`, 65 to 75 inputs). The global entries, after R3:

| Entry | Export | What it decides |
| --- | --- | --- |
| `src/core/keys/index.ts` | all | environment hash, check key, closure helpers, observed sets, installed packages |
| `src/core/scheduler/keying.ts` | `WorktreeKeys` | closures, declared inputs, listings, gitignored paths |
| `src/core/scheduler/records.ts` | all | a report's rows |
| `src/core/state/fingerprint.ts` | `describeFailure` | the fingerprint; it arrives in `recordsForFile` as a parameter, so no import reaches it |
| `src/core/scheduler/stability.ts` | all | the completion barrier, withheld files |
| `src/core/scheduler/store-decision.ts` (R3) | all | per file: store, and under which key, or discard |
| `src/core/scheduler/store-results.ts` | all | the only caller of `putMany` |
| `src/core/store/repos/results.ts`, `src/core/store/schema.ts` | all | row shape, the copy of R1 |
| `src/core/scheduler/accept.ts` (R3) | all | accept or hold, retired checks, the read of the listed formats |
| `src/core/state/inherited.ts` | `heldFailure` | C5's held fail |
| `src/core/state/derive.ts` | `stateFromResult`, `classify` | the state rows give |

Hashed beside the bundle: the `location@version#integrity` lock closure of the packages the bundle imports (its metafile's external imports), the same for `esbuild`, and the plugins' `bin/` launchers, which decide how Node runs the daemon.

Everything else is out without a list: the CLI, status, delivery, the harnesses, `Ledger`'s queueing, `tiers.ts`'s selection, and the scheduling hints. Each is out because no entry reaches it. The risk moves to the other side: a decision that lands where no entry reaches. R4's tests mutate each decision and require the alarm to fire (section 6, risk 4).

**Pinned to the last release.** The comparison builds the same bundle from the last release's tree (section 3). When the emitted text and the fingerprint match, nothing on the path changed and no comparison runs. There is no `KEY_SOURCES_HASHES`, nothing to re-pin, and no table to keep in step with the constant. The last release is the newest `squeal--v*` tag that is an ancestor of `HEAD` (`git describe --tags --abbrev=0 --match 'squeal--v*'`).

**How often it fires.** The probe's `no-tiers` variant, without `Ledger` and `tiers.ts`, fired in 4 of 8 windows: 9→10, 11→12, 12→13, and 16→17 (only the `keysSince` read). It was identical from 0.1.222 to 0.1.225 (`bundle.out`). R3's two modules bring the accept rule and the store decision in without `Ledger` and `tiers.ts`. Whether they add firings is for R2 to measure. *verified by experiment; inferred for R3*

**Per-adapter and recorder alarms.** Today an adapter has no alarm of its own. Its code is under the global guard, and its version file is exempt from it. Once the global entries stop reaching `src/runners/`, each adapter needs the same comparison under its own version (findings recommendation 4, Q4 risk 3):

| Component | Version | Entries | Left out |
| --- | --- | --- | --- |
| Vitest | `VITEST_ADAPTER_VERSION` | `src/runners/vitest/adapter.ts` (the class, after R3) and what it imports | `index.ts`'s wiring, `width.ts` |
| node:test | `NODE_TEST_ADAPTER_VERSION` | `src/runners/node-test/adapter.ts` and what it imports; `runtime/recorder.cjs` and `runtime/reporter.mjs` as text | the composite's slot and width hints (`src/core/daemon/node-test-runners.ts`) |
| pytest | `PYTEST_ADAPTER_VERSION` | `src/runners/pytest/adapter.ts` and what it imports; `runtime/squeal_pytest.py` as text | `src/core/daemon/pytest-runners.ts` |
| Shared recorder | `RECORDER_VERSION` | `src/runners/observe/*.ts`; `recorder.cjs`, `fs.cjs`, `spawn.cjs`, `preloads.cjs` as text | |

The `.cjs` and `.mjs` runtime files and the Python runtime run inside test processes, out of esbuild's reach, so they are hashed as text. A component's version re-keys that runner's checks alone, as today. In a repository with one runner, that is still every check, so the same rule governs it.

**A defect today.** `src/runners/pytest/version.ts` is not in `EXEMPT` (`test/keys/key-sources.ts`), and the "an adapter-only bump" tests cover Vitest and node:test only. So a pytest bump today also moves the guard's hash and forces a global raise. C3 says an adapter bump "leaves the guard's hash as it is". R4 removes the list. Until then this is a one-line fix for the coordinator to place. *read in source code*

## 3. The decision (brief question 3)

**The flow.** It is one Vitest file, `test/keys/validity/compare.test.ts`. Squeal runs it as part of the suite, and CI runs it with `npx vitest run`. It also imports the entries statically, so that its closure holds them and Squeal re-runs it when one changes. esbuild is a Go child process, and no recorder sees what it reads (C12). The steps:

1. Find the last release L (section 2). Extract its `src/` and `tsconfig.json` into the test's temporary directory with `git archive <tag> src tsconfig.json`.
2. Bundle the entries at the candidate C and at L. If the text and the fingerprint are the same, the test passes here.
3. Otherwise, run every corpus case through the harness at both trees. An esbuild `onLoad` for `key-format.ts` sets one format value in both bundles, so that a raise does not hide an equal key.
4. Compare, case by case. Keys are compared and reported. Where the keys are equal, compare the rows by their verdict projection, the kept observed sets, and the decisions. Wording differences are listed and never fail the test.
5. Check coverage. Run C's cases in a child `node` with `NODE_V8_COVERAGE`. The line diff of the two normalized bundles gives C's changed lines, and each one must lie in a block that ran at least once.
6. Give the verdict. If C has L's version, outputs must be equal and coverage complete. Otherwise the test fails, naming the differing cases or the uncovered lines, each line with its source location through the source map. If C has raised the version, at least one case must differ (D6). From R4 on, a raise must also empty the list of section 4.

**How L's code is obtained (011-35's open question 3).** `git archive` of the tag (D3 a). Worktrees share the repository's tags. CI's checkout fetches them (`fetch-depth: 0`, or `git fetch --depth=1 origin tag <tag>`). The candidate's harness is bundled twice, once against each tree. L's bundle resolves its external packages from C's `node_modules`. That is sound while the dependency fingerprint is the same at both. When it differs, because a package the bundle imports or `esbuild` itself moved, the test installs L's lock in the temporary tree (`npm ci --ignore-scripts --no-audit`) and bundles L with L's own esbuild. That never happened in 011-35's eight windows: no manifest changed beyond `version`, and no lock entry of a bundled package changed (`raises.out`). When the tag is missing, the test fails and names `git fetch --tags`. It never skips silently.

**The harness.** `test/keys/validity/harness.ts` has one function per case kind and imports, by path, from the tree under test. When R3 moves a function, the harness reads the new path and falls back to the old one for L, until L carries the move; then the fallback goes. Cases are data. L ignores a field it does not know, which is exactly the question being asked: what the old code does with the new run.

| Kind | Input | Output compared |
| --- | --- | --- |
| `key` | core and runner environment inputs, a closure, file hashes, a dependency segment | environment hash, check key |
| `assemble` | a fixture Git repository, a policy, a stub adapter's environments and closures, observed sets | each test file's closure and key |
| `rows` | a key, a run report, previous checks | rows by projection, also read back after each tree's own `putMany` |
| `observe` | canned recorder output of a run | the observed set kept in `meta` |
| `accept` | rows that several worktrees stored, each written by the tree's own store code; the receiving worktree's failure keys | accepted or held, `mayWait`, states, retired checks |
| `store` | a tier, its report, unstable paths, observed growth | per file: store and under which key, discard, re-queue, unknown |
| `adapter:<runner>` | canned runner objects (Vitest task trees, module graphs, resolved configs; node:test events; pytest reports), or a fixture project the real runner runs: node:test is built into Node, Vitest comes from the candidate's install, pytest runs where CI has it | `RunReport`, closures, environments |

The `accept` kind is the upgrade itself. L writes a store. C opens it and migrates its `user_version` (C7), as a user's daemon does. C also writes its own store from the same runs. C decides over both, and the decisions are compared. *inferred (design)*

**The verdict projection** of a row is its check identity (project, path, kind, full name), its outcome, and its fingerprint compared through the candidate's `sameFingerprint`. Duration and provenance come from the case. Everything else is wording (section 1).

**Coverage proof (011-35 Q4, risk 1).** Node's `NODE_V8_COVERAGE` records block counts. The changed lines come from a line diff of the normalized L and C bundles. A comment or a type changes no emitted line, so it needs no case. A moved function changes lines only where its emitted text changed. A changed line that no case runs fails the comparison with its source location: the alarm fired on code the corpus cannot vouch for.

**How a case joins.** A case joins in the change that needs it. A coverage gap names the lines. The author adds a case file under `test/keys/validity/cases/<kind>/` with a `why` naming the row or raise it pins, and the comparison then runs it at L and at C. A case is not deleted while its kind exists. The seeds are:

- 011-35's golden inputs (`golden.mjs`): keys over fixed inputs, plain rows, a load error, an error after the tests, a module skip.
- 9→10's skip rows and 11→12's label.
- The 12→13 assembly cases (section 4) and 013-02's barrier cases.
- 001-170's held fail and 001-205's `mayWait`.
- An observed set with a listing and a recursive listing (001-134).

**Cost.** In the common case nothing on the path changed, and the cost is two bundles and a compare. The corpus and the coverage run happen only when the alarm fires: four of eight windows in the probe's history. Neither cost has been measured. 011-35 built 17 bundles per variant without timing them.

## 4. Reading formats 13 to 17 (brief question 4)

**How a lookup finds a row under an equivalent format.**

- `key-format.ts` gains `KEY_FORMATS_READ_AS_ONE`. It holds the formats from 13 up to the one below `KEY_FORMAT_VERSION`: 13 to 17 when R1 ships at 18 beside 013-02 and 001-365 (D5), or 13 to 18 when R1 ships later, at 19.
- `environmentHash` takes the format as a parameter, defaulting to the constant. The change is additive. `WorktreeKeys` computes one environment hash per listed format per project, beside today's (`src/core/scheduler/keying.ts:211-221`).
- `KeyIndex` answers each test file's keys at the listed formats with `keyFromSegments` over the segments it already holds (`src/core/keys/key-index.ts:180-189`).
- On a miss at the current key, the lookup reads the listed keys in one `SELECT ... WHERE key IN (...)`. It takes the set with the newest `recorded_at`; C7 lets the newest run's outcome replace older ones. It copies that set to the current key in one statement: `INSERT ... SELECT ... WHERE NOT EXISTS (SELECT 1 FROM results WHERE key = <current>)`. Then the lookup runs as today, and `heldFailure` and the own-worktree rule decide (`src/core/scheduler/ledger.ts:298-307`).
- The old keys are read once per file and key per daemon. A queued file that tier selection probes again does not read them a second time.
- 011-23's pass reads the keys stored since its last read. It matches them against the listed-format keys of this worktree's files without a result, as well as against their current keys. A row that an older daemon stores after the upgrade is therefore adopted on the next pass.
- A busy store leaves the copy to the next lookup, as 001-422 does for the adoption pass.

**Why copy (D4).** C7's pruning keeps a key that is current in a live worktree and drops others once `recorded_at` is 7 days old (`src/core/store/prune.ts:55-57`). Read through, a set under an old key would be dropped while still in use. Every lookup of every daemon would also pay the extra read. And `keysSince`, claims, `test_file_keys_by_key` and the heal all work by key, so each would have to learn the old keys. A copied set is read once and is then an ordinary row. The copy keeps the run's provenance and `recorded_at`, so status and `why` name the run that produced it, and 011-23's watermark does not treat it as new. Because `NOT EXISTS` sits in the same statement, a set another daemon stored at the current key in the meantime is never mixed with an older one. C7 holds one result per check and key.

**Cost against C4's catch-up.** Measured by `probes/alias-cost.sh` (`probes/alias-cost.out`). It ran in a throwaway worktree at `d75e1bde` under `/tmp/kfg37`, at a one-minute load of 19.36 on 24 CPUs, Node v24.21.0, on a synthetic store of 200,000 rows (20,000 keys of 10 checks) with the product's schema. *verified by experiment (synthetic store, not cezar's)*

| Part, per missed file, five listed formats (13 to 17) | Measured | Compared with |
| --- | --- | --- |
| Five more check keys (`keyFromSegments`) | 33 µs at 50 paths, 115 µs at 300, 360 µs at 1,000 | today's one key per file |
| One `SELECT` over the five keys, none stored | 59 µs | today's miss (`byKey`, `UPDATE` then `SELECT`): 20 µs |
| On a hit: that `SELECT`, then the copy of 10 rows as its own statement | 0.60 ms | a run of that file: 0.1 s to minutes |
| The same for 876 files in one transaction | 399 ms (0.46 ms each) | 876 runs |

For cezar's 876 stale files after an upgrade, that is about 150 ms when nothing is found (keys plus reads at 300 paths). It is about 0.53 s when every file is found and copied, statement by statement. That happens once per daemon. The copy should commit per statement, as `byKey`'s `UPDATE` does today. That holds the store's write lock for about 0.6 ms at a time, never the 0.4 s of one transaction, which matters given C7's history of long write transactions (001-161).

The read happens at the lookup, before catch-up's first tier. So it delays that tier by under a second against the 120 s wall budget of a backlog tier (C4 step 5), and it replaces a re-run of every file. For scale, a pull's catch-up of 795 cezar files took a modelled 857 s on the backlog route (`research/catch-up.md`). An idle 011-23 pass stays at 0.02 ms, because a miss reads the old keys only once per file and key.

**What it does not do.**

- **A confirmed fail is held once more.** `heldFailure` compares the worktree's confirmed failure key with the row's key (`src/core/state/inherited.ts:29`). So another worktree's fail that this worktree confirmed under an old format's key is held once more after the copy. The file runs here once, or stays held under `lookup-only`: one file per such fail. Accepted.
- **No store migration.** A key hashes closures and environments that the store does not keep in full, so old rows can be re-keyed only where a daemon computes the key.
- **The list never grows after R4.** From then on a raise means a stored meaning changed, so no earlier format is equivalent, and a raise empties the list (R4's test).
- **011-30 is unaffected.** A step-down's cancel loses what the old tier would have stored. With formats read as one, those rows would be readable, so the cancel now loses only the files still running. 011-30 already accepts that for a release that keeps the format.

**The 12→13 verdict.** The list's floor is 13 whatever the verdict, because 13 is the first format after 004-81. What the evidence settles is whether this corpus would have reached 12→13's verdict from evidence rather than inference. 12→13 is the one raise 011-35's corpus could not reproduce (findings open question 2). Before R4 ships, R2 runs these cases once at `2639208a` (12) and `87d7ced6` (13), with the format set to one value, and keeps them in the corpus:

1. `assemble`: a slow file that declares a gitignored artifact which exists. Keys differ, because the artifact leaves the closure.
2. `assemble` and `rows`: a slow file whose artifact glob matches no file. Keys and rows are equal.
3. `assemble` and `rows`: a slow file with a tracked declared input. Keys and rows are equal.
4. `assemble` and `rows`: a fast file that declares a gitignored input. Keys and rows are equal.
5. `assemble`: a fast file with no inputs. Keys are equal.
6. `accept`: case 2's file, stored by worktree A and looked up in B. 12's code refuses it, so the file runs in B, and 13's accepts it. 13's code accepts it over 12's store and over 13's store alike.

The verdict is no raise when case 1 differs, cases 2 to 5 are equal with equal rows, and case 6's two decisions under 13's code agree. An equal-key case with different rows would make 12→13 a raise the findings missed. It would not move the floor, but R2's notes would have to say why 011-35's fixtures missed it. Extending the list below 13 is not recommended. If this holds and 11→12 is wording only, 11 and 10 would be equivalent too, but few rows of theirs can still matter: C7 drops a key no live worktree holds once it is 7 days old. Each extra format also adds a key per miss. *inferred*

**The release of 013-02 and 001-365.** Under today's guard it raises to 18. Under the rule it is not a raise:

- **013-02 only narrows what is withheld** (013-01 section 2 and D2). A counted touch withholds the files whose graph reaches it, not the whole run, and the barrier withholds the files whose keys name the path, not the whole tier. Every file 18 withholds, 17 withheld too, and every file neither withholds is recorded by the same `recordsForFile`. So every row 17 stored is a row 18 stores for the same run. 18 also stores some rows 17 discarded, and no 17 row stands for those. *read in source code (the design); inferred for the code, which is not written yet*
- **001-365 is a note.** It changes which files a node:test note names (`bareNote`) and wires policy `inputs` to the adapter for that note. No key, row or decision changes (`git diff` of `wip/001-365` at `1457d60b`, `src/`). *read in source code*

So 18 joins the list (D5 a). If R1 has passed review by then, it ships in that release, and the release re-keys nothing for users of 0.1.222 to 0.1.226. The release is not held for R1: the human bundled the two rows to pay one re-key, and the list repays it later. Until R2 exists, 18's membership rests on this reading and on 013-02's review confirming both points. Once R2 lands, 013-01's test 11 (the barrier) becomes a `store` case, and its tests 2 and 4 become `adapter:vitest` cases. All three run at 17 and 18.

## 5. The refactors (brief question 5)

Each refactor is its own commit, proven by R2's comparison: the same outputs on every case, and the changed emitted lines covered. The findings measured why they matter: `Ledger` changed in 3 of the 8 windows and `tiers.ts` in 7, for queueing and tier selection, not for acceptance (`closure.out`). *verified by experiment*

**The accept rule out of `Ledger`, into `src/core/scheduler/accept.ts`.**

- *Moves:* `probe`'s rule (`ledger.ts:298-307`: `results.byKey`, the own-worktree shortcut, `heldFailure`); the retirement of checks in `applyResults` (`ledger.ts:331-333`); R1's read and copy of the listed formats.
- *Exports:* `acceptedAt(store, worktreeId, key, now, listed)`, which returns `{ hits, mayWait }`, and `currentChecks(previous, results)`, which returns `{ checks, retired }`.
- *Stays in `Ledger`:* the `FileState` bookkeeping (`resultKey`, `failing`, `durationMs`, `discards`, `blocked`, the queue, the phase, checkpoints), `settle`'s loop, `lookup`, and `#rank`.

**The store decision out of `tiers.ts`, into `src/core/scheduler/store-decision.ts`.**

- *Moves:* `recordTier`'s per-file branch (`tiers.ts:533-577`). That covers superseded, withheld, re-queued or cancelled, not completed (not started, unknown, split), observed growth and the key to store under (`storeKey`), unstable inputs (discard), first-seen paths, environment growth, and no key. It becomes one pure function of the file's entry, the report's sets and the unstable predicate, returning one decision. It reads `FileState` fields only. `ledger.files.get(file.id) === file` comes in as a boolean.
- *Stays:* the transaction and the decision's execution (`Ledger` calls, `recordsForFile`, `storeResults`, re-runs, setups, `markUnknown`).

**The hints out of the Vitest adapter.**

- *Moves:* `slowWidth` and `tierWidth` (`src/runners/vitest/adapter.ts:398-409`), and the resize before each run (`adapter.ts:447`, `width.ts:86-95`). They go to a `VitestHints` object that `index.ts` builds from `width.ts` and hands to the adapter class. `index.ts`'s wrapper answers `RunnerAdapter.tierWidth` and `slowWidth` from it. `RunnerAdapter` does not change: those members were already optional.
- *Why:* `adapter.ts`'s bundle stops holding `width.ts`. Width changes nothing stored, since `maxWorkers` left the environment hash at format 10 (C10, 001-378). 13→14 (001-366) changed `adapter.ts` and `width.ts` for width only.
- node:test and pytest already keep their hints in the `src/core/daemon/` composites, outside any adapter's entries.

## 6. Code rows (brief question 6)

Numbers are the coordinator's to give.

| Row | Seams and owned files | Regression it lands | Release |
| --- | --- | --- | --- |
| R1 Formats read as one | `src/core/keys/environment.ts` (format parameter), `key-format.ts` (the list), `key-index.ts` (keys at the listed formats), `src/core/scheduler/keying.ts` (environment hashes per listed format), `src/core/store/repos/results.ts` (the read and the copy), `src/core/scheduler/ledger.ts` `probe`, `src/core/scheduler/stored-keys.ts`; tests in `test/keys/` and `test/scheduler/` | One test file has rows under its format-16 and format-17 keys, the newer at 17; another has rows under format 12. A daemon at 18 settles the first from the 17 set with no run, provenance and `recorded_at` intact, and runs the second. A set already at the current key is never replaced or mixed. Another worktree's unconfirmed fail at 16 stays held. An older daemon's row stored after the upgrade is adopted on the next pass. Red on main: the first file runs. | With 013-02 and 001-365 if reviewed by then, else the next release. Under today's guard it raises, and its own format joins the list, because its change only adds reading. |
| R2 Corpus and comparison (tests only) | `test/keys/validity/` (harness, cases, `compare.test.ts`, the coverage driver); the CI workflow fetches tags | At `HEAD` against the last tag, it passes. Self-tests with an overlay of C's tree: dropping 9→10's skip rows reports differing rows; a change on an uncovered line reports that line; a summary-only change passes and lists the wording. One-off, recorded in the row's notes: the 12→13 cases at `2639208a` and `87d7ced6`, and 013-02's barrier cases at 17 and 18 once 013-02 lands. | No `src/` change, so no raise. |
| R3 The three refactors (three commits) | `src/core/scheduler/{accept,store-decision,ledger,tiers}.ts`, `src/runners/vitest/{adapter,index,width}.ts` | R2's comparison shows no difference after each commit. | Guarded under today's guard, so it ships with R4. |
| R4 The alarm replaces the guard | `test/keys/key-format.test.ts` (verdict, raise-needs-a-case, the list's rule), `test/keys/key-sources.ts` retired, `KEY_SOURCES_HASHES` gone from `key-format.ts` and `keys/index.ts`, the per-adapter and recorder comparisons, the comment in `key-format.ts` | The risk tests below. | With R3. The comparison shows equal outputs, so the release keeps the last release's format and re-keys nothing. |

The order is R1, then R2, then R3 with R4. R1 is the user-visible win and does not need R2. R3 needs R2 to prove itself. R4 needs R3's modules for its entries. Until R4 ships, each release's raise joins the list on the reviewer's reading, and from R2 on, on R2's comparison.

**The findings' residual risks (Q4), and this design's own, each with its test.**

| # | Risk | Test | Row |
| --- | --- | --- | --- |
| 1 | A changed line no case runs | An overlay on an uncovered branch of `records.ts`: the comparison fails and names the line. | R2 |
| 2 | Observed sets kept by older code | An `observe` case with an overlay that stops recording stat'ed paths: the kept set differs, and the comparison names the recorder's version to raise. | R2, R4 |
| 3 | Runner run and report code | An overlay on Vitest's `results.ts` that reads a skipped test as `pass`: the Vitest comparison fails, while the global and node:test ones pass. An overlay on `width.ts`: no comparison fires. | R4 |
| 4 | Acceptance outside the entries | One overlay per decision fires the global alarm and fails the comparison: `accept.ts` holds no fail, `store-decision.ts` stores an unstable file, `heldFailure`, `stateFromResult`, the barrier. A source scan finds that no module but `store-results.ts` and `accept.ts` writes `results`, as `SEAMS` scans imports today. | R3, R4 |
| 5 | Bad rows going forward, such as a weakened stability check | No version helps. The scheduler's own tests catch it, and the later fix falls under risk 1. | none |
| 6 | The list names a format that is not equivalent | R1: the list holds only formats from 13 to the one below the current one, each with the row that raised it. R4: a raise that leaves the list non-empty fails. | R1, R4 |
| 7 | An older daemon stores under its format after the upgrade | The adoption pass adopts the row on its next read (R1's regression). | R1 |
| 8 | A confirmed foreign fail is held once more | R1's test states it: one run of that file. | R1 |
| 9 | A package the bundle imports, or esbuild, moves | A lock-entry overlay makes the comparison report that L must be installed. It is a unit test of that decision, not of the install. | R4 |

## Spec text (drafts, for the amendments)

**C3, "Key format version", replacing the bullet:**

> - **Key format version** (task 001-199; decided by the human 2026-10-10; rule, alarm and reading amended by task 011-37, decided by the human on the date of acceptance). `KEY_FORMAT_VERSION`, a small integer in `src/core/keys/key-format.ts`, stands in the environment hash where the Squeal version stood, because each hub release re-ran every worktree's full suite while the code that builds keys had not changed. The key names the format of keys and results, not the release: two builds that differ only in `package.json` version key every check alike, and the daemon's version decides step-down (D10) and shows in status without entering a key. It moves only when a key this release computes can find something an earlier release stored that this release would have stored or decided differently: the rows of a run (the checks it stores, and per check its outcome and its fingerprint as `sameFingerprint` reads it), or a decision read from stored rows (accepted or held, the states they give, the checks they retire), read by this release over a store an earlier release wrote and over one it wrote itself. A change to what a key is computed from re-keys the affected checks by itself and moves nothing (tasks 001-378, 001-424, 004-81), and a differing key is never by itself a reason to move it. A change to what is observed and kept for later keys moves the version of whatever records it, the runner's adapter version (D4) or the recorder's (C12), since keys over a set kept earlier equal the earlier keys. Wording is not meaning: the summary and error text a row carries, and an error's phase, causes, code and recorder note, re-key nothing, and a row keeps the wording it was stored with until its file runs again (the human, 2026-10-20). A test (`test/keys/key-format.test.ts`) bundles the validity path's entries as the shipped bundles are built, without comments or types: closure assembly and keys, a report's rows and their failure description, the completion barrier, the store decision, the result store and its schema, the accept rule, the held fail and the state rows give. It fingerprints the packages the bundle imports, the bundler and the plugins' launchers, and compares both with the same built from the last release's tag. While they match, nothing on the path changed. When they differ, a corpus of cases (`test/keys/validity/`) runs through one harness at both trees, the format held at one value: keys, rows, observed sets kept, and decisions over a store each tree wrote. Under an unchanged version every case with equal keys must give equal rows, wording aside, equal sets and equal decisions, and every emitted line that changed must have run in some case; a raised version needs a case whose outputs differ. A changed line no case runs is answered, in the same change, by the case that runs it. Each runner adapter and the recorder are compared the same way under their own versions, their scheduling hints left out. The formats from 13 to the one before this test replaced the guard of task 001-203, raised under that guard for changes that left every stored meaning alone (`research/key-format-guard.md`, task 011-37), are read as the current one: a lookup that misses at its key computes the key at each and, when rows are stored under one, copies the newest set under its key, with its provenance and record time, only while no row is stored there, and then looks up as at any key (C4 step 3). A raise after the guard's replacement empties that list. The first value is the number 1 where every earlier key held a version string, so the switch re-keyed every check once and no result stored under a version-hashed key is trusted.

**C4 step 3**, after "No run is needed.":

> A key with no result is first read at the formats C3 reads as one, once per file and key in a daemon, and the keys other worktrees stored since the last read are matched at those formats too (task 011-37).

**C7**, after "another worktree's known state follows when it next refreshes that file.":

> A set copied from a format read as one (C3) keeps its run's provenance and record time and is written only under a key that holds no row, so it never replaces a stored set or mixes with one (task 011-37).

**C12**, after "so a pass stored before observation runs once more.":

> `RECORDER_VERSION` moves under C3's rule for what the recorder observes and keeps, decided by its own comparison (task 011-37).

**C14**, replacing "A runner's adapter version re-keys that runner's checks alone; `KEY_FORMAT_VERSION` re-keys every runner (C3).":

> A runner's adapter version re-keys that runner's checks alone; `KEY_FORMAT_VERSION` re-keys every runner. Each moves under C3's rule, decided by its own comparison; an adapter's scheduling hints (`tierWidth`, `slowWidth`, `tierPart`, `besideBacklog`, `backlogSlot`, `lane`) are outside it (task 011-37).

## Rejected options

- **Keep today's guard.** It fires in 8 of 8 windows and re-keys once per release (findings Q3).
- **An import closure as the alarm.** It also fires in 8 of 8: barrels (`state/index.ts`, `types/index.ts`) and `Ledger` pull in whole directories (findings Q3 (a)).
- **Golden keys and rows alone.** They missed 12→13 for want of a fixture, and they cannot see a decision.
- **A pin table re-pinned under the same version** (D2 b). The last tag is already a pin, and the table needs a commit per re-pin.
- **A committed baseline bundle, or a golden output file per release** (D3 b, c). Each is a release step that can drift. The golden file cannot run a new case at the old code.
- **Node type stripping of L's sources** (D3 d). It runs a transform other than the shipped one and needs a resolve hook. It stays for one-off probes.
- **Read-through, start-only reading, a store migration** (D4 b, c; section 4).
- **A format column per row.** It needs a schema migration and adds nothing: the key is recomputed wherever it is needed.
- **Per-component versions alone.** They exist already and decide nothing about when to move (findings Q3 (c)).
- **Decisions compared at each release's own code** (D1 b).
- **A list of live-only adapter modules exempt from coverage.** That is the exemption style this replaces, and it trusts a list. A change only a live runner executes either gets a case with a fake runner object or raises that adapter's version.
- **Extending the list below 13** (section 4).

## What is not known

- **The reading's cost on a real store.** The probe used a synthetic 200,000-row store. Cezar's store, its page cache under load, and closures above 1,000 paths were not measured.
- **R3's effect on the alarm.** Whether its modules add firings over the probe's `no-tiers` variant.
- **How much adapter code the corpus can drive.** That is, how much of each adapter's changed code canned runner objects can reach. A change only a live runner executes needs a fake object or raises that adapter's version. The share of past adapter changes of that kind was not measured. In the eight windows, adapter files changed in 9→10 (pytest, new), 12→13 (Vitest wiring) and 13→14 (Vitest width) (`raises.out`).
- **The comparison's time** when the alarm fires: two bundles, the corpus twice, and coverage. Not measured. An adapter case that runs a real runner over a fixture project costs a runner start per tree. node:test's run path also produces notes (001-365's `bareNote` sits in it), so a note change fires the node:test comparison, and only such a case can cover its lines without raising the adapter's version.
- **013-02's equivalence** rests on its design until its code and R2's cases exist.
- **12→13** stays inferred until R2's one-off run.
