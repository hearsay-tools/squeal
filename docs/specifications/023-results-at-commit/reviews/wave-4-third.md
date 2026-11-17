# Wave 4 third review: CI manifest step dropped

PASS `e86c4be0b45b3daefb85a6d1ed2b9aa87e1509cd`

**0 blockers, 0 should-fix, 0 nits.** The human dropped the CI manifest-evidence step on 2026-11-17. The candidate removes the path that caused `wave-4-rereview.md` B1-CI. Workspace-chain results without manifest evidence remain uncertified. The original B1/B2 closure fixes remain intact.

This is the requested narrow re-review: the prior blocker, removal of the CI step, the revised CI regression, and restart/second-worktree preservation. The held relative shadow-path half and unchanged settled areas were not re-prosecuted. Repository history was rewritten between reviews. The prior reviewed candidate is now `415e40153d2d10d5261aa0ab1c80f6489a1de520`; its report commit is `c9351c545d`. The older hashes printed in that report describe its original run.

## Blockers

None.

## Verification

HEAD matched the requested candidate. All product verification ran before this report was written, with no tracked changes. Dependencies supplied at launch were retained; setup was not repeated. No full suite or full-suite checkpoint was requested. Direct Vitest was used only for the external discriminating proof, outside Squeal's coverage.

| Command or evidence | Actual result |
| --- | --- |
| `git fetch --prune origin`; `git checkout --detach e86c4be0b45b3daefb85a6d1ed2b9aa87e1509cd`; `git rev-parse HEAD` | Exit 0; exact requested candidate. |
| `pnpm run lint` | Exit 0: `Checked 3613 files in 1178ms. No fixes applied.` |
| `pnpm run typecheck` | Exit 0: `tsrs --fast --noEmit`. |
| `pnpm run build`; `git status --short` | Exit 0: TypeScript and all four plugin builds. No tracked drift. |
| `git diff --check origin/main HEAD` | Exit 0; no output. |
| `rg -n 'readManifests' src plugins` | Exit 1; no matches. |
| `git diff --quiet origin/main HEAD -- src/runners/vitest/ci-runtime/vitest-ci.cjs plugins/claude-code/dist/ci/vitest-ci.cjs plugins/codex-runtime/dist/ci/vitest-ci.cjs plugins/pi/dist/ci/vitest-ci.cjs plugins/opencode/dist/ci/vitest-ci.cjs` | Exit 0. The hook source and all four committed copies equal main's hook. |
| Named Squeal wait below | Exit 0: `Named test files at revision 9: no known failures; 9 test files, each with a current result, after 48.8 s.` Whole worktree: 633/1918 files not current, 4 running and 629 queued; 4135 tests not current. Broader affected results are **unverified**. Content-key reuse is included; this is not a claim of fresh full-suite coverage. |
| External B1-CI shell-restoration proof below | Exit 0: **1 test passed**, 7.50 s. Its nested recorded Vitest run passed both fixture files. Assertions also verified clean fixture git status, export exit 0, plain control retained, chain result omitted, and independent plain Vitest exit 1 with `expected 'a' to be 'b'`. |
| `pnpm run check:private`, before report | Exit 0: `private: 6227 added lines in 51 files over 633d50af025e7d978e965147c0d8dc996e409916, ok`. Warning: the optional `SQUEAL_PRIVATE_DENYLIST` is empty and its rule was skipped. Structural checks ran. |
| Exact-candidate CI, inspected 2026-11-17 14:26 Europe/Warsaw | [CI 44092143277](https://github.com/hearsay-tools/squeal/actions/runs/44092143277) in progress: all six Node 22/26 shards and the Node 24 lint/typecheck/version-sensitive job pending. Full-suite result **unverified**. [Private material 44092143330](https://github.com/hearsay-tools/squeal/actions/runs/44092143330) passed. |

```sh
SQUEAL=~/.codex/plugins/data/squeal-hearsay/bin/squeal
"$SQUEAL" status --wait 60000 \
  test/integration/resolution-chains.test.ts \
  test/ci/resolution-import.test.ts \
  test/runners/vitest/resolution-inputs.test.ts \
  test/runners/vitest/reresolution.test.ts \
  test/integration/resolution-inputs.test.ts \
  test/keys/key-format.test.ts test/runners/boundaries.test.ts \
  test/version-sensitive.test.ts test/ci/export-wrapper.test.ts

# External proof launched through hsq job start review-third-ci:
timeout 600 pnpm exec vitest run --config <scratch>/vitest.config.mjs
```

The throwaway proof replays the prior B1-CI failure. Committed A maps `#chosen` through a linked workspace package's `exports` to `a.ts`. A recorded Node wrapper uses `sh` to select B before Vitest starts. The test imports `#chosen` and both source targets, restores exact A manifest bytes through `sh`, and passes with the already imported B value. The final tree is clean. At this candidate, export omits `test/late.test.ts` and retains `test/plain.test.ts`. An independent plain Vitest run at A fails the value assertion. Thus removal closes the specific false certificate, without relying on a missing source-target certificate to hide it. The external test and config were removed before commit.

## Previously blocking findings

| Finding | Result |
| --- | --- |
| `wave-4-rereview.md` B1-CI: final manifest scan certifies the wrong state | **Resolved by removal and accepted scope reduction.** No `readManifests` implementation or call remains in source or bundles. The previous false-pass fixture is now omitted by the existing per-shard closure certifier. |
| `wave-4.md` B1: `#` chain omits workspace `exports` manifest | **Still repaired.** Closure implementation and integration cases are byte-identical to the prior reviewed candidate. Current integration results cover changed-manifest restart refusal, a real failing run, undo reuse, same-content worktree reuse, and changed-worktree refusal. |
| `wave-4.md` B2: workspace subpath omits nested `main` manifest | **Still repaired.** The same checks cover retargeting an existing nested manifest and adding a previously absent one. The workspace `main` and own-package `exports` controls remain current/pass. |

## Should-fix and nits

None.

## What fits

- The product source delta from the rewritten prior candidate is exactly the 28-line removal in `src/runners/vitest/ci-runtime/vitest-ci.cjs`. The only test delta is `test/ci/resolution-import.test.ts`. Closure code, chain integration tests, re-resolution expectations and core interfaces are unchanged. Other delivery changes are notes, version 0.1.543 and rebuilt bundles/metadata.
- The revised CI regression checks that all three chain tests are explicitly left out of export. Lookup-only imports have no state for them at either the export's own commit or any of the three manifest changes. The direct root `#reg` and plain test still import current passes at matching content; root retargeting refuses the old pass. No test run supplies a replacement pass during these imports.
- Certification still uses the existing per-shard evidence check in `src/core/ci/export-inputs.ts`. No final manifest scan, endpoint comparison or replacement certificate was added.
- The manifest closure, installed-package exclusion, `exports` root-only rule, key format and adapter version are unchanged. The earlier independent re-key measurement, 0 walked additions here and 109/1902 in squawk, is retained as prior evidence, not a fresh census at this commit. The removal changes certification availability, not local closure membership.

## Inputs for the next wave

No repair is required for this review's scope. Keep the adapter's manifest paths in local keys, including absent nearer and nested manifests. Keep CI results uncertified when the shard lacks evidence for those paths. A future CI expansion must capture what native resolution used; reading the final content is insufficient. The relative shadow-path half remains held. Exact-release full-suite CI remains the coordinator's release requirement; this review does not claim it passed.
