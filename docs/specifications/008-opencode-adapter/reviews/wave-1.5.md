# 008 wave 1.5 review

Verdict: **PASS 60a2ac8c** for the focused re-review. **0 proven blockers**, 2 should-fix notes (1 proven, 1 plausible), no nits. Range: `4edc4dd8~1..60a2ac8c`, the seven 008-17 commits. Reviewed 2026-10-15 (Europe/Warsaw) against `reviews/wave-1.md` and the 008-17/008-18 briefs. This closes the named repair scenarios; it is not a green full-suite or release verdict.

## Verification output

The starting checkout was `de783b10`, one board-only commit after the candidate. This is a **proven checkout mismatch**, not a product finding. `git diff --stat 60a2ac8c..de783b10` names only `docs/board.md`. I detached at the exact candidate before installing dependencies and checking it, then restored the worker branch to commit this file alone.

```text
$ git rev-parse HEAD
60a2ac8c14a9dd7c0d247f62e293a73f67d1d941
$ git status --short
(no output)

$ npm ci
added 196 packages, and audited 197 packages in 13s
found 0 vulnerabilities
exit 0

$ npm run lint
> squeal@0.1.178 lint
> biome check .
Checked 1190 files in 2s. No fixes applied.
exit 0

$ npm run typecheck
> squeal@0.1.178 typecheck
> tsc --noEmit
exit 0

$ npm run build
> squeal@0.1.178 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.178 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
exit 0

$ git diff --stat
 plugins/opencode/dist/hooks/after.mjs    | 504 ...
 plugins/opencode/dist/hooks/before.mjs   | 652 ...
 plugins/opencode/dist/hooks/end-turn.mjs | 470 ...
 plugins/opencode/dist/hooks/end.mjs      | 470 ...
 plugins/opencode/dist/hooks/ping.mjs     | 108 ...
 plugins/opencode/dist/hooks/prompt.mjs   | 506 ...
 plugins/opencode/dist/hooks/register.mjs | 501 ...
 plugins/opencode/dist/hooks/stop.mjs     | 504 ...
 plugins/opencode/dist/hooks/wait.mjs     | 504 ...
 plugins/opencode/dist/plugin.mjs         | 113 ...
 10 files changed, 2205 insertions(+), 2127 deletions(-)

$ npx vitest run test/harness/opencode/package.test.ts --maxWorkers=1
Test Files  1 passed (1)
     Tests  5 passed (5)
  Duration  2.98s
exit 0
```

**Proven integration work remains.** The fresh-build equality check above ran on regenerated bundles, so it proves B3's extra-file repair and equality after rebuilding, not equality of the candidate's committed bytes. B3's retired `hooks/opencode.mjs` is absent both before and after the build; `d1a3e903` is an ancestor of the candidate. The ten modified bundles contain the subsequent source repairs. The 008-17 brief explicitly forbids committing dist, raising the package version or the key format. These are the coordinator's remaining integration checks, not a newly dispatched worker omission. I restored only those generated changes, confirmed a clean candidate, and ran the focused and full checks against its committed state.

```text
$ git restore -- plugins/opencode/dist
$ git status --short
(no output)

$ npx vitest run test/harness/opencode/idle.test.ts test/harness/opencode/lifecycle.test.ts test/harness/opencode/sessions.test.ts test/harness/opencode/turn.test.ts test/harness/opencode-abort.test.ts test/cli/update-opencode.test.ts test/cli/update-pi.test.ts test/cli/update.test.ts test/cli/launcher.test.ts --maxWorkers=2
FAIL test/harness/opencode/idle.test.ts > only the turn that went idle is continued (review 008-16 B2) > a user message while Stop is pending starts no continuation; the news rides on the next tool result
AssertionError: expected [ 'register', 'prompt', 'stop' ] to deeply equal [ 'register', 'stop', 'prompt' ]
❯ test/harness/opencode/idle.test.ts:141:21
Test Files  1 failed | 8 passed (9)
     Tests  1 failed | 77 passed (78)
  Duration  92.91s
exit 1
```

The real OpenCode abort file ran **without skips and passed**. It calls `squealOpenCode`, which calls `runOpenCode`: isolated OpenCode 1.18.35, a scripted provider, the freshly built plugin and bridge entries, with a controlled slow Stop. No real OpenCode probe used the agent's home. The failed order assertion is S1 below; its preceding zero-continuation assertion passed. Lint/typecheck and these focused results are exact-candidate evidence. A supplemental single-worker diagnostic passed all eight idle tests plus two temporary decision probes (10/10, 15.74 s), but its tree contained an untracked throwaway probe, so that suite result is **unverified as clean-candidate verification**. The file was removed before the full run. The public-hook probes below ran from an external temporary script against a clean candidate, and the shared-store decision probe was repeated in an external Vitest root with the candidate clean (1/1, 1.67 s).

```text
$ npx vitest run --maxWorkers=4
RUN v5.0.3
[partial output]
❯ test/keys/key-format.test.ts (29 tests | 3 failed) 818ms
  × KEY_FORMAT_VERSION > is bumped whenever the guarded sources change
  × an adapter-only bump > of src/runners/vitest/version.ts keeps the global pin
  × an adapter-only bump > of src/runners/node-test/version.ts keeps the global pin
[fixture gitdir repair notice]
[no final summary; interrupted by the reviewer after just over ten minutes]
exit 130
```

**Independent full-suite completion is unverified.** This was one full attempt, with four workers to limit contention, on the clean candidate with its committed bundles restored. It did not finish within the ten-minute review attempt, so I interrupted it. There is no final file/test total or full-suite pass claim. The runner and its remaining workers disappeared, and no process remained under this run's test-build cache. Host load samples during the review ranged from about 46 to 114; a sampled worker waited in Linux `D` state on `xfs_buf_lock`. Worker pids subsequently changed, so permanent disk deadlock is **unverified**. Host contention causing the slow run is **plausible**, not a product finding. The partial log reported three key-format assertions; it does not establish that these were the only failures in the whole suite. No second full proof was run.


Supplemental Squeal checkpoint, attempted on the clean candidate. It includes inherited results and does not replace the independent reviewer run:

```text
$ node --disable-warning=ExperimentalWarning /home/agent/.codex/plugins/cache/hearsay/squeal/0.1.168/dist/cli/squeal.mjs run --all --wait
Checkpoint f0bfcd42-646a-4c65-a0fa-e07c4a0ab4b3 has no verdict: 70 test files without a current result at revision 7 (70 stale)
Checkpoint f0bfcd42-646a-4c65-a0fa-e07c4a0ab4b3 started at revision 7: 0 test files to run, 496 already current
Revision: 7
Known failures: 4 (4 tests)
  FAIL test/harness/opencode/package.test.ts > the OpenCode package > has the bundles exactly as `npm run build:plugin` produces them
       hooks/after.mjs differs from the build
  FAIL test/keys/key-format.test.ts > KEY_FORMAT_VERSION > is bumped whenever the guarded sources change
  FAIL test/keys/key-format.test.ts > an adapter-only bump > of src/runners/node-test/version.ts keeps the global pin
  FAIL test/keys/key-format.test.ts > an adapter-only bump > of src/runners/vitest/version.ts keeps the global pin
Affected checks: 4630 passed (4134 tests, 496 test files loaded), 0 running, 0 queued, 7 skipped (7 tests), 663 stale (593 tests, 70 test files loaded)
Full-suite checkpoint: completed at revision 7
exit 3
```

A completed checkpoint with no verdict is **unverified**, not a pass. The guard prints the current key-source hash `d02fa1dd38d8b32f4020b79318df1b0bdfdaa855c63ac7d2453cdfd2381abbd0`, versus version 10's pin `f2cff02340f80b4b159a845e7825a4cfe000a53272ac92c1b465db79771f8821`. The range changes the guarded `src/harness/opencode/build.ts`, including its comment; the guard counts comments too. Reconcile the pin with the integration's final sources and regenerate bundles before independent landing verification. This review did not change either.

`npm ci` printed the deprecated `node-domexception` and allowScripts notices and completed successfully. All throwaway probes and generated mutations were removed from the project before committing this report. No product, board, status or test file is in the report commit.

## Re-review of the named findings

Every original scenario is **proven repaired in the stated scope**. The portability of held news across a new plugin instance is separately limited below.

| Prior finding | Candidate evidence and judgment |
| --- | --- |
| B1: idle and deletion spend successive full budgets | **Proven repaired.** Re-ran the public hooks with a known root, Stop news delayed 1,200 ms, then a never-resolving `promptAsync`: idle returns in **2,006 ms**, and its one API request's signal is aborted. With registered `stopWaitMs: 0` and a 1,000 ms Stop, idle returns in **511 ms** and submits no API request. A deleted child's ancestry lookup takes 800 ms, followed by a stalled `end`: deletion returns in **2,010 ms**, with one correctly attributed `end`. These small scheduling margins do not add a fresh API/bridge budget. `hooks.ts:123` creates the configured absolute deadline, and `turns.ts:136` uses only its remainder. Registration and subsequent prompts return policy `stop.waitMs`; the changed real bridge test of both answers passes. The pinned SDK forwards `signal` into its HTTP client. Cancelling an already server-accepted message is **unverified**, not something this signal probe proves. |
| B2: abort/input overtakes Stop yet gets a continuation | **Proven repaired for the named overlaps.** An 800 ms Stop, aborted at 200 ms through the public event hook, makes **zero `promptAsync` calls**. The next message has `[next, SQUEAL review news]`, the following one `[again]`: no lost or duplicate text within that instance. The candidate's input-overlap test asserts no continuation too; its separate process-log ordering flaked, as recorded above. The real `opencode-abort.test.ts` scenario passes: first reply idle with a 1,200 ms controlled Stop; a second user message reaches the scripted provider, then the isolated abort API is called; after Stop plus four seconds of quiet there are **exactly two model requests**, neither headed by `SQUEAL late report`. Thus the old `[first, second, late report, late report]` behavior is absent in the real host. Epoch checks immediately before submission invalidate the old decision. A fresh user turn resets abort state, and the one-continuation guard remains. |
| B3: retired monolithic bridge remains committed | **Proven repaired for the extra file.** No `hooks/opencode.mjs` remains. Fresh build plus the complete package test passes **5/5** with equal file names and bytes. The candidate's other committed bundle bytes need coordinator regeneration, as disclosed above; the fresh-build result does not hide that drift. |
| S1: disposal during identity lookup registers afterward | **Proven repaired.** Re-ran lookup delayed 800 ms, disposal at 200 ms, then awaited the original message: the bridge log is **`[]`**, rather than `[register]`. `identify` checks disposal after resolution and all awaiting hook callers use it. The delayed-registration disposal regression still passes. |
| S2: cycle/depth exhaustion invents a root | **Proven repaired.** Independent `a -> b -> a` and unbounded-parent stand-ins both return **`null`**. The candidate also passes its 30-node and ordinary root/child tests. The loop returns an identity only after actually observing a parentless node; exhausting its walk leaves no guessed consumer. |
| S3: format-3 launcher survives an OpenCode update | **Proven repaired.** The migration test starts from the actual 0.1.177 format-3 fixture, with an old Pi 0.1.175 package still on disk and only OpenCode eligible to update. `update` reports OpenCode 0.1.178, copies **format 3 to 4**, and the terminal launcher runs **0.1.178**, rather than old Pi. This test and the changed Pi/general update and launcher suites pass. All four launchers are byte-identical, SHA-256 `ce602c0c2955c2a6bc41e53d2645d28bbb024f9396371da64bed826aee90b56a`. |

The public-hook script's decisive output was:

```text
{"probe":"B1 slow-stop stalled-API","elapsedMs":2006,"prompts":1,"aborted":[true]}
{"probe":"B1 configured zero","elapsedMs":511,"prompts":0}
{"probe":"B1 delete lookup then stalled end","elapsedMs":2010,"calls":["end"]}
{"probe":"B2 abort-overlap","prompts":0,"next":["next","SQUEAL review news"],"again":["again"]}
{"probe":"S1 lookup-dispose","calls":[]}
{"probe":"S2 cycle-depth","cycle":null,"depth":null}
```

## The two decisions

**A second idle with no intervening message ends no turn: accept within the tested lifecycle.** This is **proven** by the duplicate-idle regression and the real abort scenario. A user or Squeal message opens a turn; idle closes that marker before awaiting Stop, so a duplicate event cannot independently decide or continue it. The abort path performs `endTurn` once and arms one waiter; a new message opens a fresh turn and may be continued again. This fits D3's one continuation and prevents the extra idle emitted by OpenCode 1.18.35 after abort from resetting the once guard. Do not extend this judgment to an untested upstream path that starts model work without `chat.message`.

**Cancelled news in plugin memory: accept only as live-instance carry-forward, with a durability note.** Same-instance delivery on the next message or tool result is **proven**, once. It does not leave that news undelivered in the shared store. Stop has already advanced the delivery view before `say` holds the text. The external shared-store probe registers at PASS, delivers a failure, produces a recovery, takes that recovery through the real shared Stop, aborts before submitting it, and constructs a new `turns` instance:

```text
{"probe":"cancelled-recovery","prompts":0,"sharedPrompt":null,"freshPlugin":null,"oldPluginRecovery":true}
```

That demonstrates the **proven local storage limitation**: only the old instance has `FAIL -> PASS`; a shared prompt has no remaining delta, and a fresh plugin cannot `take` the held text. It does not demonstrate an actual OpenCode restart/Continue losing an actionable state: a restarted instance re-registers and may restate current state in its header. That end-to-end reach is **unverified**, hence the broader recovery concern is **plausible and nonblocking**, S2 below. The decision is not evidence of durable session storage under Goal 4 or of retained undelivered store news across process lifetime.

## Blockers

None in this focused re-review. The original deadline, abort-overlap, retired-file and three note scenarios are closed as above. No independent full-suite pass is claimed.

## Should-fix

### S1. Proven: the new input-overlap regression orders independently scheduled bridge starts

`test/harness/opencode/idle.test.ts:141`, `test/harness/opencode/stub.ts:119`.

The first independent focused run got `[register, prompt, stop]` where the test required `[register, stop, prompt]`. The hook had already started its Stop call, but each stand-in process records only after Node starts and reads stdin; two independent children need not reach that line in spawn order. The no-continuation assertion immediately before it passed. A single-worker diagnostic subsequently passed the same test. This is **proven test fragility**, not a proven product continuation break.

Fix, one test-only row: wait for a Stop-start barrier before issuing the user message, then release the Stop answer only after the message has completed. Assert report delivery and no stale continuation. Do not use a 200 ms sleep or process-log order as evidence of which hook decision is live. The real abort test already has a Stop-start marker; use the same principle here.

### S2. Plausible: memory-held cancellation news may not survive a process-ending step

`src/harness/opencode/turns.ts:137`, `:151`, `:194`, `:222`; `src/harness/opencode/hooks.ts:77`.

Goal 4 says news under `opencode run` is “stored in the session and read at its next resume”; the B2 repair asks that cancelled news stay available for the next legitimate prompt. The new array is process-local, and the real shared Stop already consumed the delta. The local probe above proves that a fresh plugin has neither its held report nor another shared-store delta. Whether re-registration's current-state header is sufficient in an actual process-ending OpenCode step has **not been verified** here. Do not characterize this as observed real-harness loss or a blocker.

Fix/proof, one adapter proof row: run a real abort/refused-continuation case through `runOpenCode`, end the process before the next boundary, and resume the same session in a new process. Include a previously delivered failure and its cancelled recovery, rather than only canned news. Assert the resumed model learns the resulting state. If exact report retention is required, preserve it on a durable adapter/session surface before acknowledging it; do not restore an old consumer view over newer concurrent delivery. Otherwise have the coordinator explicitly record the live-instance scope and the re-registration fallback in D3/D5 and the amendment log. This review changes neither the spec nor shared core contracts.

## Nits

None.

## What fits

- **Proven:** the named B1/B2 public-hook scenarios and the real OpenCode abort overlap hold; S1/S2 identity/lifecycle repairs hold; S3's actual previous-launcher migration holds.
- **Proven:** the configured idle bound now covers lookup, Stop and API submission in one budget. Deletion likewise uses one event deadline. Background waiter lifetime remains independent.
- **Proven:** the repeated-idle guard retains one continuation for Squeal's own message and reopens on fresh user input. Cancelled reports ride once on a same-instance prompt or tool result.
- **Proven after regeneration:** fresh package equality, import restrictions and launcher parity pass; the obsolete bridge file is gone.
- **Proven by the delta:** no shared harness, delivery, daemon or store implementation changed. New policy budget metadata is confined to the OpenCode bridge protocol. The source and README now name per-kind entries.
- **Unverified:** a green independent full suite, actual restart/Continue behavior for memory-held reports, and server-side late acceptance after a timed-out API request. This bounded re-review does not reopen wave 0's settled findings or make a calm-load latency judgment.

## Inputs for the next wave

- This is the final focused round on `reviews/wave-1.md`; do not redispatch its closed original probes. Keep the consumer identity, epoch check, same-instance carry-forward, configured deadline and format-4 migration contracts.
- Coordinator integration still regenerates the ten OpenCode bundles, reconciles the final key-format pin, and observes the repository's patch-version rule. Independently verify package parity on that clean integrated commit and obtain full-suite evidence before landing. A passing test against locally regenerated bytes does not certify the committed package.
- Remove the input-overlap regression's process-start ordering assumption with a barrier. Treat it as test repair, not a reason to revert the epoch guard.
- The installed-package proof and dogfooding rows must establish resume behavior for held recovery news. Same-instance unit coverage and the two-request real abort test do not prove durability. Amend the spec if the intended fallback is re-registration's current-state header.
