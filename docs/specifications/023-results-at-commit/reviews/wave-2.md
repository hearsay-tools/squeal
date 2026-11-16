# Wave 2 review: glob folder membership (023-13)

FAIL 828022e894f7e46102b52b67091fcd4a7850bed3

Three proven blockers. One non-blocking test note. No nits.

## Verification

Reviewed the exact candidate on a clean product tree. `git rev-parse HEAD` returned `828022e894f7e46102b52b67091fcd4a7850bed3`. `git fetch origin` succeeded. The six commits returned by `git log origin/main..828022e89` were:

```text
74732f3bf feat(023-13): a glob's folder membership in keys (fix A)
3d33aaf6c chore(023-13): export node:test's quietly for the glob parser (approved by d36c4d53)
e8f7c99be test(023-13): validity cases for glob folders; parser lines each run
1195d7e92 test(023-13): a CI import with an added matching file imports no pass
6d50a35aa docs(023-13): worker notes: seam map and decisions
828022e89 chore(023): version 0.1.532 and bundles (023-13)
```

This review covers those commits. The assigned broader range also contains unrelated 011 changes, which are outside this review. The fetched main was `4b08e6e6cd5ab5900df27bcac63039884a72329b`; the merge base was `a3ae26cd10bff69941084c61c6f86d762ee6e2b8`.

| Command | Actual result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Squawk reported successful setup before launch (1 s). Not repeated, as the brief required. This is supplied setup evidence, not a reviewer-run install. |
| `pnpm run lint` | Exit 0. `Checked 3577 files in 1261ms. No fixes applied.` |
| `pnpm run typecheck` | Exit 0. `tsrs --fast --noEmit`. |
| `pnpm run build` | Exit 0. TypeScript build and all four plugin builds completed. |
| `git status --porcelain` after build and probes | Empty. No generated bundle drift. |
| `gh run list --commit 828022e894f7e46102b52b67091fcd4a7850bed3 --json databaseId,name,status,conclusion,url,headSha` and `gh run view 43978818282 --json status,conclusion,jobs` | [CI run 43978818282](https://github.com/hearsay-tools/squeal/actions/runs/43978818282) was still in progress when read. Node 22/26 test shards and the Node 24 lint/typecheck/version job had not finished. Full-suite CI remains **unverified**, not a finding. |

The broad affected read used `~/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000` with the changed product paths plus the integration, CI-import, boundary, key-format and version-sensitive test paths. It returned exit 3 after 61.1 s: 78 current test files (77 pass, one fail), 86 pending and 1226 unknown in that selection. No full run was requested. Pending and unknown coverage is **unverified**, not a blocker.

The narrower read used the same command with these eight explicit paths:

```text
test/integration/glob-membership.test.ts
test/ci/glob-import.test.ts
test/keys/glob-listings.test.ts
test/runners/vitest/glob-listing.test.ts
test/runners/vitest/closure-globs.test.ts
test/keys/key-format.test.ts
test/version-sensitive.test.ts
test/runners/boundaries.test.ts
```

Actual output at revision 0:

```text
FAIL test/runners/boundaries.test.ts > runner folders (spec 016 goal 8) > import no other runner's folder, and no shared file under src/runners imports one
expected [ Array(1) ] to deeply equal []
+ "vitest/glob-listing.ts imports node-test/enumerate.js"
at test/runners/boundaries.test.ts:92:32
Named test files at revision 0: 1 known failure: 1 test; 8 test files, each with a current result, after 2.3 s.
```

A final read of the seven paths without the boundary file returned exit 0:

```text
Named test files at revision 0: no known failures; 7 test files, each with a current result, after 2.0 s.
Worktree: known failures 1 (1 test); not current: 1342 of 1897 test files (90 queued, 1252 unknown)
```

One external, temporary Vitest probe tested the two false-pass scenarios below. It imported the candidate's unchanged source and existing scheduler harness by absolute paths, used a separate config and test file under the task's temporary folder, and left the tracked tree clean. Command: `timeout 600 pnpm exec vitest run --config <temporary-folder>/config.mjs`. Actual output:

```text
Test Files  1 passed (1)
     Tests  2 passed (2)
  Duration  10.87s
```

These two tests asserted the faulty behavior: the first run passed; after the add, a restart retained the identical key and a current pass with no run; an independent empty-store run over the same files failed. All fixture schedulers and runners closed. The temporary probe was removed. No direct full suite ran. No changed e2e file required a check outside Squeal's coverage.

## Blockers

### B1. Proven: root-folder listings are discarded

Location: `src/runners/vitest/glob-listing.ts:123` through the directory conversion at line 127.

The brief requires patterns to resolve from `/` at the Vite root, and says a restart after adding a matching file must read stale, never pass. `folderListings` can correctly return the worktree root for `import.meta.glob("/plugin-*.ts", { eager: true })`. `moduleGlobs` then tests that directory with `WorktreePaths.isProjectFile`. That helper deliberately excludes the root itself. No listing reaches the core, although the core already represents the root listing as `./`.

The real-adapter probe used `src/registry.ts` with that glob, one root file `plugin-kept.ts`, and a test asserting a count of one. With `observe.runtimeInputs: false`, the initial run stored a current pass. After stopping it and adding root file `plugin-new.ts`, a lookup-only restart kept the same test key and returned a current pass without running. A fresh-store run against those files returned a current failure. This breaks the vision rule, "An old result never gets to pose as the current truth."

Worker-sized fix: accept a listing directory equal to the worktree root and report it as directory `""`, which the existing core converts to `./`. Keep the exclusions for paths outside the worktree and under `node_modules`. Add a real-adapter restart regression for this root glob and a root recursive glob. Keep both runtime-input policy values in coverage.

### B2. Proven: parse fallback can miss the glob's folder and can treat comments as globs

Location: `src/runners/vitest/glob-listing.ts:55` and `src/runners/vitest/glob-listing.ts:82`.

The fallback lists only the importer's own directory recursively. This is not a superset of the folders a legal glob can read. TypeScript enums trigger strip-mode failure. JSX/TSX files take the fallback without a parse. Their globs can point to `../plugins`, a root folder, an alias or a `base` outside that directory.

The real-adapter probe used:

```ts
// src/sub/registry.ts
export enum Kind { A }
const plugins = import.meta.glob("../plugins/*.ts", { eager: true });
export const count = Object.keys(plugins).length;
```

The fixture first held only `src/plugins/kept.ts`; the test asserted a count of one. With runtime-input observation disabled, the first run passed. After stopping it and adding `src/plugins/new.ts`, the restart retained the identical key and a current pass with zero runs. A fresh-store run failed. The recorded fallback under `src/sub/` cannot see additions under `src/plugins/`. This violates the same restart done-when as B1.

The fallback also violates the explicit done-when, "a module whose glob text sits only in a comment or string adds no listing." A separate direct call through `pnpm exec tsx -e` passed this source as `/repo/src/App.tsx`:

```tsx
// import.meta.glob("./decoy/*.ts")
export const App = () => <div />;
```

Actual result:

```json
{"patterns":null,"listings":[{"directory":"/repo/src","recursive":true}]}
```

Worker-sized fix: make one parser path handle the syntax Vite accepts before extracting real calls. It must preserve the original literal patterns and resolve their actual target folders. An own-folder fallback cannot establish coverage. Add a sibling-folder enum case, a TSX case with a real glob outside its own folder, and TSX comment/string-only controls. Do not accept a false pass as the fallback behavior.

### B3. Proven: the new import breaks runner isolation

Location: `src/runners/vitest/glob-listing.ts:17`, importing `../node-test/enumerate.js`.

Spec 016 goal 8 says, "An edit inside one runner's folder re-runs no other runner's kit file." The styleguide also forbids imports from another runner's folder. The new Vitest parser imports `quietly` from node:test. This adds node:test's enumeration code to Vitest's import closure and fails the existing boundary test at the exact candidate, as shown above. The worker notes record coordinator approval for reusing the helper, but no human amendment removes the isolation rule.

Worker-sized fix: move the generic warning-suppression helper to a shared runner utility and import it from both runners, or keep the Vitest helper local. Do not exempt this edge from the boundary test. Verify `test/runners/boundaries.test.ts`, relevant parser tests and the validity alarm after the move.

## Should-fix

### N1. Plausible: the real-resolver cases leave `#` subpaths untested

Location: `test/runners/vitest/glob-listing.test.ts:48` and `test/keys/validity/cases/adapter/vitest-globs.ts:22`.

The unit test mentions a `#` subpath but its resolver always returns null for that pattern. The real-adapter fixture covers an alias but has no `package.json` `imports` mapping. The new resolver sets Vite's custom `isSubImportsPattern` flag, and the inspected Vite implementation uses that seam. No failing `#` example was proven, so this is not blocking. Add a real mapping and assert the reported listing against Vite's matched files; include a non-relative template import if the fixture claims every resolution form.

## Nits

None.

## What fits

- The independent shared set is the right seam. `GlobListings.see` maps each module to its directories, and `SharedPaths.write` merges inside the store transaction without dropping another worktree's paths. Existing tests cover two writers and a newly opened view.
- `WorktreeKeys.setClosure` records the report before reading listings for the runner paths. The merge runs outside the `observe.runtimeInputs` condition. The ordinary-glob integration tests pass with that policy both enabled and disabled.
- Restart reuse after removal, second-worktree lookup, and CI import have current passing results for the implemented ordinary relative-glob fixture. The CI test has a same-commit positive control. These results do not cover B1 or B2.
- The parser ignores comments, strings and regex text in the JS/strippable-TS cases it can parse. Relative, root-relative folders below the root, `base`, aliases and ordinary template imports are covered in the new tests. B1 is the root directory itself; B2 is the parse fallback.
- The new tests cover the additive adapter report separately from the core merge. The assembly validity case exercises stored-style closures without a new report, using the shared set.
- No `KEY_FORMAT_VERSION` or `VITEST_ADAPTER_VERSION` raise was made. The key-format and version-sensitive tests have current passing results. No raise is justified by this candidate's validity evidence. Repairs must retain that test gate; a blanket raise is not a substitute for the missing listings.
- The `keying.ts` diff is limited to the requested merge: import at line 26, field at lines 169–170, construction at line 215, merge at lines 516–521, and write at line 737. It does not edit scheduler policy, commit lookup, checkout, delivery or status behavior.
- The build reproduces all committed bundles without changes.

## Inputs for the repair wave

Dispatch parser/root reporting to one worker and the shared-helper move to a separate worker only if their edits to `glob-listing.ts` are coordinated. The parent owns integration. The fix must retain `RunnerClosure.globs` as a report only; runners must not write the store. Core order stays: `see(project, report, below)`, then `of(project, runner.paths)`, merge into the assembled closure, then persist through `writeSeen` in the existing record transaction. Keep the shared set merge-only and unconditional on runtime-input observation.

Use the existing `dir/` and `./` representations. Fix folder discovery rather than changing key encoding. Keep `keying.ts` limited to the merge. Do not change held 023-03 code, checkout, status or delivery to conceal the false pass. Keep direct Vitest commands under `timeout 600`, read affected results, and run lint, typecheck, a clean build, the boundary test and validity/version tests. No routine full suite is needed. The candidate's exact full-suite CI result was pending at review time; release still requires that evidence for the final release commit.
