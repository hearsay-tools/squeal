# Keep file-level selection; this sample does not justify structural skipping

015-97 R1, 2026-10-27. **Inferred:** retain the existing file-level mechanism.
The fixed contract sample has no incremental historical structural savings.
It does not settle the value of body-level selection in a representative
application history. No product or default change follows from this probe.

| Brief question | Answer and evidence |
| --- | --- |
| 1. Exact isolated baseline? | **Verified by experiment:** Cezar `991c14b9675b34ff58cd33fe16b2333752967832`; each edit uses its actual parent tree. Independent tracked-source copies, copied local dependencies and empty scratch homes/caches. Node 24.22.1, pnpm 12.11.2 provenance, Vitest 4.1.10, Vite 8.1.4. No installer, live checkout mutation, service, agent session or full-suite run. |
| 2. Ordinary sample and eligibility? | **Verified by experiment:** 18 existing contract test files, ten ordinary commits, declared before execution. Twenty-five history candidates retained: ten selected, one test-only edit ineligible, 14 beyond the cap. Six later-added contract test files omitted. Every selected parent baseline is viable. |
| 3. Incremental work and misses? | **Verified by experiment:** both selectors execute 51 files / 879 cases across ten edits; exhaustive sample executes 180 / 3,570. Zero ordinary sample failures, so ordinary failure recall is not determined. Final costs and deliberate-regression results are below. |
| 4. Further development? | **Inferred:** no product implementation is justified by these ordinary outcomes. Further evidence needs a representative history with eligible body edits and the same file-level comparator. The present sample is not replaced or extended to obtain a favorable result. |

## Ordinary outcomes

**Verified by experiment**, the versions above. Complete historical edits are
unions over all changed paths, including tests, configuration and package
metadata. Coverage always comes from the exact pre-edit sources. These are
whole-file runs; case counts are actual reporter results.

| Edit (Cezar commit) | Whole-edit paths | File / structural files | File / structural cases | Exhaustive cases |
| --- | ---: | ---: | ---: | ---: |
| `03ed960f5` automation batch count | 9 | 2 / 2 | 17 / 17 | 361 |
| `e2f6e00cd` attention/tool display refactor | 3 | 3 / 3 | 92 / 92 | 361 |
| `891b1123b` preview browser | 53 | 6 / 6 | 120 / 120 | 361 |
| `8b7bbdf23` handoff records | 43 | 5 / 5 | 44 / 44 | 361 |
| `dd2a4b0f9` shared helpers/validators | 78 | 2 / 2 | 5 / 5 | 361 |
| `b65b01204` shared search predicate | 22 | 18 / 18 | 361 / 361 | 361 |
| `a3511d1cb` pending-ask projection | 23 | 0 / 0 | 0 / 0 | 361 |
| `6c3047fd9` attention/predicates | 44 | 10 / 10 | 196 / 196 | 361 |
| `2f9cbcd21` web optional-property types | 182 | 0 / 0 | 0 / 0 | 341 |
| `fe61be8c4` server optional-property types | 136 | 5 / 5 | 44 / 44 | 341 |

**Verified by experiment:** dependency filtering avoids 129/180 file runs
(71.7%) and 2,691/3,570 cases (75.4%). Structural coverage avoids no additional
historical run. Two changed function bodies occur in the attention/tool-display
refactor, but new module structure forces broadening. No declared historical
edit has a changed body under an unchanged module skeleton. Comment/type
changes and module changes dominate the remaining contract paths.

**Read in source code:** this is a pure Node contract/schema sample, with
shared `waits`, `runs`, `automation-schedule` and `zoned-time` modules and
multiple functions. It excludes server orchestration, storage, filesystem
and process effects, web rendering and browser tests. The six omitted newer
tests include tool-display, run-search, pending-ask and handoff tests. Their
absence matters for commits adding those features. A zero selected set is
only a statement about these 18 files, not the whole project's required work.

## Cost and deliberate regressions

**Verified by experiment:** warm totals include selection, execution and
coverage/input mapping. Seconds, summed across the ten ordinary edits:

| Arm | CPU | Wall |
| --- | ---: | ---: |
| File-level | 19.20 | 12.75 |
| Structural + coverage | 22.63 | 15.16 |
| Exhaustive sample | 62.90 | 43.76 |

Structural selection costs 17.9% more CPU and 18.9% more wall than file-level
selection here. The three independently started arms alternate their extreme
positions; the file arm stays in the middle. These are one pair per edit on a
shared host, not a stable production speed estimate.

**Verified by experiment:** over all 13 comparisons, median all-file warm
baseline CPU/wall is 7.14/5.00 s with coverage, 5.68/3.90 s for the file arm.
Median baseline collection is 1.86 versus 1.64 s; mapping/input capture is
136 versus 4.8 ms. Median Vitest initialization is 74 versus 59 ms, excluding
module imports before the initialization timer. Cold run CPU/wall is
7.44/5.27 versus 6.48/4.44 s. Complete arm process totals, which include startup,
cold and warm baselines, edited runs and teardown, are structural 236.91/165.28 s,
file 200.10/137.13 s, exhaustive 263.86/185.65 s. Coverage acquisition is not free.

**Verified by experiment:** three predeclared regressions on pinned HEAD use
only the same existing tests. Failed-case counts match exhaustive execution:

| Deliberate change | File files/cases | Structural files/cases | Oracle failures | Missed |
| --- | ---: | ---: | ---: | ---: |
| `isoWeekday` returns 99 | 4 / 59 | 3 / 57 | 4 cases in 2 files | 0 |
| `localTimeZone` returns an invalid zone | 4 / 59 | 1 / 4 | 1 case in 1 file | 0 |
| Question-count limit becomes zero | 13 / 229 | 13 / 229 | 6 cases in 2 files | 0 |

These avoid four further file runs and 57 cases through body coverage. Their
combined warm CPU/wall is 6.74/4.68 s structural versus 7.03/4.72 s file-level.
The 40 ms wall difference is too small to establish a benefit on this host.
The positive body example is concrete: the local-timezone mutation costs
0.29 CPU-s structurally versus 1.25 file-level. Three omitted readers remain
stale; the weekday mutation leaves one reader stale. These are deliberate
regressions, not ordinary historical savings or a measured real-world miss rate.

All 39 primary arms have passing cold and warm baselines. The saved audit
reproduces all 13 decisions from pre-edit inputs and checks failed-case
multisets and failed modules. Supplemental runs of only the failing files
retain assertion messages; they do not choose the comparison population.
At HEAD the sample loads 31 of 58 production contract source files. Of 106
named top-level functions, 63 have exact mapped ranges and 53 are hit. This
is not branch coverage or coverage of every function form.

Primary run load ranges from 7.32 to 17.76 on 24 CPUs; at arm starts at least
23.98 GiB was available. One worker ran at a time. An earlier attempt stopped
at load 25.45; its partial executed-case count was not recorded, so no complete
run is claimed for it. One preparation error and 19 superseded timing pilot
arms are retained. All recorded arm/pilot/interrupted test processes together
cost 1,083.88 CPU-s / 756.98 wall-s; supplemental diagnostics add 3.49/2.53 s.
Initial copy costs 34.69 wall-s and source resets 64.06 wall-s separately;
their CPU was not instrumented. The cumulative child RSS high-water mark is
551 MiB. No full repository suite ran.

## Interpretation and limits

**Read in source code / verified by experiment:** the file arm calls Squeal's
actual `importClosure`, combines recorded inputs, and broadly selects the
sample for a relevant config/package/lockfile change. It does not run the
complete daemon's environment-key/store/scheduler protocol. In particular,
`b65b01204` selects all 18 through the conservative lockfile fallback even
though the measured contract/runner dependency graph is unchanged. This may
overstate existing file-level work; it does not create incremental structural
savings here.

**Verified by experiment:** the structural adaptation uses Cezar's installed
Babel parser 8.0.7 for original TypeScript, Squeal's real coverage provider and
source mapper, exact original function ranges, independent function-body
hashes and a module skeleton. Type syntax remains in the skeleton; type-only
edits can broaden even when Vite emits equal JavaScript. Missing evidence or
exact ranges broadens selection. No post-edit hit chooses a run.

**Inferred:** absence of misses here cannot establish general reliability.
The ordinary oracle has no failures, and this sample does not exercise
reflection, source text read as data, child execution, new dependency gates,
parallel workers, cancellation or source-stamp races. Earlier reflection and
source-as-data misses remain evidence; they were not disproved by this sample.
Any changed-key omission remains **stale**. Explicit verification must bypass
skipping; a selected pass cannot make the omitted population current.

**Verified by experiment:** complete historical lockfiles differ, but all 169
nodes reachable from Vitest, Babel parser and contract Zod have identical
lockfile graph hashes in the 20 before/after snapshots and the copied installed
lock. The complete installed lock is not byte-identical to the tracked lock;
that distinction is retained. Root and contract configurations, source bytes,
full tree manifests and full changed-path sets are preserved. No newer runner
was substituted.

Sources: [probe methods and reproduction](probes/cezar-selection/README.md),
[declared sample and all candidates](probes/cezar-selection/declaration.json),
[exact inputs](probes/cezar-selection/inputs.json.gz),
[provenance](probes/cezar-selection/provenance.json),
[dependency graph audit](probes/cezar-selection/dependency-audit.json),
[results and cost summary](probes/cezar-selection/summary.json),
[compressed reporter evidence](probes/cezar-selection/runs.json.gz),
[choice replay](probes/cezar-selection/replay.json),
[verification commands and status](probes/cezar-selection/verification.txt),
[prior method and known misses](selection-tools.md).
Local contracts: 015 D8–D10 and Non-goals; 011 C3/C4/C7/C10/C15.
Cezar source citations refer to the pinned commit above; historical commit
subjects in retained data belong to `hearsay-tools/cezarion`.

Verification: script syntax checks, retained-evidence audit, choice replay and
dependency audit pass. Squeal selects no tests for these research paths
(exit 3); it reports zero known failures and five unrelated unknown test files.
The bounded scratch runs above provide this task's experimental verification.
