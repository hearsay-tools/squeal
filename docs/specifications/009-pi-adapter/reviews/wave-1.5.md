# 009 wave 1.5 review

Row: 009-21. Scope: `02249f2355e2b45bd0452e63d2f49e6552c1c41b` only, against B1 of `wave-1.md`, spec 009 goal 4 and D3 as amended in `status.md`. Verification candidate: `c4c594821a4cb40840d3f474132250c5fd81a090` (0.1.172), as the brief requires. This closes the last re-review of wave 1; it does not review wave 2's idle-wake implementation.

## Verification output

The dispatched branch starts at `1409403e0ed5d42265694710df038ebba29d95af`, after the verification candidate. All builds, independent tests and probes below ran in the explicitly authorized detached worktree at `c4c59482`, on Node 24.21.0. No tracked code was changed. The review file alone is committed on the dispatched branch.

```text
$ git worktree add --detach /tmp/review-009-w15 c4c59482
HEAD is now at c4c59482 build: 0.1.172 bundles with the Pi idle wake and the B1 fix (spec 009 wave 2)
$ git rev-parse HEAD
c4c594821a4cb40840d3f474132250c5fd81a090
$ npm ci
added 174 packages, and audited 175 packages in 5s
found 0 vulnerabilities
$ npm run lint
> biome check .
Checked 1132 files in 427ms. No fixes applied.
$ npm run typecheck
> tsc --noEmit
$ npm run build
> tsc -p tsconfig.build.json && npm run build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts
$ git diff --exit-code -- plugins/claude-code/dist plugins/codex/dist plugins/pi/dist
(no output; exit 0)
$ git status --short
(no output)
```

`npm ci` also reports four dependency install scripts not covered by `allowScripts`. The independent reviewer gate uses Vitest directly, as required by the repository's reviewer instructions, rather than Squeal's checkpoint. Two workers cap this run's concurrency on the shared host.

```text
$ npx vitest run --maxWorkers=2
FAIL test/evals/atomic-trend.test.ts > ATOMIC.md from the committed atomic results > shows no flag and no alarm beyond the accepted ones
AssertionError: expected [ { measure: 'own-run-covers', ...(3) } ] to deeply equal []
Test Files 1 failed | 532 passed | 1 skipped (534)
Tests 1 failed | 4501 passed | 10 skipped (4512)
Duration 1340.47s
(exit 1)
```

**Proven, outside the scoped delta:** the only failed test is the known release-eval flag assertion at `test/evals/atomic-trend.test.ts:270`. It sees the committed 0.1.168 `a5-uncovered` / `own-run-covers` flag for Claude Haiku, 0/10 against 8/10 on 0.1.131 (`evals/results/ATOMIC.md:19`, committed by `bdd05f15`). `git diff --name-only 02249f23^ c4c59482 -- test/evals/atomic-trend.test.ts evals/results` prints nothing. The board already records this main-CI failure and its owner. It is not a B1 finding or a new blocker against the fix. This full-suite run is not green.

### Discriminating B1 proof

Scratch probes were kept in ignored `node_modules/.review009w15/`, outside normal test discovery. The committed real-Pi regression from `test/integration/pi-events.test.ts:170` was copied with its assertions unchanged; imports pointed to the candidate's helpers and its build setup was replaced with an explicit extension path. This lets the same regression exercise the committed bundle and an isolated counterfactual bundle. Real Pi ran only through `test/helpers/pi.ts`, with the fixture's protected home, temporary directory and agent directory, its scripted provider and its resource-isolation flags. No direct Pi command or access to the user's `~/.pi`.

For the counterfactual, a copy of `plugins/pi/dist/extension.mjs` changes exactly the input handler's `cancelWait()` back to `startRun()`. Its worker and other runtime files point to the candidate's unchanged files. This reverses B1's executable fix without changing tracked source or bundles. It is negative evidence for the old handler, not a failing result against the candidate.

```text
$ REVIEW_EXTENSION=/tmp/review-009-w15/plugins/pi/dist/extension.mjs npx vitest run --config node_modules/.review009w15/config.mjs --maxWorkers=1 --reporter=verbose -t 'a steer during'
Test Files 1 passed (1)
Tests 1 passed | 7 skipped (8)
Duration 3.96s
(exit 0)
$ REVIEW_EXTENSION=/tmp/review-009-w15/node_modules/.review009w15/mutant/extension.mjs npx vitest run --config node_modules/.review009w15/config.mjs --maxWorkers=1 --reporter=verbose -t 'a steer during'
FAIL rpc: a steer during Squeal's continuation continues the run no second time (review 009-17 B1)
AssertionError: expected { n: 4, ... } to be undefined
Test Files 1 failed (1)
Tests 1 failed | 7 skipped (8)
Duration 4.08s
(exit 1)
```

The fixed handler makes four requests: the gate, the final response, Squeal's continuation and the steering response. Restoring the old handler makes a fifth, `n: 4`, ending with a second `Squeal policy stop.blockOnKnownFailures` report. This reproduces the prior blocker through Pi's RPC steering path.

```text
$ REVIEW_EXTENSION=/tmp/review-009-w15/plugins/pi/dist/extension.mjs npx vitest run --config node_modules/.review009w15/config.mjs --maxWorkers=1 --reporter=verbose
Test Files 2 passed (2)
Tests 15 passed (15)
Duration 28.73s
(exit 0)
$ npx vitest run --config node_modules/.review009w15/config.mjs --maxWorkers=1 --reporter=verbose -t 'run flags|real queued'
steer 5 requests; 2 run starts; 2 settles; policy in requests 1 and 4
followUp 5 requests; 2 run starts; 2 settles; policy in requests 1 and 4
Test Files 2 passed | 1 skipped (3)
Tests 9 passed | 8 skipped (17)
Duration 3.61s
(exit 0)
```

The 15-test run includes the eight integration assertions against the committed bundle and seven recorded-event flag probes. The final run adds real Pi with queued `steer` and `followUp` during the first continuation, then a separate RPC prompt. Lifecycle logging observes two `before_agent_start` and two `agent_settled` events. Each genuine run continues once; the queued input adds no second policy continuation inside the first run.

After the suite and probes, the candidate's tracked tree is clean and all three bundle drift checks still exit 0. Scratch probes and the detached worktree were removed:

```text
$ git status --short
(no output)
$ git diff --exit-code -- plugins/claude-code/dist plugins/codex/dist plugins/pi/dist
(no output; exit 0)
$ git worktree remove /tmp/review-009-w15
(no output; exit 0)
```

**Unverified limits:** no new Node 22, interactive TUI or real-model run. Abort/error outcomes and new runs without `input` were independently exercised with recorded events and a real delivery-host worker stand-in, not new real-Pi abort/error experiments. Package installation and wave 2's idle wake remain outside this focused re-review.

## Verdict

PASS `c4c59482`, for `02249f23`: 0 proven blockers, 0 plausible should-fix notes, 0 nits. B1 is closed. The regression passes the candidate and fails when only its executable fix is reversed. No per-run flag leak was found across the brief's new-run, abort and error cases. The full-suite result and its limitations are recorded above; this verdict concerns the bounded B1 fix.

## Blockers

None. B1 of `wave-1.md` is resolved (proven).

## Should-fix

None in this delta.

## Nits

None.

## What fits

- **Continuation ownership (proven):** `src/harness/pi/extension.ts:169` cancels only the waiter on `input`. `before_agent_start` at line 174 calls `startRun`, which resets both `continued` and `ended` at lines 126-127. The settle handler at line 214 checks both flags before asking Stop. Real Pi confirms that neither steering nor follow-up input within a continuation reopens the guard, and that a later genuine prompt does.
- **No-input starts (proven on recorded events):** after a continued run and after a silent Stop, a `before_agent_start` with no preceding `input` permits exactly one new continuation. A third run does the same. `ended` does not suppress the next run, and repeated `agent_settled` does not duplicate `endTurn`.
- **Abort and error starts (proven on recorded events):** aborted and error outcomes ask no Stop, end once at `agent_settled`, and allow the subsequent input-free run to continue once. An abort that emits no `agent_before_settle` follows the same path. The reset happens before the awaited worker call, so its answer is not what clears the flags.
- **Other instance state (proven by source and existing tests):** `lastPrimer` deliberately survives runs; it is not a per-run flag. `shutDown` remains an instance-lifetime latch and `started` remains session registration state. The B1 delta does not change those lifetimes. `input` still cancels the idle waiter, while the later run start also cancels it; removing the reset does not remove that cancellation seam.

## Inputs for the next wave

1. Keep the amended D3 boundary: only `before_agent_start` resets the run's flags; `input` cancels the waiter without resetting them. Future input changes must retain the committed real-Pi steering regression.
2. No B1 repair row remains. This review does not reopen the previously settled wave-1 areas or accept wave 2's idle-wake work on the coordinator's behalf.
3. Real TUI/model proof and installed-package end-to-end verification remain the scheduled wave-3 work. The unrelated full-suite release-eval failure stays with its owning coordinator.
