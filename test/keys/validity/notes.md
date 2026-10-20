# The cross-release comparison: notes (board row 011-39)

Row 011-39 is R2 of task 011-37's design (`docs/specifications/011-core/tasks/011-37/design.md`, sections 3, 4 and 6). It adds tests only and changes nothing under `src/`, so it needs no format raise. These notes record the seam map, the decisions the design left open, the one-off 12→13 verdict, the measured wall time and what the next rows need.

## Seam map

| File | What it does |
| --- | --- |
| `compare.test.ts` | Compares `HEAD` with the last release. It also self-tests the comparison by comparing this checkout with itself under an overlay (a change unmade). It imports `driver.ts` statically: esbuild reads the sources in a Go process that no recorder sees (011 C12), so that import is what re-runs the file when an entry changes. |
| `compare.ts` | `compareTrees`: two bundles and a fingerprint check. When they differ: both runs, the decide runs, the verdicts and coverage. `failures` gives the verdict; `wordingChanges` lists wording that differs. |
| `sides.ts` | One side: its bundle and its copy of the recorder's runtime under the work directory. It runs the driver in a child `node` under `NODE_V8_COVERAGE`, with `HOME` and `XDG_*` set inside the work directory. |
| `bundle.ts` | Bundles `driver.ts` against a tree with the shipped build's target, platform and format. Packages stay external and legal comments are dropped. The candidate's harness resolves its `src/` imports into the tree under test. The tree's `key-format.ts` is pinned to format 0 and loses `KEY_SOURCES_HASHES`; overlays replace file texts. esbuild's `// path` markers are blanked, so line numbers and the source map stay valid. `BEFORE_MOVES` (row 011-40): a tree without a moved module reads the harness module that asks the same of the code where it was. |
| `coverage.ts` | Reads V8 block coverage (the innermost range at a line's first character), runs a `git diff --no-index` line diff, decodes source maps and lists changed source lines. |
| `trees.ts` | `lastRelease`: `git describe --tags --abbrev=0 --match 'squeal--v*'`; it fails and names `git fetch --tags` when no tag is found. `extractTree`: `git archive` of `src`, `tsconfig.json` and the manifests into a temporary directory. Also reads a tree's format and the lock closure of the packages its bundle imports, plus esbuild. |
| `driver.ts` | The bundle's entry. It re-exports section 2's entries (as namespaces where the table says "all"), so the bundle keeps them whole. `run` runs every case; `decide` decides over what a run stored. Imported, it runs nothing. |
| `harness.ts`, `harness/*.ts` | One function per kind. Every `src/` import is resolved into the tree under test. `accept-rule.ts` (`acceptedAt`, `currentChecks`) falls back to `accept-rule-ledger.ts` (`Ledger.probe`, the sink's `retire`); `store.ts` (`tierEnd`, `storeDecision`) falls back to `store-traced.ts` (the tree's `recordTier`, read from its `Ledger` calls); `store-input.ts` is the `store` kind's shared input, the barrier as the scheduler builds it. |
| `case.ts`, `cases/<kind>/*.ts`, `cases/index.ts` | The corpus. Cases are data, and each has a `why`. |
| `compare-refs.ts` | A one-off comparison of two refs: `npx tsx test/keys/validity/compare-refs.ts <baseline> <candidate> [kind...]`. With `KEEP=1` the work directory is kept. It also prints the baseline's own decisions. |

## Kinds built, and the seeds

| Kind | Cases | Output compared |
| --- | --- | --- |
| `key` | 011-35's golden key, with and without a dependency segment | keys only (environment hash, check key) |
| `rows` | golden rows; a load error; an error after the tests ran (11→12); a module skip (9→10); a module skip with no known check; the time outside the tests | each row's verdict projection (identity, outcome, fingerprint through the candidate's `sameFingerprint`), also after the tree's own `putMany`; summary, errors, location and duration are wording |
| `observe` | a stat, a read and a listing (001-132, 001-134); a recursive listing (001-139) | what `observedInputs` gives and the set `ObservedSets.add` keeps in `meta` |
| `accept` | another worktree's pass; an unconfirmed fail (001-170); a fail the worktree confirmed (001-170); its own fail; a pass stored at a format read as one (011-38); a miss (001-205's `mayWait`); a hit that lacks a check the receiver held (001 D8); 12→13 case 6 | hits (verdict projection), `mayWait`, the states the hits give (`stateFromResult`), the checks they retire |
| `assemble` | 12→13 cases 1 to 5 | keys: each test file's closure and key through `WorktreeKeys` over a fixture repository |
| `store` | 013-01's test 11, T1 and T2 (the barrier's narrowed withhold); every per-file outcome of a completed tier; a failed global setup; a timed-out tier; a cancelled backlog tier; a moved install (row 011-40) | per file: the decision (stored and under which key, withheld, re-queued, not started, unknown, split and its cap, unstable and its paths, first seen, environment, nothing), whether its growth joined, whether the results became current; the barrier's reason is wording |

Not built yet:

- `adapter:<runner>`. These cases, 013-01's tests 2 and 4 among them, and the per-adapter comparisons belong to R4 (011-41), by the coordinator's decision of 2026-10-20.

## Decisions the design did not settle

1. **Which changed lines need a case.** The design takes a line diff of the two bundles. Measured: when one module changes, esbuild renames identifiers it has to keep apart elsewhere in the bundle (`createHash` becomes `createHash2`). A bundle-wide diff then demands cases for dozens of untouched lines (an empty `check-key.ts` overlay flagged 13 renamed lines in 9 files at each side). A line needs a case only when two things hold: the bundles differ there, and the source map traces it to a changed source line. The source texts come from each bundle's `sourcesContent`, so overlays and the format pin are included. A comment or a type maps to no emitted line, so the rule in section 3 still holds. A line the candidate added must have run at the candidate. A line it removed must have run at the last release, so dropping code is covered too.
2. **The recorder's runtime.** `src/runners/observe/*.cjs` runs inside test processes, out of esbuild's reach. The comparison fires on its text, the way section 2 hashes it. Its changed code lines need coverage just as the bundle's do. Coverage comes from the observed child, which inherits `NODE_V8_COVERAGE` from the driver. Comment-only lines need no case.
3. **D1 (a) as two phases.** In `run` mode each tree's driver stores an `accept` case's runs with its own code: `recordsForFile`, then `putMany`, then the run's own worktree's `createStateSink().applyResults`. In `decide` mode the candidate's driver runs twice, once over each tree's store, opening it as a daemon would and migrating its `user_version`. The two decisions become the case's baseline and candidate outputs. The baseline's own decision is outside the verdict; `compare-refs.ts` prints it.
4. **A raised format is reported, not failed.** Until R4 replaces the guard, the guard forces a raise for every change on the path. So `failures` returns nothing when the versions differ, and the comparison is the evidence that the raised format reads as one. D6 ("a raise carries a case that differs") belongs to R4's verdict.
5. **Self-tests compare the checkout with itself.** Their expectations are exact (which case differs, which line goes uncovered). That holds whatever `HEAD` changed since the tag, including a raised format before the next release. One test still runs every case at the tag's tree and at the candidate, and requires only that no case throws at either.
6. **The format-12 probe.** At `2639208a`, `Ledger.probe` took the file's state first and read the policy's slow files. `harness/accept-rule-ledger.ts` calls it that way when its arity is 2. Once 12→13 no longer needs re-running, the branch can go.
7. **Packages moved since the release.** When the lock lines of the packages a bundle imports, or of esbuild, differ, `failures` names them and says the last release must be bundled from its own lock. Installing that lock (`npm ci` in the temporary tree) is R4's (risk 9).
8. **`observe` glue.** The kept set is the read paths plus the listing paths, as `observedGrowth` adds them for a file with an empty closure in a worktree that ignores nothing. `observedGrowth` itself needs a `SchedulerContext` with `WorktreeKeys`: closure subtraction, link targets and gitignored drops. That can join as an `assemble`-style case when a change needs it.
9. **A changed source line is changed by the trees, not by which bundle holds it (row 011-40, the coordinator's conditions of 2026-10-20).** `changedSources` read each path's text from the bundles' `sourcesContent`, and a path one bundle lacked counted as `""` there. Once the candidate's harness reads the accept rule from `accept.ts`, its bundle holds no `Ledger`, no `queue.ts` and none of the queueing modules `Ledger` imports. Every one of their lines then counted as removed and needed a case at the release, though the candidate's tree holds them unchanged. Now a path a bundle lacks is read from that side's tree: the candidate's overlay first, then its file, and a harness path from this checkout at both sides. Three rules follow, each pinned in `coverage.test.ts`: (1) a path only one tree has is changed in every line at that side, so `accept.ts` and `store-decision.ts` need cases at the candidate; (2) a path whose texts differ counts its diff's lines at each side, deleted lines at the release included, so the moved `Ledger.probe` and `recordTier` lines need cases at the release; (3) a path the trees hold alike counts no line, even when only one bundle holds it. The bundle-line side is unchanged: a line needs a case only when the two bundles differ there too. This is independent of 0.1.228's B1 fix, which changed how a line's run is read (each process's report on its own, `unrun`). This rule changes which lines must have run (`changedSources`). The reason a module's unchanged lines may leave the bundle unproven: they leave only because an import of them changed, and that import's line is a changed line, held to the proof at the side that holds it.
10. **Each decision reads its own copy of the stores a run wrote (row 011-40).** A lookup writes: it copies a set read as one to the key and sets a last-used time. The candidate's decision over the release's store had copied the set before the release's own decision ran, so that decision found it at the key, and the release's copy lines showed as unrun. `storedFor` copies each case's `store` directory per decision, and the run's own stores stay as the run left them, for `compare-refs.ts`'s print of the release's own decision too.

## 12→13 one-off (011-37 section 4)

Run on 2026-10-20 at a one-minute load of 34.6 on 24 CPUs, Node v24.21.0. The command was `TMPDIR=/tmp KEEP=1 npx tsx test/keys/validity/compare-refs.ts 2639208a 87d7ced6 assemble accept rows key`. Both trees were extracted under `/tmp/squeal-validity-refs-zwW2E4`, with the format pinned to one value in both bundles. The comparison took 2,103 ms.

| # | Case | Result |
| --- | --- | --- |
| 1 | `assemble`: a slow file's gitignored artifact that exists | keys differ (the artifact leaves the closure) |
| 2 | `assemble`: a slow file's artifact glob that matches no file | keys equal, closures equal |
| 3 | `assemble`: a slow file's tracked declared input | keys equal, closures equal |
| 4 | `assemble`: a fast file's gitignored declared input | keys equal, closures equal |
| 5 | `assemble`: a fast file with no inputs | keys equal, closures equal |
| 2-4 rows | the six `rows` cases (a run's rows depend on neither slowness nor inputs) | equal |
| 6 | `accept`: case 2's file stored by A, looked up in B | 13's code accepts it over 12's store and over 13's store alike (outputs equal). 12's own decision refuses it: no hits, `mayWait` false. |
| — | the five other `accept` cases, both `key` cases | equal |

**Verdict: no raise was due.** Case 1 differs. Cases 2 to 5 are equal with equal rows. Case 6's two decisions under 13's code agree. This confirms by experiment what 011-37 inferred, and the floor of 13 stands. 011-35's fixtures missed nothing here, because no case with equal keys gives different rows.

**Coverage was not complete.** 126 changed lines ran in no case, grouped by file:

| File | Removed at 12 | Added at 13 |
| --- | --- | --- |
| `src/core/daemon/policy-precondition.ts` | 30 | |
| `src/core/keys/ignored-inputs.ts` | 27 | |
| `src/core/scheduler/keying.ts` | 22 | 2 |
| `src/core/state/slow-skipped.ts` | 15 | |
| `src/core/scheduler/ledger.ts` | 14 | 5 |
| `src/core/state/derive.ts` | 3 | 2 |
| `src/core/state/sink.ts` | 3 | 3 |

Most of these lines are features 004-81 removed: the slow precondition, the ignored-inputs bookkeeping and the slow-skipped state. Under C3's rule a raise of that size would need cases for them. The six cases above settle the question section 4 asked, but not that one.

## Other windows run once

- **0.1.224 → 0.1.225 (15→16).** `compare-refs.ts squeal--v0.1.224 squeal--v0.1.225`, all kinds: every case equal, 2,817 ms. There were 5 uncovered lines, all in `src/core/scheduler/queue.ts`, which `Ledger` pulls into the bundle. R3's extraction of the accept rule takes them out. So 16 would join the list on this comparison, once the queueing lines leave the bundle or get a case.
- **0.1.225 → cand/0.1.226 (16→17).** Not run: `origin/cand/0.1.226` is not in this clone. The design's commit `276ed939` is a docs commit.

## Wall time

Measured with `npx vitest run test/keys/validity/compare.test.ts --reporter=verbose`, 9 tests:

| One-minute load (24 CPUs) | File | `HEAD` vs the tag (nothing on the path changed, so no corpus) | Full corpus at both trees, one comparison |
| --- | --- | --- | --- |
| 26 | 13.5 s | 0.15 s | 2.2 s |
| 54 to 59 | 34.0 s | 0.66 s | 5.6 to 7.1 s |

`beforeAll`'s `git archive` of the tag takes about 0.1 s. In the common case, when nothing on the path changed, the comparison costs two esbuild bundles and a compare. The rest of the file is the self-tests: each one bundles twice and runs its cases in four child processes (two runs and two decides).

## What the next rows need

- **R1 (011-38)** raises the format, under today's guard. This comparison then reports the raise without failing. Its outputs say whether the raised format reads as one.
- **R3 (011-40)**, done: the `store` kind, retired checks, and the three moves, each against `squeal--v0.1.231` with no differing output and no uncovered line (`docs/specifications/011-core/tasks/011-40/notes.md`). The 17 and 18 one-off for 013-02's barrier cases is recorded there.
- **R4 (011-41).** Move the entries table from `driver.ts` to the alarm, `accept.ts` and `store-decision.ts` joining it. Split the per-adapter and recorder comparisons, with the `adapter:vitest` kind and 013-01's tests 2 and 4. Enforce D6 in `failures`, and the list's rule. Implement the install of the last release's lock. Under D1 (a), an overlay on `acceptedAt` changes both compared decisions alike (011-40's notes): risk 4's accept overlay needs a verdict that reads the release's own decision. Drop `BEFORE_MOVES` and its fallbacks once the last release carries the moves.
