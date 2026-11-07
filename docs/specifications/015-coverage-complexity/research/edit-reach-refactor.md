# Edit reach before and after wave 28 (row 015-112)

Researcher, 2026-11-07, from 13:20Z. **Phase 1 only: the "before" measurement at origin/main.** Phase 2 (the candidate) is pending the candidate SHA. Brief: `tasks/wave-28.md`, section 015-112. Read first: `research/edit-reach.md` and `probes/edit-reach/README.md`.

Versions: squeal origin/main `6db9fcb7b` (2026-11-07 13:27Z; equal in code to `2fc4ad13f`). The read-only clone is under `/tmp/er112/main`. Store copies (`store.sqlite`, `code.sqlite`, each with `-wal` and `-shm`) and copies of 8,026 `report.json` files were taken at 13:27Z from `~/projects/squeal/.git/squeal`. No test, build or benchmark ran. No live store or daemon socket was opened. Probes ran at nice 10: `probes/edit-reach-refactor/README.md`.

**Units**, as in `edit-reach.md`. A *pair* is one (source file, test file that an edit of the source re-keys). *Pair-seconds* weight a pair by the test file's recorded seconds (the median `fileDurations`). "Every source once" weights each reached source file equally. "Real edits" weights a source file by its count in the store's watch revisions of 1 to 3 paths. The *called share* is the share of pair-seconds in which the test file's newest coverage record shows that a function of the source ran (the module's top level does not count).

**Suite.** 1,490 automatic test files, 6,205 recorded s. The 17 `test/e2e/**` files (481 s) are left out: `squeal.config.json` `vitest.exclude` has excluded them since `a962e0e89` (004-81), so an edit does not re-run them. Their stored closures date from 2026-10-07 to 2026-10-19. `edit-reach.md` counted them (1,504 files, 6,696 s). Its shares are therefore not exactly comparable with these. *read in source code and store.*

**Real edits.** 106 edits of 51 reached source files, in 1,333 watch revisions from 2026-10-06 to 2026-11-07 (869 of them with 1 to 3 paths). This is a small sample, and it is smaller than in `edit-reach.md` (137 edits of 64 files). The store now holds fewer watch revisions (1,333, against 1,523 then). *read from store.*

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Before: pair-seconds and called share, overall | Every source once: 3,118,924 pair-s over 1,558 source files, a mean of 32.3% of the suite (2,002 s) per edited source; 24.5% called. Real edits: 198,538 pair-s, a mean of 30.2% (1,873 s) per edit; 26.3% called | verified by experiment |
| 2 | Before: by path kind (barrel, helper) | Barrel 40.7% of pair-s, 31.2% called (real edits: 42.7%, 39.4%). Helper 16.4%, 47.0% called (13.5%, 48.0%). Table below | verified by experiment |
| 3 | After: the same for the candidate | Pending phase 2 | — |
| 4 | Where the static and stored methods differ | At main they agree to 7 of 3,118,924 pair-s. With the excluded e2e files they would differ by 3.2%, from those files' stale closures. Differences that only a candidate has are listed in section 3 | verified by experiment |
| 5 | The limit of coverage carried over per pair | "Called" is a property of the (source, test file) pair as recorded before the wave. It holds for a candidate with unchanged behaviour. A source file that origin/main lacks counts as "no record" | inferred, with an invariant to check in phase 2 |

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

## 2. After, at the candidate

Pending. Phase 2 runs `reach.mjs` with the candidate clone and `"base": "6db9fcb7b"`, then `compare.mjs` against the phase 1 output. Two scopes are reported: all source files of each commit, and only the source files that both commits hold. The second scope keeps the real-edit weights comparable when barrels are deleted. At main, the 41 reached barrels carry 1 real edit and 119,732 pair-s of their own reach.

## 3. Where the two methods differ

- **Static against stored closures at main.** Squeal's stored import part is itself a static walk (`src/core/keys/closure.ts` `CLOSURE_METHOD = "static imports plus declared inputs"`; `src/runners/vitest/graph.ts` `importClosure`). The probe emulates that walk with esbuild and es-module-lexer. Without e2e, the stored closures and the static reach agree to 7 pair-s, in one test file: a child-process import missing from that file's stored closure. With the e2e files, 104,025 pair-s are static-only. These come from 17 e2e files whose closures were last stored between 2026-10-07 and 2026-10-19, before newer imports were added. *verified by experiment.*
- **Observed reads and child-process imports are carried over.** They were recorded on runs at older commits. The candidate keeps them per test file and drops only paths that the candidate does not track. The 106 test files that bundle or start the CLI from source read its import closure as it was at main. If the candidate's CLI closure is smaller, the "after" side overstates the observed reach. Phase 2 bounds this by comparing the value closure of the bundle entries (`src/cli/index.ts` and the others) at both commits. *inferred.*
- **Coverage "called" is carried over per (source, test file) pair.** A pair the candidate adds takes its status from the test file's record at main. A source file that origin/main lacks (a split helper file) counts as "no record". The candidate's own runs could differ only where behaviour changed, and the wave rules that out. Phase 2 checks the invariant above to catch the case. *inferred.*
- **Recorded seconds are main's.** A test file that loads fewer modules may also run faster. The pair-s use the same weights on both sides, so they measure reach, not saved seconds. *inferred.*

## Open questions

- Phase 2 numbers, after the coordinator sends the candidate SHA.
- The real-edit sample (106 edits of 51 files) is small. The weighted figures can move with a few edits.
- The recorded seconds are medians from this loaded host. Shares are robust to that load; absolute seconds read high (`edit-reach.md`).

## Sources

- Squeal at `6db9fcb7b`: `src/core/keys/closure.ts` (`assembleClosure`, `CLOSURE_METHOD`), `src/core/keys/observed.ts` (`observedMetaKey`, `observedDirectMetaKey`), `src/core/keys/modules.ts` (`observedModulesMetaKey`), `vitest.config.ts`, `squeal.config.json`.
- Store copies of `~/projects/squeal/.git/squeal/{store,code}.sqlite` and `runs/*/report.json`, taken 2026-11-07 13:27Z.
- `research/edit-reach.md` and `probes/edit-reach/`.
- Probes: `probes/edit-reach-refactor/` (`reach.mjs`, `compare.mjs`, `spec-main.json`, `summary-main.json`, `rows-main.json`).
