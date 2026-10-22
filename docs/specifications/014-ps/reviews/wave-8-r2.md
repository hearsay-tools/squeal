# Wave 8 review, round 2

PASS 8fbd74467cd8a34ead5ae5c55513ae066f2e3a3d

Row 014-46. Narrow re-review of `cand/0.1.267` against `reviews/wave-8.md`: B1 and S1, the rebase over 0.1.266, the version and bundle commit, and the status amendments. This includes repairs `e33f8bab8`, `6f9cf4618` and `2c0544d9c`. **0 blockers, 0 should-fix items, 0 nits found.** Both prior findings are resolved. The accepted PID reuse limit is safe.

## Verification

Node v24.21.0. The parent first pinned `89817f2cd`, then moved the pin to `8fbd74467cd8a34ead5ae5c55513ae066f2e3a3d` to repair the unreadable-namespace case found during this review. The authorized reset succeeded. The package files did not change between these pins. The tree stayed clean through the final checks; only this findings file was then added.

`npm ci` ran at the first pin: 196 packages added, 197 audited in 9 s, exit 0. It reported one high severity audit issue and six packages with uncovered install scripts. The parent explicitly required no second install at the final pin because the package files were unchanged. No dependency was changed by this review.

The following checks ran at the final pin:

```text
$ npm run lint
> squeal@0.1.267 lint
> biome check .
Checked 1768 files in 839ms. No fixes applied.
exit 0

$ npm run typecheck
> squeal@0.1.267 typecheck
> tsc --noEmit
exit 0

$ npx vitest run test/global-teardown.test.ts test/daemon/strays.test.ts test/harness/ps-bundle.test.ts test/harness/plugin.test.ts test/keys/key-format.test.ts --maxWorkers=4
 RUN  v5.0.3
 Test Files  5 passed (5)
      Tests  50 passed (50)
   Start at  19:50:14
   Duration  4.81s (tests 68%, transform 27%, import 5%)
exit 0

$ npm run check:version -- 1ee20a900
> node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/check-version-bump.ts 1ee20a900
version bump: 0.1.266 -> 0.1.267, ok
exit 0
```

The focused suite is the independent check the re-review brief requires. Its global setup reported one earlier-run stray cleanup; the suite passed. No manual process signal or printed `ps` end command was used. No `npm run build` ran in this tree. The committed bundles remain the candidate artifacts.

The coordinator reports its full gate at `e33f8bab8`: 909 files passed, 2 skipped, exit 0. That is evidence at an earlier commit, not an independent full-suite verdict at the final pin. The first review's independent full-suite evidence remains in `wave-8.md`. No second full suite ran here.

`gh run view 39826048209` and its per-job results were read before the verdict. The run reports head `8fbd74467cd8a34ead5ae5c55513ae066f2e3a3d`, completed, success. All four test jobs passed. Build and bundle drift checks passed in Node 24 and Node 22 (1/3); those steps were skipped in Node 22 (2/3) and (3/3):

| Job | ID | Result |
| --- | --- | --- |
| Node 24 (lint, typecheck, version-sensitive) | 119989718294 | success |
| Node 22 (1/3) | 119989718449 | success |
| Node 22 (2/3) | 119989718767 | success |
| Node 22 (3/3) | 119989718838 | success |
| Node 24 (nightly, full suite) | 119989720439 | skipped |
| Bundle changes bump the version | 119989720757 | skipped |

CI: https://github.com/hearsay-tools/squeal/actions/runs/39826048209. The skipped jobs are not passing evidence. The explicit local version check above covers the version bump.

## Blockers

None. Prior B1 is resolved, including the unreadable-namespace case.

## Should-fix

None. Prior S1 is resolved.

## Nits

None.

## What fits

- **B1, namespace identity:** `test/global-teardown.ts:90` creates the parent, and `:91` to `:93` record its namespace before `:99` exposes it to workers through the temp variables. At `:166`, a live local PID preserves the parent. At `:169` to `:172`, removal requires a real directory, this user's uid, and an exact namespace-marker match. A different, absent or unreadable marker preserves the parent. The private-root cases at `test/global-teardown.test.ts:105` and `:123` cover a dead local run, a live local PID, a foreign marker and no marker.
- **B1, unreadable Linux namespace:** `namespaceName` at `test/global-teardown.ts:184` to `:188` returns `null` when Linux cannot read its namespace. The sweep returns at `:163` before it examines entries for deletion. Setup writes no marker at `:93`, so another sweep cannot claim that parent. Its own teardown still removes it. The helper's Linux and Darwin branches are checked at `test/global-teardown.test.ts:145`. The platform fallback off Linux is consistent with the supported single PID space there.
- **Safe reproduction:** the first pin's shared `no /proc` fallback failed a private-root probe. The identical probe at the final pin passed: `foreign parent with legacy no /proc marker preserved: true`, `new parent has no namespace marker: true`. It bundled the actual exported setup in memory, injected an unreadable namespace and a locally absent PID, disabled stray scanning, and kept both its root and cache under an owned `mkdtemp` directory. Its call was `setup(project, { env, root })`. The root `/tmp/squeal-r2-private-Y8B2Om` was removed afterwards. **No `/tmp/squeal-vitest-*` parent of another run was touched by either probe.** No real shared `/tmp` sweep or signal ran in either probe. This is an injected dependency test, not a native namespace reproduction. Source inspection establishes why it covers the missing-read branch.
- **S1, exact names:** `test/global-teardown.ts:55` accepts only a positive PID without a leading zero and exactly six ASCII letters or digits, anchored at both ends. At `:170`, `lstat` excludes a symlink. The test at `test/global-teardown.test.ts:123` preserves a longer name, a bad suffix and a symlink. Valid dead parents are removed by the case at `:105`.
- **Accepted PID reuse limit:** `test/global-teardown.ts:166` preserves a dead run's parent while an unrelated live process has reused its PID. This delays cleanup; it does not authorize deletion of a live run. After that process exits, a later setup can remove the old parent if its namespace and uid match. `docs/specifications/014-ps/status.md:49` records this limit. No start-time identity is needed for safe retention. Unreadable and foreign namespace identities also deliberately retain debris.
- **Rebase:** `git range-diff 81b927e08..ec15d10bf~1 1ee20a900..8078eb670` reports all 19 wave commits with `=`. No wave patch changed during the rebase. The earlier review's settled product conclusions remain applicable.
- **Version and bundles:** `c9c0fd025` changes exactly the eight version source files: root package and lockfile, installer, Claude manifest and package, Codex manifest, OpenCode package, and Pi package. The version changes from 0.1.266 to 0.1.267 throughout. The other 36 changed files are rebuilt bundles under the four plugin `dist` directories. After that bundle commit, changes are limited to test cleanup repairs, status text and the prior review. The key-format, plugin and bundle checks pass. Each committed `ps.mjs` is 129301 bytes against `squeal.mjs` at 2527083 bytes: 5.1166%, below one eighth. CI's build and drift results are recorded above; this tree did not rebuild the artifacts.
- **Accepted scope:** `docs/specifications/014-ps/status.md:48` retains the integration decisions reviewed in round 1. Its next line, `:49`, records namespace markers, the Linux unreadable-namespace rule, canonical names, and PID reuse retention. These match the implementation. No delta reopens the product drop, decoders, installed-version readers, waiter budget or quality slices settled in round 1.

## Inputs for the next wave

No repair is required by this re-review. Keep unknown and foreign namespace identities conservative. Preserve canonical names, uid checks, the short `/tmp` parent and the marker-before-worker ordering. Any future namespace reproduction must use an owned private root or a private tmpfs.
