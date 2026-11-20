# Wave 18 fourth review

FAIL `de2136c8a7df5347269e71637eeadaab9004e87e`: 1 proven blocker. The ordinary live-sibling witness is fixed, but a failed pathname lookup still makes a live outside working folder read as the checkout.

This narrow review is bounded by `3f09090f5:docs/specifications/023-results-at-commit/reviews/wave-18-third.md` and `d765213f6..de2136c8a`. The amended D6 at main `0697a35ea` remains the contract: only the kernel-reported working folder establishes containment. Generated bundle content was excluded.

## Verification and scope

HEAD matches the requested candidate. The pre-existing `squeal.config.json` edit (`coverage.enabled: false`) was preserved and is not part of this commit. Local commands ran with that difference; pristine-tree verification remains **unverified**. The real-process probes use the candidate helper directly and do not depend on Squeal coverage. All temporary processes, folders and the probe script were removed.

| Command or evidence | Actual result |
| --- | --- |
| `git fetch origin cand/0.1.581`; `git checkout --detach origin/cand/0.1.581`; `git rev-parse HEAD` | `de2136c8a7df5347269e71637eeadaab9004e87e` |
| Dependency setup | Supplied installation retained; not repeated |
| `git diff --name-only d765213f6..de2136c8a` and source/test diff | Only `src/core/checkout/left-under.ts`, `test/checkout/left-under.test.ts`, four generated CLI bundles and the generated runtime manifest hash changed. No other product source changed. |
| `timeout 600 pnpm run lint` | Exit 0. `Checked 3894 files in 2s. No fixes applied.` |
| `timeout 600 pnpm run typecheck` | Exit 0, no diagnostics |
| `pnpm run check:private` | Exit 0. `private: 37316 added lines in 88 files over ee79bb1277c97356c3f21e14db1d852593d9ba40, ok`. The empty private denylist rule was skipped with a warning. |
| `git diff --check` | Exit 0 |
| Installed Squeal `status --wait 60000 src/core/checkout/left-under.ts` | Exit 3. Revision 0, partial list, no daemon running. Affected results are **unverified**, so targeted tests ran directly. |
| `timeout 600 pnpm exec vitest run --maxWorkers=2 test/checkout/left-under.test.ts test/runners/boundaries.test.ts` | Exit 0. Two files, 15 tests passed, 2.73 s. |
| `timeout 600 pnpm exec tsx /tmp/sq-wave18-fourth-process.mts` | Exit 1 on the outside-survival assertion below. All eight earlier cleanup controls passed; the permission-error witness failed. Permissions restored, children/folders cleaned, script removed. |

No local full suite or build ran. Exact-candidate [CI 44837951802](https://github.com/hearsay-tools/squeal/actions/runs/44837951802) was still in progress when checked; full-suite and build/bundle checks are **unverified**. Exact-candidate [Private material 44837952165](https://github.com/hearsay-tools/squeal/actions/runs/44837952165) passed. Earlier unverified benchmark and live-daemon evidence remain outside this narrow repair.

## Blocker

### 1. Proven, original B1 remains: a pathname permission error is treated as deletion evidence

**Locations:** `src/core/checkout/left-under.ts:263`, `:265`, and the catch at `:271`.

Row 023-31 requires: “Never touch a process outside the path.” The inode comparison fixes a readable live `C (deleted)` sibling. However, `statOrNull` converts every pathname lookup error into null. `cwdOf` then strips the suffix. Failure to read the pathname is not proof that the working folder was deleted.

**Real disposable-process reproduction:** under a unique parent P, create checkout C and the separate live sibling `C (deleted)`. Start an idle child in the sibling. Remove search permission from P with `chmod(P, 0600)`; neither directory is removed. The same unprivileged user can still read and stat `/proc/<pid>/cwd`, while stat of the written pathname fails with `EACCES`. Call `endLeftUnder(C, { graceMs: 100 })`.

Observed: the proc cwd object has `nlink: 2`, the pathname lookup gives `EACCES`, cleanup reports the outside child in `ended`, and the child is dead. The fallback turns the live sibling's name into C, so both signal checks accept it. The probe restored P's permissions in its cleanup and removed all its processes and folders.

**Repair:** one checkout worker should keep an unreadable pathname distinct from evidence of deletion. Do not strip a suffix merely because stat failed. Use positive evidence from the cwd object to establish deletion, or return no eligibility when the evidence is ambiguous. Add this real permission-error survival regression beside the readable-live and genuinely deleted controls. Preserve cwd-only eligibility and full revalidation before both signals.

## What fits

- The original live `C (deleted)` sibling now survives. The new inode comparison also distinguishes a deleted checkout cwd from a live sibling with the same displayed text; its existing regression passed.
- The independent real-child controls all passed: outside cwd with symlink/`..` argument; one executable argv containing spaces and an embedded checkout path; outside cwd with a contained option path; `C2` sibling; readable live suffix sibling; contained cwd; deleted contained cwd; and cwd through a checkout symlink. Only the last three ended, as required.
- Existing cleanup tests passed for entire-checkout deletion, sweep integration, caller/ancestor and uid exclusions, start-time changes, escalation, and leaving the folder during the grace period. The permission-error case bounds these passing claims.
- No status-run, report, gate or skill source changed since the third candidate. The closed second-pass mutation blocker and earlier accepted judgments remain settled; they were not re-run in this narrow review. No new stdout writer is introduced.

## Input for the fix wave

Dispatch blocker 1 to the checkout worker. Keep the successful readable-path identity check, but make unknown metadata conservative. Re-review the unreadable live sibling together with the readable live sibling and deleted cwd cases. Keep the pre-existing configuration edit out of the fix and review commits.
