# Wave 1 confirmation review

PASS `f7836934edea4b55a4af29bb10aee0fdb9809402`

**0 blockers, 0 should-fix items, 0 nits.** This confirms the human's 2026-11-16 decision to land rows 023-04 and 023-05 and hold 023-03 back. It does not approve the removed keys-at-commit mechanism.

Scope: `c56b15d84..f7836934e`, bounded by the prior review at `a6e792211:docs/specifications/023-results-at-commit/reviews/wave-1-rereview.md`. The candidate adds one revert commit. No candidate code was edited during review.

## Verification

All checks used the exact candidate on a clean tracked tree. The build left it clean.

| Command or evidence | Actual result |
|---|---|
| `git fetch origin && git checkout --detach f7836934edea4b55a4af29bb10aee0fdb9809402`; `git rev-parse HEAD` | Exit 0; exact requested SHA |
| Dependency setup | Existing install retained per the task instruction. Dependency declarations and lockfile unchanged; install not repeated. |
| `pnpm run lint` | Exit 0: `Checked 3564 files in 1590ms. No fixes applied.` |
| `pnpm run typecheck` | Exit 0: `tsrs --fast --noEmit` |
| `pnpm run build` | Exit 0; TypeScript and all four harness builds completed |
| `git status --porcelain=v1 --untracked-files=all`; `git diff --exit-code`; `git diff --cached --exit-code` | Empty output, exit 0; bundles match the build and no new bundle file appeared |
| `git diff --check c56b15d84..HEAD` | Exit 0, no output |
| Squeal command below | Exit 0 at revision 6: `11 test files, each with a current result`, no known failures; first wait 33.5 s, final wait 2.2 s. The worktree still had 897 unrelated test files not current (889 queued, 8 unknown). Results can be inherited by content key; this does not claim fresh execution of all 11 files at this SHA. |
| Squeal JSON diagnostic | All three inspected files current/pass; `commit.head` equals the candidate and `dirty: false`. Snapshot exited 3 with `reason: unsynced`; the subsequent final named wait above exited 0. |
| `gh run view 43969627794 --json headSha,status,conclusion,jobs` | At 2026-11-16T22:27:26Z, exact candidate SHA, **in progress**, no conclusion. Six Node 22/26 shards and the Node 24 checks job running. Version-bump and nightly jobs skipped. Full-suite CI **unverified**, not a finding. [Run](https://github.com/hearsay-tools/squeal/actions/runs/43969627794) |

```sh
~/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 \
  test/cli/code-gate-files-env.test.ts \
  test/cli/code-gate-files-environment.test.ts \
  test/cli/code-gate-files.test.ts test/cli/code-gate-relaunch.test.ts \
  test/cli/code-gate-kill-parent.test.ts test/checkout/checkout.test.ts \
  test/store/transfer-rekey.test.ts test/store/environments.test.ts \
  test/keys/environment.test.ts test/keys/key-format.test.ts \
  test/version-sensitive.test.ts
```

No full suite or checkpoint was requested. No direct Vitest run was needed for this confirmation.

## Blockers

None in the reduced candidate.

## Revert completeness and settled findings

**B1 is removed from this landing, not repaired.** All five `src/core/commit/at-*.ts` modules, all three corresponding test files and `tasks/023-03/notes.md` are deleted. `git ls-files` finds no remaining source or test under those patterns. A search of `src`, `test`, `plugins` (bundles included), `scripts` and `.github` finds no references to `at-keys`, `at-environment`, `keysAtCommit`, `sideKeys`, `targetCoverage`, `projectEnvironments`, `KeysAtInput` or `environmentAtCommit`.

The three shared files `src/core/keys/environment.ts`, `src/core/store/environments.ts` and `src/core/store/transfer-rekey.ts` match `2ca6a943c` byte for byte. The complete delta is exactly those three restorations and the nine deletions above. Nothing else changed.

**B2 remains closed.** Gate implementation and tests are byte-identical to `c56b15d84`. Current environment regression tests cover execution under overridden and unset variables, restoration, store reuse at the matching environment, conditions without storage and overlapping calls. Restoring the keys/store helper files does not remove the effective environment held by `runGateFiles` across config loading, execution and storage.

**B3 remains closed.** Checkout implementation and tests are byte-identical to `c56b15d84`. Current checkout tests retain the original write-through regression and the symlink-parent case. Copy-in still replaces a final symlink and refuses a symlinked parent before writing.

## Should-fix and nits

None.

## What fits and next-wave inputs

Rows 023-04 and 023-05 retain their prior reviewed behavior, including named-file results, relaunch parent cleanup, checkout cleanup and visibility. The revert changes no gate or checkout boundary. Committed bundles are unchanged from the prior candidate and match a fresh build.

Keep 023-03 and its consumers held back. No `keysAtCommit` or `sideKeys` API exists in this candidate. A future implementation must establish target-closure completeness, including unchanged glob importers whose matched file set changes, before returning a reusable key. The B1 reproduction and repair requirements remain in the prior re-review. The coordinator records the human's reduced landing scope in the board/status documents. Passing full-suite CI for the exact release commit remains required before release.
