# 016-11 Where our core-logic defects come from

Brief: `core-defects-brief.md`. Researcher: Claude Opus 5.5, 2026-10-24 and 25. Examined: 016-09's item list rebuilt at `f6320cd7e` (its `diff` against 016-09's `tally-output.txt` is empty, so the ids match `classes.tsv`), the review files and board rows it cites, `docs/specifications/011-core/spec.md` section titles, `runner-kit.md` recommendation 1 and open question 1, and the tests under `test/` at `0cbd8a861`. Probe: `probes/core-defects/`.

Every area, mechanism and catch below is `inferred`: one reader (this researcher) coded each item from its title, its cited paths and an excerpt of up to 900 characters (rows: the row text). The counts are `verified by experiment` (`tally.mjs`, `threads.mjs`, `catch.mjs`). Items: the 455 class E items of 016-09, 415 after its residual filter, the 10 E/B among them. A re-review residual (marked `*`) counts toward cost, not toward n.

## Questions answered

| # | Question | Answer in one line | Tag |
|---|---|---|---|
| 1 | Area | Status and `status --wait` 75 (18%), scheduler and validity 68 (16%), delivery 44 (11%), daemon lifecycle 36 (9%), slow tier 27 (7%); ten more areas share the other 40%. Scheduler blockers are in 27 of the 110 FAIL rounds with a class E blocker, status in 20. | inferred, counts verified by experiment |
| 2 | Mechanism | 54 area and mechanism groups of three or more hold 309 of 415 items (74%). Three causes repeat across areas: an unhandled order or a path that skips a rule (75), a decision from evidence that does not prove it (92), concurrency and lifetime (85). Together they are 61% of items and 80% of review blockers (148 of 185). | inferred |
| 3 | Catch | A single owner for a rule: 11 groups, 59 items, 40 blockers; it already ended three long chains. A state-machine test over scheduler and delivery events: 9 groups, 65 items, 35 blockers; no such test exists. A scratch-daemon scenario: 10 groups, 56 items, 18 blockers; most kinds already have one test. Nothing before use: 12 groups, 69 items, 4 blockers (what agents are told). | inferred; tests read in source code |
| 4 | Cost | By FAIL rounds: scheduler races (7), scheduler order (6), status-wait order (6), scheduler paths that skip a rule (6), status inferring a result's producer (6). By rounds plus rows, daemon handover across versions (5 + 11) and status gaps (0 + 20) enter the top five. | inferred, counts verified by experiment |
| 5 | Check | 42 items (seed 16011): same area 41, same mechanism 38, both 37. The re-read was by the same reader in the same session, so this is an upper bound. | verified by experiment |

## Findings

### 1. Area

Areas follow 011's sections. Two are added because they hold more than ten items and have no 011 section: child processes (sweep, priority, leftovers; 011 C9 and C10 touch them) and `squeal ps` (014). Status and wait also holds `run --all` verdicts and `why`. Retries sit under state and transitions (011 C5). "Rounds" counts FAIL review files with at least one blocker of the area.

| Area | n | % | Rounds | 001 | 011 | Other | 10-01 | 10-09 | 10-13 | 10-17 | 10-21 | Undated |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| status and `status --wait` | 75 | 18 | 20 | 30 | 34 | 003 2, 004 1, 005 3, issues 5 | 0 | 28 | 12 | 16 | 17 | 2 |
| scheduler and validity | 68 | 16 | 27 | 45 | 19 | 007 2, issues 2 | 10 | 26 | 9 | 9 | 10 | 4 |
| delivery views and wording | 44 | 11 | 9 | 30 | 11 | issues 3 | 3 | 12 | 9 | 7 | 6 | 7 |
| daemon lifecycle and handover | 36 | 9 | 11 | 21 | 14 | issues 1 | 4 | 10 | 7 | 3 | 8 | 4 |
| slow tier | 27 | 7 | 12 | 14 | 2 | 004 11 | 0 | 16 | 6 | 4 | 1 | 0 |
| code checks (015) | 24 | 6 | 5 | 0 | 0 | 015 24 | 0 | 0 | 0 | 0 | 23 | 1 |
| watcher and revisions | 22 | 5 | 4 | 21 | 1 | | 3 | 16 | 2 | 0 | 1 | 0 |
| keys and closures | 20 | 5 | 10 | 12 | 6 | 004 1, issues 1 | 5 | 6 | 0 | 2 | 5 | 2 |
| focus and named demand | 18 | 4 | 5 | 0 | 16 | issues 2 | 0 | 0 | 2 | 2 | 14 | 0 |
| `squeal setup` and the CLI | 17 | 4 | 7 | 1 | 2 | 004 1, 005 12, issues 1 | 0 | 0 | 13 | 1 | 2 | 1 |
| `squeal ps` (014) | 17 | 4 | 4 | 0 | 0 | 014 17 | 0 | 0 | 0 | 0 | 17 | 0 |
| the store | 15 | 4 | 3 | 11 | 3 | issues 1 | 0 | 7 | 4 | 2 | 1 | 1 |
| state and transitions | 14 | 3 | 4 | 6 | 7 | issues 1 | 2 | 1 | 2 | 5 | 3 | 1 |
| child processes | 12 | 3 | 5 | 10 | 1 | 004 1 | 0 | 6 | 2 | 4 | 0 | 0 |
| policy and capacity | 6 | 1 | 2 | 3 | 2 | 004 1 | 0 | 1 | 3 | 0 | 2 | 0 |
| all | 415 | | 110 | 204 | 118 | 93 | 27 | 129 | 71 | 55 | 110 | 23 |

Periods start on the date shown and end before the next. Over time:

- Status and wait is the only area with 12 or more items in every period since 10-09. It is the steady source, in 001 and in 011 alike.
- The watcher had 19 of its 22 before 10-13 and 1 after. It matured.
- New features bring their defects in one burst: named demand (14 in 10-21 on), code checks (23), `squeal ps` (17), setup (13 in 10-13 to 10-17).
- The scheduler holds 9 to 10 a period after its 10-09 peak of 26.

### 2. Mechanism

Twenty mechanisms, in six families (`family-output.txt`; blockers include residuals):

| Family | Mechanisms (items) | Items | Review blockers / FAIL rounds |
|---|---|---|---|
| Decision from evidence that does not prove it | proxy 40, env 19, parse 16, input 13, name 4 | 92 (22%) | 54 / 40 |
| Concurrency and lifetime | multi 39, race 32, time 11, cancel 3 | 85 (20%) | 46 / 42 |
| Unhandled order, or a path that skips a rule | order 61, path 14 | 75 (18%) | 48 / 38 |
| Bounds and resources | count 21, cost 17, leak 15, error 15 | 68 (16%) | 26 / 24 |
| What the agent is told | gap 34, text 20, noise 8 | 62 (15%) | 6 / 6 |
| Design and duplication | spec 22, two 11 | 33 (8%) | 5 / 5 |

Definitions. **order**: a state or order of events in one process that the code does not handle. **path**: a rule held on one path, skipped by another path to the same effect. **proxy**: a fact inferred from something that does not prove it, where the fact could have been recorded (the producer of a result, the artifact a run tested, the owner of a directory). **multi**: a restart, a second daemon, worktree or session, or a mix of versions. **race**: an await or separate reads between a check and its use. **time**: a deadline or expiry that nothing re-checks. **input**: a key or watch that misses an input. **env**: a repository or host shape (symlink, workspace, editor save, Git layout). **parse**: a heuristic reader of free text or a foreign format. **name**: a path with a space, dots or a shared prefix. **gap**: output that leaves out what the agent needed. **text**: text that says more than it knows. **noise**: output that repeats or says too much. **count**: a count, sum, cap or bound. **leak**: rows, files, processes or memory never cleaned up. **cost**: CPU, reads or wait beyond need. **error**: an I/O or tool failure read as a normal answer. **spec**: behaviour missing from the spec or design. **two**: one rule in two places.

The first three families are where reviews fail (148 of 185 blockers). The fifth escapes review: 62 items, 6 blockers. Agents found them in use (issues, dogfood, friction triage).

Every group of three or more, with its items. "Rounds (alone)" counts FAIL rounds with a blocker of the group, and in brackets the rounds whose blockers were all this group's. "Rows" adds escaped rows and repair rows that cite one of those rounds. "Catch" is finding 3.

| Group | n | Rounds (alone) | Blockers | Rows | Catch | Items |
|---|---|---|---|---|---|---|
| scheduler, order | 21 | 6 (3) | 8 | 10 | machine | R21 R22 R23 R31 R32 R79 R108 R126 R128 R161 R345 R431 D146 D154 D164 D167 D168 D220 D239 L6 I10 |
| status and wait, gap | 20 | 0 (0) | 0 | 20 | none | D2 D4 D5 D7 D8 D12 D24 D30 D45 D95 D96 D97 D211 D237 D245 D319 I26 I24 I23 I21 |
| status and wait, order | 12 | 6 (4) | 6 | 6 | owner | R69 R136 R137 R194 R195 R223 R342 D32 D223 D226 D227 D228 |
| daemon lifecycle, multi | 11 | 5 (4) | 5 | 11 | daemon | R37 R39* R178 R380 R381* D15 D16 D38 D100 D101 D178 D180 D271 |
| keys, input | 10 | 5 (1) | 5 | 4 | corpus | R6 R14 R16 R27 R29 R209* R211 R214* D166 D170 D265 D287 |
| scheduler, race | 10 | 7 (2) | 7 | 5 | machine | R41 R68 R121 R141* R363 R378 R427 D182 D233 D267 D299 |
| scheduler, count | 8 | 5 (3) | 6 | 4 | machine | R12 R38 R157* R308 R310* R425 R428 R430 D195 D234 |
| watcher, env | 8 | 1 (1) | 1 | 7 | daemon | R34 D171 D174 D175 D207 D236 D282 D283 |
| store, multi | 8 | 1 (0) | 1 | 7 | daemon | R414 D188 D203 D230 D303 D327 D332 I8 |
| status and wait, proxy | 7 | 6 (1) | 6 | 4 | owner | R129 R134* R159 R238 R340 R364 D221 D222 |
| delivery, order | 7 | 4 (0) | 4 | 6 | machine | R158* R163 R374 R405 D156 D159 D160 D161 |
| setup and CLI, parse | 7 | 4 (2) | 7 | 4 | corpus | R227 R241 R243 R244 R245 R246* R247 R248 |
| delivery, text | 6 | 1 (1) | 1 | 3 | spec | R19 R35 R40* R152 D241 D254 I37 |
| child processes, race | 6 | 3 (2) | 3 | 1 | type | R53 R56 R86* R113* R168* R170 R171 R416 D318 |
| status and wait, multi | 6 | 3 (2) | 3 | 2 | daemon | R61 R62 R153 R409 D268 D270 |
| slow tier, proxy | 6 | 5 (0) | 6 | 1 | owner | R73 R75* R78* R203 R207 R210* R212 R215 R224* D281 |
| daemon lifecycle, leak | 6 | 0 (0) | 0 | 5 | daemon | R176 D49 D176 D330 L3 L4 |
| scheduler, path | 6 | 6 (1) | 7 | 1 | owner | R133* R362* R368 R369 R370 R373 R429 D116 |
| squeal ps, proxy | 6 | 1 (0) | 2 | 4 | none | R447 R448 D127 D130 D132 D133 |
| named demand, spec | 6 | 0 (0) | 0 | 6 | none | D22 D27 D28 D39 I17 I14 |
| delivery, noise | 6 | 0 (0) | 0 | 6 | none | D158 D165 D240 D316 D323 I13 |
| delivery, multi | 5 | 3 (0) | 3 | 4 | machine | R20 R82* R149 R422 D148 D150 |
| slow tier, race | 5 | 5 (1) | 6 | 1 | type | R71 R72* R76 R142* R196 R208 R222 |
| delivery, proxy | 5 | 2 (0) | 2 | 4 | owner | R81 R109 R148 D25 I32 |
| status and wait, text | 5 | 2 (1) | 2 | 2 | spec | R96 R410 R417 D94 D179 |
| status and wait, race | 5 | 1 (0) | 1 | 4 | type | R226 D173 D218 D262 D269 |
| scheduler, cost | 5 | 1 (0) | 1 | 4 | none | R302 D111 D177 D187 D217 |
| delivery, gap | 5 | 0 (0) | 0 | 5 | none | D119 D172 D242 D243 D244 |
| state, order | 4 | 3 (1) | 3 | 2 | machine | R11 R104 R419* R423 D14 |
| daemon lifecycle, proxy | 4 | 2 (1) | 2 | 3 | daemon | R63 R66 D266 D321 |
| store, leak | 4 | 1 (1) | 1 | 1 | owner | R67 R135 R150 L18 |
| slow tier, order | 4 | 4 (2) | 4 | 2 | owner | R74* R77 R197 R202 R221* D280 |
| slow tier, spec | 4 | 0 (0) | 0 | 3 | none | R100 D56 D275 D279 |
| scheduler, time | 4 | 2 (2) | 2 | 4 | machine | R147* R169 D246 D247 D249 |
| daemon lifecycle, order | 4 | 2 (0) | 2 | 2 | daemon | R359 R383 D274 I12 |
| status and wait, two | 4 | 1 (0) | 1 | 2 | owner | R365 R375 D26 I9 |
| named demand, path | 4 | 2 (1) | 4 | 0 | owner | R384 R385 R392 R395 |
| code checks, parse | 4 | 2 (0) | 2 | 2 | corpus | R454 R463 D141 D142 |
| code checks, proxy | 4 | 3 (0) | 3 | 1 | owner | R455 R459 R471 D137 |
| status and wait, cost | 4 | 1 (1) | 1 | 4 | none | R400* D36 D110 D113 D114 |
| scheduler, spec | 4 | 0 (0) | 0 | 4 | none | D41 D209 D210 I31 |
| watcher, two | 3 | 0 (0) | 0 | 1 | owner | R7 R8 D259 |
| daemon lifecycle, race | 3 | 2 (0) | 2 | 4 | daemon | R18 R90 D295 |
| scheduler, env | 3 | 0 (0) | 0 | 1 | daemon | R24 R33 D23 |
| watcher, count | 3 | 1 (1) | 1 | 1 | machine | R60 R155 R156* D258 |
| status and wait, count | 3 | 1 (0) | 1 | 0 | machine | R70 R230 R235* R411 R421* |
| watcher, error | 3 | 1 (1) | 1 | 2 | fault | R154 D257 D284 |
| delivery, cost | 3 | 0 (0) | 0 | 2 | none | R407 D214 D329 |
| state, parse | 3 | 1 (0) | 2 | 1 | corpus | R412 R413* R415 I28 |
| squeal ps, text | 3 | 1 (0) | 1 | 2 | type | R444 R449 D129 |
| code checks, error | 3 | 2 (0) | 2 | 0 | fault | R452 R457 R460 |
| code checks, multi | 3 | 2 (1) | 2 | 1 | daemon | R458 R469 D138 |
| state, gap | 3 | 0 (0) | 0 | 3 | none | D17 D35 D302 |
| keys, cost | 3 | 0 (0) | 0 | 3 | none | D153 D169 I33 |

### 3. Catch

The kind of check that would have caught each group before review (`catch.tsv`; counts in `catch-output.txt`):

| Catch | Groups | Items | Blockers | A past test or row that does it |
|---|---|---|---|---|
| none before use | 12 | 69 | 4 | Found by agents and dogfood. After the fact, `test/cli/next-step-rows.test.ts` walks a table of file states (011-27). |
| state-machine test of scheduler and delivery events | 9 | 65 | 35 | None. No test generates orders or interleavings: no `fast-check` or similar in `package.json` or `test/`. `test/scheduler/helpers.ts` runs the real scheduler and store in process, one hand-written order per test. Five test files use fake timers (`test/scheduler/runner-part-bound.test.ts`, `busy-resume.test.ts`). |
| single owner for a rule | 11 | 59 | 40 | 001-258 replaced holds, timers and sync-forget with one re-key record: "every case of reviews 13k, 13l, 13q, 13r, 13s and 13t passes", net -250 source lines. 001-305 replaced the owed list with `untold` after three rounds (13am, 13an, 13ap). 001-253 gave both parcel watches one timestamp rule after four rounds. 011-47 joined the barrier to the one validity path. 001-254 made one list of a worktree's meta rows. |
| scenario through a scratch daemon | 10 | 56 | 18 | `test/daemon/handover.test.ts` (released 0.1.31 and 0.1.32 daemons), `test/daemon/died.test.ts`, `test/store/concurrency.test.ts`, `test/cli/status-wait-successor.test.ts`, `test/e2e/worktrees.test.ts`. |
| corpus of real inputs | 4 | 24 | 16 | `test/keys/validity/` compares keys at two trees. Setup's gate reader (`test/cli/setup/gates-allow-list.test.ts`) and the fingerprint and complexity parsers have hand-written lines, not real files. |
| type | 4 | 19 | 11 | `test/daemon/escaped-identity.test.ts` pins (pid, start) on one path; a process handle type would hold it on all. 001-116 put status reads in one transaction (`test/e2e/torn-status.test.ts`); Stop and slow-tier reads still raced (R208). `null` and 0 share a number in `squeal ps` render (R444). |
| check in the spec | 2 | 11 | 3 | None: a printed claim names the state that proves it. |
| fault injection | 2 | 6 | 3 | `test/code/pass/retry-daemon.test.ts` |

Three notes:

- **Single owner** has the best record. Each of the three long chains above ended only when one mechanism replaced several. The proxy groups (status inferring a result's producer, slow-tier provenance, delivery provenance, code-check provenance) are the same pattern as 016-09's costliest seam item, runner identity inferred in `attribution.ts`: a fact inferred later that could have been recorded when it was known.
- **A state-machine test** reaches the most blockers that have no test kind today. The scheduler and status groups state their contracts as invariants already ("a result is stored only under a key whose inputs were stable for the whole run", "the wait never ends quiet while an edit's file is pending").
- **016-10 open question 1** (run the kit through a scratch daemon): its reach here is 56 items and 18 blockers, mostly lifecycle across processes (handover across versions, a second daemon on the store, a successor answering a wait). Each of these kinds already has at least one real-daemon test. State and transitions, where retirement and `unknown` live, holds 14 items. A scratch-daemon kit adds less than an owner rule or a state-machine test.

### 4. Cost

Costliest groups (`tally-output.txt`). Rows = escaped rows plus repair rows citing the group's rounds.

| By FAIL rounds | Rounds (alone) | Blockers | Rows |
|---|---|---|---|
| scheduler, race (R41 R68 R121 R141* R363 R378 R427 …) | 7 (2) | 7 | 5 |
| scheduler, order (R21 R31 R32 R126 R128 R345 R431 …) | 6 (3) | 8 | 10 |
| status and wait, order (R69 R136 R137 R194 R195 R223 R342 …) | 6 (4) | 6 | 6 |
| scheduler, path (R133* R362* R368 R369 R370 R373 R429 …) | 6 (1) | 7 | 1 |
| status and wait, proxy (R129 R134* R159 R238 R340 R364 …) | 6 (1) | 6 | 4 |

By rounds plus rows, two more enter: daemon lifecycle, multi (5 rounds, 4 alone, 11 rows) and status and wait, gap (no rounds, 20 rows, all agent friction).

The same cost by feature thread (`threads.mjs`; the lists are this reader's). These 11 threads hold 59 of the 110 FAIL rounds with a class E blocker:

| Thread | Items | Blockers | Rounds | Rows |
|---|---|---|---|---|
| `status --wait` edit window and re-key record | 26 | 9 | 9 | 16 |
| waiting Stop for slow files | 19 | 9 | 7 | 9 |
| daemon step-down and handover | 19 | 10 | 7 | 13 |
| slow-tier artifacts, preconditions, provenance | 12 | 12 | 7 | 0 |
| named demand: promotions, yields, focused runs | 22 | 14 | 6 | 7 |
| observed growth, heal and re-run | 10 | 8 | 6 | 3 |
| code checks (015) | 24 | 14 | 5 | 7 |
| child processes | 15 | 5 | 5 | 6 |
| `squeal ps` (014) | 17 | 9 | 4 | 8 |
| setup gate rewording | 8 | 7 | 4 | 4 |
| install wait and dependency keys | 18 | 4 | 3 | 6 |

Since 2026-10-15, 011 repairs on the candidate, not as rows, so rows undercount 011's threads (named demand shows none).

### 5. Check

`sample.mjs` drew 42 of the 415 (10%) with seed 16011. I coded them again from the longer excerpt in `sample.txt` before comparing (`reread.tsv`). Same area 41 of 42; same mechanism 38; both 37. The five that moved: D239 (scheduler to daemon lifecycle: a checkpoint lost when the daemon exits), R104 and R161 (order to proxy: "completed" read as "started", a superset read as a match), D241 (text to gap), D219 (spec to cost). The order, proxy and path lines are the softest. The first codes were in the same session's context, so 37 of 42 is an upper bound on agreement.

## Recommendation for Squeal

1. **The largest source is status and `status --wait` with the scheduler**: 143 of 415 items (34%), blockers in 20 and 27 FAIL rounds, every period since 10-09 (findings 1 and 4). The costliest single thread is the wait's edit window (9 rounds).
2. **Record a fact when it is known; do not infer it later** (finding 3, proxy and owner groups). The proxy mechanism alone is 40 items and 27 blockers in 25 rounds, the same cause as 016-09's runner identity. A spec check would ask, for each fact a line prints, where it is recorded.
3. **After a second FAIL round on one mechanism, look for a single owner before a third repair** (finding 3). 001-258, 001-305 and 001-253 ended chains of 3 to 6 rounds this way and removed code.
4. **Try one model-based test of the scheduler and delivery** (findings 2 and 3): generated events (edit, result, restart, install, `run --all`, cancel, a wait) and await-point interleavings, checked against invariants the spec already states. In reach: 65 items and 35 blockers with no test kind today. First replay five past scheduler race and order blockers to see if it finds them. It runs in Squeal's own suite and adds no CPU per user edit.
5. **For 016-10 open question 1**: scratch-daemon scenarios are worth it for the cross-process lifecycle groups (56 items, 18 blockers), but most of those kinds have a real-daemon test already. Rank it after 2 to 4.
6. **What agents are told is caught in use, not in review** (62 items, 6 blockers). Keep friction triage. Extend the 011-27 table test, one row per file state naming what advances it, to each new output.

Limits: one reader coded every item, from excerpts; board rows are terse, so row codes rest on a title and a sentence. The mechanism set is this reader's. The re-read is not independent. Rows are matched to rounds by the review file they cite (74 of 108 repair rows cite one). 23 items have no date. Items in the "gap", "spec" and "noise" groups are mostly friction reports and feature-shaped; a reader who counts only wrong behaviour would drop about 60 of them.

## Open questions

1. Would a second reader agree on mechanism? Not determined: no second reader ran. Order, proxy and path are where the re-read moved items.
2. Would a model-based scheduler test have found the past race and order blockers? Not determined: not tried. Recommendation 4 names the experiment.
3. What did each group cost in worker hours? Not determined: the docs record rounds and rows only.

## Sources

Read 2026-10-24 and 25:

- 016-09: `defect-causes.md`, `probes/defect-causes/` (`classes.tsv`, the item scripts, `tally-output.txt`), its item list rebuilt at `f6320cd7e`.
- `runner-kit.md` (recommendation 1, open question 1); `docs/specifications/011-core/spec.md` section titles (C1 to C15).
- The review files and board rows each item cites, at `f6320cd7e`; GitHub issues of `hearsay-tools/squeal` (`gh issue list --state all`, 93 issues, read 2026-10-24).
- Tests at `0cbd8a861`: `test/scheduler/helpers.ts`, `test/cli/next-step-rows.test.ts`, `test/keys/validity/case.ts`, `test/e2e/torn-status.test.ts`, `test/e2e/worktrees.test.ts`, `test/daemon/handover.test.ts`, `test/daemon/claims-restart.test.ts`, `test/store/concurrency.test.ts`; a search of `test/` and `package.json` for `fast-check` and `useFakeTimers`.
- Board rows quoted in finding 3: 001-253, 001-254, 001-258, 001-305, 011-27, 011-47.
- Probe: `probes/core-defects/` (`areas.tsv`, `catch.tsv`, `reread.tsv`, `sample.txt`, the scripts and their `*-output.txt`).
