# Coverage-based selection across the test-file population

**Defer skipping tests.** Coverage could be researched as an ordering hint, but this study measures no prioritization benefit. It does not justify changing 011 C3/C4 or the non-goal on runtime coverage selection.

Research row 015-15, R1; 2026-10-27. Product examined: `f1068562e8595a6da9fd79ff605e2eb3212585e5`, Squeal 0.1.367. Work stayed inside the research ownership and below the 90-minute limit. No product, configuration or live-store writes; no full-suite run.

## Questions and evidence

| Question | Answer and evidence tag |
| --- | --- |
| 1. Is the population complete? | **Verified by experiment:** all 1,290 tracked files matching this commit's Vitest configuration were inventoried. Squeal includes 1,270 and excludes 20 e2e files. Retained records cover all 1,270; current records cover only 57. Current child-only reach and per-run runtime provenance are not complete. |
| 2. What could line selection save? | **Verified by experiment:** 40 source-changing first-parent commits contain 97 source edits and 53,073 stored-closure file-edit pairs. Old-source/time-compatible records and case-outcome checks leave 11,299 no-hit pairs, 21.29% of all pairs. These are historical estimates, not replayed runs. After coarse fallbacks, three individual source-edit candidates remain; none remains when all source edits in each commit are combined. |
| 3. Can it miss failures? | **Verified by experiment:** naive old-line selection misses 8 of 9 deliberately introduced failures in 10 adversarial fixtures. This is an adversarial denominator, **not an observed real-world regression frequency**. The tenth fixture is a non-failing control. |
| 4. Proceed, narrow or defer? | **Inferred:** defer skips. An optional ordering experiment could retain every affected test and its current key rules. Its latency, CPU, failure-discovery and starvation effects are unmeasured. |

## Population completeness, separate from soundness

**Verified by experiment**, read-only snapshot at 15:12:52–15:12:56 UTC:

| Population fact | Count |
| --- | ---: |
| Tracked configured Vitest test files / Squeal-included files | 1,290 / 1,270 |
| Excluded e2e files, outside this selection population | 20 |
| Current-key record / only a stale-key record / no retained record | 57 / 1,213 / 0 |
| Chosen records with skipped or todo test cases | 9 files, 17 cases |
| Chosen records with unread sources / missing manifest parts | 0 / 0 |
| Stored closures marked incomplete | 1,270 |

The projection holds explicit test-file keys, source blob ids, covered and executable bitsets, record times and result provenance. It retains current and latest coverage-bearing keys: 1,285 distinct records out of 115,063 provider-v2 records in the store. All chosen file-level results say `pass`; this means the file loaded, **not that all its test cases passed**. The archive estimate separately reads case outcomes.

**Verified by experiment:** 413 chosen records have every captured source at the research commit's blob. This still does not prove a current key: the test, environment, installed dependencies and other inputs also matter. All 1,270 stored closure rows have `complete=0`, and may have been updated by another worktree. They provide a frozen file-closure estimate of today's selection rule, not an exact historical scheduler replay.

**Read in source code**, 015 D8 and the Vitest adapter at the examined commit: inspector users and non-isolated projects can run without coverage. No absent record may mean “does not execute this source.” There is no complete per-file historical skip-reason ledger in this projection. The nine skipped-test files are distinct from coverage-provider skips. Lexical inspector mentions occur in 119 test-side closures; that is a risk signal with false positives, not 119 proven provider skips.

**Read in source code / prior experiment**, `research/child-processes.md`: the older 1,040-file study found 50 of 7,582 functions reached only in child processes, in 18 source files; 63 test files had children that ran source. These are historical counts, not this population's child-only count. **Verified by experiment:** 862 of today's 1,270 test-side closures mention child processes or threads. The current exact child-only population is **not determined**: stored in-process records cannot supply it. The isolated child-only fixture confirms why missing coverage must fall back.

## Version and soundness limits

**Read in source code:** the retained record format stores provider version and source identity, but no explicit Node/Vitest runtime version. Hashes of environment inputs cannot recover those versions. The root project's empty project identity and configuration identify the sampled population as Vitest; this is source/configuration evidence, not a per-record recorded runner label. The research runtime is Node 24.22.1, Vitest 5.0.3, tsx 4.23.15.

All stored estimates here use **provider v2**, never v3. Squeal also reported the two known node:test mapping/blob failures in this worktree. They were not repaired here. Source at repaired main `b7b01dea8ab23287282b17f874d26b1fb4f7640b` includes `e04e0d009`: `ownMap` reads retained lazy inline maps, rejects unusable transformed evidence, and raises the provider to 3. It repairs the node:test `ownRecord` path, not the Vitest mapping path used to collect these root test files.

Thus v2 supports a **qualified historical Vitest geometry estimate**: which stored source bytes and lines were seen at those old keys. It supports neither a v3-current-key claim nor a node:test soundness claim, and it does not measure v3 costs. No old record is relabelled repaired. The adversarial fixtures use inspector precise coverage and Squeal's identity mapper over untransformed `.mjs` files; they do not use the affected node:test/tsx source-map path. Their counterexamples do not depend on accepting the broken provider's evidence.

## Savings estimate and conservative fallbacks

**Verified by experiment:** `history.py` opened stores read-only and searched all 1,270 files in 246.92 seconds, under its 300-second cap. It visited 227,813 retained file-result keys and decoded 90,333 records, reading 2,971,624,650 compressed record bytes. It selects records whose source blob equals the edit's **parent** blob and whose result and coverage timestamps precede the commit. `outcomes.py` then qualified 7,308 selected keys in a separate timed read.

| Classification of all 53,073 file-edit pairs | Count |
| --- | ---: |
| No old source: source added | 11,040 |
| No retained pre-commit record with the old source blob | 17,483 |
| Empty old hunk: insertion has no old lines to intersect | 4,837 |
| Nonpassing case outcomes / skipped cases | 126 / 108 |
| Compatible old-source record, changed old lines hit | 8,180 |
| Compatible old-source record, no changed old line hit | 11,299 |

No unmatched edit or missing pair is silently dropped. A source/time match is weaker than **whole-key validity**. It does not prove that the test text, all other source/data blobs, environment, packages, setup or observation set equal the parent's inputs. Several selected records came from dirty worktrees. Commit time is not the time editing started. No pre-edit whole-key reconstruction was made.

The 11,299 pairs are 58.01% of the 19,479 source-compatible, passing, non-skipped hit/no-hit pairs, but only 21.29% of the whole denominator. Their summed historical file durations are 69,276 seconds, 63.07% of durations in that matched subset. This is neither CPU saved nor elapsed time saved: file wall durations repeat across edits, and cache adoption, cancellations and parallelism were not replayed. The latest-record, **post-edit** comparison finds 7,206 no-hit pairs; that is hindsight and cannot drive a prospective skip. It must not be compared directly with the old 30-file study's 71% as if both were population-wide prospective results.

The following intentionally broad fallbacks quantify how much of the apparent gain survives. They are a screening heuristic, not a sound program analysis:

1. Retain every missing, source-mismatched, untimed, skipped, nonpassing or empty-old-hunk pair above.
2. Of 11,299 no-hit pairs, retain 11,278 when the source is added/deleted, is not JS/TS, or any hunk changes line count. This coarse geometry fallback also rejects safe edits; it is not proof that equal-length edits are safe.
3. Of the remaining 21, retain 18 when the test-side stored closure mentions child/thread execution, inspector, data reads or reflection. Signals overlap: 11 child/thread, 17 data-read, 12 reflection, 0 inspector. Text scans can miss indirect operations and can match strings/comments.

**Three source-edit candidates remain**, all for `eaa759bfb`, `src/core/lint/surface/deliver.ts`, old blob `af361ca63e22d0982c7d3d38699d5e98e92ab3ba`, hunks at old lines 36, 92 and 240. They are `test/cli/failures-per-check.test.ts` (1,000.68 ms), `test/cli/main.test.ts` (521.65 ms), and `test/delivery/slow-told.test.ts` (376.73 ms). Each has a pre-commit matching source record, passing cases without skips, no hit on those lines, equal-length modification hunks, and no listed lexical risk signal. Together they represent 1,899.06 ms of historical file duration, **not a measured saving**. Inspection shows this edit renames the `LintRead` TypeScript interface and two type annotations. It is not evidence for skipping arbitrary executable body changes. Full keys remain unproven for all three.

Combining all source edits per commit gives 27,994 distinct commit/test pairs, not 53,073 actual runs. Only 4,328 have no-hit evidence for every selected source; 4,147 also use one record key across those sources. **Zero** survives the coarse fallback policy for the whole source-changing commit. Other changed test/config/input files and cache hits are still unmodelled. A strict fallback that keeps existing whole-key validity and reruns changed closure inputs yields **zero proven safe skips**, and introduces no coverage-based omission relative to current selection.

## Adversarial soundness and decision

**Verified by experiment**, Node 24.22.1, ten serial isolated fixtures, initial load below 24 CPUs:

| Deliberate change | Mutated result | Naive old-line decision |
| --- | --- | --- |
| Read changed text through an uncalled function's `toString` | fail | miss |
| Read changed data from a file | fail | miss |
| Change an uncalled hoisted function's arity | fail | miss |
| Add top-level throwing code | fail | miss |
| Delete a hoisted declaration read through `typeof` | fail | miss |
| Change an executed import | fail | run |
| Use stale coverage after another dependency changes branch reach | fail | miss |
| Change code executed only by a child | fail | miss |
| Add a syntax error inside an unused function | fail | miss |
| Change an unused body with no observable effect | pass | skip |

Fallbacks for missing/data/child evidence, stale dependencies, additions/deletions, parsing and declarations leave **one missed adversarial failure: reflection**. Adding the fixture's known reflection flag catches it. Those flags are labelled properties of these fixtures, not a proven general detector. A full-key fallback retains all nine failing fixtures. Prioritizing while retaining all affected files avoids a new skip mechanism; no experiment here proves it improves first-failure latency, CPU or total time.

**Inferred recommendation:** keep file-level validity and selection. Revisit skipping only with complete pre-edit keys, producer/runtime provenance, child/data/reflection handling and a sound equivalence argument. If ordering is proposed, first compare it with existing failure/direct-import/duration priority without dropping tests. No new implementation is authorized by this report.

## Reproduction, verification and sources

Exact commands, saved outputs and snapshot formats are in [the probe README](probes/line-level-selection/README.md). `audit.json` checks population totals, every selected old blob/time, pair accounting and fixture baselines. Python parse and JavaScript syntax checks pass. The targeted Squeal reading is preserved in `affected-status.txt`; these research paths select no tests. The two unrelated node:test failures remain known. No broad run, build or typecheck was needed for these research-only files.

Sources read: [015 Non-goals, D8–D10](../spec.md), [015 amendments](../status.md), [011 Non-goals, C3/C4/C7/C10](../../011-core/spec.md), [coverage collection Q7](coverage-collection.md), [child-process findings](child-processes.md), and [Round 3 cost limits](../tasks/015-14/round-3/notes.md). At the examined commit: `src/core/code/coverage/{record,parts,map,types}.ts`, `src/runners/vitest/coverage.ts`, `src/core/{store/schema,code/store/schema,keys/check-key}.ts`. Repair source: [e04e0d009](https://github.com/hearsay-tools/squeal/commit/e04e0d009c0ea75cc54e4a928b01226f7800e63f), with final `own-map.ts` read at main `b7b01dea8`. The previous cost studies do not supply this change's net CPU benefit; Round 3's two CPU pairs failed their agreement rule.
