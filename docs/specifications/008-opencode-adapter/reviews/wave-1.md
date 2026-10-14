# 008 wave 1 review

Verdict: **FAIL f0c45b2f**. **3 proven blockers**, 3 should-fix notes (1 proven, 2 plausible), no nits. Range: `47a3e4ad~1..f0c45b2f`, rows 008-12 to 008-14 and the 0.1.178 bundle integration. Reviewed 2026-10-14 against D1 to D9 as amended, and the final re-review of wave-0 B1 to B4, S1, S2 and N1.

## Verification output

The starting checkout was `9971e323`, one documentation-only commit after the candidate. This is a **proven checkout mismatch**, not a product finding: `git diff --stat f0c45b2f..9971e323` names only the board and wave-1 brief. I detached at the exact candidate for checks and probes, confirmed a clean tree before and after them, then restored the worker branch to commit this report alone. The first installation started before detaching; the lockfile is identical, and I repeated `npm ci` entirely at the candidate before the focused run. The blocker and re-review probes, static checks and independent tests below are from `f0c45b2f`; the supplemental checkpoint is labelled separately.

```text
$ git rev-parse HEAD
f0c45b2f18570d2136cdc46869f2351c8ac3e9ea

$ npm ci
added 196 packages, and audited 197 packages in 2m
found 0 vulnerabilities
exit 0

$ npm run lint
> squeal@0.1.178 lint
> biome check .
Checked 1188 files in 1531ms. No fixes applied.
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

$ git status --short
(no output)
$ git diff --exit-code
(no output, exit 0)

$ npx vitest run
RUN v5.0.3
[partial output]
❯ test/harness/opencode/package.test.ts (5 tests | 1 failed) 825ms
  × has the bundles exactly as `npm run build:plugin` produces them 12ms
[no final summary; interrupted by the reviewer, exit 130]

$ npx vitest run test/harness/opencode test/cli/opencode-status.test.ts test/cli/opencode-status-wait.test.ts test/cli/install-sh-opencode.test.ts test/cli/install-sh-opencode-update.test.ts test/cli/update-opencode.test.ts test/cli/launcher.test.ts --maxWorkers=2
RUN v5.0.3
FAIL test/harness/opencode/package.test.ts > the OpenCode package > has the bundles exactly as `npm run build:plugin` produces them
AssertionError: expected [ 'cli/front-desk.mjs', …(13) ] to deeply equal [ 'cli/front-desk.mjs', …(12) ]
+ "hooks/opencode.mjs",
❯ expectSameFiles test/harness/bundle-helpers.ts:119:25
❯ test/harness/opencode/package.test.ts:53:5

Test Files  1 failed | 19 passed (20)
     Tests  1 failed | 166 passed (167)
  Start at  23:03:36
  Duration  85.21s (tests 95%, transform 4%, import 2%)
exit 1
```

**Independent full-suite completion is unverified.** The independent attempt lasted over 11 minutes. At the end only one worker remained, in Linux uninterruptible `D` state with wait channel `xfs_buf_lock`; its parent awaited it and the log had not changed for several minutes. I interrupted the runner. It exited 130 and its remaining worker disappeared. There is no final suite total or full-suite pass claim. This inability to finish is not a finding against the wave. I did not run a second full proof.

The partial log reported at least **22 failed tests in 19 files**. The focused run independently isolated this wave's deterministic failure, B3. The other reported failures were outside this review's changed test files: `scheduler/rekeyed-moves`, `keys/packages`, `cli/setup/{init-flags,candidates,plan,gates-allow-list}`, `store/open`, `runners/vitest/structural-resolution`, `runners/{node-test,pytest}/fixtures`, `harness/pi/run`, `daemon/open`, `e2e/pi`, `integration/node-test-packages`, `scheduler/checkpoint-tracker`, and `watcher/{parcel-root,linked-exclusions,watch-count}`. Host samples reached load **178.21** on 24 CPUs. Many failures were timeout/performance assertions; load as their cause is **plausible**, not independently proven here. Their code is outside this wave and they are not additional wave findings. The coordinator still needs an independent green full suite before landing.

`npm ci` printed the deprecated `node-domexception` warning, funding notice and six install scripts outside `allowScripts`; it completed successfully. Vitest also printed fixture gitdir repair, one earlier-process cleanup and experimental type-testing notices. The focused selection includes the real `opencode-fixture`, `opencode-hooks` and `opencode-wake` tests: they ran without skips through `runOpenCode`. The reviewer's independent run, rather than a Squeal checkpoint, is the repository's review gate.

Throwaway probes used the candidate's public plugin/bridge interfaces with bounded stand-ins, plus one real OpenCode abort overlap through `runOpenCode`. Their decisive outputs are preserved with the findings below. Probe projects and children were cleaned up; no probe ran real OpenCode against the agent's home. Calm-load latency is **unverified** and explicitly left to the coordinator by the 008-16 brief; this review makes no latency ruling.

Supplemental repository checkpoint, run after restoring the documentation branch while this report was untracked. This is **unverified as independent candidate evidence** because its checkout is `9971e323` plus the report and it includes inherited results. It satisfies the requested Squeal checkpoint attempt; it does not replace the independent reviewer run above. The first request exited 3 when a report edit advanced its revision. With the file held steady, the second completed and exited 1:

```text
$ node --disable-warning=ExperimentalWarning "/home/agent/.codex/plugins/cache/hearsay/squeal/0.1.168/dist/cli/squeal.mjs" run --all --wait
Checkpoint 351da8f1-8030-4ba8-84ae-68940998acde completed at revision 5: 1 known failure: 1 test; 563 test files, 361 already current, 202 run by the baseline checkpoint 9bd87ccd-1298-4ba1-83f9-e1d7742bbb19 it joined
Revision: 5
Known failures: 1 (1 test)
  FAIL test/harness/opencode/package.test.ts > the OpenCode package > has the bundles exactly as `npm run build:plugin` produces them
Affected checks: 5275 passed (4712 tests, 563 test files loaded), 0 running, 0 queued, 10 skipped (10 tests)
Full-suite checkpoint: completed at revision 5
exit 1
```

## Re-review of wave 0

The original four blocker scenarios are **proven repaired**. This is the last round on them; the new idle behavior is reviewed below, rather than reopening the settled prompt-path checks.

| Prior finding | Candidate result and independently re-run probe |
| --- | --- |
| B1: lookup and registration budgets in series | **Proven repaired for the original prompt case.** An unseen child's never-resolving lookup plus a stalled registration entry returns in **2,002 ms**, adds no part, and sends **zero bridge requests**. `hooks.ts:148` supplies one deadline through `sessions.ts` and `ask`. The new idle path and deletion path still have the related budget gaps described in this review's B1. |
| B2: descendant survives leader exit | **Proven repaired.** Re-ran the leader-exits-first, inherited-stdout probe through `callBridge`, under Node and Bun. Silence returned in **237 ms / 182 ms** and the recorded descendant was **gone** in both. `bridge-client.ts` kills the group at leader exit and bounds output draining. This check runs Bun directly on the bridge client, not a real OpenCode process. |
| B3: null-header registration cached | **Proven repaired.** Two unsuccessful answers produce `[register, register]`, with no disposal `end`. A cold answer followed by successful registration and one more message produces `[register, register, prompt, end]`. The protocol's explicit `registered` field and `hooks.ts:64` agree; the shipped bridge returns false when no consumer was written. |
| B4: unavailable parent guessed as root | **Proven repaired for error/timeout and recovery.** A failed resumed-child lookup makes no bridge request and adds no part. Recovery produces only `{sessionId: "root", agentId: "child"}`, with no `(child, main)` registration. Unknown lookup results remain retryable. Ancestry cycles/depth exhaustion remain the nonblocking note S2 below. |
| S1: disposal misses registration in flight | **Proven repaired for the original interleaving.** Registration delayed 800 ms, disposal at 200 ms: disposal waits **807 ms**, emits an `end` naming the root consumer, and the original message gets no added part. Disposal during the earlier identity lookup is still the note S1 below. |
| S2: added part need not sort last | **Proven repaired.** With a valid last-part id dated 60 seconds ahead, `partAfter` returns that id plus `z`, which sorts after it; invalid/missing ids return null. The candidate also tests the public message hook's ordering and no-add fallback. |
| N1: shell environment changes after disposal | **Proven repaired.** Calling `shell.env` after disposal leaves its output `{}` and performs no identity/bridge work. |

## Blockers

### B1. Proven: idle adds a fresh API budget after spending its hook budget

`src/harness/opencode/turns.ts:89`, `:91`, `:135`, `:136`; `src/harness/opencode/hooks.ts:13`, `:122`, `:134`.

Goal 6 and D4 bound the whole idle hook to `stop.waitMs + 500 ms`, at most 2,000 ms. `idle` gives the identity lookup and Stop bridge one absolute deadline, but then `say` awaits `client.session.promptAsync` with a fresh **2,000 ms**. It does not take the remaining hook budget. `IDLE_DEADLINE_MS` also always uses the maximum rather than the configured wait plus 500 ms.

The public-hook probe used a known root, a Stop bridge returning news after 1,200 ms, and a never-resolving `promptAsync`. `session.idle` returned after **3,318 ms**, above even the maximum idle budget. This is sequential waiting, not merely a loaded-host scheduling margin. A real shared Stop can spend up to 1,500 ms waiting for pending tests before returning news. An unavailable API then adds another 2 s. The API request is also not cancelled at expiry, so a late accepted continuation is not ruled out; that late acceptance is **plausible**, not independently observed.

The related deletion path still creates a new deadline for `end` after resolving a child's root. A resumed child's root lookup delayed 800 ms plus a stalled `end` returned after **2,809 ms**, versus the adapter's stated 2 s event bound. The original `chat.message` B1 is fixed; these are the remaining/new paths with the same cause.

Fix, one worker in the OpenCode adapter: carry one absolute deadline through lookup, bridge and `promptAsync`, and use its remaining time for each awaited operation. Cancel or invalidate work at expiry and suppress a late continuation. Supply idle's configured `min(stop.waitMs, 1500) + 500 ms` bound rather than always the maximum, without a second full bridge budget to fetch it. Reuse the deletion deadline for its `end`. Add public-hook tests with a slow successful bridge followed by a stalled API, and with delayed ancestry plus a stalled delete bridge; assert silence and no late continuation after the bound. The independent D5 waiter retains its own lifetime.

### B2. Proven: an abort arriving during the Stop bridge still starts a continuation

`src/harness/opencode/turns.ts:125`, `:131`, `:135`, `:136`.

D3 says an idle preceded by `MessageAbortedError` ends the turn with no continuation; 008-12 explicitly requires “none after an abort”. `idle` checks `turn.aborted` only before awaiting Stop. Its continuation branch checks `stopped` after the await, but does not re-check abort or whether this is still the same turn.

The public-hook probe starts `session.idle` with Stop delayed 800 ms. At 200 ms it delivers `session.error` with `MessageAbortedError`. Stop then answers with news. The client records **one `promptAsync` after the abort**. This is an allowed event overlap: upstream [OpenCode 1.18.35 `plugin/index.ts:255`](https://github.com/sst/opencode/blob/v1.18.35/packages/opencode/src/plugin/index.ts#L255) invokes event callbacks with `void`, so an event callback's pending promise does not serialize later events. The local failure is proven. A second probe used real OpenCode 1.18.35 through `runOpenCode`, the candidate `squealHooks`, a controlled Stop bridge delayed 1,600 ms and the scripted provider. The first reply went idle; a new user message started the second model request while the old idle decision waited. The probe then called the isolated server's abort API, which returned `200 true` and emitted `MessageAbortedError` 997 ms after the first idle. Despite this, the next two model requests had last messages `SQUEAL late report`. The recorded request sequence was `[first + registration, second input, SQUEAL late report, SQUEAL late report]`. This establishes the overlap in the real host and also shows that stale idle decisions can evade the once guard. The bridge supplied controlled news; this was not a real daemon or real-model dogfood.

Fix, one worker in `turns.ts` and its public-hook tests: invalidate pending idle work on abort and user input, and re-check that the same live, non-aborted turn owns the report immediately before submitting it. Give a fresh user turn its own abort state. Test abort and user input while Stop is pending, alongside the existing abort-before-idle and one-continuation cases. Preserve undelivered evidence for the next legitimate prompt when cancelling a continuation.

### B3. Proven: the retired monolithic bridge remains in the committed package

`plugins/opencode/dist/hooks/opencode.mjs:1`; `test/harness/opencode/package.test.ts:53`.

D1/D6 require committed dist to match the build, and 008-12 requires the full suite green. Commit `c01a1403` removes `src/harness/opencode/entries/hooks/opencode.ts` in favor of per-kind entries. The bundle commit adds the new files but leaves the retired `opencode.mjs` tracked. Rebuilding in place does not delete obsolete entries, which explains why the clean `npm run build` check alone misses this.

The independent suite fails the existing test “has the bundles exactly as `npm run build:plugin` produces them”. A separate fresh-directory `buildOpencodeDist` probe proves the precise difference:

```text
actual hooks:   after, before, end-turn, end, opencode, ping, prompt, register, stop, wait
expected hooks: after, before, end-turn, end,           ping, prompt, register, stop, wait
extra: hooks/opencode.mjs
```

This is a deterministic package/verification break, independent of the host-load failures. The active plugin points to the new entries; no runtime invocation of the stale bundle was observed.

Fix, one bundle/integration row: remove the obsolete committed `plugins/opencode/dist/hooks/opencode.mjs`, regenerate the OpenCode package from a fresh output directory and verify the package equality test. A shared build-system cleanup redesign is unnecessary for this repair.

## Should-fix

### S1. Plausible: disposal during lookup can still register afterward

`src/harness/opencode/hooks.ts:147`, `:149`, `:165`, `:176`, `:230`.

Disposal now waits for entries already in `registering`, which fixes wave-0 S1's exact probe. It does not include a message awaiting `consumerOf`. The message checks `disposed` before that await, but starts `register` afterward without checking it again.

A public-hook probe delays `session.get` by 800 ms, starts the first message, calls disposal at 200 ms, then awaits the original message. Its bridge request log is **`[register]` with no `end`**. Disposal had already seen no registrations and returned. The registration later enters `registered` even though the instance is disposed. An actual OpenCode teardown overlapping that lookup remains **plausible**; the locally proven interleaving is a note, not a new blocker or an observed real-session leak.

Fix in the same lifecycle row: check `disposed` after identity resolution before starting new work, or track entire in-flight message operations within disposal's existing deadline. Extend the delayed-register regression with delayed-lookup/dispose. Keep the bridge's original registration deadline and leave no late registration to await process death.

### S2. Plausible: ancestry cycles and depth exhaustion still invent a root

`src/harness/opencode/sessions.ts:51`, `:57`.

Wave-0 B4's repair asked for cycles/depth exhaustion to remain unresolved too. Errors now do, but the loop still returns its last node without proving it has no parent. A bounded stand-in returning `a -> b -> a` makes `consumerOf("a")` return **`{sessionId: "a"}`**. A chain beyond eight hops similarly uses an intermediate session as root. Whether OpenCode can produce either input here is **unverified**, so this does not reopen the closed unavailable-lookup blocker.

Fix: track visited ids and return null on a cycle or exhaustion unless a root was observed. Add a cycle and a long-chain test; leave those identities unset and retryable.

### S3. Proven: adding OpenCode search did not raise the launcher's migration format

`plugins/opencode/bin/squeal-launcher:2` and its three identical copies; `src/cli/update.ts:206`.

The previous launcher and the candidate both say **format 3**, although the candidate adds OpenCode package search. `squeal update` copies a launcher only when the format increases; `install.sh --opencode` does not copy the terminal launcher. A normal fresh `install.sh` install does copy it, so this does not invalidate that path.

A `updateCommand` probe uses a previously copied format-3 launcher, an OpenCode `current` package, an old Pi package left on disk, with OpenCode as the only eligible update target. A stand-in installer updates OpenCode from 0.1.177 to 0.1.178 and places the candidate launcher in its package. Update exits 0 and reports the new version, but the terminal launcher stays byte-identical to the previous one; invoking it runs **old Pi 0.1.175**, because it cannot discover OpenCode. The installer and harness are stand-ins; the migration comparison itself is the shipped code.

Fix, one install/update row: raise the format in all four copies and add a migration test starting with the actual previous format-3 launcher. Assert the copied terminal launcher discovers the newer OpenCode package after update. This is the same migration convention used for the Pi search changes.

## Nits

None.

## What fits

- **Proven by the focused run:** 166 passing tests cover the adapter, changed CLI and installer paths, including the real OpenCode fixture/hooks/wake scenarios. The sole focused failure is the retired bundle in B3.
- **Proven by source and probes:** the original registration retry, failed-lookup silence, added-part ordering, descendant cleanup and shell-after-disposal contracts now hold in their named scenarios. No shared harness module changed in this range.
- **Proven by source:** prompt/tool boundaries share a 2 s deadline; bridge errors are silence and deliberate tool deny is the only throw. Root/child identity is preserved on the changed bridge requests and shell variables. A child's idle ends only its consumer, and a subsequent message can register it again.
- **Proven by source:** D5 starts one bounded background bridge, unreferences its process/timer/pipes, cancels on a root's message and on disposal, and suppresses results from a cancelled waiter. It uses the shared waiter's pending-file delivery contract and detached daemon path.
- **Proven by source:** the system primer comes from registration and is reused, capped at 8,000 characters, in root and child requests. `before`, `after`, `prompt`, `stop`, and `endTurn` reuse the existing delivery/deny/turn policy implementations. Default bash calls are not regression-denied.
- **Proven by source:** `waitConsumer` and `lastHeard` distinguish `(root, main)` from `(root, child)` for pull windows and preserve Claude Code/Codex precedence. The D7 human status causes and absolute Node/CLI command are covered in the candidate; JSON output remains the shared shape.
- **Proven by source:** fresh install uses one stable `file:.../current` config entry, repoints it on update and never passes `--force`. Only OpenCode's CLI writes its config; uninstall removes owned packages and names the retained config entry. Update pruning retains the newest prior directory and any directory named by process arguments. Fresh installs and launcher searches have candidate tests.
- **Proven by source:** `runOpenCode` keeps its explicit isolated environment and protected variables with `setup` and `afterReply`; neither callback replaces that environment. The new real-harness tests call it through `squealOpenCode`. No probe ran real OpenCode outside that helper or `squeal-e2e`.

## Inputs for the next wave

- Repair B1 to B3 before landing wave 1. B1 and B2 fit the OpenCode adapter's ownership; shared delivery/store/daemon contracts do not need redesign. B3 belongs to the coordinator's bundle integration. Carry the existing root/child consumer, worktree and OpenCode pid through every bridge request.
- Keep one deadline for the whole awaited hook; the background waiter's 59-minute polling lifetime is independent. Bound/cancel API acceptance too, rather than allowing a hook timeout to leave an uncontrolled continuation.
- Invalidate an awaited idle decision when the root is aborted, deleted, disposed or given new user input; only the current turn may submit its report. Keep the one-continuation guard for Squeal's own message.
- S1 can join the lifecycle fix; S2 is a small identity follow-up. S3 belongs to the install/update row and requires all launcher copies to remain identical.
- Calm-load latency remains the coordinator's decision as the 008-16 brief requires. This review makes no latency verdict. Full-suite green must be independently established before landing; this review's loaded-host failures are not proof of new product defects. End-to-end installed-package proof and real-model interpretation of wake/continuation remain the later proof/dogfooding rows.
