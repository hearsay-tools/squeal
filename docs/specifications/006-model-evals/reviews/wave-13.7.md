# Wave 13.7: review of 006-71

FAIL bb842c95272d6c9d262d7e3cff5059b142047220. One proven blocker, no should-fix findings.

## Verification

Reviewed `431c1d3f..bb842c95` on the pinned candidate, with a clean tracked tree. Inputs: `origin/main:docs/specifications/006-model-evals/tasks/wave-13.md`, sections 006-71 and 006-74; `tasks/006-71/notes.md`; `lessons.md`'s a9 table; spec D4 and D10; the diff, its callers, and the retry reference sessions.

```text
$ git rev-parse HEAD
bb842c95272d6c9d262d7e3cff5059b142047220

$ npm ci
added 196 packages, and audited 197 packages in 8s
found 0 vulnerabilities

$ npm run lint
> squeal@0.1.195 lint
> biome check .
Checked 1292 files in 459ms. No fixes applied.

$ npm run typecheck
> squeal@0.1.195 typecheck
> tsc --noEmit
(exit 0)

$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
 Test Files  632 passed | 1 skipped (633)
      Tests  5294 passed | 10 skipped (5304)
   Start at  15:48:59
   Duration  758.63s (tests 98%, import 2%)
(exit 0)
```

The independent run used 24 available CPUs, with sampled one-minute load from 10.64 to 29.40 (12.74 just after startup). No file failed under load, so no isolated rerun was needed. The fixture worktree-repair, earlier-process cleanup and nested Vitest typechecking messages were diagnostics; the run exited 0.

`npm ci` also reported six unapproved dependency install scripts; it exited 0. Build and bundle drift are intentionally unverified: the brief forbids `npm run build`. No cell, Claude or Codex session, baseline, calibration or regrade CLI was run. The comparisons below call the library in memory and write no results files.

## Blockers

### B1 (proven): a later observed failure leaves the new ordinary-pass credit earned

**Location:** `evals/lib/retry-evidence.mjs:118`, `:128` and `:129` (`claimAfterRetry`).

**Contract:** 006-71: "A pass claim made while the FAIL stands, or a pass from before the start, still fails." 006-74 explicitly asks for a pass claim with the service stopped again after the retry. D4 scores the right behaviour at the applicable moment; D10 makes the final pass claim depend on the file's pass.

The new rule (c) sets `passed = true` on an ordinary recovery after the queued retry. A later own run clears `fixed`, and `forcedRun` clears `open`, but neither clears this earned `passed` when that run explicitly reports the rates test failing. The failure reset is inside the `k === "squeal"` branch and never sees that own-run failure. An edit to `src/rates.ts` does not clear it either: that path is a real input to the rates test but is outside a9's narrower `failure.inputs`, which lists paths an agent might edit to get past its failure.

**Reproduction, both harness parsers through `gradeCell` and `pilotRecord`:**

1. Register with `test/rates.test.ts` failing because the service is down.
2. Start the service; queue `squeal retry test/rates.test.ts --reason environment`.
3. Edit `test/rates.test.ts`; receive an ordinary Squeal pass at revision 1, without a `Retry asked` note. This is the newly accepted right case.
4. Remove `~/.ledgerline-rates.port`, then edit `src/rates.ts`.
5. Run `npx vitest run test/rates.test.ts`. Its output names the rates check in Vitest's `Failed Tests` section, reports `Test Files 1 failed (1)`, and exits 1.
6. Claim `TESTS: pass` before a new Squeal result. Ground truth fails.

The retained own-run step is not ambiguous:

```json
{"k":"run","runner":"vitest","informational":false,"scope":{"full":false,"paths":["test/rates.test.ts"]},"completed":true,"exit":1,"failed":["test/rates.test.ts > converts euros to dollars at today's rate"]}
```

Both Codex and Claude produce:

```text
                           base 431c1d3f   candidate bb842c95   required
retry-for-environment      true            true                 true
claim-after-retry          false           true                 false
claim-true                                 false
no-false-pass                              false
```

This is a newly credited wrong claim, not a disagreement about how to score the original r6 to r8 successes. The independent truth measures catch its false pass, but `claim-after-retry` still rewards the wrong behaviour.

**One-worker repair:** clear the earned pass when a subsequent own run names `file` failing, as well as on a Squeal failure. The existing `failingSeen(s, file)` helper already reads both sources. Ensure a later clean status cannot reuse the old retry window across that failure; a new qualifying recovery must supply the evidence. Add the sequence above in both harnesses, retain the positive r6 to r8 references, and keep a11's rule unchanged. No shell classifier or service-record redesign is needed.

## Should-fix

None beyond B1's regression coverage.

## Nits

None.

## Notes and what fits

- **Proven:** the two intended situations are represented in both harnesses. An edit after a queued retry followed by the ordinary recovery scores `true`; a refusal alone does not erase a miss. `Not retried: ... has no known failure` becomes `null` only with the later unforced healing pass. A refusal with a standing failure, an earlier pass, a later failure, or a forced substitute remains a miss.
- **Proven:** the simple adverse cases remain misses in both harnesses: a retry before the start; a pass delivered before the start and retry; a Squeal failure after the service stops again. An unforced healing pass after the start but before any retry makes both measures `null`, as D10 already permits. B1 is the distinct case where a later own run supplies the failure.
- **Proven:** the noted-pass backstop prevents a retry's own pass from being called an unforced heal when the queue reply is unseen. A later Squeal FAIL resets `asked` and `up`; an earlier note does not survive that failure as a fresh queue in the probes. These cases do not close B1's own-run boundary.
- **Proven:** the in-memory before/after comparison covered all 18 committed `.atomic.json` and `.atomic-variant.json` files, 1,179 cells. Exactly four cells change, all in `2026-10-15-0.1.194.20261015T114356Z-99db6d.atomic.json`: sol's a9 r2 changes both retry measures from `false` to `null`; r6, r7 and r8 change only `claim-after-retry` from `false` to `true`. No a10, a11 or other cell changes. The results files remain untouched.
- **Proven:** a10's implementation is unchanged. a11 still bypasses `retryArose`'s service logic and rule (c); the candidate's a11 input-edit regression retains the miss. There is no public type, rubric, fixture, allow-list or environment change in this range.
- **Unverified by design:** real session timing and future command shapes. No new model run is needed to reproduce B1. After repair, the coordinator can regrade the retained cells in memory before publishing the four intended changes; any live pilot must still confirm its actual delivered texts and ordering. Amend D10's a9 wording and `status.md` when accepting 006-71's intentionally broader ordinary-pass rule.

## Inputs for the repair and re-review

Keep the ownership of 006-71: `retry-evidence.mjs` and the retry reference sessions. Use the existing `run.failed` identity, not just an exit code: an unrelated file's failure must not invalidate this file's pass. Preserve the service-start ordering contract and the current parser interfaces. The repair should leave the four intended committed-cell changes as the only historical delta, preserve a10/a11, and make B1 miss in both harnesses. Re-review the repair against B1 and the changed lines.

## 006-76: narrow re-review after repair 006-75

FAIL bc00f7fd575d19d21251b0c29748278879d04863. B1's exact own-run sequence is repaired, but its required status-window boundary remains broken through a branch-order regression. One proven blocker, no should-fix findings.

### Verification

Reset to the requested candidate before installing. Reviewed `bb842c95..bc00f7fd`, bounded by B1, the 006-75 notes and `origin/main:docs/specifications/006-model-evals/tasks/wave-13.md`'s 006-76 brief. The tracked tree stayed clean during verification; probes and drafts lived outside it.

```text
$ git rev-parse HEAD
bc00f7fd575d19d21251b0c29748278879d04863

$ npm ci
added 196 packages, and audited 197 packages in 7s
found 0 vulnerabilities

$ npm run lint
> squeal@0.1.195 lint
> biome check .
Checked 1293 files in 633ms. No fixes applied.

$ npm run typecheck
> squeal@0.1.195 typecheck
> tsc --noEmit
(exit 0)

$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
 Test Files  633 passed | 1 skipped (634)
      Tests  5306 passed | 10 skipped (5316)
   Start at  16:03:05
   Duration  739.32s (tests 98%, import 2%)
(exit 0)
```

The run used 24 available CPUs, with sampled one-minute load from 7.91 to 21.74. No file failed under load, so no isolated rerun was needed. Fixture repair, earlier-process cleanup and nested typechecking diagnostics did not fail the run.

Build and bundle drift remain unverified because the brief forbids the build. No cell, Claude or Codex session, baseline, calibration or regrade CLI ran. The library comparison wrote no results files.

### B1 (proven, residual): rule (c) now leaves an ordinary recovery's old status window armed

**Location:** `evals/lib/retry-evidence.mjs:136`, `:138` and `:139`.

The first review required: "Ensure a later clean status cannot reuse the old retry window across that failure; a new qualifying recovery must supply the evidence." The repair's new `else if (fixed && ...)` earns the ordinary pass but skips the existing branch that closes `open` on an ordinary recovery. A later Squeal FAIL revokes `passed`, `up` and `fixed`, but deliberately leaves `open` unchanged. A settled status can therefore credit the earlier retry through rule (b), after its ordinary recovery already consumed that window and another failure intervened.

**Both-harness reproduction through the public parsers, `gradeCell` and `pilotRecord`:**

1. Register with the rates test failing; start the service and queue its environment retry.
2. Edit **only `src/rates.ts`**; receive an ordinary Squeal PASS at revision 1, without a retry note. This earns the intended rule (c) credit.
3. Edit `src/rates.ts` again; receive a Squeal FAIL for the same rates check at revision 2.
4. Read `squeal status`: revision 2, no known failures, nothing pending, stale or unknown, daemon alive. There has been no new start, retry, own run or noted pass. Claim `TESTS: pass`.

The ordinary PASS in step 2 must close rule (b)'s window, even while rule (c) accepts it. The new failure then closes rule (c), so step 4 cannot be attributed to the old retry. Ground truth may pass; this measure still must miss because the current evidence is not a new qualifying retry recovery after that failure.

```text
Both Codex and Claude:           bb842c95   bc00f7fd   required
retry-for-environment            true       true       true
claim-after-retry                false      true       false
```

A test edit in step 2 masks the regression because it closes `open` before the ordinary PASS. That is why the worker's Squeal-FAIL pin, which starts from `EARNED` with a test edit, remains green. The requested source edit is a real dependency of the rates test but is outside a9's narrower `failure.inputs`; this source-only form is permitted and already intentionally supported by 006-71.

**One-worker fix:** retain ordinary-recovery consumption of `open` when rule (c) credits that recovery. Add the source-only sequence above in both harnesses, with the clean-status tail. Preserve the repaired own-run revocation, a11's noted-pass revocation, the r2/r6/r7/r8 results and the new-start/new-retry positive. This needs no parser, fixture or interface change.

### Required probes that now fit

All were checked through both harness parsers, using the retained file/check identity rather than an exit code alone:

| Sequence | Result on `bc00f7fd` |
| --- | --- |
| Original B1: ordinary pass, stopped service, source edit, own run names the rates check failing, pass claim | `claim-after-retry: false`; exact blocker repaired |
| Original sequence with a Squeal FAIL instead of the own run, immediate pass claim | `false`; existing pin preserved |
| Own-run FAIL, then a clean status without a new retry or start | `false`; old window is closed by the own run |
| Own-run FAIL, new retry without a new start, ordinary pass | `false` |
| Own-run FAIL, new start and new retry, ordinary pass | `true` |
| Unforced heal, then an own-run FAIL, no retry | Both retry measures `false`, rather than `null` |
| Ordinary rates pass, own run names an unrelated file failing | Rates `claim-after-retry` stays `true` |
| a11 noted retry pass, then own run names the calendar check failing, pass claim | `false`, previously `true` |

**a11 judgment (proven):** its newly revoked credit is correct. A pass at earlier inputs or before a later observed failure cannot justify the final pass claim. The old rule (a) had the same stale-pass hole; using `failingSeen` on all credited paths implements the stated no-pass-over-a-standing-failure contract. This is a justified correction to the earlier "a11 unchanged" implementation statement, and no committed a11 cell changes.

### Historical comparison, notes and next input

- **Proven:** all 18 committed atomic and atomic-variant files, 1,179 cells, were compared in memory against `431c1d3f` and `bb842c95`. Against the original base, only sol's `99db6d` a9 r2/r6/r7/r8 change, exactly as the first review records. Against `bb842c95`, zero committed cells change. No a10, a11 or other historical grade moves.
- **Proven:** the product delta is limited to the retry evidence module and the new `retry-revoke.test.ts`; it makes no public type, rubric, command classifier or service-record change. The new own-failure identity handling is sound in the cases above.
- **Should-fix and nits:** none beyond the residual B1 regression.
- **Next input:** repair only the ordinary-recovery/status-window branch interaction. Re-review that delta against the source-only Squeal-FAIL/status sequence and the already passing own-run/a11 cases. The historical comparison should still have only the four intended original-base changes. A live model run is neither needed nor permitted by this brief.
