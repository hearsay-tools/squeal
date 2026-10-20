# 011-47 and 011-41: the barrier on the validity path, then the alarm in place of the guard, notes

Row 011-47 moves the barrier's narrowing into `stability.ts`. Row 011-41 is R4 of task 011-37's design (`../011-37/design.md`, section 6 as amended for risk 4). The brief is the 011-41 section of `../011-37/briefs.md` with its amendment "011-41 and 011-47 after 011-40". The base is 011-40's branch (`wip/011-40` at `dddc7b3f`). The last release is `squeal--v0.1.231`: key format 20, with 13 to 19 read as one. `KEY_FORMAT_VERSION` stays 20, so this row raises nothing.

## Commits

011-47 is its own commit, before any of 011-41's.

| Commit | What |
| --- | --- |
| `f470c9be` | 011-47: `Scheduler.#record`'s narrowing becomes `barredByTouch` in `src/core/scheduler/stability.ts`. The scheduler and the harness's `store-input.ts` both call it. |
| `a0d3fa12` | Risk 4: one overlay per decision fires the alarm (`reach.test.ts`), plus the writers' source scan. |
| `77424fb0` | The `store` kind's verdict reads by direction. |
| `30bb8705` | The alarm replaces the guard. Its entries are in `entries/`, one module per component (`components.ts`). D6 and the list's rule go into the verdict (`verdict.ts`). Each tree bundles at its own build target. `key-sources.ts` and `KEY_SOURCES_HASHES` go. The launchers are pinned by `test/keys/launchers.test.ts`. |
| `3f76b589` | Risk 3: the `adapter:vitest` kind, with 013-01's tests 2 and 4 as its cases. |
| `7d9af71e` | Risk 9: the last release's lock is installed when its packages moved. |
| `f001f122` | The `adapter:vitest` kind reads by direction under the `store` kind's rule (the coordinator's decision of 2026-10-20). |

## The comparison at the head

Command: `TMPDIR=/tmp npx tsx test/keys/validity/compare-refs.ts squeal--v0.1.231 f001f1228`. Two alarms fired: the global one and Vitest's. All 33 cases are equal, with nothing reported, no wording change, no uncovered line and no failure. It took 5.4 s at a one-minute load of 18.5 on 24 CPUs. Squeal passes `test/keys/key-format.test.ts`'s "moves only when the validity path's outputs differ from the last release's", which is the same comparison against the extracted tag, with every version unchanged: 20, Vitest 3, node:test 9, pytest 2, recorder 3.

- **The global alarm fires** because the candidate's harness reads the modules 011-40 and 011-47 moved: `accept.ts`, `store-decision.ts` and `barredByTouch`. The release's harness reads where that code was.
- **Vitest's alarm fires** because 011-40's move 3 changed `adapter.ts`. The three `adapter:vitest` cases run its changed lines, so none is left uncovered.

## 011-47: the barrier's narrowing

- **The move.** `barredByTouch(report, files, touched, growth?)` picks the files whose inputs, or whose observed growth, name a touched path. It returns the report those files are withheld from, the files, and the touched paths they name. `Withholds` still decides first or exhausted in `Scheduler.#record`.
- **The harness.** `harness/barrier.ts` re-exports the function for `store-input.ts`. A tree whose `stability.ts` does not export it reads `harness/barrier-scheduler.ts` instead, through `BEFORE_MOVES`' third entry. A move's `exports` field names the function a move needs exported, so the fallback holds while `stability.ts` exists without it.
- **Against `squeal--v0.1.231`.** The alarm fired. All 30 cases were equal, with no uncovered line, in 4.6 s at a load of 37.9.
- **Tests.** `test/scheduler/barrier.test.ts` has three tests of the narrowing. Risk 4's barrier overlay is the third test below.

## Risk tests

| Risk | Test | Where |
| --- | --- | --- |
| 3 | **"fails Vitest's alone when its results read a skipped test as a pass"**: an overlay on `src/runners/vitest/results.ts`. Only Vitest's alarm fires, so the global and node:test comparisons fire nothing and pass. The two cases that complete a file differ, and both failures name `VITEST_ADAPTER_VERSION`. **"fires none for a change to Vitest's width hints"**: an overlay on `width.ts`. Since `f001f122`, the adapter's withholding is self-tested in both directions. "fails Vitest's when it withholds a file the last release completed" names each file. "reports a file Vitest's completes that the last release withheld, without failing" reports it as "the candidate stores more". | `test/keys/validity/adapters.test.ts` |
| 3 | An adapter-only bump of each runner (S1 of review wave 13m) fires no alarm and fails only its own verdict, for want of a differing case (D6). | `test/keys/key-format.test.ts` |
| 4 | Three overlays fire the global alarm and run their changed line, and cannot fail the comparison (D1 (a)): **"the accept rule holds no fail"** (`accept.ts`), **"the held fail holds none"** (`heldFailure`, `inherited.ts`), and **"the states a fail gives carry no fingerprint"** (`stateFromResult`, `derive.ts`). | `test/keys/validity/reach.test.ts` |
| 4 | **"fails when the store decision withholds a stable completed file"**: `store-decision.ts`, naming "every per-file outcome of a completed tier". **"fails when the barrier withholds every file of a touched tier (011-47)"**: `stability.ts`, with T1 and T2 differing and two failures. | `reach.test.ts` |
| 4 | **"finds no module but store-results.ts and accept.ts writing a result row"**: a source scan for `putMany`, `copyNewest`, and `INTO results` under `src/core/store/`. The result repository is the third writer it finds. | `reach.test.ts` |
| 6 | **"passes a raised format with a case whose outputs differ and no format read as one (D6)"**, **"fails a raise no case's outputs differ (D6)"** and **"fails a raised format that leaves formats read as one (risk 6)"**. | `test/keys/validity/compare.test.ts` |
| 9 | **"reports that the last release's lock must be installed, a transitive package included"**: `enhanced-resolve`'s version, then `tapable`'s integrity, with no installer. Only node:test fires, and its failure names the moved lock lines. **"fires every component when the bundler moved"**: esbuild. **"installs the last release's lock once, then compares each side at its own packages"**: with a stub installer, it is called once with the release's tree, `installed` is true, and there is no failure. **"fires none for a tool's lock entry, nor for the release's own version"**: Biome, and the version in `package.json` and the lock's root. | `test/keys/validity/lock.test.ts` |

Risk 9's tests check the decision, not the install. The install was probed once in `/tmp/probe-011-41`, with `HOME` and `XDG_*` pointed there and an empty npm cache. `installLock` ran `npm ci --ignore-scripts` on `squeal--v0.1.231`'s extracted tree in 10.3 s, and the tree's own esbuild built a module. Then came a full comparison of the checkout against that installed tree, with a moved `enhanced-resolve` overlaid: the release was bundled by its own esbuild and run on its own packages. Global, Vitest and node:test fired, and all 33 cases were equal in 7.2 s.

## The 17→18 one-off

Command: `TMPDIR=/tmp npx tsx test/keys/validity/compare-refs.ts squeal--v0.1.226 squeal--v0.1.228`, all kinds. It took 5.8 s at a one-minute load of 23 on 24 CPUs. Global, Vitest and node:test fired.

**It passes on the `store` and `adapter:vitest` kinds** under their direction. That answers the question 011-40's notes left open: 013-02's narrowing needs no raise.

- **The `store` kind.** In 013-01's test 11, T1 and T2, `slow2` and `slow3` are `unknown` at 17 and stored at 18. Both are reported: "the candidate stores more".
- **The `adapter:vitest` kind.** In 013-01's test 2, the adapter at 18 completes `slow2` and `slow3`, which 17 withheld. In test 4 with two projects, it completes `a/test/held.test.ts`. All three are reported. 013-02 narrowed the adapter's withholding as well as the scheduler's barrier.
- **The other cases.** Every other case is equal. Test 2's withheld reason is wording.

**Its uncovered lines stand as found.** There are 85 distinct lines. compare-refs.ts now groups them by component:

| Component | Lines | Where |
| --- | --- | --- |
| global | 41 | `keying.ts` (5 at 17, 15 at 18), `key-index.ts` (17 at 18), `ledger.ts` (4 at 18) |
| Vitest | 49 | `adapter.ts` (14 at 17, 14 at 18), `touched.ts` (4 at 18), `key-index.ts` (17 at 18) |
| node:test | 29 | `adapter-project.ts` (3 at 17, 9 at 18), `key-index.ts` (17 at 18) |
| recorder | 17 | `key-index.ts` (17 at 18) |

- **The global lines** are 011-38's reading-as-one code. These are the 41 lines that 011-40's notes found.
- **`key-index.ts`'s 17 lines appear under every component** whose entries bundle it (decision 3 below).
- **The adapters' lines** are 013-02's changes in `adapter.ts`, `touched.ts` and node:test's `adapter-project.ts`. The cases do not run them.

## Decisions the brief did not settle

1. **The plugins' launchers stay out of the alarm** (the coordinator's decision (a) of 2026-10-20, request `ad98da15`). Three reasons:
   - The Node that runs is in every environment hash (`nodeVersion`).
   - The CLI a launcher picks carries its own `KEY_FORMAT_VERSION`.
   - `--disable-warning` stores nothing.

   The pin, in the alarm commit: `test/keys/launchers.test.ts`. Every `node` invocation in `plugins/*/bin` passes only `--disable-warning=<name>` flags. The one exception is the CLI's lookup, a `node -e` script whose output the launcher reads. No launcher sets `NODE_OPTIONS` or exports an environment variable. The same reason is in `entries/global.ts`'s comment.
2. **The build target and tsconfig of each tree** (accepted by the coordinator, 2026-10-20).
   - **The build target** (`30bb8705`): each tree bundles at the target its own `src/harness/build.ts` names, read by `bundle.ts`'s `targetOf`, where the comparison used to use the candidate's for both trees. A moved target therefore shows in the emitted code ("fires on a change to the build's target, which the shipped bundles are built at", `key-format.test.ts`).
   - **The tsconfig**: this row added nothing. Since 011-39, `extractTree` archives `tsconfig.json`, and esbuild reads each source's nearest tsconfig, so each tree's sources compile under their own.
3. **Components.**
   - **What each one is.** `components.ts` names five: global, vitest, node:test, pytest and recorder. Each has its version constant, its entries module under `entries/`, the texts it hashes beside its bundle, and the case kinds that are its own.
   - **Bundling.** Each component's entries are bundled at both trees with every version constant pinned to `"0"` (`bundle.ts`, `VERSION_FILES`). A version that moves alone therefore fires nothing, and its verdict holds it to D6.
   - **Attributing uncovered lines.** A changed line that no case ran counts against every component whose entries' bundle holds its source, at either tree. Shared code such as `key-index.ts` therefore counts once under each of those components.
4. **Adapter cases run only when their own alarm fired.** Each starts a real runner at each tree.
5. **node:test and pytest have no case kind.** A change to code their entries bundle fires their alarm, and no case can run its changed lines. Raising their version then fails D6, since no case of theirs can differ. Until an `adapter:node-test` or `adapter:pytest` kind exists, such a change cannot pass; only one that moves no emitted code, such as a comment or a type, can. 013-02's change to node:test's `adapter-project.ts` (above) would have hit this.
6. **One direction rule for the `store` and `adapter:vitest` kinds** (`verdict.ts`, `byDirection`). A kind's outputs give per file where its rows are stored: the `store` kind's `store at` decision, or Vitest's completed files per run.
   - **Asks a raise:** a file the last release stores and the candidate does not. So does a file stored alike whose other outputs differ: `current` or the growth kept, or a completed file's results or load error.
   - **Reported:** a file only the candidate stores, one stored under another key (a re-key), and one neither stores.
   - **Runs:** a different number of runs asks a raise.
   - **Wording:** each failure names the files that asked it.
7. **The width hints run for coverage only.** `harness/vitest.ts`'s `hinted` asks `slowWidth` and `tierWidth` and drops what they answer (C14).
8. **A line that opens with closing brackets** (`coverage.ts`, `unrun`): such a line is read at its first other character. Example: the `}` that closes a never-called default `note = () => {}` and then continues the statement. The test is in `coverage.test.ts`.
9. **The install** (`lock.ts`). `installLock` runs `npm ci --ignore-scripts --no-audit --no-fund --prefer-offline` in the extracted tree, with scripts off as a candidate tree's install runs here.
   - **Bundling and running that side:** the release side is bundled by that tree's own esbuild (`esbuildOf`). Its run directory links `node_modules` to the tree's, so Vitest and every other package resolve there.
   - **When it runs:** only when the alarm fired and some component's lock lines differ.
   - **Without an installer:** with `install: null`, the verdict names what moved.
10. **The entries' own fallbacks** (`bundle.ts`, `ENTRIES_BEFORE_MOVES`). At a release that predates 011-40's moves, `accept.ts` is read as `ledger.ts`, and `store-decision.ts` as `tiers.ts`. The harness's fallbacks are separate: `BEFORE_MOVES`.

## Type changes

- **New in `src/`:** `barredByTouch` and `Barred` (`src/core/scheduler/stability.ts`).
- **Removed from `src/`:** `KEY_SOURCES_HASHES` is gone from `src/core/keys/key-format.ts` and `src/core/keys/index.ts`. Only `test/keys/key-sources.ts` read it, and that file is retired. The comments on `KEY_FORMAT_VERSION` and `KEY_FORMATS_READ_AS_ONE` now name the alarm.
- **Test-side `Comparison`:** gains `alarms`, `installed` and `readAsOne`.
- **Test-side `CompareOptions`:** gains `install`.
- **Test-side `CaseVerdict`:** gains `reported` and `raised`.
- **Test-side `Case`:** gains the `adapter:vitest` kind.
- **Test-side `trees.ts`:** `formatVersionOf` becomes `versionOf(tree, component, overlay)`.
- **Test-side `bundleDriver`:** takes the bundler as an optional fourth argument.

## What the next worker must know

- **The fallbacks go once the last release carries the moves.** These are `BEFORE_MOVES`' three entries with `accept-rule-ledger.ts`, `store-traced.ts` and `barrier-scheduler.ts`, `ENTRIES_BEFORE_MOVES`, format 12's `probe` arity branch, and the `KEY_SOURCES_HASHES` clause in `bundle.ts`'s `pinFormat`. While `squeal--v0.1.231` is the last release, they stay.
- **node:test and pytest need an adapter kind** before their next code change (decision 5).
- **Bundle drift.** `npm run build` was not run, so the four bundle tests fail as expected: "cli/squeal.mjs differs from the build". They are `test/harness/plugin.test.ts`, `test/harness/codex/plugin.test.ts`, `test/harness/opencode/package.test.ts` and `test/harness/pi/package.test.ts`.
- **A raise from now on** carries a case whose outputs differ, and empties `KEY_FORMATS_READ_AS_ONE` in the same change.
