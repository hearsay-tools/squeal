# Wave 22 rebase review

PASS `21f549af285e952ff7453a0f4e4c5e606432db6a`: **0 blockers, 0 new findings**.

This review covers the rebase of the previously passing `96506bb52` from
`9cc0d1c9d` onto `47d7178e0`, and the final bundle rebuild. It carries forward
`wave-22-rereview.md` unchanged from `ca63e2cd7`. The earlier B1/B2/B3/S1/N1
closures stand. Its nonblocking N2/N3 follow-ups remain open.

## Verification

Switched the clean worktree to the exact candidate before verification.
`git rev-parse HEAD` returned `21f549af285e952ff7453a0f4e4c5e606432db6a`.
Heavy verification ran in a new isolated boat.dev sandbox. Reconstructed the
original commit from its archive and commit object; the index tree matched
`1f39ed698cff2d4ec5b7733b4c34bd3ab42f4bc4`. Node was 24.22.1.

| Command or evidence | Actual result |
| --- | --- |
| `git range-diff 9cc0d1c9d..96506bb52 47d7178e0..21f549af2` | All source, test and documentation patches compare equal. Only the two earlier bundle commits differ; the final rebuild is added. Version-base differences change 0.1.587 to 0.1.588 before the same 0.1.590 raise. |
| The same `range-diff` restricted to `src test` | All **13** source/test commits show `=`. No changed or added patch. |
| Source/test paths changed by the old candidate versus those changed by the new main base | Empty intersection. The endpoint source/test delta contains exactly main's five source files and seven test/helper files. |
| Dependency setup | Kept local dependencies. Sandbox `corepack pnpm install --frozen-lockfile` passed with pnpm 12.15.0. The lockfile is unchanged. |
| Sandbox `pnpm run build`, then `git diff --exit-code` and a clean-status assertion | Exit 0. All four plugin builds passed. **No tracked or untracked drift**, including bundles and the Codex runtime manifest. |
| Sandbox `pnpm run lint` | Exit 0. Checked 3,972 files, no fixes. One existing `noProto` warning and two literal-key infos in unrelated tests. |
| Sandbox `pnpm run typecheck` | Exit 0, no diagnostics. |
| Installed `squeal checks` | Default tests after edits. Excludes `test/e2e/**`; does not cover lint, typecheck or build. |
| Two installed `squeal status --wait 60000` path selections below | Revision 6, clean `21f549af + 0`: **16 selected test files current, no known failures**. First selection returned after 16.1 s; second after 2.9 s. At the second return, 558 of 2,108 worktree test files were not current: 200 running, 357 queued, one unknown. No full-suite claim. |
| Coordinator's local evidence in the brief | Reports lint, typecheck, private check and 211 files / 2,062 tests passing. That broader test run was not independently repeated. |
| Exact-candidate CI | [CI 44930651250](https://github.com/hearsay-tools/squeal/actions/runs/44930651250) remained in progress at the last read. Node 22/26 shards and the Node 24 checks were running. Full-suite evidence remains unverified. [Private material 44930651191](https://github.com/hearsay-tools/squeal/actions/runs/44930651191) passed. |

The first Squeal selection was:

```text
test/shared/reader-look-again.test.ts
test/shared/import-after-closures.test.ts
test/shared/policy.test.ts
test/ci/export-bundle.test.ts
test/daemon/commit-cap.test.ts
test/daemon/commit-daemon-wired.test.ts
test/daemon/commit-mode.test.ts
test/checkout/commit-identity.test.ts
test/checkout/commit-worktree.test.ts
```

The second selection was:

```text
test/shared/reader-lifecycle.test.ts
test/daemon/commit-removal.test.ts
test/daemon/commit-timers.test.ts
test/daemon/commit-daemon.test.ts
test/cli/stop-at.test.ts
test/ps/checkouts.test.ts
test/types.test.ts
```

No direct Vitest run or full suite was needed. The sandbox's extra private
check could not select a merge-base in the reconstructed shallow history;
that attempt is unverified, not a product failure. Exact-candidate private
CI passed. No benchmark was repeated for this rebase.

## Interaction check

There is a common runtime path through the shared reader; there is no new
conflict with commit mode or commit worktree ownership.

- `src/core/ci/export-bundle.ts` caches parsed observed maps within one
  synchronous bundle construction. It changes no key, worktree identity,
  daemon registration, ownership or cleanup rule.
- `src/core/daemon/policy-shared.ts` and `src/core/types/policy.ts` add bounded
  `shared.lookAgain` settings. `commitPolicy` preserves the entire policy
  except `baseline.onStart`. The new settings reach the reader in commit
  mode as they do in an ordinary daemon. Coverage remains unchanged.
- `src/core/shared/reader.ts` and `look-again.ts` retry missing CI exports and
  re-import after scheduler refinement. Lookup-only starts still scan and
  refine; disabling lint, complexity and the filesystem watcher does not
  disable that scheduler work. The lookup-only import tests pass alongside
  the commit-mode tests.
- Reader timers are unreferenced and bounded. Shutdown calls the reader's
  `close()` before closing the store or removing the worktree. That cancels
  its timer and aborts git and refinement waits; the live-step guard prevents
  a second import after cancellation. No reader wait is added to daemon
  shutdown. The commit lifetime cap and tier cancellation remain unchanged.
- Checkout identity, both D4.2 locations, shared place registrations,
  process termination, `stop --at`, ps output and owner removal are
  byte-identical to the passing candidate. The rebase reopens none of the
  earlier safety findings.

## Inputs for the next step

No repair is required for this rebase. Keep the prior re-review's N2/N3
follow-ups and 023-40 integration contracts. Exact-release full-suite CI
must pass before release; this review does not supply that evidence.
