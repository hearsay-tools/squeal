# Wave 13aq fourth review

## Verification

Candidate `af0dd6d4045615048f06124481ede37c10aed20a` matches the assigned HEAD. Scope: row 001-306, the human's replacement rule in 001-305 (`2c0d9090`), its spec 004 D9 amendment, and the integrated plugin build `9fe674eb` (0.1.131). Read `wave-13am.md`, `wave-13an.md` and `wave-13ap.md` before inspecting the repair. This is a bounded fourth round: replay the prior schedules against the new rule, inspect its delta, retain the earlier capability note. The primer and watcher reviews are not reopened.

The candidate tree was clean for every check and probe. Independent commands and output, 2026-10-12, all with `env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null`. The full suite uses four workers because this 24-CPU host is heavily loaded by other projects. This is the reviewer's own Vitest run, not a Squeal checkpoint.

```text
$ git rev-parse HEAD
af0dd6d4045615048f06124481ede37c10aed20a
$ git status --short
(no output)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npm ci
added 56 packages, and audited 57 packages in 6s
found 0 vulnerabilities
exit 0

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npm run lint
> squeal@0.1.131 lint
> biome check .
Checked 917 files in 4s. No fixes applied.
exit 0

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npm run typecheck
> squeal@0.1.131 typecheck
> tsc --noEmit
exit 0

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npm run build
> squeal@0.1.131 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.131 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
exit 0
$ git status --short
(no output: both committed plugin builds reproduce)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run --maxWorkers 4
Test Files  426 passed | 1 skipped (427)
     Tests  3527 passed | 10 skipped (3537)
  Start at  15:15:00
  Duration  861.46s (tests 97%, import 2%, transform 1%)
exit 0
$ git rev-parse HEAD
af0dd6d4045615048f06124481ede37c10aed20a
$ git status --short
(no output)
```

`npm ci` warned that the install scripts of `@parcel/watcher@2.6.0` and `esbuild@0.28.2` were not covered by `allowScripts`. No approvals were changed; build succeeded.

The sole independent full run passed, including the prior boundary schedules and the repair's told-failure controls. No timing assertion failed, so no isolated retry was needed. Load was about 81 early in the run and remained above 50 later. The run printed two fixture gitdir repair diagnostics and swept one process left by an earlier test run (`1791030`); teardown passed. HEAD still matched and the tree remained clean after the run.

An independent throwaway probe outside the worktree imported the candidate's two-harness fixture and source hooks. The fixture's writes and hook reads used separate SQLite connections. No real agent tooling, HOME state or candidate files changed. It checks the live decision and delivery view at the boundary immediately before the write lock, rather than only a delayed completion:

```text
$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run --config <throwaway>/vitest.config.mjs
Test Files  1 passed (1)
     Tests  10 passed (10)
  Start at  15:17:06
  Duration  4.54s (transform 68%, tests 20%, import 12%)
exit 0
```

In both harnesses: a failure replacing a pass after the complete poll but before `decide` blocks, its pass control is silent; a matching failure written to this consumer's view between poll and decision is silent; a told failure with a subsequently delivered recovery blocks when it fails again, then stays silent on the next Stop; two waiting entries sharing one fresh handoff produce exactly one block. The probe was deleted before committing.

## Verdict

**PASS af0dd6d4.** Zero blockers, one retained plausible non-blocking note, no nits. Every earlier blocker schedule is repaired under the human's new rule. The waiting Stop's decision uses current failures and the session's told outcome/fingerprint in the same live write transaction; no tracked membership, original key or run revision can exclude an untold current slow failure.

## Blockers

None.

## Should-fix

### S1. The worktree-wide waiting-handler capability remains session-agnostic

**Plausible, non-blocking; unchanged 13am/13an/13ap S1.** `src/core/slow/stop-wait.ts:45`; `src/harness/shared/stop.ts:129`.

The marker remains shared by a worktree and harness/version. A session can inherit evidence written by another session whose waiting handler runs. Spec 004 D9 says a missing or untrusted waiting entry “degrades to the old hold, never to none.” This fourth round did not exercise a live trust/disable transition. The code is unchanged by 001-305, and the note remains planned row 001-297.

**One-worker follow-up:** test two sessions sharing a worktree, only one with the waiting handler. Scope the capability to the consumer and installed handler, or acknowledge the current Stop within the short entry's budget. Preserve the 2 s entry and its old immediate hold when no waiting entry is available. Do not reintroduce owed-file tracking as part of this work.

## Nits

None.

## What fits

The prior schedules were rerun through the integrated candidate's tests, in both harnesses:

| Prior evidence | Candidate coverage and outcome |
| --- | --- |
| 13am B1, completion between Stop entries and during the waiting entry's first read | `stop-slow-boundary.test.ts`: failure blocks, pass stays silent. |
| 13am B2, a newer revision/re-key during the poll that saw the old pass or failure | `stop-slow-boundary.test.ts`: live transaction waits for revision 2; the bound names its pending file, never an old failure beside a new header; newer passing completion stays silent. |
| 13am B2, empty listed open set but unfinished refinement | `stop-slow-boundary.test.ts`: remains pending; the bound names the runner part; completed passing refinement stays silent. |
| 13an B1, an unlisted file listed and completed before or during the first read | `stop-slow-untold.test.ts`: failure blocks at revision 1, pass stays silent. |
| 13an S2, a pending file moved and completed before/during the first read, or entirely between polls | `stop-slow-untold.test.ts`: failure at the newer key blocks; passing controls stay silent. |
| 13ap B1, unlisted failure at revision 1 followed by a newer-key completion before/during the first read | `stop-slow-untold.test.ts`: revision-2 failure blocks; revision-2 pass stays silent. The observed-queued controls and a failure/move split across successive reads also pass. |

- `untold` compares `checkIdentity`, told `outcome === "fail"` and diagnostic fingerprint. It reads views only when a current slow check fails, under `decide`'s existing `BEGIN IMMEDIATE`. A told failure at the same or a newer key stays silent; a changed fingerprint blocks. A failure first observed at a later revision that this agent did not cause blocks once, as the human now requires. Tests assert silence on the following Stop after that block delivers it. The former later-only exclusion is intentionally gone.
- `StopHandoff` now keeps only `at`, and parsing an older handoff accepts that timestamp while discarding its former owed fields. `endTurn` still writes the idle waiter's `keys`, `revision` and `newTestFiles`; its distinct delivery rule remains unchanged. `trimmed` retains the handoff timestamp when idle obligations are trimmed.
- The fresh probe confirms that the final decision re-reads states and told views after the poll. Taking the idle consumer into a turn is atomic; competing waiting entries cannot both claim it. Existing tests retain prompt/wake cancellation, silence when the short entry spoke, and setting-off, active-Stop and SubagentStop exits.
- The live-revision delivery guard remains wired through `newsText(..., atRevision)`. The decision takes the header and failure reason from its accepted read. The wait still spends one monotonic deadline across retries, with the unchanged 600000 ms wait cap, 3000 ms handoff budget, 2 s short entry and 630 s waiting-hook timeout. No timeout overrun was reproduced; the full ten-minute wait was not wall-clock exercised.
- Source and both committed plugin bundles reproduce, with version 0.1.131. The changed interfaces are reflected in the turn tests and callers. Board and status were not edited. Only this report is committed.

## Inputs for the next wave

No repair wave is required for 001-305 by this review. S1 remains row 001-297; the coordinator decides landing and release.

Keep the contract: short Stop decides and delivers, silently ends the turn with the handoff timestamp, then nudges the daemon; waiting entry accepts a fresh handoff; poll through pending slow work and refinement within one deadline; re-read live revision, states, keys, turn and this consumer's views under `BEGIN IMMEDIATE`; cancel if a prompt/wake owns the turn; otherwise claim the idle turn once for an untold current slow failure or the unsettled bound; deliver at the accepted revision. Told means this consumer's view holds that failure's fingerprint, independent of run revision and key. Keep the idle waiter's separate obligations and all existing hook budgets.

Future changes to this boundary should retain the schedule matrix above, matching/changed fingerprint controls and cancellation controls. The capability worker should add its two-session discriminator and leave the now-settled failure-membership cases alone. The coordinator owns any board/status, bundle/version/key-format and landing changes.
