# gh-175 study: complete evidence for a widely imported file (row 020-17)

Recommendation: keep the completion rule, and add three things to `squeal code --base`. First, a pre-run estimate from the stored file durations, printed before the first run. Second, a run order that puts the loaders of the changed path with the smallest loader set first. Third, after a human decision, reuse of the gate's own completed files on the next run. In a model built on cezar's stored durations, with D14's scope, these make every changed path of the #175 change complete in 1,500 s except the hub file itself. The hub file needs its whole loader set, and 600 s cannot cover that on this host.

Examined on 2026-11-11: Squeal source at `dcafbc887` (0.1.430), Vitest 5.0.3 in Squeal and 4.1.10 in cezar, Node 24.22.1. cezar (hearsay-tools/cezarion) at `7e0883a43` ("fix(home): refuse a test marker at the account home in every process (#3220)", 2026-11-10 23:52Z). This is the only commit near #175 that changes `packages/cezar/src/paths.ts`. Its parent `1b5939ba0` is on `origin/main`. **inferred:** this is the change #175 reports, because the issue names no commit. cezar's store was read with `?immutable=1` (no lock and no `-shm` write) and is live, so the newest WAL rows are not seen. Nothing was written in `~/projects/cezar`. The scratch copy is `/tmp/wide-import/cezar` (`git clone --shared`, `pnpm install --offline --ignore-scripts`). Load rule: no live probe ran while the one-minute load was above 24. One smoke run did, see Q1. The load stayed above 24 for the rest of the session, so every live probe was skipped ("Live probe results").

| # | Question | Answer | Tag |
| --- | --- | --- | --- |
| 1 | Where the time goes | In the per-file runs. cezar's selected files cost about 17,400 s of serial file time in scope, plus 2,560 s for 114 browser files that run one at a time after the rest. Before the run, #175 itself shows 153 s of a 1,500 s budget gone. Mapping and the evaluator looked small in a smoke run above the load limit | read in the issue; verified by experiment (store query); smoke only |
| 2 | Order | Order by changed path, smallest loader set first. Gain for #175 with scope, 11 workers: at 600 s, 2 → 4 of 8 paths; at 1,500 s, 2 → 7 of 8. A function's loaders are its **file's** loaders, so per-function order adds nothing inside one file | inferred (model on store data); read in source code |
| 3 | Estimate before the run | Yes. The store has a whole-file duration for 1,213 of 1,397 selected files (87%). Sum ÷ width = about 1,590 s at 11 workers against 600 s. Print it before the first run with the ways out. Do not stop on it | read in source code; verified by experiment (store query) |
| 4 | Reuse today | Close to none for a hub change: every selected file's key holds the changed bytes. #175 read 11 of 1,834 from the stores. cezar records CI parts only in merge groups. The gate keeps nothing, so the 1,500 s rerun repeated the 600 s run | read in the issue, source code and cezar's CI |
| 5 | D14 scope | It removes 114 of 1,397 files (8%) but 2,561 s of serial time (13%). These are the only loaders that run one at a time. Without scope, no path that a browser file loads can complete in 1,500 s | verified by experiment (store query); read in source code (Vitest) |

## Q1. Where the time goes

**Selection.** **verified by experiment (store query)** (`probes/wide-import/cezar-store.mjs`, output `/tmp/wide-import/out/cezar-store.json`, summarised below): of cezar's 2,387 stored test files, 1,397 have a stored closure that holds one of the 9 changed paths. Projects: `server` 1,256, `e2e` 114, `web` 11, `f2:package` 6, `root:test:unit` 6, `test:unit` 3, `test:package` 1. #175 reports 1,834 selected. The stored closures are the daemon's ("static imports plus declared inputs", `complete: 0`) as of 2026-11-11, not Vite's graph at the time. **The disagreement stays open:** only a gate run at `7e0883a43` decides it (the pre-run probe below).

**Run.** Per-file cost has three sources, and they disagree:

- The store's `file` check holds the last module duration: environment, prepare, collect, setup and tests (**read in source code**, `src/runners/vitest/reporter.ts:286-291`, "what running this file alone costs"). It covers 1,213 of the 1,397 files. Median 8.7 s, serial sum 18,386 s.
- cezar's CI manifest `.github/test-durations.json` (CI, `--maxWorkers=4`, no Squeal provider) covers 394 files, median 1.4 s. For the files both sources cover, the store's value is 2.7× the manifest's (median ratio). The store is measured on this shared host, under load, with coverage.
- Daemon single-file runs (wall time, worker start included) cover 243 more files, median 15.7 s.

Either way, about 17,400 to 18,000 s of serial file time is in scope, plus 2,554 to 2,561 s for the browser group. The gate's Vitest width in cezar is cezar's own `maxWorkers: defaultMaxWorkers(availableMemory, cpus)` = min(cpus, free GiB ÷ 2). That is **11** here at 22 GiB available (`free -g`, 11:43Z). At width 11 the in-scope files need about 1,700 s, and at width 4 about 4,400 s. #175's 1,500 s run ran out at 1,347 s with files left. That fits. The daemon's last completed `squeal run --all` checkpoint in the store took 7,252 s for 1,749 files (`cezar-store.out.json`, `runAll`).

**Before the run.** **read in the issue:** `run exceeded timeoutMs (1347354 ms)` with `--timeout 1500`. **read in source code:** the collector passes what is left of the deadline to `run` (`collect.ts:176-180`). So 1500 − 1347 = **153 s** went before the first test: inventory, adapter open, `testFiles()`, `affected()` and the store lookup. The lookup opens a second, daemon-shaped Vitest and keys every selected file (`gate/stored.ts`, `openStored`). How these 153 s split is **not determined**, because the load stayed above 24 ("Live probe results"). The probe is `runs.sh` step 3.

**After the run.** **read in source code:** `mapPayloads` maps every completed file's payload after `run` returns (`collect.ts:185`), and `evidenceOf` asks `closure()` per file (`collect.ts:187`). Both run after the deadline, outside the budget.

**Synthetic fixture** (`probes/wide-import/fixture.mjs`: one hub of 40 functions imported by all N test files through one module each, 8 side files with 10 loaders each spread over the path order, 40 ms per test). Smoke run, N = 60, **load 27.4 at start, above the limit, so it is a smoke result only**: open 1.47 s, `testFiles` 2 ms, `affected` 0.90 s, run 2.86 s, 60 `closure()` calls 13 ms in total, mapping plus evaluation about 0.17 s, close 15 ms. The 600-file runs did not take place ("Live probe results"). The 1,800-file run is ruled out by the brief.

## Q2. Ordering

**read in source code:** D5 judges loaders per **source path**. A function's expected loaders are every selected file whose closure holds its file (`evaluate.ts:53-57`, `standing`). An unfinished loader makes the whole path `not-finished` (`evaluate.ts:93`). So the functions of one file complete together or not at all. Ordering "by function" has the same effect as ordering by path. The unit to order is the changed path.

**read in source code:** the gate hands one runner its files sorted by path (`collect.ts:282`). Vitest keeps that order within a project. `runTestSpecifications` never fills the file stats (only `start()` does, Vitest 5.0.3 `index.DpLw24bj.js:21016`, 4.1.10 `cli-api.BK8pd4xc.js:13478`), and the gate runs with `cache: false`, so the results cache has no path and reads nothing (`setConfig(root, resolved.cache)`, 5.0.3 `index.DpLw24bj.js:7056-7058`, `20652`). So `BaseSequencer.sort` finds no stats and no results and returns 0, and the sort is stable. Projects are sorted by name. An isolated project with `maxWorkers` 1 and the default `groupOrder`, such as cezar's `e2e` (`fileParallelism: false`), goes into a sequential group that runs **after** every other file (`groupSpecs`, 4.1.10 `cli-api.BK8pd4xc.js:3782-3848`). A project's own `sequence.sequencer` can change this. cezar's `CiTestSequencer` overrides only `shard`. That the order is honoured is **read in source code**. The smoke run agrees, but it ran above the load limit, so it is not a finding ("Live probe results").

Proposed order: for each changed path, its loader set; paths in ascending order of their loaders' summed stored duration (count when unknown); emit each path's loaders not yet emitted. The hub, which every file loads, then comes last for free. The closures are already read per file after the run (`collect.ts:187`), so reading them before the run adds no work.

**Simulated on store data** (`probes/wide-import/simulate.mjs`, list scheduling, store durations first, browser files one at a time after the rest; this is **inferred**, not a run):

| Width, budget | Scope | Path order (today) | Loader order |
| --- | --- | --- | --- |
| 11, 600 s | all | 640 files, 0 of 8 paths | 636 files, 2 paths |
| 11, 600 s | D14 | 640 files, 2 paths | 636 files, 4 paths |
| 11, 1,500 s | all | 1,227 files, 0 paths | 1,252 files, 2 paths |
| 11, 1,500 s | D14 | 1,227 files, 2 paths | 1,252 files, **7 paths** (all but `paths.ts`) |
| 4, 1,500 s | D14 | 511 files, 2 paths | 578 files, 4 paths |

Paths are the 8 changed paths that have a loader. `scripts/test-install-marker.d.mts` has none. The manifest-first cost gives the same path counts. Loader order gains changed paths, never the hub. That gain is the case #175 asks for: "report which functions are complete as soon as they are". It needs no change to when evidence is complete.

## Q3. An estimate before the run

**read in source code:** the main store's `results` row of a file's `file` check holds its module duration (above). The gate already opens the stores read-only (D11.7). Estimate = max(longest file, Σ duration ÷ width) per parallel group, plus the sum of each sequential group. Files with no duration count at the median. Width comes from the opened instance (`vitest.config.maxWorkers`, `width.ts:65`) and from `runner.tierSize` for node:test.

For #175, at width 11: about 17,400 ÷ 11 ≈ 1,585 s in scope, plus 2,561 s for the browser group. **inferred:** that is enough to say at once "the selection needs about 26 minutes at 11 workers; the budget is 10 minutes". The ways out are the D14.4 ones, plus `--timeout`, `<path>` narrowing, the daemon's catch-up and `--parts`. Stored durations are host-bound: 2.7× apart between this host and CI. So the estimate is advice. It is not a reason to skip runs. A run that stops early completes nothing. A full run in loader order still completes the small paths. The estimate needs no store: without one, it says "unknown" and names the count.

## Q4. Reuse (D11.7 stores, D13 parts)

**read in source code:** a D11.7 or D13.2 hit needs the file's key or tested input at the **head** bytes (`gate/stored.ts`, `gate/parts.ts`). Every selected file loads a changed path, so every key holds the changed bytes. For a hub change, only evidence made after the edit can be reused:

- **The daemon in that worktree.** The edit cut keeps namesakes and the `runner.tierSize` shortest direct importers. Every other reached file is catch-up (`scheduler/edit-cut.ts:78-99`, `bootstrap.ts:253`). #175 read **11 of 1,834** from the stores (**read in the issue**). That is the size of an edit's kept work. Catch-up runs the rest only after quiet time, and with cezar's lookup-only baseline the daemon does not run unchanged files.
- **CI parts.** **read in cezar's CI** (`origin/main` `.github/workflows/ci.yml:785-806`, `.github/scripts/ci-squeal-results.workflow.test.cjs:59`): "only merge groups run the shard under squeal ci record". A PR head never has parts. cezar's pre-PR step (`.ai/skills/check-code-quality/references/pre-pr.md:17`) passes no `--parts`. So reuse from parts is 0 today.
- **The gate's own runs.** D3.5 forbids writes. The 1,500 s rerun in #175 repeated every file of the 600 s run (**inferred** from D3.5).

What would raise it, largest first: (a) the gate keeps each completed file's results and record at its D11.7 key, so the next gate run on the same bytes starts where the last one stopped. This is the same evidence under the same key rule, so completeness is unchanged. It reverses D3.5 and D11.7's "never writes", so it is a human decision. (b) Waiting for the daemon's catch-up before the gate. This is a documentation change. (c) cezar records parts on PR pushes too. That is a cezar change, close to 020-08c.

## Q5. D14 scope and `gate.groups`

**verified by experiment (store query):** the `browser` group (`checks`: `e2e`, `manual`) holds 114 of the 1,397 selected files, with 2,561 s of serial time. These files run one at a time, after the rest. Without scope, every path that a browser file loads keeps an unfinished loader until the very end, so none of them can complete within 1,500 s. That is 0 of 8 paths in the simulation. With D14, those loaders are left out (D14.2), the sequential tail goes away, and the 1,283 in-scope files bound the time. `gate.groups` gives no further cut for cezar: its only other groups are the defaults and `lint`. Scope is necessary, but it does not make 600 s enough. The in-scope files alone need about 1,590 s at width 11.

## Proposal: spec section D16 "Wide selections" (for the coordinator)

1. **Estimate (D16.1).** After selection and the stored lookup, before the first run, stderr gets one line per runner with the estimated seconds, the files with a known duration, the width, and, when the estimate passes what is left of the budget, the ways out. D7 gains `estimate`. It does not change the verdict.
2. **Order (D16.2).** The collector reads closures before the run and hands each runner its files in loader order (Q2). The report is unchanged, apart from `runs[].selected` order, which is sorted for the golden.
3. **Time before the run (D16.3).** The budget line names the pre-run seconds. The store lookup counts against the budget as it does today.
4. **Gate records (D16.4, needs the human).** Reuse the gate's own completed files on the next run (Q4 (a)).

`QUALITY_POLICY_VERSION` does not change: no state rule changes.

Rows, in this order, after 020-15a and 020-15b (both edit `collect.ts`):

- **020-17a estimate.** New pure `src/core/code/gate/estimate.ts` (groups, width, durations → seconds). A `durations` option in `collect.ts` beside `stored`. A read of the `file` check durations in `src/cli/code-gate-stored.ts`. The `estimate` field in `report.ts`. A stderr line in `code-gate-text.ts`. Tests: `test/code/gate/estimate.test.ts` (Σ ÷ width, a sequential group, unknown files at the median, no store), and a CLI case where a seeded store makes the line appear before the first run.
- **020-17b order.** New pure `src/core/code/gate/order.ts` (loader sets, durations → order). In `collect.ts`, closures before `run`. Tests: `test/code/gate/order.test.ts` (smallest set first, ties by path, hub last, unknown closure last), and a collect fixture with a short budget and deterministic sleeps where a leaf path completes in loader order and stays `not-finished` in path order.
- **020-17c gate records** (only if the human approves D16.4). The gate writes completed files at their D11.7 key. Tests: a second run reads them, and a changed byte runs them again.

## Open questions

1. For the human: may the gate keep its own completed results for the next run (D16.4)? This reverses D3.5's "nothing is written to a store".
2. Should a run whose estimate far exceeds the budget stop before running? Recommended: no (Q3).
3. 1,834 (issue) or 1,397 (stored closures) selected files: only a gate run at `7e0883a43` decides it (`runs.sh` step 3).
4. The live phase costs and the loader-order gain on a real run, once the load allows ("Live probe results").

## Live probe results

**Not determined, because** the one-minute load stayed above 24 for the whole session. `probes/wide-import/guard.sh` skipped every step after waiting 10 minutes for the load to fall:

| Step | Skipped at | One-minute load |
| --- | --- | --- |
| cezar pre-run (first queue) | 11:54:03Z | 41.17 |
| `f600-full` | 12:05:45Z | 47.59 |
| `f600-half-path` | 12:15:45Z | 39.76 |
| `f600-half-loaders` | 12:25:46Z | 77.05 |
| `cezar-prerun` | 12:35:46Z | 46.28 |

Other loads read during the session: 28.07 at 11:36Z, 30.07, 25.84, 20.24 at about 11:45Z (between runs, no probe was queued then), 41.40, 50.37, 42.43 and 45.00 at 12:16Z. The coordinator stopped the queue (2026-11-11). The 1,800-file run was never started: it is the long gate run that the brief rules out, and it stays a commented command in `runs.sh` for a later, approved run.

So these points stay **not verified by experiment**:
- that Vitest starts files in the order the gate gives, at scale. The N = 60 smoke run started files in rising path order (first starts `00004 00014 00007 00001 00005 …`, last `00056 00055 00057 00059 00058`, with workers in parallel). That fits the source reading, but the run started at load 27.4, above the limit;
- how cezar's pre-run 153 s divides into open, `affected()` and the store lookup;
- the per-phase cost at 600 and 1,800 files, and the loader-order gain on a real run.

Commands for a later run, from the worktree root, when the one-minute load is at most 24:

```sh
D=docs/specifications/020-quality-gate/research/probes/wide-import
git clone -q --shared --no-checkout ~/projects/cezar /tmp/wide-import/cezar
git -C /tmp/wide-import/cezar checkout -q --detach 7e0883a43
(cd /tmp/wide-import/cezar && pnpm install --frozen-lockfile --offline --ignore-scripts)
$D/runs.sh        # f600-full, f600-half-path, f600-half-loaders, cezar-prerun; outputs in /tmp/wide-import/out
```

The half budget is the pre-run time plus half of `f600-full`'s run, or 20 s when `f600-full` did not run. Both orders get the same budget.

## Sources

- Spec 020 D3, D5, D11.7, D13, D14 (`spec.md`), `research/issue-175.md`, `research/selection.md`. Issue https://github.com/hearsay-tools/squeal/issues/175 (body and the #3197 comment).
- Squeal `dcafbc887`: `src/core/code/gate/collect.ts`, `evaluate.ts`, `stored.ts`, `src/cli/code-gate.ts`, `code-gate-stored.ts`, `src/runners/vitest/run.ts`, `reporter.ts`, `width.ts`, `src/core/scheduler/edit-cut.ts`, `bootstrap.ts`.
- Vitest 5.0.3 `node_modules/vitest/dist/chunks/index.DpLw24bj.js` (BaseSequencer 13366-13414, populateStats 7022 and 21016, executeTests 11700). Vitest 4.1.10 in the cezar copy, `dist/chunks/cli-api.BK8pd4xc.js` (groupSpecs 3782, runTestSpecifications 13541, populateStats 13478).
- cezar `7e0883a43`: `vitest.config.ts`, `packages/web/e2e/vitest.config.ts`, `.github/scripts/ci-test-sequencer.mjs`, `.github/scripts/vitest-worker-count.cjs`, `.github/test-durations.json`, `squeal.config.json`. `origin/main`: `.github/workflows/ci.yml`, `.ai/skills/check-code-quality/references/pre-pr.md`. Store `~/projects/cezar/.git/squeal/store.sqlite` (read-only, immutable).
- Probes: `probes/wide-import/` (README).
