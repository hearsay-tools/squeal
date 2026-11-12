# 020-42: selection for files the Vitest config imports (#198 part 1)

Researcher 9f26ed88, 2026-11-12. Brief: `../tasks/wave-14.md`, "020-42". Read: `research/issue-198.md`, spec 001 D3 and D4, spec 020 D3.1, D11.7 and D17.3. Source at `f1fbf73bc` (main `52534310d` plus the probe fixture). Vitest 5.0.3, Vite 8.3.2, Node v26.13.0. Released Squeal 0.1.457 for the gate and daemon runs. Probes: `probes/config-dependency-selection/` (throwaway, see its README), run in `/tmp/cds` with `HOME=/tmp/cds/home` and `TMPDIR=/tmp/cds/tmp`. The one-minute load was 22.14 to 23.37 at each probe start (22:42 to 22:44 UTC). The guard script skips any step at load 24 or more.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Can the gate select fewer than every test file for a config-dependency-only change, with no false pass? | Only as all or nothing extra. No file-level evidence narrows "all" to a subset. One proof can show that a change affects no test: every changed line is in a function that the Vitest main process never called in this run. The import graph and the resolved config cannot give that proof. | verified by experiment (9 edits); rule inferred |
| 2 | Which evidence shows which tests the file affects? | Main-process V8 call counts of the changed functions. They were correct on 9 of 9 edits. A resolved-config diff missed 3 of the 7 edits that changed an outcome. The import graph missed all 7. | verified by experiment |
| 3 | What does the daemon do with the same edit? | It re-keys every test file and runs all of them. In the probe, 10 of 10 files ran again within 3 s of a shard-only edit, under new keys. | verified by experiment (0.1.457); read in source code |
| 4 | Must the gate and the daemon agree? | The stores do not need it: a key does not depend on selection. A product rule asks for it: the human chose "match the daemon" for declared inputs on 2026-11-12. The daemon cannot use the call-count proof without a new key design. This is a human decision. | read in spec; inferred |

## Findings

**Q1–Q2. Nine edits, one test run each** (`out/<edit>.json`, from `probe.mjs`). The probe starts Vitest in-process with the options that the Squeal adapter uses (`reporters: [own]`, `watch: false`, `fsModuleCache: false`, `cache: false`, no `--shard`). It reads three things: `configFileDependencies`, the hash of Squeal's own `canonicalConfig`, and the main-process call counts from the inspector. The baseline passes 10 of 10 files.

| Edit (one file) | In `configFileDependencies` | Resolved config changes | Outcome | Changed code ran in the main process |
|---|---|---|---|---|
| `define` value | yes | yes | `define.test.ts` fails | top level, runs at load |
| imported JSON used in `define` | yes | yes | `data.test.ts` fails | top level (JSON) |
| plugin `transform` | yes | **no** | `plugin.test.ts` fails | `transform` 13 calls |
| side effect `process.env.X = …` | yes | **no** | `side.test.ts` fails | top level |
| sequencer `sort` (through `order.mjs`) | yes | **no** | order reversed; `b-reader.test.ts` fails | `sort` 1, `order` 9 calls |
| sequencer `shard` helper | yes | no | none | `shard` 0, `pickShard` 0 |
| reporter class (instance in config) | yes | no | none | `onTestRunEnd` 0 |
| reporter given as a path string | **no** | no | none | never loaded |
| JSON read by the sequencer with `fs` | **no** | no | none | n/a |

Tag: verified by experiment. Four facts follow from the table:

- Each failing edit failed a test file that has no import edge to the changed file. The plugin changes the bytes of an imported module, `define` changes the transform, the side effect changes the environment of the workers, and `sort` changes the order of order-coupled files. So no subset of "all" can come from the module graph. The Vitest walk finds only `sequencer.test.ts`, which imports the sequencer itself.
- A resolved-config diff is not a proof of no effect: three edits failed a test with an unchanged `canonicalConfig` hash.
- The main-process call counts separate the two groups exactly. Every edit that changed an outcome touched top-level code or a function that ran. Every edit without an effect touched only code that never ran.
- Squeal replaces the config's reporters (`src/runners/vitest/adapter.ts:236`, `reporters: [createSquealReporter(current)]`). So a reporter's hooks never run in the gate or in the daemon: an `onTestRunEnd` that throws had no effect. Vitest calls `sequencer.shard` only when `config.shard` is set, and `sequencer.sort` on every run (`vitest/dist/chunks/index.DpLw24bj.js:11693–11700`, read in source code 5.0.3).

**Q1. The real case.** squawk PR 3357, merge `becede8ec`, read with `gh pr diff`. It changed `.github/scripts/ci-test-sequencer.mjs` by +2 −5 lines: the body of `fallbackDuration`, plus an `export` keyword added to its declaration. The class overrides only `shard`. `fallbackDuration` is reached only through `assignShards` from `shard()`. The gate runs without `--shard`, so the changed body never runs. Under the call-count rule, the gate would add no Vitest file for this edit, instead of 1,665. The added `export` keyword is the open point: it changes a declaration at the top level. A strict rule ("every changed line lies inside a function body that did not run") still selects all for this diff. The rule needs a definition that counts an export-only change as part of the declaration. Tag: read in source code (squawk at `becede8ec`); the effect on selection is inferred, because squawk did not run here.

**Q2. The cost of the evidence.** Each item below is needed for the call-count proof:

- The gate runs Vitest in its own process (`src/cli/code-gate-relaunch.ts`: "Collection runs Vitest's global setups in the gate's own process"). So an inspector session in that process can count the calls, as `probe.mjs` does. Tag: read in source code; the counting is verified by experiment.
- Vite bundles the config and its local imports into one file. The probe saw one script, `node_modules/.vite-temp/vitest.config.ts.timestamp-*.mjs`, and the functions of `config/sequencer.mjs` were in it. To map counts to changed functions, the gate must read the source map of that bundle or match functions by name. Neither was tried here.
- `shard` and `sort` run inside each `runTestSpecifications` call, after the run starts. So the gate cannot decide before the run. A possible order: run the narrow selection, read the counts, then run the rest if a changed function ran or the top level changed.

**Q3. The daemon** (`out/daemon-*.out`, `out/daemon-runs.txt`). A full run, then the shard-only edit. At revision 1 the daemon ran two tiers, 4 files and then 6. That is all 10 files, done within 3 s of the edit. `squeal why` shows `plain-1.test.ts` under key `775491be77c9` at revision 0 and under key `5c5a0160b735` at revision 1. The cause in source: spec 001 D3 puts "the contents of the config file and its `configFileDependencies`" into the environment hash of each test file. Tag: verified by experiment (0.1.457); read in spec.

The gate on the same edit (`out/gate-shard.*`): 10 of 10 files selected and completed, verdict `pass`. The changed functions are `pickShard` and `pickShard.<filter>`, with the measured loader `sequencer.test.ts`. The control edit of `src/marked.ts` (`out/gate-control.*`) selects only `plugin.test.ts` and passes. Tag: verified by experiment (0.1.457). The first control run had a probe bug: `sed` also rewrote the `declare` line, so the file did not parse. I fixed it in `squeal.sh` and ran the gate step again with a new HOME.

**Q4. Agreement.** The key does not depend on selection: the gate writes and reads at the daemon's key (020 D11.7, D17.3). So a narrower gate leaves the stores correct. The files it does not select stay without results at the head key, and the daemon runs them, as it does today. The cost of a difference: the gate says `pass`, and the daemon then runs the whole suite. If the proof were wrong, a failure in a file the gate did not select would show up only in the daemon. That is the false-pass case. The daemon cannot take the same proof: a key must be known before the run, and call counts exist only after it. Matching the gate would need a key that holds only the config code that ran, which changes 001 D3. Spec 020 D3.1 (amended 2026-11-12, row 020-35) records the human's rule for declared inputs: "match the daemon". A gate-only narrowing departs from that rule. Tag: read in spec; the consequences are inferred.

**What Vitest and Vite do.** Vite's dev server restarts on a change to any config dependency (`vite/dist/node/chunks/node.js:25260`). Vitest's file module cache puts the contents of every `configFileDependencies` file into the key of every transform (`index.DpLw24bj.js:7325`). In watch mode, Vitest restarts only for the config file itself (`:20639`), because `hmr: false` stops Vite's own restart. Tag: read in source code (Vitest 5.0.3, Vite 8.3.2). So upstream treats a config dependency as global to every file.

## Recommendation for Squeal (to propose, not to decide)

1. Keep "all files" as the default. No evidence narrows a config-dependency change to a subset of files.
2. Option A, the gate alone: add one exception. When every changed region of a config-only dependency is inside a function that the Vitest main process did not call during the run, select no extra file. Otherwise select all. On #198 this needs the export-keyword definition above. It departs from the "match the daemon" rule.
3. Option B, no new evidence: a declared list in `squeal.config.json` of config dependencies that select nothing, used by both the gate and the daemon. This keeps them in agreement. The project owns the risk.
4. Separately, a gap in both: a file that config code reads with `fs`, such as squawk's `test-durations.json`, is in no key and selects nothing. It had no effect here only because only the shard path read it. Tag: verified by experiment that it is not in `configFileDependencies`; its effect on outcomes is not tested.

## Open questions

- How does the gate's counter mark an added `export` keyword: as a change to the function or at the top level? Not determined, because this was not run.
- How should main-process counts map back to source lines in the Vite config bundle (source map or names)? Not determined, because this was not tried.
- Would Option A save time on #198? Inferred yes, from 1,665 files down to the import walk's files. squawk was not run here.

## Sources

- Issue: https://github.com/hearsay-tools/squeal/issues/198. squawk PR 3357, https://github.com/hearsay-tools/squawk/pull/3357, merge `becede8ec`. The `.github/scripts/ci-test-sequencer.mjs` and `vitest.config.ts` files on squawk main, read with `gh api` on 2026-11-12.
- Squeal at `f1fbf73bc`: `src/runners/vitest/affected.ts`, `project.ts`, `environment.ts`, `adapter.ts:220–250`, `src/core/code/gate/changed.ts:154–171`, `src/cli/code-gate-relaunch.ts`; spec 001 D3 and D4; spec 020 D3.1, D11.7 and D17.3.
- Vitest 5.0.3 `dist/chunks/index.DpLw24bj.js` lines 7300–7345, 11682–11700, 20620–20650. Vite 8.3.2 `dist/node/chunks/node.js` lines 25255–25275 and 37300–37335.
- Probes: `probes/config-dependency-selection/` (`probe.mjs`, `edits.mjs`, `run-all.sh`, `squeal.sh`, `guard.sh`, fixture) and their outputs in `out/` (including `job.log` with the loads).
