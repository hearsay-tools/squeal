# Wave 7 review

Reviewer task 001-55 for spec 001, 2026-10-07. Range `64941df..e818a05` (4 commits): task 001-53 (targeted invalidation on add and delete, defect 11), its cost test, the D4 amendment and the bundle rebuild. I read it against D3, D4 as amended, `research/vitest-internals.md` Q5 and `tasks/wave-7.md` (001-53 done-when). The question the brief set: can targeted invalidation leave a stale transform that the old `invalidateAll` would have dropped? Yes. Probes found four ways, each shown in this file as a wrong result or a closure that is missing a file.

## Verdict

**FAIL at `e818a05`.** Counts: 2 blockers, 2 should-fix, 5 nits.

- **B1.** The add rule recognises only resolution by extension, `index` and TypeScript twin. Four common patterns fall outside it, and in each the old `invalidateAll` gave the right result where the candidate gives a stale one: `import.meta.glob`, a template-literal dynamic import, an unresolved aliased or `tsconfig` `paths` specifier, and a directory resolved through its own `package.json`. Two of them make `run()` report a result for code that is not on disk. The other two leave the new file out of the test's closure for good, so a later break of that file never re-runs the test. Goal 3 is broken.
- **B2.** The ratio asserts in `structural-cost.test.ts` fail CI on `main`. Both `main` runs of this code failed (Node 22, at `e818a05` and `e85b844`), and the test failed 4 of 4 times here under load. The cost of an add includes a fixed part of about 20 ms. The warm walk it is compared against is 13 ms on CI, so a two-times bound cannot hold there.

What holds: the delete rule (deleted directories included), rename as delete plus add in one batch, shadowing by extension, `index` and twin (aliased imports included, once resolved), inline projects with their own `root`, an unrelated add keeping the cache, and the read of `invalidationState`. A rename of that field is caught by an existing test, which I checked by mutation.

## Verification

Run on a detached worktree at `e818a05` (see N5: the brief's branch HEAD is `93b14f8`, two docs-only commits later).

```
$ git rev-parse HEAD
e818a05ce6a2bd28a3288c73cb9d53bf22188139
$ npm ci
npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)
$ npm run lint
Checked 330 files in 87ms. No fixes applied.
$ npm run typecheck
tsc --noEmit   (no output, exit 0)
$ npm run build
(exit 0)
$ git status --porcelain
(empty: committed bundles match the build)
$ npx vitest run
structural cost, 1000 modules + 205 test files, median of 5: {
  cold: '3850.2 ms', warm: '23.6 ms', afterAdd: '64.5 ms', afterEdit: '43.3 ms',
  sourceWarm: '21.4 ms', sourceAfterAdd: '38.8 ms' }
 FAIL  test/runners/vitest/structural-cost.test.ts > ... > costs within two times the warm walk
AssertionError: expected 64.51612000000023 to be less than or equal to 47.207329999999274
 ❯ test/runners/vitest/structural-cost.test.ts:99:31
 Test Files  1 failed | 103 passed (104)
      Tests  1 failed | 814 passed | 7 skipped (822)
```

The machine had a load average of 64 on 24 cores, because other workers were running. I ran `structural-cost.test.ts` alone three more times and it failed each time: afterAdd/warm was 132.5/26.5, 91.8/19.6 and 82.5/21.5 ms. In those runs afterEdit was also above twice the warm walk two times out of three. GitHub Actions on `main`, which has no other workers on it:

| Run | Commit | Node 22 | warm | afterAdd | afterEdit | cold |
|---|---|---|---|---|---|---|
| 37534291718 | `e818a05` | FAIL | 13.6 ms | 33.4 ms | 14.5 ms | 1962.6 ms |
| 37534353429 | `e85b844` | FAIL | 12.5 ms | 33.8 ms | | |

The same commits passed on `cez/87218933`, so the test is flaky, not reliably red. `64941df` was green on both branches.

## Blockers

### B1. An add leaves stale transforms where resolution is not extension, `index` or twin probing (proven)

`src/runners/vitest/stale.ts:27-50` builds the add targets only from `resolutionBases` × `resolutionCandidates`. D4 as amended scopes the rule the same way ("Aliased and bare specifiers are not read, as in D3"), so the code follows the amended spec. The amended spec, though, breaks Goal 3 ("Everything the agent is told is true at the moment it is told") in cases that `invalidateAll` got right. D3 itself says more than the code does: "Adding or deleting a file re-resolves closures of test files that import from the affected directory."

Probe: a throwaway adapter test built on `openFixture`, run at `e818a05` and again with `adapter.ts` and `graph.ts` checked out at `64941df`. Same fixture, same steps:

| Case | Fixture, then the add | Old `invalidateAll` | Candidate |
|---|---|---|---|
| `import.meta.glob` | `registry.ts`: `import.meta.glob("./plugins/*.ts", { eager: true })`, count; test expects 2; add `plugins/b.ts` | `affected` = [test]; run **pass** (count 2) | `affected` = []; run **fail** with `count=1`, which is not what the files on disk produce |
| template dynamic import | `` import(`./locales/${l}.ts`) ``; add `locales/fr.ts` | run **pass** | run **fail** (`missing`): the expansion done at transform time is reused |
| `package.json` directory entry | `./pkg` resolves to `src/pkg/lib.ts` through `src/pkg/package.json` `main`; add `src/pkg.ts` | `affected` = [test]; run **pass** (`file`) | `affected` = []; run **fail** (`dir`): old resolution reused |
| alias, unresolved | alias `@` → `src`; `uses.ts`: `export { which } from "@/later"`; add `src/later.ts` | `affected(later)` = [test] | `affected(later)` = [] before and after a run; the run itself passes because the module runner re-resolves the verbatim specifier |
| `tsconfig` paths, unresolved | `resolve.tsconfigPaths: true`, `"~/*": ["src/*"]`; same steps, then a change to `later.ts` | closure has `src/later.ts`; `affected(later)` after the change = [test] | closure `["src/uses.ts", snap, test]`, no `src/later.ts`; `affected(later)` after the change = [] |

How each becomes a wrong state:

- **Glob and template import.** Invert the probe: a test that checks every plugin has some property passes after a plugin without it is added. That is a wrong pass, and the key does not change either (D3 never sees the new file).
- **Alias and `paths`.** The importer's cached transform keeps `@/later` verbatim (`deps` = `["@/later", "/src/math.ts", "/@fs/.../chokidar/index.js"]`, from a direct `transformRequest`). So `later.ts` stays out of the test's closure until `uses.ts` itself is edited. Once the test is re-run for any reason (its own edit, `run --all --force`), it is stored as PASS under a key without `later.ts`. A later break of `later.ts` never re-keys it, and the PASS stays current. Until then the old file-error FAIL stays current even though the import now resolves.

Fix, one worker, all in `stale.ts` plus the adapter's `createVitest` call. Mark as stale on add:

1. Every module with a dep that is not a path and not a Node builtin: `!dep.startsWith("/") && !dep.startsWith(".") && !dep.startsWith("\0") && !dep.includes(":") && !isBuiltin(dep)`. Vite turns every resolved import into a `/…` or `/@fs/…` URL, resolved packages included (the probe above: `chokidar` became `/@fs/.../node_modules/chokidar/index.js`). So such a dep is always a specifier Vite could not resolve: alias, `paths` or package. Scanning the deps already in hand costs only string checks.
2. Every module whose source uses `import.meta.glob` or a template-literal dynamic import. Record these with an `enforce: "pre"` transform plugin that Squeal passes in `createVitest`'s Vite overrides (it tests the source with a regex and adds the id to a set). Do not parse the code Vite emits.
3. Every module with a dep under `base + "/"` for each `base` in `resolutionBases(added)`. This covers a directory resolved through its own `package.json` that a new file now shadows.

Turn the five probe rows into tests in `structural.test.ts`, each with the run outcome and `affected` asserted. Amend D4 so it no longer says aliased and bare specifiers "are not read", and name the three rules. Re-run the cost test once to show the added sets stay small.

### B2. `structural-cost.test.ts` ratio asserts make CI red on `main` (proven)

`test/runners/vitest/structural-cost.test.ts:99-100` asserts `median(afterAdd) <= 2 * median(warm)` and the same for the source case. The add carries a fixed cost that does not grow with the graph: `clearSpecificationsCache()` re-globs 205 test files and transforms the new file. That cost is about 20 ms on CI (afterAdd 33.4 ms against afterEdit 14.5 ms), while the warm walk it is compared with is 13 ms. So the bound fails on CI's hardware and under any load. Median of 5 does not help when every round is slow. The `cold / 4` assert has a margin of 15 times on CI (33 against 490) and holds.

Fix, one worker. Keep `afterAdd < cold / 4` as the regression guard (it is what catches a return of `invalidateAll`). Make the two ratios report-only, or assert them on the best round with a fixed allowance, the way `test/watcher/reconcile-pass.test.ts:72` uses `best`: for example `min(afterAdd) <= 2 * min(warm) + 30`. Record the CI numbers above next to the local ones in D4 (S1). The row's done-when ("measured and reported") is met by reporting.

## Should-fix

### S1. D4 and `status.md` overstate the add cost (proven)

D4: "`affected` right after an add costs 13 to 17 ms against 10 to 13 ms for the same walk warm and 0.9 s cold, about what it costs after a plain edit". `status.md`: "1.3 to 1.5 times the warm walk". On CI the numbers are 33 ms against 13.6 warm and 14.5 after an edit, about 2.4 times. Those figures come from one machine. Give both, and name the fixed cost (re-glob plus the new file's transform). It is still far below the 5 to 6 s that defect 11 recorded, which is the claim that matters.

### S2. The read of `invalidationState` is safe only at the Vite version this repository pins (plausible)

`stale.ts:61-63`. Vite 8.3.2 sets `mod.invalidationState ??= mod.transformResult` on soft invalidation (`vite/dist/node/chunks/node.js:36446`). Soft invalidation spreads to every transitive importer whenever a file is invalidated, so on a delete the deleted file's importers carry only `invalidationState` by the time `staleTransforms` runs. I checked a rename by mutation: reading a missing field makes `structural.test.ts` "a resolved target is deleted" fail (`expected [] to deeply equal [ 'test/util.test.ts' ]`). A Vite upgrade in this repository would therefore be caught. Squeal declares `vitest >=5` as a peer, though, and a user's install whose Vite renamed the field would get stale delete results with no error. A soft-invalidated module before an add (an edit earlier in the same revision batch, not yet re-requested) is also untested. Fix: feature-detect once per instance (`"invalidationState" in module` on the first `ModuleNode`). When the field is missing, fall back to invalidating every cached transform and persist one note. Add a test where an edit soft-invalidates the importer, then an add shadows its target.

## Nits

- **N1** (plausible). `depToPath` (`graph.ts:91-102`, now also used for staleness) strips `?query` only from root-relative deps, not from `/@fs/` or unresolved relative ones. An unresolved `import "./later?raw"` never matches the added `later` path. Strip the query in every branch.
- **N2** (unverified). Multiple environments: `staleTransforms` loops over every environment and reads its own `resolve.extensions`. Only `ssr` was exercised, because no `jsdom` or `happy-dom` is installed and the probe could not open a `client` environment. Inline projects with their own `root` work (probe: shadow under `pkg/` re-resolved, `affected` = [`pkg/test/a.test.ts`], run pass).
- **N3**. `staleTransforms` returns the deleted paths in its set, and the adapter calls `invalidateFile` on them a second time (`adapter.ts:124`). This is harmless but redundant: start the set empty and skip deleted files by membership instead.
- **N4**. The timing test reads `measured.cold` from one sample. The guard is fine at a margin of 15 times; a comment that it is deliberately loose would stop the next worker from tightening it.
- **N5**. The brief's branch HEAD is `93b14f8`, not the candidate `e818a05`. The difference is `docs/board.md` and `tasks/wave-7.md` only. Verification above ran at `e818a05`.

## What fits (do not re-check)

- **Delete rule.** Importers of a deleted path are re-transformed, including soft-invalidated ones. A deleted directory reaches the adapter as one delete per tracked file under it (`src/core/watcher/candidates.ts:31-34`).
- **Rename in one batch.** Delete `util.ts` plus add `util.tsx` while the importer is untouched: `affected(util.tsx)` = [test], run pass.
- **Shadowing.** Shadowing by extension, `index`, twin and `index` with each extension works, through relative and resolved aliased imports alike, because a resolved alias is stored as its resolved URL (probe: alias `@/util` → `util/index.ts`, add `util.ts` → pass).
- **Inverse property.** `resolutionBases` is the inverse of `resolutionCandidates` for the cases tested, and the property test in `structural.test.ts` checks it.
- **Cache kept.** An unrelated add or delete leaves other transforms cached (the test proves it with an edit made on disk but not invalidated).
- **Test globs.** `clearSpecificationsCache()` still runs when a test glob matches. The existing Q5 tests in `invalidation.test.ts` pass.
- **Checks.** Lint, typecheck and build are clean, and the committed bundles match the build.

## Inputs for the next wave

1. **Fix row for B1** (owns `src/runners/vitest/`, `test/runners/vitest/`, the D4 paragraph). The three extra rules go in `staleTransforms`. The glob and template-import set comes from a `pre` transform plugin added where the adapter calls `createVitest` (`adapter.ts` `#start`). Tests: the five probe rows above, each asserting `affected` and the run outcome. Budget: `affected` after an add stays under `cold / 4` on the 1,000-module fixture.
2. **Same row or a second one for B2 and S1** (`structural-cost.test.ts`, D4 and `status.md` numbers). Disjoint from B1 apart from D4, so give B2 and S1 to the B1 worker.
3. **S2** fits the B1 row (same file).
4. **The inherited stale FAIL of `test/harness/plugin.test.ts`** (outside the range; the coordinator asked for a proposal). This session saw it live: Squeal reported `bundles > are committed exactly as npm run build produces them` as FAIL, "inherited from …/1babdb45… at commit 64941dfe4ac5", in a worktree whose bundles match the build. The test reads `plugins/claude-code/dist/*.mjs` and bundles `src/` through esbuild at runtime. Neither is a static import, so neither is in its closure, and its key matched across the rebuild. A committed `squeal.config.json` with an `inputs` map is the right fix, and D3 and D11 already provide for it. The repository has no `squeal.config.json` today. Proposed:

   ```json
   {
     "inputs": {
       "test/harness/plugin.test.ts": ["plugins/claude-code/**", "src/**/*.ts", ".claude-plugin/**", "package.json"],
       "test/e2e/shipped-plugin.test.ts": ["plugins/claude-code/**"],
       "test/runners/vitest/**/*.test.ts": ["test/fixtures/vitest/**"]
     }
   }
   ```

   The map form keeps `src/**` off every other test. `plugin.test.ts` then re-runs on any `src` edit, which is the honest cost of a test that bundles all of `src`. The adapter tests copy `test/fixtures/vitest/` at runtime and have the same hazard. Check that `.tmp/` under the fixtures is excluded from the watcher, or the scratch copies will re-key them on every run. Owner: a one-file row; it does not overlap B1 or B2.
5. **001-54** (`cezar` probe re-run) is still open. Its add-to-run-start number should be taken after B1 lands, because rules 1 to 3 add work on every add.
