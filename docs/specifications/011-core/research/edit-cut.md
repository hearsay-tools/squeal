# 011-25: which tests stay an edit's work (the edit cut measured)

Researcher R2 of 011 wave 6, 2026-10-20. Brief: `tasks/wave-6.md` R2. Read: `docs/vision.md`, `docs/styleguide.md`, `docs/process.md`, board row 011-25, `research/central-edits.md` and its probes, spec 011 C4 step 4 and C15, `status.md`.

Versions: Squeal main at `b3e190d6` (after `84509d92`). Cezar's store: the read-only copy `/tmp/r3/cezar-store.sqlite` of 2026-10-19T22:21Z that `central-edits.md` read, so cezar's 62 central and 293 agent revisions are the same ones. Squeal's own store: a copy made 2026-10-20T10:48Z through a `readOnly` connection (`VACUUM INTO`), 1,832 revisions in 29 worktrees, 887 test files. Graphs: `git archive` of 25 cezar heads and 62 Squeal heads into scratch directories, the static one-hop graph of `central-edits.md` (oxc as Vite 8 uses it, es-module-lexer 2.3.1). **No live measurement ran**: the one-minute load was 54 to 76 on 24 CPUs from 12:47 to 13:04 local, above the hold of 8. Every time below is a replay of recorded durations or a read of a store. Probes: `probes/edit-cut/` (README lists each).

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Namesakes | Cezar names its tests after its modules: on its 62 central revisions, 105 of 124 changed code sources (85 %) have exactly one namesake, all of them siblings (`store.ts` → `store.test.ts`). Squeal names tests by behaviour: no sibling and almost no mirror (1 of 116), and 37 of 116 (32 %) have a namesake only as the unique test file of that stem anywhere (`src/core/scheduler/queue.ts` → `test/scheduler/queue.test.ts`). A third repository (mvp-unveiled-july26, Vitest layout, no closures): 66 of 229 changed sources (29 %). Rule (n) never finds several. No pytest repository with a store exists on the host | verified by experiment, read from the stores |
| 2 | Cuts replayed | On cezar's central revisions, (n) cuts the next edit's wait from 132 s to 8 s at p90 (the median stays 6 s) and all results from 842 s to 607 s at the median, without delaying the own test file. On Squeal (a) is already narrow (1 edit file at the median, 9 at p90; the next edit's wait is 6 s at p90), and (n) changes the wait by nothing. (n+4) costs nothing measurable over (n): 8 s at p90 on cezar | verified by replay |
| 3 | Exposure | 75 agent revisions had a new failure among their re-keyed files (47 cezar, 28 Squeal). The first new failing file was an edited test in 31, a namesake in 3, another direct importer in 9, transitive in 11, outside the import graph in 21. Against (a), (n) reports the first new failure later in 3 of 75: +65 s, +62 s and +78 s, each a short direct importer the namesake rule sent to catch-up. (n+4) leaves 1 (+63 s, a `store.ts` fixture user). Against today, every cut delays guard tests reached through declared inputs: on Squeal 9 of 28 by 47 s at the median | verified by replay, read from the stores |
| 4 | The smell | At a8042ec3, 163 test files import `runs/store.ts` at runtime: 11 test the store (its subject), 152 build a `RunStore` to set up state for another subject (a fixture), and another 16 import only its types, which the transform drops. `workflows/run.ts`: 5 subjects, 37 fixtures, 84 type-only. The count reflects ordinary setup against a 4,925-line module, not a test design fault. A testkit indirection moves the fixtures to depth 2: under (a) the next edit's wait at p90 drops to 28 s. Under (n) it changes nothing | verified by experiment (heuristic, spot-checked), replay |

## Findings

### 1. Namesakes

**Matchers** (`lib.mjs`), each over the test files present at the revision: **sibling** `<dir>/<stem>.test|spec.<ext>` (pytest `test_<stem>.py`, `<stem>_test.py`); **`__tests__`** `<dir>/__tests__/<stem>[.test|.spec].<ext>`; **mirror** `src/<sub>/<stem>.ts` → `test|tests/<sub>/<stem>.test.ts`, also under `packages/<p>/`; **pytest** `test_<stem>.py` or `<stem>_test.py` anywhere; **anywhere** any test file of the stem. **Rule (n)** takes the first strict matcher that finds any. Failing that, it takes the anywhere match only when it is unique. An `index` source never matches. A changed source is a keyed path the revision changed that is not a test file. *verified by experiment.*

| Code sources changed (pairs of revision and source / distinct sources) | sibling | mirror | anywhere: one / several | rule (n): one | none |
|---|---|---|---|---|---|
| cezar, 62 central (124 / 34) | 105 / 26 | 0 | 91 / 16 · 20 / 8 | **105 (85 %) / 26 (76 %)** | 19 / 8 |
| cezar, 293 agent (294 / 91) | 156 / 45 | 0 | 157 / 28 · 49 / 12 | 169 (57 %) / 54 (59 %) | 125 / 37 |
| Squeal, 63 central (116 / 31) | 0 | 1 / 1 | 37 / 7 · 14 / 3 | **37 (32 %) / 14 (45 %)** | 79 / 17 |
| Squeal, 238 agent (263 / 89) | 0 | 8 / 6 | 101 / 13 · 37 / 7 | 102 (39 %) / 38 (43 %) | 161 / 51 |
| mvp-unveiled-july26, changed by its 291 watch revisions (n/a / 229) | 58 | 0 | 66 / 0 | 66 (29 %) | 163 |
| mvp-unveiled-july26, every source under `src/`, `app/`, `lib/` (n/a / 805) | 149 | 0 | 161 / 5 | 164 (20 %) | 641 |

`__tests__` and pytest found none anywhere. Sources with no namesake are central modules tested through behaviour files: in Squeal `ledger.ts`, `scheduler.ts`, `daemon.ts`, `keying.ts`, `adapter.ts` (17 of the 31 central). In cezar they are `runner-runtime.ts`, `contract/src/github.ts`, `harness-parity.testkit.ts` (8 of 34), plus scripts, dist bundles and e2e helpers. Non-code keyed sources (`package.json`, lockfiles, workflow YAML, Markdown) never have one: 15 distinct in cezar, 20 in Squeal.

**Is the namesake really the test of the source?** The picked namesake, among the files the revision re-keyed:

- In cezar it is direct in 147 of 174 picks, an edited test in 14, outside the graph in 3, and not re-keyed in 10.
- In Squeal it is direct in 25, transitive in 18, edited in 3, outside in 2, and not re-keyed in 56.

The 56 are false matches. A plugin's `dist/*.mjs` bundle matches a harness test by stem: `stop.mjs` matches `test/harness/stop.test.ts`. The test never reaches the bundle, so the rule (re-keyed namesakes only) ignores it. Squeal's 18 transitive namesakes are mostly true: `key-format.ts` → `test/keys/key-format.test.ts`, through the `keys/index.ts` barrel. Two are loose: `scheduler/failures.ts` → `test/cli/failures.test.ts` and `vitest/touched.ts` → `test/scheduler/touched.test.ts`. *verified by experiment; true or false read by hand.*

**Other repositories.** Seven Squeal stores exist on the host (`find` under `/home/agent`, `/srv`, `/opt` and `/`, depth 5 to 6). Cezar and Squeal have results. `mvp-unveiled-july26` has 329 revisions but no test files or results, so only its layout counts. The other four (`/tmp/p362`, `/tmp/w2-412`, `/tmp/squeal-011-42`, `/tmp/r375-fixture`) are scratch stores of other probes and workers, not read. None is a pytest repository. The only node:test code with a store is cezar's `test:unit` lane: 13 changed sources whose importers are all node:test, 10 of them with a sibling (`.github/scripts/x.cjs` → `x.test.cjs`). pytest: **not determined, because** no pytest repository with a store exists here. The pytest matchers are defined but not measured.

### 2. Cuts, replayed

Method: `central-edits.md`'s replay, unchanged (`replay.mjs`). Each revision replays alone, with Vitest and node:test lanes at once. A file's time is the median of its recorded runs. Edit tiers follow the span rule at `runner.tierSize` 4. Catch-up runs in Vitest backlog tiers (W 23, 120 s) and node:test slots (W 4). The next edit's wait is the time left in the Vitest tier in flight at a uniform moment, with a catch-up tier cancelled within 6 s. "Own" is the revision's edited test files and rule (n)'s namesakes. Central means 200 or more test files re-keyed that exist at the head: cezar's 62 of `central-edits.md`, and 63 on Squeal. The rules:

- **(a)**: edited and added test files, and every direct importer of a changed path.
- **(n)**: edited and added test files, and each changed source's re-keyed namesakes. A source with none keeps its direct importers.
- **(nd)**: (n), counting a namesake only when it is direct.
- **(n+K)**: (n), plus the K shortest of the revision's other direct importers.
- **(a) kit**: question 4's counterfactual.

Values are p50 / p90 / max (`results/replay.txt`):

| Rule | Edit files | Own result s | Next edit waits s | All results s |
|---|---|---|---|---|
| *cezar, 62 central* | | | | |
| today | 221 / 234 / 466 | 6 / 75 / 1,062 | 124 / 143 / 145 | 1,554 / 1,957 / 2,208 |
| (a) | 10 / 150 / 173 | 6 / 75 / 1,062 | 6 / 132 / 158 | 842 / 1,488 / 1,972 |
| **(n)** | 2 / 5 / 48 | 5 / 69 / 745 | **6 / 8 / 125** | 607 / 1,003 / 1,501 |
| (n+4) | 5 / 8 / 52 | 6 / 74 / 746 | 6 / 8 / 125 | 610 / 1,024 / 1,502 |
| (n+12) | 10 / 15 / 60 | 6 / 75 / 750 | 6 / 11 / 124 | 635 / 1,024 / 1,506 |
| (a) kit | 10 / 16 / 52 | 6 / 75 / 767 | 6 / 28 / 133 | 636 / 1,024 / 1,522 |
| *cezar, 291 agent* | | | | |
| today / (a) / (n) / (n+4) | 8 / 1 / 1 / 1 (p50); 221 / 10 / 5 / 6 (p90) | 4 / 4 / 3 / 4; 64 / 64 / 32 / 32 | 3 / 4 / 4 / 4; 140 / 19 / 6 / 8 | 55 / 34 / 34 / 34; 1,584 / 940 / 628 / 662 |
| *Squeal, 63 central* | | | | |
| today | 238 / 511 / 594 | 10 / 306 / 1,027 (30 with an own file) | 22 / 28 / 28 | 734 / 1,107 / 1,330 |
| (a) | 1 / 9 / 43 | 5 / 130 / 229 | 6 / 6 / 23 | 262 / 276 / 456 |
| (n) | 1 / 4 / 42 | 1 / 20 / 74 | 6 / 6 / 26 | 262 / 268 / 508 |
| (nd) | 1 / 4 / 42 | 5 / 130 / 223 | 6 / 6 / 26 | 260 / 268 / 508 |
| (n+4) | 1 / 6 / 43 | 2 / 20 / 74 | 6 / 6 / 23 | 262 / 275 / 456 |
| *Squeal, 237 agent* | | | | |
| today / (a) / (n) / (n+4) | 18 / 1 / 1 / 1; 242 / 3 / 2 / 4 | 8 / 8 / 6 / 6; 48 / 48 / 20 / 20 | 19 / 6 / 6 / 6; 29 / 9 / 9 / 9 | 137 / 79 / 79 / 79; 764 / 262 / 262 / 262 |

At tierSize 12 (cezar's stopgap), (n) waits 8 s at p90 against (a)'s 136 s. *verified by replay.*

**Reading it.**

- **Cezar.** (n) fixes what (a) left open, the hub. `bccd1abc` r3 (`store.ts`) keeps 1 edit file instead of 150, and the next edit waits 6 s instead of 114 s. `store.test.ts` reports at 5 s.
- **The remaining tail** is one revision, `ba5234dc` r13 (125 s). It edits `harness-parity.testkit.ts`, which has no namesake, so (n) falls back to its 46 direct importers.
- **Squeal.** Its tests reach central modules through chains and barrels, so (a) already keeps one file at the median and the wait is 6 s.
- **Where (n) differs on Squeal: transitive namesakes.** (n) keeps them as edits, and (a) and (nd) send them to catch-up. That is why the own result is 20 s at p90 under (n) against 130 s.
- **The price of a transitive namesake.** A long one holds the edit route. `backlog.ts`'s namesake `backlog.test.ts` takes 66 s and runs ahead of its guards (question 3).

### 3. Exposure

Method: a fail result (`results.outcome = 'fail'`) belongs to the latest revision of its worktree, at or before the result's revision, that re-keys its file. A failure is **new** when the file's last result before that revision passed. A carried failure is no news and orders first anyway. Each revision with a new failure is replayed under each cut. *read from the stores; the counterfactual is inferred.*

| | cezar | Squeal |
|---|---|---|
| agent revisions with a new failure among re-keyed files | 47 (of 66 with any failure) | 28 (of 47) |
| first new failing file under today's order: edited test / namesake / other direct / transitive / outside | 22 / 3 / 7 / 6 / 9 | 9 / 0 / 2 / 5 / 12 |
| (a) against today: later in, p50, max | 7, 1 s, 5 s | 9, 47 s, 63 s |
| (n) against today | 7, 1 s, 65 s | 10, 47 s, 105 s |
| (n+4) against today | 8, 1 s, 63 s | 9, 47 s, 105 s |
| **(n) against (a)** | **2: +65 s, +62 s** | **1 real: +78 s**; +58 s (a long transitive namesake ahead of a guard), four of 1 to 2 s (tier packing) |
| **(n+4) against (a)** | **1: +63 s** | 0 real; the same +58 s and four of 1 to 2 s |

The three real cases, all direct importers that are not the namesake:

- **`66a59a96` r21** (cezar): `runner-runtime.ts` broke `codex-startup.test.ts`, which takes 1 s. The namesake `runner-runtime.test.ts` failed too, but takes about 60 s. (n) reports at 66 s, (n+4) at 1 s.
- **`bccd1abc` r2** (cezar): `store.ts` broke `runs/repo-handle-recovery.test.ts`, a store behaviour tested under another name. It was not among the 4 shortest of 150, so (n+4) reports it 63 s later.
- **`2851919a` r9** (Squeal): `status-wait.ts` broke `test/status/torn-read.test.ts`. (n) reports it at 80 s, (n+4) at 2 s.

The larger number is against today, for any cut. Declared-input guards are the outside class:

- **Squeal:** `test/harness/{pi,opencode}/package.test.ts`, `plugin.test.ts`, `key-format.test.ts` and `version-sensitive.test.ts`. They were the first new failure in 12 of 28 revisions. Every cut runs them in a backlog tier, which stores at its end, so they report about 47 s later.
- **Cezar:** its guards are short and its edit sets small, so the delay is 1 s at the median.

*verified by replay; n is small: 3 cases of "other direct" first failures in 75 revisions, each 62 to 78 s.*

### 4. The smell

**Method** (`hubs.mjs`, at a8042ec3). Every file whose source imports a hub, classified from its import statement and text:

- **type only**: every imported name is a type.
- **subject**: the hub's namesake, or a file whose `describe` titles name its main export (`RunStore`, `RunManager`), or one that imports no other source module and no testkit.
- **fixture**: any other test file.
- **testkit**: a helper module that imports the hub.

Spot-checked by hand:

- `client-request.test.ts` is a subject: its second suite is "RunStore client request id".
- `schedule-runner.test.ts`, `conversation-service.test.ts` and `artifacts/lifecycle.test.ts` are fixtures: each builds a `RunStore` to test another module.
- `harness-parity.test.ts` (534 s) is a fixture. A looser rule that matched "store" in titles called it a subject.
- `repo-handle-recovery.test.ts` is classified a fixture but tests a store behaviour. That is the heuristic's known error, and it is the file of `bccd1abc` r2.

*verified by experiment, heuristic.*

| Hub | Importers in source | Runtime test importers | of them subject | of them fixture | type only (in source, dropped) | testkits importing it (tests reached only through them) |
|---|---|---|---|---|---|---|
| `runs/store.ts` (4,925 lines) | 221 | 163 | 11 | 152 | 16 | 7, `run-store.testkit.ts` among them (66) |
| `workflows/run.ts` | 142 | 42 | 5 | 37 | 84 | 5 (67) |
| `core/harness-parity.testkit.ts` | 51 | 45 | 3 | 42 testkit users | 0 | 5 (13) |

**Verdict.** The count is ordinary test setup, not a design fault in the tests. The store is cezar's persistence, and tests build a real one in a temp directory rather than mock it. 93 % of its runtime importers do that. A smell exists, but in the module: `store.ts` is 4,925 lines, so any edit to it touches every user, and Squeal cannot tell which edit touched which behaviour. Cezar already has `run-store.testkit.ts` (66 tests reach the store only through testkits). *inferred from the counts.*

**A testkit indirection under each cut.**

- **(a):** the 152 fixtures become depth 2 and catch-up. Edit files on the central revisions fall to 16 at p90, and the next edit's wait to 28 s at p90 (from 132 s). The 28 s rests on classifying `harness-parity.test.ts` as a fixture: counted as a subject, the wait stays 142 s.
- **(n):** it changes nothing, because fixtures are already catch-up.
- **Exposure:** under both, `repo-handle-recovery.test.ts` reports later (+76 s under (a) kit).

So the indirection buys under (a) what (n) buys with no change to cezar, and only for this hub. *verified by replay.*

## Recommendation for Squeal

**Cut (n+K), with K = `runner.tierSize`.** A revision's edit work is:

- its edited and added test files;
- for each source it changed, that source's namesakes among the files the revision re-keyed, or, when the source has none, the runner's direct importers of it;
- the K shortest, by last-known duration, of its other direct importers.

Everything else it re-keys is catch-up (011-22's group).

The tradeoff that decides it: on cezar the next edit's wait at p90 falls from 132 s under (a) to 8 s. Against (a), the first new failure reports later in 1 of 75 revisions with a new failure, by 63 s. (n) without the K catches 2 fewer of those 75 (+65 s, +78 s), at no gain in the wait. The own test file reports no later than under (a), and earlier where it is a transitive namesake (Squeal p90 130 s → 20 s).

**A repository with no naming convention** keeps the edit route. When no changed source has a namesake, every source falls back to its direct importers, and (n+K) is (a), `central-edits.md`'s cut. Squeal is half such a repository: 17 of 31 central sources have no namesake. Its replay shows the fallback working, with the next edit's wait at 6 s at p90 under every cut. What such a repository does not get is the hub relief: a module that 150 tests import directly, with no namesake, keeps all 150 as edits, as under (a) today. The rule degrades to (a), never to "everything is catch-up".

**C4 sentences it would change** (on top of `central-edits.md`'s, which the spec has not taken yet):

- Step 4, "Work an edit caused, a test file whose closure a revision changed, that a revision added or edited, or that the runner reports as a direct importer, runs ahead of the baseline, …" becomes: "Work an edit caused runs ahead of the baseline, …: a test file a revision added or edited; for each source it changed, the source's namesakes among the files it re-keyed, or, when it has none, the test files the runner reports as its direct importers; and the `runner.tierSize` shortest of the revision's other direct importers by last-known duration."
- Add after it: "A namesake of a source is a test file of the same name with `.test` or `.spec` before its extension (pytest: `test_<name>.py` or `<name>_test.py`), in the source's directory, its `__tests__`, or a test tree that mirrors its path below `src/`; failing those, the only test file of that name in the repository. An `index` file has none. A revision of fewer keyed paths makes catch-up of every other file it re-keys: other direct importers, files it reaches through other modules, a declared input or a path a run read. When its runner part gives no answer, every file it reaches stays an edit's work (amended 2026-10-…, row 011-25; cezar 2026-10-14 to 10-19: the next edit's wait at p90 132 s under direct importers, 8 s under namesakes; `research/central-edits.md`, `research/edit-cut.md`)."
- "Explicit checkpoints": "An edited file or a direct importer goes in the first group" becomes "An edited file, a namesake or a direct importer an edit keeps goes in the first group".
- Step 4's class order inside each group, step 5, the turn and C15 stand: a named wait still moves a catch-up file to the first group.

**The question the human must decide.** Which files stay an edit's work when an agent edits a source? There are three options:

- **(a) every direct importer.** No naming rule. On cezar a hub edit holds the lane: 132 s at p90.
- **(n+K) namesakes plus the K shortest direct importers.** Recommended. 8 s at p90. 1 of 75 new failures reports 63 s later than under (a).
- **(n) namesakes only, the human's proposal.** The same wait as (n+K). 3 of 75 report 62 to 78 s later than under (a).

Under (n) and (n+K), a source without a namesake keeps all its direct importers, uncapped. Capping that fallback is a further choice. It would also relieve a hub in a repository without names. It would cost the own test file wherever it is not among the K shortest, which `central-edits.md` measured at 16 of 110 own files.

**The slice's done-when, as tests** (these replace `central-edits.md`'s 1 to 10; `test/scheduler/`, `catch-up-fixture.ts`'s shape: real store and pool, a fake runner of fixed durations whose `affected` returns a direct and transitive split):

1. Namesake cut. One edited `src/a.ts`, with `src/a.test.ts` direct, 6 other direct importers of 0.1 to 3 s, and 200 transitive files of 0.1 to 5 s plus one of 60 s. The edit tiers hold `a.test.ts` and the 4 shortest other direct importers, with no grant. The rest run as catch-up: backlog tiers with a grant, more than `runner.tierSize` files. Red on main: edit tiers over all 207.
2. Matchers. Each of these is kept:
   - a mirrored `test/x/b.test.ts` for `src/x/b.ts`;
   - the only `c.test.ts` in the tree for `src/deep/c.ts`;
   - `tests/test_d.py` and `pkg/d_test.py` for `pkg/d.py`.

   Two `e.test.ts` in different directories and no sibling give no namesake, and `e.ts`'s direct importers are all kept. `index.ts` never has a namesake.
3. No naming convention. A revision whose changed sources have no namesake keeps every direct importer as an edit and makes the transitive files catch-up (cut (a)). A namesake the revision does not re-key counts as none.
4. A transitive namesake (it imports the source through a barrel) is an edit's work. It runs in the first group before catch-up.
5. Guard (holds on main): the own namesake is current before any catch-up file's run starts, and so is an edited test file.
6. A second edit 1 s into the first edit's catch-up Vitest tier cancels it. The second edit's namesake is current within its own run plus 6 s. In a node:test lane the edit's tier starts beside the catch-up slots.
7. `affected` fails or is abandoned: every reached file goes in the first group, as today.
8. A declared-input test and a non-namesake direct importer beyond the K are catch-up. A named wait (C15) on either promotes it ahead of catch-up.
9. A daemon start over an unrefined small revision classifies by namesakes and the runner's `affected`. Under `lookup-only` nothing is queued.
10. 011-22's `catch-up.test.ts` 1 to 3 stay green (10 or more keyed paths: all catch-up).
11. The cezar case: `probes/edit-cut/replay.mjs` on the slice's selection, or live once the load is below 8. Version bump, review PASS.

## Open questions

- **Small n.** Three "other direct" first failures in 75 revisions drive the (n) against (n+K) choice: a large per-case effect (62 to 78 s), unconfirmed. Ten times the history would put a rate on it.
- **Loose anywhere matches.** `failures.ts` → `test/cli/failures.test.ts` is one. A wrong namesake displaces the source's direct importers. Requiring direct (nd) removes the risk but loses barrel-reached namesakes (Squeal own p90 20 s → 130 s). Not resolved.
- **Long namesakes hold the route.** Examples: `runner-runtime.test.ts` (60 s), `backlog.test.ts` (66 s). A guard that reads declared inputs then waits behind them (+58 s, `f096238b` r33).
- **Guards report later under every cut** (Squeal 47 s at the median) because a backlog tier stores at its end. Streaming Vitest slots (`research/streaming-lanes.md`) would remove that. Outside this row.
- **pytest** is not measured: no repository on the host.
- **Bursts and live numbers.** As in `central-edits.md`: replays take each revision alone, and the load never fell below 8.

## Sources

- Squeal main `b3e190d6`: spec 011 C4 step 4, C15, `status.md`; board row 011-25; `research/central-edits.md` and `probes/central-edits/` (`graph.mjs`, `direct.mjs`, `replay.mjs`, reused in method); `probes/catch-up/{calibrate,explained,snapshot}.mjs`.
- Cezar's store copy `/tmp/r3/cezar-store.sqlite` (2026-10-19T22:21Z) and git `/home/agent/projects/cezar` (25 heads; hubs at `a8042ec3`). Squeal's store `/home/agent/projects/squeal/.git/squeal/store.sqlite`, copied to `/tmp/r25b/squeal-store.sqlite` (2026-10-20T10:48Z), and git (62 heads). `mvp-unveiled-july26`'s store, copied to `/tmp/r25b/mvp-store.sqlite`, and `git ls-files` at `00bbf84a`.
- Squeal's static graph trust (`probes/edit-cut/results/trust-squeal.txt`, at `dbe34551`): 737 test files, recall 0.949, precision 1.000 against stored closures. The misses are runtime-read preloads (`src/runners/observe/recorder.cjs` in 64 closures).
- rolldown 1.1.5 and es-module-lexer 2.3.1 from the npm registry.
- Probes: `probes/edit-cut/` (README, `lib.mjs`, `classify.mjs`, `trust.mjs`, `namesakes.mjs`, `hubs.mjs`, `replay.mjs`, `results/`).
