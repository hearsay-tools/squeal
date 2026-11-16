# Wave 2 re-review: glob membership repairs

PASS cb18ca16c64dd944354ba571eba1b4a60660384a

Zero blockers, zero new should-fix findings, zero nits. B1, B2 and B3 are closed. The prior non-blocking N1 test gap is also closed for `#` glob subpaths.

## Verification

Read the prior findings from review-only commit `73efbd471`, file `docs/specifications/023-results-at-commit/reviews/wave-2.md`. That file is not present on this candidate. This re-review is bounded by those findings and the repair delta, not a new review of the whole feature.

Ran `git fetch origin` and `git checkout --detach cb18ca16c64dd944354ba571eba1b4a60660384a`. `git rev-parse HEAD` returned that exact SHA. The repair delta from `828022e894f7e46102b52b67091fcd4a7850bed3` contains the parser/root/isolation repairs in `02b474667` and rebuilt bundles in `cb18ca16c`. It changes no core keying or shared-set code.

| Command | Actual result at the candidate |
| --- | --- |
| `pnpm install --frozen-lockfile` | Not repeated. Squawk supplied successful frozen-install setup before this worker started, and the repair changes no manifest or lockfile. This is supplied setup evidence, not a new reviewer-run install. |
| `pnpm run lint` | Exit 0. `Checked 3580 files in 1462ms. No fixes applied.` |
| `pnpm run typecheck` | Exit 0. `tsrs --fast --noEmit`. |
| `pnpm run build` | Exit 0. TypeScript build and all four plugin builds completed. |
| `git status --porcelain` after build and external probes | Empty. The build reproduced the committed bundles. |
| `gh run list --commit cb18ca16c64dd944354ba571eba1b4a60660384a --json databaseId,name,status,conclusion,url,headSha` and `gh run view 43981325144 --json status,conclusion,jobs` | [CI run 43981325144](https://github.com/hearsay-tools/squeal/actions/runs/43981325144) was in progress. The Node 22/26 test shards and Node 24 lint/typecheck/version job were pending completion. Exact-candidate full-suite CI is **unverified**, not a finding. |

Affected results were read with:

```sh
~/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 \
  test/integration/glob-membership.test.ts \
  test/runners/vitest/glob-listing.test.ts \
  test/runners/vitest/closure-globs.test.ts \
  test/runners/boundaries.test.ts \
  test/keys/key-format.test.ts \
  test/version-sensitive.test.ts \
  test/ci/glob-import.test.ts
```

Exit 0. Actual output:

```text
Revision: 2 · cb18ca16 + 0
Named test files at revision 2: no known failures; 7 test files, each with a current result, after 35.4 s.
Worktree: known failures 0; not current: 972 of 1897 test files (620 queued, 352 unknown), 1451 tests (1451 queued)
```

These are Squeal's current results, including shared-key reuse. Its boundary recovery message identified an inherited pass from another worktree at `daa5677e5d53`; that is not a separate exact-candidate test execution. Results outside this focused selection remain pending or unknown and are **unverified**. No full-suite checkpoint or direct full suite ran.

One temporary external probe suite imported this candidate's unchanged source and existing fixture harness by absolute paths. Command: `timeout 600 pnpm exec vitest run --config <temporary-folder>/config.mjs`. Actual output:

```text
Test Files  1 passed (1)
     Tests  4 passed (4)
  Duration  6.29s
```

The four cases checked the original root restart scenario, original enum/sibling-folder restart scenario, original TSX comment-only scenario, and the parser-rejection fallback seam. Each real-adapter restart case disabled runtime-input observation, stored a first pass, added a matching file while stopped, and asserted a changed key, stale result and zero runs after restart. An independent empty-store run over the same added-file tree failed, confirming that the changed membership still changes the test outcome. All fixture schedulers and runners closed. The external test and config were removed. The tracked tree stayed clean until this findings file was added.

## Blockers

None.

## Previously blocking findings

### B1 closed: root listings reach the core

`src/runners/vitest/glob-listing.ts:156` handles a listing directory equal to the worktree root before calling the project-file filter. It returns directory `""`, which the unchanged core encodes as `./`.

The original `/plugin-*.ts` false-pass probe now changes the key and reads stale after adding `plugin-new.ts`. The expanded integration test covers flat root and recursive root globs, with observation both enabled and disabled, plus pass reuse after removal. Its Squeal result is current and passing.

### B2 closed: supported syntax is parsed; rejected syntax uses a safe membership superset

`src/runners/vitest/adapter.ts:564` passes the project's loaded `vitest/node.parseAst` into glob reporting. `src/runners/vitest/glob-listing.ts:63` selects its language from the source extension. Vite 8 can parse the enum and TSX cases directly, so the adapter reports the actual sibling folder rather than the importer's folder.

The original enum module with `../plugins/*.ts` now changes the key and reads stale after adding a sibling plugin. The original TSX source with glob text only in a comment returns no listing. The updated parser tests also cover TSX strings and JSX text, a real sibling-folder glob, and an enum with a decorator.

When parsing fails, `moduleGlobs` uses the worktree root recursively (`src/runners/vitest/glob-listing.ts:133` and line 143). The external probe supplied a JavaScript-only parser that rejects a TypeScript enum and verified the report `{ directories: [""], recursive: [""] }`. This closes the unsafe own-folder fallback. The new real-adapter fixture also exercises an unreadable plugin-defined module format and expects the same recursive-root report.

Compatibility limit: the brief explicitly names Vite 6/7's JavaScript-only parser fallback. TypeScript-only syntax rejected there takes the broad listing path. This can also broaden a module whose only apparent glob is comment/string text if that module cannot be parsed. It causes conservative re-keying for unrelated membership changes. The no-listing comment/string claim is verified for source the selected parser can read. No actual Vite 6/7 installation was run in this re-review; the parser-rejection seam was tested directly. This limitation is **unverified compatibility evidence**, not a new blocker or a claim of a Vite 6/7 integration pass.

### B3 closed: no cross-runner import remains

The Vitest parser no longer uses Node's type stripper or imports node:test's `quietly`. `src/runners/node-test/enumerate.ts` restores the helper to a private function. The unchanged boundary test now has a current passing Squeal result. Inspection of the exact-candidate import delta confirms the forbidden edge was removed, without an exemption to the boundary rule.

## Should-fix and nits

None added by this delta. Prior N1 is addressed: the real-adapter validity fixture now defines `"#plugins/*": "./src/plugins/*"` in `package.json`, imports `#plugins/*.ts`, and checks its reported directory as `src/plugins`. `closure-globs.test.ts` has a current passing result. This verifies the glob subpath case; it does not claim new coverage for every non-relative template-import form.

## What fits

- B1/B2 repairs preserve the report-only runner seam. No runner writes the shared store.
- Core order, shared merge-only storage and unconditional application across runtime-input policy values are unchanged from the first review.
- `keying.ts`, key encoding, `KEY_FORMAT_VERSION` and `VITEST_ADAPTER_VERSION` are unchanged by the repair. The key-format and version-sensitive tests have current passing results.
- The broadened fallback favors additional re-keying over reuse without the required membership input. It does not reinstate the proven false passes.
- Bundle rebuilding leaves no drift. No commit lookup, checkout, status or delivery behavior changed in the repair.

## Inputs for the next wave

No repair row is required for B1–B3. Keep the runner report, core merge order and existing listing representation. Treat older-parser whole-worktree fallback as a conservative compatibility path, with its wider invalidation cost stated above. The coordinator still needs passing full-suite CI at the exact final release commit before release; this PASS does not supply that evidence.
