# Edit reach before and after wave 28 (row 015-112)

Researcher, 2026-11-07, from 13:20Z. Phase 1 (before, at origin/main) and phase 2 (after, at the candidate `cand/0.1.414` `963aff844`). Brief: `tasks/wave-28.md`, section 015-112. Read first: `research/edit-reach.md` and `probes/edit-reach/README.md`.

Versions: squeal origin/main `6db9fcb7b` (2026-11-07 13:27Z; equal in code to `2fc4ad13f` and to the candidate's main base `b21efef01`: no change outside `docs/`). Candidate `963aff844a83` (`cand/0.1.414`, 015-110 and 015-111). Read-only clones are under `/tmp/er112/main` and `/tmp/er112/cand`. Store copies (`store.sqlite`, `code.sqlite`, each with `-wal` and `-shm`) and copies of 8,026 `report.json` files were taken at 13:27Z from `~/projects/squeal/.git/squeal`. No test, build or benchmark ran. No live store or daemon socket was opened. Probes ran at nice 10: `probes/edit-reach-refactor/README.md`.

**Units**, as in `edit-reach.md`. A *pair* is one (source file, test file that an edit of the source re-keys). *Pair-seconds* weight a pair by the test file's recorded seconds (the median `fileDurations`). "Every source once" weights each reached source file equally. "Real edits" weights a source file by its count in the store's watch revisions of 1 to 3 paths. The *called share* is the share of pair-seconds in which the test file's newest coverage record shows that a function of the source ran (the module's top level does not count).

**Suite.** 1,490 automatic test files, 6,205 recorded s. The 17 `test/e2e/**` files (481 s) are left out: `squeal.config.json` `vitest.exclude` has excluded them since `a962e0e89` (004-81), so an edit does not re-run them. Their stored closures date from 2026-10-07 to 2026-10-19. `edit-reach.md` counted them (1,504 files, 6,696 s). Its shares are therefore not exactly comparable with these. *read in source code and store.*

**Real edits.** 106 edits of 51 reached source files, in 1,333 watch revisions from 2026-10-06 to 2026-11-07 (869 of them with 1 to 3 paths). This is a small sample, and it is smaller than in `edit-reach.md` (137 edits of 64 files). The store now holds fewer watch revisions (1,333, against 1,523 then). *read from store.*

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Before: pair-seconds and called share, overall | Every source once: 3,118,924 pair-s over 1,558 source files, a mean of 32.3% of the suite (2,002 s) per edited source; 24.5% called. Real edits: 198,538 pair-s, a mean of 30.2% (1,873 s) per edit; 26.3% called | verified by experiment |
| 2 | Before: by path kind (barrel, helper) | Barrel 40.7% of pair-s, 31.2% called (real edits: 42.7%, 39.4%). Helper 16.4%, 47.0% called (13.5%, 48.0%). Table below | verified by experiment |
| 3 | After: the same for the candidate | Every source once: 2,722,291 pair-s (**−12.7%**), 1,530 source files, a mean of 28.7% per edited source; **27.8%** called. Real edits: 178,660 pair-s (**−10.0%**), a mean of 27.4% (1,701 s) per edit; **29.3%** called. Barrel pairs fall from 40.7% to 0.1%; most of them stay as transitive or helper pairs | verified by experiment |
| 4 | Where the static and stored methods differ | At main they agree to 7 of 3,118,924 pair-s. With the excluded e2e files they would differ by 3.2%, from those files' stale closures. Differences that only a candidate has are listed in section 3 | verified by experiment |
| 5 | The limit of coverage carried over per pair | "Called" is a property of the (source, test file) pair as recorded before the wave. A source file that origin/main lacks counts as "no record". The invariant holds by real edits (52,309 before and after). Every source once, it falls by 5,068 (0.7%): 1,599 from the rename of the scheduler helpers, and 3,469 from functions that ran only while a module loaded, in modules the tests no longer load | verified by experiment |

## 1. Before, at origin/main `6db9fcb7b`

Static mode: the import part of each test file is the emulated value graph at the commit, plus the setup and config closure (`vitest.config.ts`, `test/global-teardown.ts`). From the store come only the observed reads (`meta observed.`), the child-process imports (`observedModules.`) and the policy's declared inputs. *verified by experiment.*

| Path kind | Every source once: pair-s | Share | Called | Real edits: pair-s | Share | Called |
|---|---|---|---|---|---|---|
| **barrel** | 1,270,516 | **40.7%** | **31.2%** | 84,848 | **42.7%** | **39.4%** |
| **test helper** | 511,181 | **16.4%** | **47.0%** | 26,816 | **13.5%** | **48.0%** |
| transitive import | 353,893 | 11.3% | 29.8% | 20,739 | 10.4% | 24.4% |
| direct import | 28,566 | 0.9% | 71.9% | 1,302 | 0.7% | 74.7% |
| types-only module | 5,772 | 0.2% | 0% | 0 | 0% | — |
| observed read | 612,635 | 19.6% | 0% | 41,458 | 20.9% | 0% |
| declared input | 190,377 | 6.1% | 0% | 11,131 | 5.6% | 0% |
| `import type` only | 76,114 | 2.4% | 0% | 6,740 | 3.4% | 0% |
| child process imported it | 52,600 | 1.7% | 0% | 5,504 | 2.8% | 0% |
| setup or config closure | 17,268 | 0.6% | 0% | 0 | 0% | — |
| **all** | **3,118,924** | 100% | **24.5%** | **198,538** | 100% | **26.3%** |

Every automatic test file has a coverage record (provider 3), so "no record" is 0% at main. The 0% called for observed, declared, child-process and type-only pairs means only that coverage does not see these paths. It does not mean the tests do not need them (`edit-reach.md`, section 3).

**The most the wave can remove.** Barrel and helper pairs in which no function ran: 873,811 + 270,851 = 1,144,662 pair-s, which is 36.7% of all pair-s (real edits: 51,450 + 13,938 = 65,388, 32.9%). The true cut is lower: the defining modules have imports of their own, and many of them are needed. *verified by experiment (bound only).*

**Invariant for phase 2.** The refactor changes no behaviour. A test file that called a function of a source file therefore still imports that file, so the called pair-seconds must stay at 763,064 (every source once) and 52,309 (real edits). A drop would mean a lost import or a misread carry-over. A rise is possible only for source files that the candidate adds.

**Single gateways at main** (`cuts` in `summary-main.json`). Each figure is the share of value pair-s that no longer holds if that one file passed no imports on. The figures do not add up, because other paths can still hold a pair:

| Gateway | Kind | Test files | Pair-s cut, every source once / real edits |
|---|---|---|---|
| `test/scheduler/helpers.ts` (015-111) | helper | 153 | 16.9% / 15.3% |
| `src/core/delivery/index.ts` | barrel | 610 | 6.0% / 3.5% |
| `src/core/scheduler/index.ts` | barrel | 390 | 4.3% / 7.0% |
| `src/core/state/index.ts` | barrel | 877 | 3.1% / 12.4% |
| `src/core/status/index.ts` | barrel | 410 | 2.4% / 1.1% |
| `src/core/retry/index.ts` | barrel | 815 | 0.7% / 0% |

At main there are 43 barrels by the probe's rule (a module that holds only imports and export lists). Eleven files under `src/` and `test/` have an `export *` line. `test/scheduler/helpers.ts` had 0 real edits in the window. As an edited source it re-keys 154 test files (1,599 s). *verified by experiment; counts read with `git grep`.*

## 2. After, at the candidate `963aff844`

Same method and the same store copy: `reach.mjs` in static mode on the candidate clone, with `"base": "6db9fcb7b"`, then `compare.mjs` (output: `probes/edit-reach-refactor/compare-main-cand.md`). The suite is unchanged: 1,490 automatic test files, 6,205 s, and no test file was added or removed. Under `src/` the candidate deletes 32 files: 29 barrels and 3 other re-export files. It renames `test/scheduler/helpers.ts` to `test/scheduler/vitest-harness.ts` and adds 4 helpers beside it. *verified by experiment; file changes read with `git diff --name-status`.*

| Measure | Before | After | Change |
|---|---|---|---|
| Pair-s, every source once, all sources | 3,118,924 | 2,722,291 | **−12.7%** |
| the same, only the source files both commits hold | 3,008,426 | 2,715,930 | −9.7% |
| Pair-s, real edits, all sources | 198,538 | 178,660 | **−10.0%** |
| the same, only the source files both commits hold | 193,347 | 178,661 | −7.6% |
| Mean share of the suite per edited source | 32.3% (1,558 files) | 28.7% (1,530 files) | −3.6 points |
| Mean share per real edit | 30.2% (1,873 s) | 27.4% (1,701 s) | −2.8 points (−172 s) |
| Called share, every source once | 24.5% | 27.8% | +3.3 points |
| Called share, real edits | 26.3% | 29.3% | +3.0 points |

The difference between the two scopes is the reach of the deleted files themselves: 110,430 pair-s, and 1 real edit (`src/core/slow/index.ts`, 5,189 pair-s).

**By path kind.** A pair takes the strongest kind it has (`edit-reach.md` section 2). With a barrel gone, a pair that was "barrel" at main and still holds becomes "transitive" or "helper". A per-kind before-and-after row therefore shows pairs changing kind, not only pairs going away. Both views follow:

| Path kind | Before: pair-s, called | After: pair-s, called | Real edits before → after |
|---|---|---|---|
| barrel | 1,270,516, 31.2% | 3,904, 19.0% | 84,848 → 123 |
| test helper | 511,181, 47.0% | 979,007, 47.6% | 26,816 → 60,489 |
| transitive import | 353,893, 29.8% | 756,666, 35.1% | 20,739 → 51,282 |
| direct import | 28,566, 71.9% | 32,231, 79.0% | 1,302 → 1,714 |
| types-only module | 5,772, 0% | 0 | 0 → 0 |
| observed, declared, child process, `import type`, setup | 948,994, 0% | 950,482, 0.0% | 64,833 → 65,053 |

Value pairs that the candidate no longer holds, on source files that both commits keep, by their kind at main (`removed.mjs`). Every source once: 322,669 pair-s (10.3% of the before total), of which barrel 243,342 (7.8%), helper 62,902 (2.0%), transitive 10,084, types-only 5,772, direct 569. Real edits: 15,237 (7.7%), of which barrel 9,038 (4.6%) and helper 5,434 (2.7%). Of these, 30,173 pair-s (551 by real edits) are still reached through an observed read, a declared input or a child-process import, so they change kind and stay. The candidate adds no new value pair (`added.mjs`: 0). *verified by experiment.*

**Against the bound.** At main, barrel and helper pairs in which no function ran held 1,144,662 pair-s (36.7%). The candidate removes 12.7% of all pair-s, about a third of that bound. The rest of the former barrel pairs hold through the defining modules' own imports.

**The remaining barrels**, by the probe's rule: `src/core/keys/index.ts` and `src/runners/observe/index.ts` (kept for the key alarm's old releases, 015-110's notes), `evals/lib/index.mjs`, and test fixtures and validity entries. Barrel-kind pairs: 3,904 pair-s (0.1%). *verified by experiment.*

**The scheduler helpers (015-111).** At main, `test/scheduler/helpers.ts` was the largest single gateway: 153 test files, 16.9% / 15.3% of pair-s if it passed no imports on. At the candidate its successor `test/scheduler/vitest-harness.ts` is still the largest: 136 test files, 15.2% / 9.4%. The next gateways at the candidate are `src/cli/main.ts` (104 files, 6.9% / 8.4%), `src/core/scheduler/scheduler.ts` (382 files, 6.8% / 8.0%) and `src/harness/claude-code/hooks.ts` (105 files, 4.9% / 3.8%). *verified by experiment (`cuts` in `summary-cand.json`).*

**The called invariant.** By real edits, called pair-s are 52,309 before and after: exactly equal. Every source once, they fall from 763,064 to 757,996 (−5,068, −0.7%). On kept source files, called pairs that lose their import path hold 3,727 pair-s (`lostcalled.mjs`). Of these, 258 stay reached through an observed read or a declared input, so the net loss there is 3,469. All of the 3,727 are functions that run while the module loads. Examples: `src/core/code/crap/loaders.ts:71`, the `reduce` callback of the top-level `RECORD_WAIT_MS` (501 test files, 2,826 pair-s); `src/core/retry/text.ts:26`, `waitedText` for the top-level `BOUND_TEXT` (81 files); `src/core/code/coverage/parts.ts:218`, `src/core/daemon/policy.ts:58,62` and `policy-checks.ts`. These tests loaded the modules only through barrels and called nothing in them. The other 1,599 pair-s are the rename: `test/scheduler/helpers.ts` is gone, and `test/scheduler/vitest-harness.ts` did not exist at the base, so it has "no record". 3,469 + 1,599 = 5,068. No source file gains called pair-s. No lost pair points to a test that lost an import it uses. *verified by experiment; function lines read in source at `6db9fcb7b`.*

## 3. Where the two methods differ

- **Static against stored closures at main.** Squeal's stored import part is itself a static walk (`src/core/keys/closure.ts` `CLOSURE_METHOD = "static imports plus declared inputs"`; `src/runners/vitest/graph.ts` `importClosure`). The probe emulates that walk with esbuild and es-module-lexer. Without e2e, the stored closures and the static reach agree to 7 pair-s, in one test file: a child-process import missing from that file's stored closure. With the e2e files, 104,025 pair-s are static-only. These come from 17 e2e files whose closures were last stored between 2026-10-07 and 2026-10-19, before newer imports were added. *verified by experiment.*
- **Observed reads and child-process imports are carried over.** They were recorded on runs at older commits. The candidate keeps them per test file and drops only paths that the candidate does not track. The 106 test files that bundle or start the CLI from source read its import closure as it was at main. The value closure of the five bundle entries (`src/harness/build.ts`: `src/cli/index.ts`, `ps-index.ts`, `core/daemon/front-desk.ts`, `core/code/coverage/map-worker.ts`, `core/lint/provider/worker.ts`) holds 778 files at main and 739 at the candidate. Of the files the candidate keeps, 14 leave that closure. Observed reads of those 14 that the candidate reaches by no other path amount to 5,579 pair-s in 69 test files: at most 0.2% of the "after" total, and 0 by real edits (`observed-bound.mjs`). The overstatement is therefore at most 0.2 points. *verified by experiment (bound); that the bundle would stop reading them is inferred.*
- **Coverage "called" is carried over per (source, test file) pair.** A pair the candidate adds takes its status from the test file's record at main. A source file that origin/main lacks (a split helper file) counts as "no record". The candidate's own runs could differ only where behaviour changed, and the wave rules that out. The invariant check in section 2 found no such case. A rename loses the record: `test/scheduler/vitest-harness.ts`, 1,599 called pair-s. *verified by experiment.*
- **Recorded seconds are main's.** A test file that loads fewer modules may also run faster. The pair-s use the same weights on both sides, so they measure reach, not saved seconds. *inferred.*

## Open questions

- Seconds saved per edit. The pair-s keep main's recorded seconds, so they measure reach, not run time. A test file that loads fewer modules may also start faster. Only runs at the candidate can show that.
- The real-edit sample (106 edits of 51 files) is small. The weighted figures can move with a few edits.
- The recorded seconds are medians from this loaded host. Shares are robust to that load; absolute seconds read high (`edit-reach.md`).

## Sources

- Squeal at `6db9fcb7b`: `src/core/keys/closure.ts` (`assembleClosure`, `CLOSURE_METHOD`), `src/core/keys/observed.ts` (`observedMetaKey`, `observedDirectMetaKey`), `src/core/keys/modules.ts` (`observedModulesMetaKey`), `vitest.config.ts`, `squeal.config.json`.
- Store copies of `~/projects/squeal/.git/squeal/{store,code}.sqlite` and `runs/*/report.json`, taken 2026-11-07 13:27Z.
- `research/edit-reach.md` and `probes/edit-reach/`.
- Probes: `probes/edit-reach-refactor/` (`reach.mjs`, `compare.mjs`, `removed.mjs`, `added.mjs`, `lostcalled.mjs`, `observed-bound.mjs`, `spec-{main,cand}.json`, `summary-{main,cand}.json`, `rows-{main,cand}.json`, `compare-main-cand.md`).
- Squeal at `963aff844` (`cand/0.1.414`): `src/harness/build.ts` (bundle entries), the files listed by `git diff --name-status 6db9fcb7b 963aff844 -- src test`.
