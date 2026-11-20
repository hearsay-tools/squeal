# Wave 18 fifth review

PASS `1b503d9d440625d57f52f1dd0b811bf085b37418`: 0 blockers. The fourth review's remaining outside-process witness is closed. No further proven false containment case was found in this narrow repair.

Reviewed `de2136c8a..1b503d9d4`, bounded by `760829b89:docs/specifications/023-results-at-commit/reviews/wave-18-fourth.md`. The amended D6 at main `0697a35ea` remains the contract: working folder only. Generated bundle content was excluded.

## Verification and scope

HEAD matches the requested candidate. The pre-existing `squeal.config.json` edit (`coverage.enabled: false`) was left as found and is not committed. Local commands ran with that difference; pristine-tree verification remains **unverified**. The real-process probes import the candidate helper directly and do not depend on coverage configuration. All probe children, folders and the script were removed; temporary permissions were restored.

| Command or evidence | Actual result |
| --- | --- |
| Fetch, detached candidate checkout, `git rev-parse HEAD` | `1b503d9d440625d57f52f1dd0b811bf085b37418` |
| Dependency setup | Supplied installation retained; not repeated |
| `git diff --name-only de2136c8a..1b503d9d4` and source/test diff | Only `src/core/checkout/left-under.ts`, `test/checkout/left-under.test.ts`, four generated CLI bundles and the generated runtime manifest hash changed. No other product source changed. |
| `timeout 600 pnpm run lint` | Exit 0. `Checked 3895 files in 2s. No fixes applied.` |
| `timeout 600 pnpm run typecheck` | Exit 0, no diagnostics |
| `pnpm run check:private` | Exit 0. `private: 37294 added lines in 88 files over ee79bb1277c97356c3f21e14db1d852593d9ba40, ok`. The empty private denylist rule was skipped with a warning. |
| `git diff --check` | Exit 0 |
| Installed Squeal `status --wait 60000 src/core/checkout/left-under.ts` | Exit 3. Revision 0, partial list, no daemon running. Affected results are **unverified**, so targeted tests ran directly. |
| `timeout 600 pnpm exec vitest run --maxWorkers=2 test/checkout/left-under.test.ts test/runners/boundaries.test.ts` | Exit 0. Two files, 16 tests passed, 3.06 s. |
| `timeout 600 pnpm exec tsx /tmp/sq-wave18-fifth-process.mts` | Exit 0. All earlier real-child controls and the additional deletion/permission controls below passed. Script removed afterwards. |

No local full suite or build ran. Exact-candidate [CI 44838560790](https://github.com/hearsay-tools/squeal/actions/runs/44838560790) was still in progress when checked; full-suite and build/bundle results are **unverified**. Exact-candidate [Private material 44838560780](https://github.com/hearsay-tools/squeal/actions/runs/44838560780) passed. Earlier unverified benchmark and live-daemon evidence remain outside this narrow repair.

## Blockers

None.

## Closed finding and what fits

- **Fourth-review B1 closed with the same real permission witness.** Under one unique parent, create checkout C and live sibling `C (deleted)`, then start one child in each. Remove the parent's search permission. The probe confirms `EACCES` for the sibling's written pathname while its proc cwd object has `nlink: 2`. Cleanup ends only the inside child; the outside sibling survives. Both folders remain live throughout this stage. The new existing regression also passed.
- **The helper no longer guesses from a pathname lookup.** `cwdOf` at `src/core/checkout/left-under.ts:255` reads the proc cwd link and its kernel stat. A failure of either returns null, which cannot establish containment. It strips exactly one final annotation only for `nlink === 0n`. `statOrNull` is removed. The written cwd pathname is not stat'ed by the helper. TERM and KILL retain the same start-time, uid and cwd revalidation.
- **All eight earlier real-child controls pass.** Outside cwd with a symlink/`..` argument, one executable argv containing spaces and an embedded checkout path, outside cwd with a contained option path, a `C2` sibling, and a readable live suffix sibling all survive. Children in C, in a deleted contained folder, and in C through a symlink all end and are named.
- **Deletion ambiguity has real positive and negative controls.** With an entire checkout removed and a live `C (deleted)` sibling present, both cwd links display the same text. Only the child from the removed checkout ends. Removing the outside literal suffix sibling afterwards gives its cwd object `nlink: 0`; cleanup still spares it, because removing only the kernel's final annotation leaves the outside literal name intact.
- **Existing boundary coverage remains green.** Cleanup/sweep integration, uid and caller/ancestor exclusions, start-time changes, TERM/KILL escalation, and leaving the folder during the grace period passed in the targeted file. No status-run, gate, report or skill source changed. The earlier closed blockers and accepted judgments remain settled. No new stdout writer is introduced.

## Nonblocking limits

- **Accepted fail-safe spare:** on a filesystem where a removed directory retains a positive link count, the helper keeps the suffix and may spare that process. This is the accepted conservative result in the brief, not an outside-process kill. That filesystem behavior was not reproduced on this host.
- **Plausible standing race:** proc link/stat reads and the eventual signal are separate operations. A process can change cwd or identity between samples. Revalidation reduces that window; no race-induced outside signal or real pid-reuse incident was reproduced. This remains a nonblocking limit, as in the earlier reviews.

## Next evidence

No repair row is required by this review. Keep the cwd-only rule and the no-pathname-stat decision. Obtain the exact candidate's passing CI/build results before claiming those checks passed; the pre-existing configuration edit must stay out of integration commits.
