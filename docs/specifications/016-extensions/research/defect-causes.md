# 016-09 What caused our defects

Brief: `defect-causes-brief.md`. Researcher: Claude Opus 5.5, 2026-10-24. Examined: this repository at `f6320cd7e` (0.1.298 on the board), and `gh issue list --state all` for `hearsay-tools/squeal` read the same day (93 issues). Probe: `probes/defect-causes/` (scripts that list the items, `classes.tsv` with the reading, and the output of the counts).

Every class below is `inferred`. One reader (this researcher) classed every item from its title, its first cited paths and an excerpt of up to 900 characters. Nobody else classed them. A second reader could move items between C and B, or between E and A (see Limits).

## Questions answered

| # | Question | Answer in one line | Tag |
|---|---|---|---|
| 1 | Counts per class and spec, with cost | 722 distinct defects. A (seam) 22, 3%. B (kit) 11, 1.5%. C 97, 13%. D 31, 4%. E 415, 57%. F 39, 5%. G 107, 15%. When a secondary class counts too, A or B touches 61, 8%. 4 of 169 FAIL rounds failed on A blockers alone, 1 on B alone. Most other FAIL rounds were E. | inferred, counts verified by experiment |
| 2 | Every A and B item | 22 A and 11 B, listed below with file, line and reason. | inferred |
| 3 | Two examples per class, and items not placed | Below. 54 items were not defects (feature rows, dogfood runs, designs), 3 were seam clean-up rows, 4 were duplicates. 8 items sit on the A/C or A/D line. | inferred |
| 4 | The five costliest A or B items | (1) runner identity in core attribution, 3 FAIL rounds in a row and an accepted residual. (2) observed paths through the injected store: 3 findings in 3 specs, 2 repair rows, 3 rows still open. (3) `harness/shared` parses runner commands and names runners: 4 blockers. (4) interrupted Vitest runs: 4 blockers in 4 reviews. (5) pytest named in core status: one whole FAIL round. | inferred, cost read in the board and reviews |
| 5 | Does the share change over time | A plus B was 4.8% of defects before 2026-10-17 and 3.5% from then on. With secondaries it was 9.6% and 5.3%. That is a small fall at these counts, and it follows what was built (runners before, 011 core features after), not the split. C fell from 39% of review items (2026-10-01 to 10-09) to 3 to 4% after 10-17. | inferred |

## Method

Items (verified by experiment, `extract.mjs`, `rows.mjs`, `rows2.mjs`, `items.mjs`):

- **Reviews**: 313 review files. 171 are FAIL (170 say FAIL; 001 `wave-1.md` gives no verdict but lists blockers). Their blocker and should-fix sections give 472 items: a `### ` heading each, or a top-level bullet where a section has no headings. Nits are left out.
- **Escaped defects**: 263 board rows in defect sections (dogfood, `lessons.md`, "found during", defect waves) that are not reviews, research, proofs or repairs of a review; 75 Triage and `gh-N` rows; 27 entries of the Later list; 21 issues that no row or Later entry names. Issues #57 and #89 have the `duplicate` label and are dropped.
- **Duplicates**: an issue counts once, through its row. Row 007-40 is the same defect as review items R317 to R319, so it is dropped. A re-review item whose title says "residual", "still", "remains", "prior", "partially" or "unchanged" is the same defect as an earlier blocker, so it leaves the deduplicated count (75 items). R213 matches the filter but is a first-round finding, so it stays.
- **Not defects** (`X`, 54): feature rows in defect waves, dogfood runs, designs. Rows 007-47, 007-48 and 007-52 are seam clean-up rows from the quality scan (`XS`, 3). They are evidence of seam cost, not defects.

Total: 858 items. 797 are defects, 722 after residuals are removed. The brief allowed a sample above about 400. Every item was classed, so no sample was needed.

Cost (verified by experiment, `cost.mjs`): review files and FAIL verdicts per spec, blockers, and repair rows. Since 2026-10-15, 011 repairs on the candidate, not as rows, so its cost is in its `-r2` and `-r3` files.

Cross-check (verified by experiment, `location.mjs`): of 466 review defects, 65 cite `src/runners/**` first (52 runner, 13 recorder), 19 `src/harness/shared`, 14 one harness, 207 `src/core`, 39 `src/cli`, 91 `test/` or `evals/`. The runner-located 65 are the most a kit can reach among review items. I put 7 in B, 2 in A and 56 in C.

## Findings

### 1. Counts and cost

All defects, deduplicated, n = 722: A 22, B 11, C 97, D 31, E 415, F 39, G 107. Before deduplication, n = 797: A 24, B 11, C 103, D 35, E 455, F 43, G 126 (`tally-output.txt`). Review blockers alone (n = 320): A 14 (4%), B 7 (2%), C 50 (16%), D 14 (4%), E 185 (58%), F 4, G 46.

Per spec, before deduplication, with cost:

| Spec | Defects | A | B | C | D | E | F | G | Reviews | FAIL | Blockers | Repair rows |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 001 core loop (to 10-17) | 362 | 6 | 6 | 60 | 4 | 224 | 21 | 41 | 107 | 62 | 107 | 46 |
| 003 node:test | 10 | 2 | 0 | 6 | 0 | 2 | 0 | 0 | 9 | 6 | 7 | 7 |
| 004 slow suites | 31 | 2 | 0 | 1 | 1 | 23 | 0 | 4 | 24 | 11 | 23 | 1 |
| 005 adoption | 25 | 2 | 0 | 0 | 0 | 17 | 0 | 6 | 14 | 6 | 17 | 14 |
| 006 evals | 42 | 0 | 0 | 0 | 0 | 0 | 0 | 42 | 19 | 13 | 28 | 16 |
| 007 pytest | 35 | 5 | 0 | 23 | 0 | 3 | 1 | 3 | 14 | 10 | 24 | 7 |
| 008 OpenCode | 22 | 0 | 0 | 0 | 17 | 0 | 2 | 3 | 6 | 4 | 10 | 4 |
| 009 Pi | 11 | 3 | 1 | 1 | 3 | 0 | 2 | 1 | 4 | 1 | 1 | 1 |
| 011 core (from 10-17) | 173 | 2 | 3 | 9 | 5 | 128 | 12 | 14 | 83 | 43 | 76 | 8 |
| 012, 013, 014, 015, 002, 010 | 65 | 2 | 1 | 3 | 4 | 41 | 4 | 10 | 33 | 15 | 33 | 4 |
| issues and Later without a spec | 21 | 0 | 0 | 0 | 1 | 17 | 1 | 2 | | | | |

The runner specs carry the C share: 001's Vitest adapter and recorder (60), 007 pytest (23), 003 node:test (6). 008 is almost all D. 006 is all G.

Cost by class (`cost-output.txt`): 169 FAIL rounds list blockers. A blocker of class E is in 110 of them, C in 30, G in 30, A in 13, D in 10, B in 7, F in 4. Rounds whose blockers are all one class: E 85, G 22, C 17, D 6, A 4, B 1, F 1. A rounds with A blockers only: 007 waves 5.5, 5.75 and 5.875, and 011 `0.1.243.md`. The round with B only: 011 `0.1.287.md`.

### 2. Every A and B item

Deduplicated A (22). The line is the first location the review cites.

| Item | Spec, source | File and line | Why A |
|---|---|---|---|
| R9 | 001 `reviews/wave-1.md` S3 | `src/runners/vitest/index.ts:22` | The adapter hashes environment files with its own hasher, behind a signature the core cannot satisfy: contract and code drift. |
| R36 | 001 `wave-11f.md` S2 | `src/harness/shared/deliver.ts:24` | The edit tool set is declared per adapter (seams F4.3), so a named custom editing tool reads as read-only. |
| R57 | 001 `wave-13aa.md` B1 | `src/harness/shared/primer.ts:40` | `harness/shared` names runners: a node:test-only repository is told Vitest is covered. |
| R58 | 001 `wave-13aa.md` B2 | `src/harness/shared/coverage.ts:41` | Coverage maps node:test rows in Vitest's project shape and invents Vitest projects. |
| R132 | 001 `wave-13i.md` S3 | `src/core/status/run-log.ts:56` | Console capture is per runner in core status, so node:test has no `--include-logs` output. |
| R139 | 001 `wave-13m.md` S1 | `test/keys/key-format.test.ts:24` | The key guard is per component, yet a runner-only bump also forced a global bump. |
| R190 | 003 `wave-2.md` S1 | `src/core/daemon/runner.ts:87` | Runner wiring: one node:test project's graph error unlists the whole worktree, Vitest included. |
| R191 | 003 `wave-2.md` S2 | `src/runners/node-test/adapter.ts:86` | Observed paths go through the injected store and are read once, so a daemon never learns another worktree's growth (seam S2). |
| R205 | 004 `wave-2.5.md` B3 | `src/core/daemon/daemon.ts:184` | A second path for observed growth, a daemon timer over runner meta keys, acknowledges growth the scheduler cannot queue (S2). |
| R213 | 004 `wave-4.md` B2 | `src/core/scheduler/slow-tier.ts:273` | The scheduler sizes node:test slow tiers by a rule of its own (`node-test-runners.ts:140`). |
| R231 | 005 `wave-2.md` B1 | `src/harness/shared/test-command-files.ts:29` | `harness/shared` parses Vitest commands for the deny (seams group 6) and misses typecheck files. |
| R240 | 005 `wave-4-6.md` B1 | `src/cli/setup/test-globs.ts:18` | Setup names node:test globs, so excluded files validate a declaration that runs nothing. |
| R301 | 007 `wave-2.5.md` R1 | `src/runners/pytest/adapter.ts:176` | pytest reuses node:test's project code (`adapter-project.ts:94`), whose guards drop shared startup growth (seams group 8). |
| R306 | 007 `wave-2.md` B4 | `src/harness/shared/test-command-files.ts:77` | `harness/shared` resolves bare `pytest` to a configured subset and hides an uncovered failure. |
| R317 | 007 `wave-5.5.md` B1 | `src/core/delivery/attribution.ts:249` | Core attribution infers the runner from policy and extension. No runner is stored with a result. |
| R353 | 011 `0.1.243.md` B1 | `src/core/status/test-frame.ts:24` | Core status holds pytest's frame pattern (`PYTEST_ENTRY`, seams group 4). It breaks on a path with a space. |
| R441 | 014 `wave-1.md` B2 | `src/core/ps/processes.ts:163` | `squeal ps` classifies pytest by argv in core (seams group 5), so a repeated option becomes test files. |
| R461 | 015 `0.1.293.md` B3 | `src/core/code/count/parser.ts:18` | Complexity loads tree-sitter through `runners/pytest/graph/parse.ts:39` (seams group 1). A reset leaves that promise cached. |
| D87 | 009-26 | `squeal setup`'s plan; the row cites no line | The plan names only Claude Code and Codex, so Pi (and later OpenCode) each needed a row. |
| D88 | 009-27 | `src/harness/pi/session.ts:31` | The shared start assumed the hook places the primer. A host that places it itself needed a shared rule change. |
| D89 | 009-28 | `src/cli/update.ts:232` | Harness facts (update, install detection) are kept per harness. |
| D117 | 011-48 | the key alarm's case kinds; the row cites no line | The key alarm is per component and lacked node:test and pytest case kinds. |

R318 and R319 (007 waves 5.75 and 5.875) are residuals of R317, and row 007-40 is its row. They are left out above, but their cost is in finding 4.

B (11, none a residual):

| Item | Spec, source | File and line | Scenario that reaches it |
|---|---|---|---|
| R5 | 001 `wave-1.md` B1 | `src/runners/vitest/adapter.ts:136` | Import a missing file, then create it: the closure left the absent file out. |
| R13 | 001 `wave-1.md` S7 | `src/runners/vitest/run.ts:109` | File error: an unhandled error with no owner failed every completed file. |
| R101 | 001 `wave-13bp.md` B1 | `src/runners/vitest/adapter.ts:428` | Interrupted run, then re-run: timeout cancellation kept the poisoned instance. |
| R167 | 001 `wave-16.md` B2 | `src/core/daemon/daemon.ts:669` | Interrupted run: a node:test backlog stop killed processes but kept the queue (`adapter-project.ts:157`). |
| R350 | 011 `0.1.239.md` B2 | `src/runners/vitest/run.ts:74` | Interrupted run: a signal aborted before start omitted the cancel note. |
| R371 | 011 `0.1.268.md` B2 | `src/runners/pytest/runtime/sitecustomize.py:42` | Flip: a child script with no uncached imports kept a false current PASS after an edit. |
| R396 | 011 `0.1.287.md` B1 | `src/runners/vitest/reporter.ts:229` | Interrupted run: an expected-failure test that was cut read as passed and was kept. |
| R465 | 015 `0.1.295.md` B3 | `src/runners/vitest/adapter.ts:628` | Interrupted run: a cancelled run stored a coverage record. |
| D301 | 001-360 | the Vitest adapter; the row cites no line | File error: "the Vitest adapter never reads suite errors", so a `beforeAll` that throws inside a `describe` was stored as PASS. |
| D335 | 001-424 | Vitest environment; the row cites no line | Missing file, then create: a `setupFiles` import of a missing file kept "Failed to resolve import". |
| L12 | Later (009 lessons, observation 4) | no line cited | File error, then recovery: a file that failed to load before a git-ignored build existed stays current FAIL. |

Secondary A or B on another primary (inferred, `classes.tsv`): E/B 10 (core validity errors a kit run would also show, for example R32, R121, R127, R128), C/B 10 (runner knowledge that a scenario reaches only in that runner's own form, for example R25, R26, R54, R303, R307), C/A 5, D/A 3, E/A 1.

### 3. Examples, and items not placed

Quoted from the review headings and row titles:

- **A**: "Unknown runner identity is treated as a Node failure" (007 `wave-5.5.md` B1). "A node:test-only repository is told that Vitest is covered" (001 `wave-13aa.md` B1).
- **B**: "An interrupted expected-failure test can read as passed and be kept" (011 `0.1.287.md` B1). "a `beforeAll` that throws inside a `describe` is stored as PASS" (row 001-360).
- **C**: "an installed-package change can leave old passing results current" (007 `wave-2.md` B1). "processed CSS holds imported project bytes that the stamp inventory never checks" (001 `wave-13d.md`, R117).
- **D**: "idle adds a fresh API budget after spending its hook budget" (008 `wave-1.md`, R326). "command-only execution fails noisily when the plugin root contains spaces" (012 `012-01.md`, R436).
- **E**: "the protected module's end does not recheck an unchanged tier" (011 `0.1.296.md` B1). "`run --all` while waiting records a completed full suite that ran nothing" (001 `wave-11.md`, R21).
- **F**: "the replacement budget still fails in the required loaded full run" (001 `wave-13bb.md`, R88). "node-test run.test's deadline case times out under CI load" (row 001-421).
- **G**: "Stale and unknown results become Squeal's pass verdict" (006 `wave-1.md` B4, the eval grader). "committed CLI bundles drift after a clean install and build" (001 `wave-13br.md`, R105).

Hard to place. The first class was kept; a second reader could move these:

- R49, R192, R432, L13 (C or A). They are recorder or graph code that one runner borrows from another (seams group 8). The fault is runner knowledge. The borrowing is a seam.
- R219, D9, D263 (D or A). A shared primer, version warnings and keys did not allow for one harness's behaviour. The behaviour is the quirk. The shared rule that lacked it is the seam.
- R425 (E or A). "one lane is not one concurrently scheduled runner part", in the composite runner.

### 4. The five costliest A or B items

Cost here is FAIL rounds, repair rows and open rows on one defect (read in `docs/board.md` and the review files).

1. **Runner identity in core attribution** (R317, residuals R318 and R319, row 007-40). It took three FAIL rounds in a row (007 waves 5.5, 5.75 and 5.875), and each round failed on this blocker alone. Row 007-40 is "done (0.1.195; three review rounds, residual accepted by the human as 007-45)". Row 007-45, "a check knows its runner", is still planned. The cause is A: no result records its runner, so `attribution.ts` guesses from policy and extension. Recording the provider with each result (016-06) removes it by construction.
2. **Observed paths through the injected store** (seam S2: R191, R205, R301). It produced findings in three specs (003 `wave-2.md` S2, 004 `wave-2.5.md` B3, 007 `wave-2.5.md` R1). Repair rows 003-26 and 003-41 are done. Rows 007-47 (one store for node:test and pytest, "copies node:test's `observedStore` ... line for line"), 007-52 (a core path for growth) and 007-56 are still planned.
3. **`harness/shared` names runners** (R57, R58, R231, R306). Four blockers in three FAIL reviews (001 `wave-13aa.md`, 005 `wave-2.md`, 007 `wave-2.md`): coverage, primer and the test-command deny. They are seams group 6.
4. **Interrupted Vitest runs** (R101, R350, R396, R465). Four blockers in four FAIL reviews from 2026-10-15 to 2026-10-24. R396 alone failed 0.1.287, and a re-review followed (`0.1.287-r2.md`). Each case is a different branch of one scenario, "cancel or cut a run, then trust nothing it wrote".
5. **pytest named in core status** (R353). It alone failed 0.1.243. The candidate was replayed as 0.1.245 after the repair (row 011-71's status).

### 5. Over time

| Period | Defects with a date | A+B primary | A+B with secondaries |
|---|---|---|---|
| before 2026-10-17 | 439 | 21 (4.8%) | 42 (9.6%) |
| 2026-10-17 on | 226 | 8 (3.5%) | 12 (5.3%) |

57 rows have no version or date and are left out of the table. Review items by period (`tally-output.txt`): C was 39% from 10-01 to 10-09 (the Vitest adapter and recorder waves). It was 11 to 15% to 10-17, and 0 to 4% after. E rose from 43% to 54 to 91%. The fall in A+B is about one point (4.8% to 3.5%). Ten times more items would be needed to confirm it. The large swings are in C and E, and they follow the work. Before 10-17 three runners and their adapters were built (001 Vitest, 003, 007). After 10-17 the work was 011's scheduler, waits and focus, which the internal half does not touch. The split itself moved no class (inferred).

## Recommendation for Squeal

1. As a defect-reduction measure, the internal half reaches about 5 to 8% of past defects: 22 A and 11 B (4.6%) as primaries, 61 (8%) with secondaries. It would not have reached the 57% that are core logic (E), the 13% of runner knowledge (C), or the 24% from harness quirks, load and process (D, F, G). Findings 1 and 2 are the evidence. Weigh the change on consistency and on the extension goal, not on issue count.
2. The A items with repeat cost are three: runner identity per result, the injected observed store, and runner names in `harness/shared` (finding 4, items 1 to 3). They are also seams S2, S4/S7 and S5 in `seams.md`. If the internal half is cut down, keep those three. Record the runner (provider) with each result, give observed paths one write path, and move the command parsing and coverage text behind a runner description.
3. A shared kit is worth most as one scenario: an interrupted or cut run, then a check of what was stored. Four of 11 B items, and the costliest B group, are branches of that scenario in Vitest (R101, R350, R396, R465), with one in node:test (R167). Next come file error then recovery (R13, D301, L12) and missing file then create (R5, D335). Brief 016-10 can test whether these run unchanged against all three runners.
4. The kit does not reach the C share of 13%: the Vite transforms and optimizer, the recorder, and pytest's environment, `norecursedirs` and basetemp. It needs per-runner cases.

Limits: one reader classed every item. The excerpts were short, and the residual filter is a title regex (it falsely caught R213, which was put back by hand). Rows carry no date, so 57 are undated. The board's 001 archive and its waves mix features into defect sections; 54 of these items were set aside by hand. No defect was reproduced.

## Open questions

1. Would a second reader agree? Not determined: no second rating ran. The A/C and A/D lines in finding 3 are where readers would differ most. A second classification of `classes.tsv`, scored by agreement, would settle it.
2. How many E items are core validity errors that a kit run through the daemon would also catch? Not determined. 10 are marked E/B. A kit that drives the real scheduler, not an adapter alone, could catch more, and 016-10 decides which kind it is.
3. What did each defect cost in worker hours? Not determined: rounds and rows are the only cost the docs record.

## Sources

All read at `f6320cd7e`, 2026-10-24:

- `docs/specifications/*/reviews/*.md` (313 files), `docs/board.md`, `docs/specifications/001-core-loop/board-archive.md`, `docs/process.md` (roles, step 6), `docs/specifications/016-extensions/status.md` (entries of 2026-10-24), `research/seams.md` (S1 to S10, missed groups, F1.2, F4.3).
- GitHub issues of `hearsay-tools/squeal`, `gh issue list --state all --limit 1000`, read 2026-10-24: 93 issues, 23 open.
- Probes: `probes/defect-causes/{extract,rows,rows2,items,tally,cost,location}.mjs`, `classes.tsv`, `tally-output.txt`, `cost-output.txt`, `location-output.txt`.
