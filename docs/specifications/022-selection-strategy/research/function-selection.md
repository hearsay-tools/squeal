# Function selection: skip a test file when only functions it never entered changed

**Recommendation.** Do not build rule A: on real history it skips 0.07% to 0.68% of re-run seconds, not the 41% that edit-reach suggested, and it still misses every fixture regression that reflection or a line number carries. Rule B does not beat today's cut: on cezar it holds 5 of 13 new failures where the cut holds 11; on Squeal 5 of 15 where the cut holds 2, at twice the cut's size.

Researcher, row 022-07, 2026-11-21, 19:40Z to 21:40Z. Read: `docs/vision.md`, `docs/styleguide.md`, `docs/process.md`, `../status.md`, `README.md` (this folder), `loaded-modules.md`, and in `../../015-coverage-complexity/research/`: `edit-reach.md`, `line-level-selection.md`, `selection-tools.md`, `cezar-selection.md`.

Versions: Squeal `e2eef3c25`, Node 26.13.0, Vitest 5.0.3, Vite 8.3.2, TypeScript 6.0.3 parser (the installed 7.0.2 has no parser API). Cezar `c11e4edf0`. Store copies (`VACUUM INTO`, read-only connection) taken 19:44Z to 19:47Z:
- Squeal: coverage records 2026-11-11 23:32Z to 11-21 00:26Z, 685 edit revisions.
- Cezar: coverage records 2026-11-09 08:34Z to 11-20 23:33Z, 1,599 edit revisions.

No suite of either repository ran. Probes, commands and limits: `probes/function-selection/README.md`; outputs in its `results/`.

**Units.** A *pair* is one (edit, test file whose known closure holds a changed path). An *edit* is one `watch` revision without a HEAD move, or, in the commit view, one first-parent commit's whole diff. *Seconds* are a test file's median recorded file duration; shares are of the pairs' summed seconds. Fixture counts and real-history counts are kept apart.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Rule A savings | Per edit revision: Squeal 0.07% of re-keyed seconds (strict) to 0.15% (relaxed); cezar 0.004% to 0.07%. Per commit: Squeal 0.68%, cezar 0.17%. The largest removals: no record (22 to 76%), a changed path that is no script or that the record does not hold (25 to 72%), a changed skeleton (1 to 6%), a changed body the test entered (1 to 3%) | verified by experiment (replay) |
| 2 | Rule A misses on fixtures | 34 cases, 37 edits. Rule A skips 12 edits; 5 of them change the result. All 5 are reflection (3) or a line number (2). Getters, decorators, default parameters, class fields and nested functions are safe; some of them fall back | verified by experiment (Vitest 5.0.3, Squeal's provider) |
| 3 | How often the gaps occur | (a) No test calls `toString` on an imported project function in either repository (text scan). A worker-side wrapper sees direct calls, `String()`, templates and `.call`, but not a reference kept earlier or another realm; cost 26 ns per call. (b) No snapshot holds a file:line; 14 and 15 test files read `.stack`. (c) Entered sets are not stable: 26% (cezar) and 36% (Squeal) of sampled test files enter other functions in records of byte-identical sources | (a, b) verified by experiment, text scan; (c) verified by experiment (store proxy) |
| 4 | Record carry-over | Sound only if every skipped edit is judged against the record's own bytes, cumulatively, and the test is deterministic. Q3c shows that the last assumption fails often | inferred; the chain fixture shows the comparison |
| 5 | Rule B | Cezar: rule B holds 5 of 13 new failures, today's cut 11 of 13. Squeal: rule B 5 of 15, the cut 2 of 15. Rule B's set is 2 files (cezar) and 171 files (Squeal) at the median | verified by experiment (replay; cut emulated) |
| 6 | Cost and record share | 0.9 ms median (12.6 ms max) to build one file's structure; 2.0 ms median (35 ms max) to build and compare two versions; load 6.2. A usable pre-edit record: Squeal 38% of pair seconds (strict) to 78% (relaxed), cezar 2% to 32%; 0% today, because coverage is off in both configurations | verified by experiment |

## 1. Rule A on real edits

Method (`population.mjs`): each edit × each test file whose newest stored closure holds a changed path. Closure parts: import walk, environment walk, flat closure, observed sets, declared inputs and listings. Conditions 1 to 5 are applied in order, and a pair leaves at the first one it fails.

Condition 1 has two readings:
- *Strict*: the test file's latest own result in that worktree before the edit, and the coverage record at that key. The changed paths are every path changed since that result.
- *Relaxed*, used where strict fails: the newest record of the file from any worktree, whose blobs equal the old contents on every changed path it holds. Commits use only this reading.

Old and new contents come from git objects by blob id. 10,941 of 11,499 modified script paths in Squeal's window had both blobs.

| Share of pair seconds | Squeal edits, strict | Squeal edits, relaxed | cezar edits, relaxed | Squeal commits | cezar commits |
|---|---|---|---|---|---|
| Pairs; seconds | 99,293; 626,186 | 99,293; 626,186 | 115,192; 1,483,874 | 582,168; 3,636,634 | 302,909; 3,381,595 |
| C1 no record (strict: no own run 40.9, no record at the key 21.1) | 61.9% | 22.2% | 67.9% | 59.7% | 76.0% |
| C2 test file changed | 0.7% | 0.8% | 0.3% | 0.1% | 0.2% |
| C2 a changed path is no script | 29.9% | 50.1% | 1.5% | 9.9% | 3.1% |
| C2 a changed script the record does not hold | 5.1% | 21.9% | 18.9% | 20.3% | 13.7% |
| C2 deleted; entered body changed; body not mapped | 0.0; 1.4; 0 | 0.0; 2.2; 0.0 | 0.1; 3.2; 0.0 | 0.1; 3.0; 0.0 | 0.3; 2.3; 0.0 |
| Not judged (no old or new blob) | 0.0% (1 pair) | 0.0% (5) | 1.5% (3,194) | 0 | 0 |
| C3 skeleton changed | 0.8% | 2.6% | 6.1% | 6.1% | 3.2% |
| C4 new file does not parse | 0 | 0 | 0 | 0 | 0 |
| C5 child process; read as data | 0.01%; 0 | 0.01%; 0 | 0.41%; 0.00% | 0.07%; 0.01% | 0.86%; 0.01% |
| **Left: rule A skips** | **161 pairs, 412 s, 0.07%** | **258, 921 s, 0.15%** | **375, 1,038 s, 0.07%** | **7,471, 24,571 s, 0.68%** | **2,164, 5,794 s, 0.17%** |

Cezar's strict funnel loses 92% of pairs at condition 1 and leaves 27 pairs (63 s). Its daemons reuse results recorded by other worktrees, and a reused result leaves no row in the reusing worktree. 10,008 Squeal pairs whose changed paths all returned to the record's bytes (an edit and its revert) are left out: today's rule already reuses them. *verified by experiment.*

Single revisions: Squeal's 427 pairs whose test file ran at the revision just before give 60 pairs, 171 s, 13.2% of their seconds. These are the best case: a fresh record and one small edit. They are 0.4% of the pairs. *verified by experiment.*

The chain replay of real runs confirms the order of size (`replay.mjs`, `results/chain-squeal.json`). Of 51,173 re-keyed Squeal runs (293,723 s), 51,057 span a commit or checkout. Rule A would have skipped 88 runs, 234 s (0.08%); none of the 88 failed. 15 of the 51,173 runs were new failures, and rule A would have run all 15. *verified by experiment.*

**What blocks it.**
- On Squeal, `package.json` is about 97% of the no-script seconds in the strict per-edit funnel. It is in every test file's closure, and agents bump its version.
- On Squeal, `coverage.exclude: ["test/**"]` keeps every test helper out of the records, so a helper edit always fails condition 2.
- On both, an edit usually touches several paths, and one blocking path keeps the whole pair.

Per changed path among the paths a record holds, 12 to 13% change only in bodies the test never entered: Squeal 44,173 of 336,241 (commits), cezar 30,734 of 239,115 (`results/path-verdicts.txt`). The pair level takes that down to the table's last row. *verified by experiment.*

**Against `line-level-selection.md`.** That study had 53,073 (commit, source, test) pairs. 21.3% had no changed old line hit, 15.4% had one. Its line-count fallback rejected every hunk that changed line counts: 3 pairs were left, and 0 for whole commits.

The function-body comparison reads tokens without trivia, so an insertion, a comment or a line shift inside an unentered body passes. In the same per-path unit, 13.1% (Squeal) and 12.9% (cezar) of record-held paths pass. Whole commits leave 0.68% and 0.17% of seconds, where line selection left 0. The same blindness to line positions causes fixture misses N2 and N3.

The populations differ: 40 commits of 2026-10-27 there, and 2,501 and 462 commits of 2026-11-09 to 11-21 here. *verified by experiment; comparison inferred.*

## 2. Rule A on fixtures

Method (`fixtures.mjs`): real Vitest 5.0.3 with one isolated worker, Squeal's `provider.mjs`, `sourceEntry` and `recorder.cjs`. Rule A decides each edit from the last record it would have made. The test file then runs anyway as the oracle. A miss is a skip whose result changed. *verified by experiment*, load 14 to 17 (no timing).

| Case | Rule A | Result changes |
|---|---|---|
| L1 `toString` of an uncalled function | **skip** | **yes: miss** |
| L2 data read; L8 child-only code | run (C2: no script; script not loaded) | yes |
| L3 arity; L4 top-level throw; L5 deleted declaration; L6 changed import | run (C3) | yes |
| L7 dependency flips a branch, then the branch body changes | run (C3), then run (C2 entered) | no, then yes |
| L9 syntax error in an uncalled body | run (C4) | yes |
| L10 control: uncalled body | skip | no |
| S1 to S3 called body refactor, regression, branch | run (C2 entered) | no, yes, yes |
| S4 module value | run (C3) | yes |
| S5 raw source read as text | run (C5 read) | yes |
| S6 a child calls the uncalled function | run (C5 child) | yes |
| N1 `toString` text run in an `eval` worker | **skip**: the recorder marks no started thread | **yes: miss** |
| N2 stack line below an edit that adds lines | **skip** | **yes: miss** |
| N3 snapshot of that stack line | **skip** | **yes: miss** |
| N4 getter never read; N5 getter read | skip; run (C2 entered) | no; yes |
| N6 decorator argument; N7 decorator body | run (C3); run (C2 entered) | yes; yes |
| N8 decorated method never called | skip | no |
| N9, N10 default parameter, uncalled and called | run (C3); run (C3) | no; yes |
| N11, N12 class field, class not constructed and constructed | run (C3); run (C3) | no; yes |
| N13 arrow field never called, class constructed | run: it shares its record span with the field initializer, which ran | no |
| N14, N15 nested function or arrow edited, only the outer ran | skip; skip | no; no |
| N16 nested arrow edited, outer ran, inner text read with `String()` | **skip** | **yes: miss** |
| N17 nested function edited, inner ran | run (C2 entered) | yes |
| Q4 two edits of an uncalled body, then a call site | skip, skip, run (C2 entered) | no, no, yes |

- Line-level's nine failing fixtures: rule A misses 1 (reflection), where naive line selection missed 8.
- `selection-tools.md`'s reflection and raw-source escapes: the raw-source read (S5) is now caught by condition 5, because Squeal's recorder records the read. The reflection escapes (L1, N1, N16) remain.
- New: line numbers (N2, N3).
- Rule A runs 5 edits whose result does not change: L7's first edit, S1, N9, N11 and N13.

## 3. How often the gaps occur in real tests

**(a) Reflection.** Text scan of 2,105 Squeal and 1,711 cezar test files (`scan.mjs`); counts are files and include false positives.
- `.toString()` on an imported project name: 0 in both.
- `String(imported name)`: 8 and 6, all numeric constants when read.
- `Function.prototype.toString`: 1 (`test/lint/provider/rooted.test.ts`, on Node's own `fs` functions).
- `new Function` or `eval: true` workers: 7 and 2, all on literal code text when read.
- The scan misses indirect use: libraries, helpers, `${fn}` in templates (172 and 40 template matches, mostly constants).
*verified by experiment (text scan).*

Can the provider see it? `tostring/probe.mjs` puts a wrapper on `Function.prototype.toString` beside an inspector coverage session. It sees `fn.toString()`, `String(fn)`, `` `${fn}` ``, `fn + ""` and `Function.prototype.toString.call(fn)`, the `eval` worker of N1 included. It misses:
- a reference to the original kept before the wrapper (Node's own primordials do this);
- another realm (`vm`).

It finds each function's script and line through `[[FunctionLocation]]` and the coverage payload's script ids, 3.5 ms for 7 functions. A call costs 83.6 ms against 57.6 ms per million calls, so 26 ns more. A test can see the wrapper: `Function.prototype.toString.toString()` returns the wrapper's text. *verified by experiment (plain Node 26, not inside `provider.mjs`)*, load 7.9.

**(b) Line numbers and stack text.**
- `.stack` read: 14 Squeal and 15 cezar test files.
- Snapshots: 4 and 0 files; none of the 3 Squeal `.snap` files holds a file:line or a stack frame.
- Assertions on a line or location: 24 and 7. The ones read concern fixture or data files, for example `expect(error?.stack).toContain("test/math.test.ts:10:24")` on a fixture.
- Project code that turns call positions into values: 4 Squeal sources and 19 cezar testkits. The cezar testkits match a function name in `new Error().stack`, not a line.

No case asserting a line of a loaded project module was found, but not every match was read. *verified by experiment (text scan), partly read.*

**(c) Entered sets between runs.** The store keeps one record per key, so two runs at one key cannot be compared. The proxy is records of one test file whose sources are byte-identical: same paths, same blobs (`stability.mjs`, 300 sampled files per store).
- Cezar: 246 of 283 comparable files differ. 237 of them differ in the setup file `scripts/test-sandbox.mjs`; 75 (26%) differ outside it, for example `runs/store.ts` (35 files) and `core/process-usage.ts` (32).
- Squeal: 58 of 160 (36%) differ, led by `src/core/fs/git.ts` (42 files).

Squeal's records hold no test file, so there a test edit can explain some of the difference. Cezar's records hold the test file. The likely causes are timing, retries, process state and the worktree's git layout. *verified by experiment (proxy); causes inferred.*

So "the record shows the test never entered f" means "one run did not enter f". A function that another run enters can be edited under a skip.

## 4. Carry-over of a record across skipped edits

**Argument** (*inferred*). Let record R0 come from a run at key K0 on bytes B0. Edit 1 (B0 to B1) passes rule A. Then no code that ran at K0 changed, and no structure around it. So a deterministic run at K1 executes the same functions and lines as at K0, and R0 also describes K1.

For edit 2 (B1 to B2), judging the cumulative change B0 to B2 against R0 is the same as judging B1 to B2 against the run at K1 that never happened. So a chain of skips stays sound when each decision compares:
- every path changed since R0's key: the record's own sources at the blobs it names, and every other closure path against that key;
- the current bytes, not the last skipped edit's.

**Assumptions:**
- determinism (Q3c: often false);
- nothing reads function text or positions (Q2 misses);
- a complete record (no `unread`, isolation on, no inspector skip);
- the old result, failure text included, still describes K1. A failure text with a stack line would be stale.

**Fixture.** Q4: two skipped edits of an uncalled body, then a call-site edit, judged against the record's bytes. The skips held and the call-site edit ran and failed. With `FSEL_STEPWISE=1`, edit 2 is compared with edit 1's bytes, the record's blob no longer matches, and condition 1 sends it to a run. That is safe, but it loses the skip. *verified by experiment (fixture).*

## 5. Rule B

Method (`ruleb.mjs`): a new failure is a failed test or file after a passing run of the same file in the same worktree, with every revision between stored. The edit is the union of those revisions' changes.
- Rule B: the test files whose pre-edit record (strict, else relaxed) entered a function whose own body changed or that was removed.
- Today's cut, emulated from `editWork`: changed test files; per changed source its namesakes, else its direct importers; then the 4 shortest of the other direct importers, then of the other closure readers.
*verified by experiment; the cut is an emulation (inferred).*

| | Squeal | cezar |
|---|---|---|
| New failures; with every revision stored; only edit revisions between | 201; 15; 1 | 300; 13; 0 |
| Failing file reached by the closure | 15 | 12 |
| In today's cut at once | **2** | **11** |
| In rule B's set | **5** | **5** |
| In either | 6 | 12 |
| Failing file with no usable record; with a record but not in B | 1; 9 | 5; 2 |
| Per edit, median files: reached / cut / B / no record | 1,305 / 57 / 171 / 101 | 238 / 8 / 2 / 39 |
| Summed seconds: reached / cut / B / no record | 78,681 / 6,526 / 14,188 / 15,582 | 105,452 / 17,959 / 12,022 / 68,434 |

Squeal's 9 failures that have a record but are outside B are mostly bundle, package and plugin tests, for example `test/harness/plugin.test.ts`, `codex/packaging/runtime.test.ts` and `opencode/package.test.ts`. They fail through declared inputs, bundling and child processes, not through a function they entered. The cut leaves them to catch-up as well: a declared input or an observed read reaches them, not a direct import. On cezar the cut's namesakes and direct importers hold 11 of 13. Rule B misses 7 of those: 5 files have no usable record, and 2 have a record but did not enter a changed function. The 1 file outside both is `webhooks/cli.test.ts`; no stored closure holds its changed path. 14 and 13 events are too few for a rate; read the counts as large-and-unconfirmed differences.

## 6. Cost

`cost.mjs` on Squeal's 1,277 `src` TypeScript files (8.2 MB), one-minute load 6.2 to 6.6:
- Building one file's structure (parse, bodies, skeleton): median 0.87 ms, p90 2.3 ms, max 12.6 ms (`scheduler.ts`, 69 KB); 0.18 ms per KB.
- Building and comparing two versions: median 2.0 ms, p90 6.3 ms, max 35 ms.
- In the replays, with structures cached, a judgement took 0.42 ms on average (11,650 in 4.8 s).

*verified by experiment.*

Share of pairs with a usable pre-edit record at edit time:
- Squeal: 41.8% of pairs, 38.1% of seconds (strict); 81.9% and 77.8% (relaxed).
- Cezar: 7.4% and 1.8% (strict); 50.1% and 32.1% (relaxed).
- Today the share is 0%. Both repositories' configurations turned coverage off by 2026-11-21 (`../status.md`), and the newest records are from 11-21 00:26Z (Squeal) and 11-20 23:33Z (cezar).

*verified by experiment and store.*

## Recommendation for Squeal

1. Do not build rule A. On both repositories it would skip under 1% of re-run seconds:
   - per edit, 0.07% to 0.15% (Squeal) and 0.004% to 0.07% (cezar);
   - per commit, 0.68% and 0.17%.
   It keeps reflection and line-number misses that no recorder closes fully, and its "never entered" evidence comes from one run, which differs from the next run for 26 to 36% of sampled test files. Edit-reach's 41% "loaded, nothing called" does not survive real edits: they touch several paths, `package.json` and test helpers among them.
2. Do not replace the edit cut with rule B. On cezar it would have moved 7 of 13 new failures from the first group to catch-up and 1 into it. On Squeal it would have moved 4 of 15 into the first group and 1 out, at 2.2 times the cut's recorded seconds. Rule B needs coverage on, which both repositories turned off.
3. If ordering by coverage is wanted, the evidence supports only adding rule B's files to the cut's first group, not replacing it: 6 of 15 and 12 of 13 failures would be in the union. Its cost was not measured. *inferred.*

## Open questions for the human

- Is a saving under 1% of re-run seconds worth anything, given the misses? This research says no.
- Rule B as an addition to the cut: worth a measured experiment on a project with coverage on? Neither repository has coverage on now.
- Not determined: the same-key stability of entered sets. The store keeps one record per key; a bounded run of sample files twice would answer it.

## Sources

- Squeal `e2eef3c25`:
  - `src/core/code/coverage/{types,parts,record,map,provider.mjs}`
  - `src/core/scheduler/{edit-cut,namesakes}.ts`
  - `src/core/keys/{observed,modules}.ts`
  - `src/core/types/{revision,runner,policy}.ts`
  - `src/core/store/schema.ts`
  - `src/runners/observe/recorder.cjs`
  - `squeal.config.json`
- Cezar `c11e4edf0`: `squeal.config.json`, the testkits named in Q3b.
- Earlier research: `../../015-coverage-complexity/research/{edit-reach,line-level-selection,selection-tools,cezar-selection}.md`, `loaded-modules.md`.
- Store copies of `~/projects/{squeal,cezar}/.git/squeal/{store,code}.sqlite`, 2026-11-21 19:44Z to 19:47Z.
- Probes: `probes/function-selection/` (README, scripts, `results/`).
