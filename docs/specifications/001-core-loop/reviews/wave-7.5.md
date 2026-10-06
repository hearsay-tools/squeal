# Wave 7.5 review

Reviewer task 001-59 for spec 001, 2026-10-07. This is a re-review of task 001-56 against `reviews/wave-7.md`, the second and last round on this slice. Range `96a14e7..94f468b` (5 commits): the `InvalidateResult.notes` seam, the add rules, their tests, the D4 and `status.md` amendment and the bundle rebuild. I read it against D3 and D4 as amended, `src/runners/vitest/stale.ts`, `dynamic.ts`, `graph.ts`, the `invalidate` branch of `adapter.ts` and `test/runners/vitest/structural*.test.ts`. I did not re-check what `wave-7.md` "What fits" lists.

## Verdict

**FAIL at `94f468b`.** Counts: 2 blockers, 0 should-fix, 7 nits.

Every finding the brief named is closed: `wave-7.md` B1 (all five probe rows), S1, S2, N1, N3 and N4. Mutation shows that each new rule has a test that fails without it.

The new rules still leave three add cases where the old `invalidateAll` gave the right result and the candidate gives a stale one. In each case a later `run` reports a result for code that is not on disk:

- **B1.** The source scan for `import.meta.glob` never reads a module that is served but not on disk (a virtual module), and it skips every file under `node_modules/`, including a dependency inlined with `server.deps.inline`. D4 does not mention that skip.
- **B2.** A directory's `package.json` whose `main` names a file that does not exist yet. Vite falls back to the directory's `index`, and adding the `main` target does not stale the importer.

Each fix is a few lines in `dynamic.ts` or `stale.ts`, plus one test per case. One worker can do all three.

## Verification

I ran this on a detached worktree at `94f468b`. The brief's branch HEAD is `8119c64`, which is one commit later and touches only `docs/board.md` and `tasks/wave-7.5.md` (N7).

```
$ git rev-parse HEAD
94f468b867c830abd4e4cd12c1a12f0c2ef14de8
$ npm ci
npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)
$ npm run lint
Checked 332 files in 88ms. No fixes applied.
$ npm run typecheck
tsc --noEmit   (no output, exit 0)
$ npm run build
(exit 0)
$ git status --porcelain
(empty: committed bundles match the build)
$ npx vitest run
 Test Files  106 passed (106)
      Tests  829 passed | 7 skipped (836)
```

Cost on the 1,000-module fixture: I ran `structural-cost.test.ts` alone five times at a load average of 8 to 15 on 24 cores. CI is run 37543291333 on `main` at `94f468b`, which is green.

| | cold | warm | first invalidate (add) | invalidate (add) | afterAdd | afterEdit | sourceWarm | sourceAfterAdd |
|---|---|---|---|---|---|---|---|---|
| local, 5 runs | 0.88–1.16 s | 10.5–11.8 ms | 16.5–21.9 ms | 3.9–5.5 ms | 15.2–17.1 ms | 14.3–15.5 ms | 10.7–12.3 ms | 16.1–16.6 ms |
| CI, Node 22 and 24 | 1.45–1.73 s | 10.7–11.8 ms | 12.8–17.6 ms | 6.0–6.3 ms | 20.0–21.0 ms | 18.3–19.8 ms | 10.2–10.3 ms | 13.2–15.7 ms |

`afterAdd` stays at about the cost of `afterEdit`, so rules 2 to 4 added no measurable walk cost. The `cold / 4` guard has a margin of about 18 times on CI (363 to 433 ms against 20 to 21 ms).

## Previous findings

| `wave-7.md` | Status | Evidence |
|---|---|---|
| B1, `import.meta.glob` | closed | `structural.test.ts` "import.meta.glob picks up the new file", root project and inline project with its own Vite server. It asserts `affected` and the run outcome. With the scan disabled, both cases fail. |
| B1, template-literal dynamic import | closed | test "a template-literal dynamic import loads the new file", which fails with the scan disabled. My probe with the template literal split across lines also passes. |
| B1, directory resolved through its `package.json` | closed | test "a new file shadows a directory resolved through its package.json", which fails with rule 4 (the directory prefixes) disabled |
| B1, unresolved alias | closed | test "an unresolved an alias specifier enters the closure". It asserts `affected`, the closure containing `src/later.ts`, the run, and `affected` after a later change. It fails with rule 2 disabled. |
| B1, unresolved `tsconfig` `paths` | closed | the same test for `tsconfig` paths, which also fails with rule 2 disabled |
| S1 | closed | D4 and `status.md` give local and CI figures and name the fixed cost. The CI figure is labelled "before rules 2 to 4"; N3 has the figures after them. |
| S2 | closed | `knowsSoftInvalidation` checks the field once per instance. Without it, `staleTransforms` returns `null` and the adapter invalidates every cached file, adding `FALLBACK_NOTE` once per instance. The "soft-invalidated in the same batch" test fails when `cachedTransform` ignores `invalidationState`; so does "a resolved target is deleted". Probe: a runner whose `invalidate` returns `notes` gets the note persisted in `notes.<worktreeId>` at revision 1 and listed in `scheduler.status().notes`. |
| N1 | closed | `depToPath` strips the query before branching. A unit test covers every branch. |
| N3 | closed | `staleTransforms` keeps deleted files in `gone` and never returns them. The adapter has already called `invalidateFile` on every path in the batch (`adapter.ts:119`). |
| N4 | closed | `structural-cost.test.ts:108-109` says `cold` is one sample on purpose |

The brief's other probes:

- **Rule 4 leaves out an added `index`.** The worker's claim holds. Vite reads the directory's `package.json` first. With `src/pkg/package.json` `{ "main": "lib.ts" }`, adding `src/pkg/index.ts` gives `affected` = [] and the run still reads `lib`, the same as a fresh instance. With a `package.json` that has no `main`, rule 1 stales the unresolved `./pkg`, and the run picks up the new `index`. The exception is B2.
- **Added `package.json`.** This is covered by the test "a new package.json re-points a directory resolved through its index". A deleted `package.json` also works: `affected` = [test], and the run falls back to `index` as a fresh instance does.
- **Rule 2 does not fire on resolved packages.** Test files import `vitest`, and their deps hold it as `/@fs/…/vitest/dist/index.js`, so it is not a bare dep. An unrelated add returns an empty stale set.

## Blockers

### B1. The glob scan misses virtual modules and inlined `node_modules` files (proven)

`src/runners/vitest/dynamic.ts:20` returns `false` for any path containing `/node_modules/`. `readSource` (`dynamic.ts:30-35`) returns `""` for a file it cannot read, so a module Vite serves from a plugin's `load` hook is scanned as empty. D4 (3) covers "every module with `import.meta.glob` or a template-literal dynamic import in its source". It names no exception for `node_modules`, and it is silent on modules that have no source on disk.

I probed with a throwaway adapter test. For the old behaviour I forced `staleTransforms` to return `null`, which runs the same loop as `invalidateAll` at `64941df`. A fresh adapter on the same root gives what is on disk.

| Case | Fixture, then the add | Full invalidation | Candidate | Fresh |
|---|---|---|---|---|
| virtual module | `vitest.config.ts` plugin: `resolveId('virtual:plugins')` → `\0virtual:plugins`, `load` returns `import.meta.glob("/src/plugins/*.ts", { eager: true })` and the count. The test expects 2; add `src/plugins/b.ts` | run **pass** | run **fail** (count 1) | pass |
| inlined dependency | `node_modules/globby-lib/index.js` with the same glob, `test.server.deps.inline: ["globby-lib"]`; add `src/plugins/b.ts` | run **pass** | run **fail** (count 1) | pass |

This is a real pattern. For example, `@generouted/react-router` ships `import.meta.glob(['/src/pages/**/…'])` in its package, and under Vitest it has to be inlined. In both cases `affected` is [] under every rule, because the closure walk stops at virtual ids (`depToPath` returns `null` for `/@id/…`) and at `node_modules` (`graph.ts:41`). That gap predates this range (N5). So the stale transform shows when the test runs for another reason: `squeal run --all`, `--force`, or an edit to the test. The run then records a FAIL against a disk that would pass, and stores it as current.

Fix (one worker, `dynamic.ts`):

- Drop the `node_modules` skip. Only modules with a cached transform reach the scan, and an externalized dependency has none. Re-run the cost test to confirm.
- Return `true` when the source cannot be read. A virtual module is re-transformed on every add; there are few of them, and their transforms are cheap.
- Add both rows above to `structural.test.ts`, asserting the run outcome.
- Name both cases in D4 (3).

### B2. Adding the file a `package.json` `main` names leaves the `index` fallback cached (proven)

Fixture: `src/pkg/package.json` `{ "main": "lib.ts" }`, `src/pkg/index.ts`, no `lib.ts`, and `src/uses.ts` `export { which } from "./pkg"`. Vite's `tryCleanFsResolve` catches the failed package entry and falls back to `tryIndexFile`, so `./pkg` resolves to `/src/pkg/index.ts`. Then add `src/pkg/lib.ts`:

| | `affected(["src/pkg/lib.ts"])` | run (test expects `lib`) |
|---|---|---|
| full invalidation | [`test/pkg.test.ts`] | **pass** |
| candidate | [] | **fail** (reads `index`) |
| fresh instance | | pass |

`resolutionBases("src/pkg/lib.ts")` contains neither `src/pkg` nor `src/pkg/index.ts`. The rule for an added `package.json` does not fire, because the `package.json` was already there. The import is resolved, and it is not under a directory that the added path shadows. So no rule stales `src/uses.ts`.

This break is worse than B1. `affected` misses the test as well, so the old FAIL (or PASS) stays current after the add. Nothing re-runs the test, and its key does not move.

Fix (one worker, `stale.ts`). For each added path, walk its ancestor directories up to the project root, excluding the root itself. For each `package.json` found, read its `main` and `module`, and a string `exports` or `exports["."]`. If `join(dir, entry)` is among `resolutionBases(added)`, push `${dir}/` onto `directories`. That is one `existsSync` per ancestor and a JSON parse only where a `package.json` exists. Add the case to `structural.test.ts` with `affected` and the run outcome asserted, and add one sentence to D4.

## Nits

- **N1** (proven, pre-existing). Editing a `package.json` (`kind: "change"`, for example `main` from `lib.ts` to `other.ts`) leaves `./pkg` importers resolved to the old entry. `affected` = [], and the run fails where a fresh instance passes. Full invalidation fails the same way, because a change was never structural. D4 names only an added or deleted `package.json`. A change could feed the same directory rule: add `package.json` paths of `kind: "change"` to `directories` in `staleTransforms`. This fits the B2 row.
- **N2** (proven, pre-existing, cause unverified). A dynamic import built by concatenation, `import("./locales/" + l + ".ts")`, fails after `src/locales/fr.ts` is added. `affected` = [], and the run fails where a fresh instance passes. It fails under full invalidation too, so the cause is not the transform cache: possibly the module runner keeps the failed resolution from the earlier run. The regex in `dynamic.ts:5` does not match concatenation either. This does not belong to this range. It is an input for a later row.
- **N3**. D4's CI figures are labelled "before rules 2 to 4". Run 37543291333 at `94f468b` has the figures after them: afterAdd 20–21 ms, warm 11–12 ms, afterEdit 18–20 ms, cold 1.5–1.7 s, `invalidate` 6 ms and 13–18 ms the first time. Replace them, so D4 no longer describes code that is gone.
- **N4** (plausible, cost only). Rule 4 stales every module with a resolved import anywhere under `${base}/`, not only imports of the directory itself. Adding `src/components.ts` re-transforms every importer of `src/components/**`. The deps hold resolved URLs, not specifiers, so the rule cannot be narrower. This is not measured on a real repository; the 001-54 probe re-run is where it would show.
- **N5** (pre-existing, outside the range). The closure walk ends at virtual ids and at `node_modules`. So a test whose glob runs through a virtual module or an inlined dependency (B1) never has the matched files in its closure, and an add or edit of one never re-runs it. This is a D3 gap, and the B1 fix does not close it.
- **N6** (plausible). `FALLBACK_NOTE` is written once per Vitest instance. Persisted notes keep the newest 20 (`MAX_PERSISTED_NOTES`), so after 20 other notes, status stops saying that every add is a cold walk while the fallback is still in force. This matters only on a Vite without `invalidationState`. Write the note again on each fallback, or once per revision.
- **N7**. The brief's branch HEAD is `8119c64`, not the candidate `94f468b`. The difference is docs only. CI at `8119c64` on `main` (run 37543347765) failed in `test/harness/waiter.test.ts` "exits at once when a waiter already holds the lock" (`expected 142.13 to be less than 100`). That is a timing bound outside this range, and the same code passed on `cez/87218933`.

## What fits (do not re-check)

- **The five `wave-7.md` B1 rows.** Each is a test in `structural.test.ts` that asserts `affected` and the run, and each fails when its rule is disabled.
- **Rule 2 (unresolved bare dep).** Resolved packages are `/@fs/…` URLs, `vitest` included. Builtins, `\0` ids, ids with a scheme and `/@id/` ids are excluded. An unrelated add stales nothing.
- **Rule 4 and its `index` exception.** A directory with a `package.json` `main` ignores a new `index`, and a directory without `main` picks it up through rule 1. An added or deleted `package.json` re-points its directory.
- **The `invalidationState` check and its fallback.** The feature check runs once per instance. The fallback invalidates every cached file. The note goes through `InvalidateResult.notes` → `fetchRunnerPart` → `context.note` → `notes.<worktreeId>`, and notes inside refinement are existing practice (`tryRunner`). A soft-invalidated importer before an add is tested.
- **The scan cache.** It is keyed by the transform object, so a re-transform is scanned again. A hard-invalidated module (`invalidationState` = `"HARD_INVALIDATED"`) is skipped before the scan.
- **`depToPath` query stripping (N1) and deleted paths (N3).**
- **Cost.** `afterAdd` is about `afterEdit` locally and on CI. The first `invalidate` after open scans every module once (13–22 ms on 1,000 modules), and later ones take 4–6 ms.
- **Checks.** Lint, typecheck and build are clean, the committed bundles match the build, and CI is green at `94f468b`.

## Inputs for the next wave

1. **Fix row for B1 and B2**, owning `src/runners/vitest/dynamic.ts`, `stale.ts`, `test/runners/vitest/structural.test.ts` and the D4 paragraph:
   - In `expandsFromDisk`: drop the `node_modules` skip, and treat a source that cannot be read as expanding.
   - In `staleTransforms`: for each added path, check the entry fields of every ancestor `package.json` below the root (B2). Optionally, add a `package.json` `change` to the directory rule (N1).
   - Tests: the virtual module, the inlined dependency and the `main` target added, each asserting the run outcome, plus `affected` for B2.
   - D4: name the three cases and replace the CI figures (N3).
   - Budget: `affected` after an add stays under `cold / 4`. `afterAdd` should stay within a few ms of `afterEdit` on the 1,000-module fixture; give the first-`invalidate` figure with the `node_modules` skip removed.
2. **001-54** (`cezar` probe re-run). Take the add-to-run-start number after the fix row lands, and record whether rule 4 (N4) shows up on a real repository.
3. **Later, not this slice.** These need a spec decision before a row: the closure gap at virtual ids and `node_modules` (N5), and concatenated dynamic imports (N2).
4. **Flaky timing bound in `test/harness/waiter.test.ts`** (N7). It is outside this slice, and it made `main` red at `8119c64`.
