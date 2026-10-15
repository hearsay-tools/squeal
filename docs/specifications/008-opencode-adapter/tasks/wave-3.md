# 008 wave 3: the dogfooding defects

Read `../spec.md`, `../status.md` and `../lessons.md` (008-20) first. Host test-run policy as in `wave-2.md`. 008-25 and 008-26 run in parallel on disjoint files; with 008-24 (held on `hold/008-24`) they make one candidate. Defect 3 (setup) joins 009-26 and 009-28. Defect 4(b) is in the shared report (`src/core/delivery/format.ts`) and goes to 001.

## 008-25 the continuation under `opencode run`

Use /worker. Outcome: under `opencode run`, news known before the turn ends reaches the session as one stored Squeal message that `opencode run --continue` reads (goal 4, D5), or evidence that OpenCode 1.18.35 gives a plugin no way to store it.

- Defect: `lessons.md` defect 1 (s3, s3b). `run` disposes the instance about 10 ms after the first idle. `event` hooks are not awaited, so idle's Stop bridge cannot answer before `dispose`, and after `dispose` every hook is silent. Research r1 (`research/opencode-sessions-and-wake.md`) stored a message only from a `promptAsync` called synchronously inside the hook.
- Shape: slice, with a stop condition.
- Seam: first reproduce it in `test/e2e/opencode.test.ts` with the scripted provider: news ready before idle under `run`, then `run --continue` asserts the stored message. Then find out from OpenCode 1.18.35's source whether `dispose` is awaited before exit, and how long for. Leads, in order: `dispose` finishes the in-flight Stop and calls `promptAsync` within its deadline; or the plugin learns of news before idle (from the last bridge answer, or a waiter already running in the turn) so idle can call `promptAsync` without a bridge.
- Owns: `src/harness/opencode/**`, `test/harness/opencode/**` (except the 008-24 files: `bridge-client.test.ts`, `turn.test.ts`), `test/e2e/opencode*`. Leaves alone: `src/cli/**` (008-26), `test/helpers/opencode.ts` (008-24; ask first), shared code beyond D6.
- Stop: if no lead holds, stop after the reproduction. Commit it as `it.fails` with the OpenCode source lines that rule each lead out, and report. The coordinator takes the spec amendment to the human.
- Done when: the e2e passes under `run` and the `serve` tests still pass; D4's deadlines hold (`run` exits within dispose's 3 s); lint, typecheck and the suite verdict from `squeal run --all --wait` are green.

## 008-26 the status line's causes and the update's wording

Use /worker. Outcome: `squeal status` in an OpenCode shell names the right cause when Squeal is silent, and `squeal update` speaks only of the harnesses it updated.

- Defects: `lessons.md` defect 2 (the plugin is blamed when the repository is not set up) and 4(a) (`/reload-plugins in Claude Code` printed with only OpenCode installed).
- Shape: repair.
- Seam: `src/cli/opencode/status.ts:43`. When the worktree fails the plugin's own fast-path test (`usesSquealAt` in `src/harness/opencode/host.ts`; import it, do not copy it), say the repository is not set up for Squeal and to run `squeal setup`. Keep the install advice for a set-up repository. Then `src/cli/update.ts:100`: name only the harnesses being updated.
- Owns: `src/cli/opencode/**`, `src/cli/update.ts`, `test/cli/opencode-*.test.ts`, `test/cli/update*.test.ts`. Leaves alone: `src/harness/**` (008-25).
- Done when: a CLI test for each status cause, and update texts tested for OpenCode alone, Claude Code alone and both; lint, typecheck and `squeal run --all --wait` green.

## 008-27 review of `cand/0.1.186` (wave 3)

Use /reviewer. Outcome: `reviews/wave-3.md` committed with a verdict on the exact candidate SHA the spawn names. Every finding is labelled proven, plausible or unverified. This is the candidate's landing gate.

- Range: the spawn names it: main at 0.1.185, then 008-26, then 008-24 and 008-25 (one branch), then the 0.1.186 build commit. Spec: goal 4, D3 to D5 and D7 as amended; `reviews/wave-2.md`; `lessons.md` defects 1, 2 and 4(a).
- Questions:
  - 008-25: does `dispose` waiting for in-flight idles keep `run` within D4's 3 s, and leave no consumer registered? Is `session.prompt` with `noReply` at dispose stored exactly once, and never under `serve` while the server lives? Do an abort or new input during dispose still cancel the continuation (review 008-16 B2)? Can `storedBySqueal` skip a user's message, or a compaction's? Check the OpenCode 1.18.35 source claims (`effect-cmd.ts:90-93`, `plugin/index.ts:265-279`, `session/prompt.ts:1069`, `instance-registry.ts:11`) against `node_modules/opencode-ai`.
  - 008-26: is each status cause right in a linked worktree and in a subdirectory, and does importing `usesSquealAt` into the CLI change its bundle's behaviour anywhere else?
  - 008-24: is S1 closed, and can the helper's signal handlers change how Vitest ends a worker?
- Writes only `docs/specifications/008-opencode-adapter/reviews/wave-3.md`. Runs real OpenCode only through `runOpenCode`. Full-suite verdict from `squeal run --all --wait`; no independent full run, since the coordinator's gate runs under the host lock.

## Wave 3.5: repair of `reviews/wave-3.md`

### 008-28 a disposal's report yields to newer input and an abort

Use /worker, on `cand/0.1.186` (ceea98c2). Outcome: B1 of `reviews/wave-3.md` fixed. A report stored at `dispose` is dropped when the session has a newer message than the turn that went idle, including input routed to OpenCode's recreated plugin instance and an abort. The `run` storage path and the 3 s bound stay as they are.

- Read `../reviews/wave-3.md` B1 (its five-step reproduction) and S1.
- Shape: repair.
- Lead: the plugin's own epoch cannot see input the new instance takes, so ask OpenCode. At idle, record the session's last message id. In `say`'s stopping path, just before `session.prompt` with `noReply`, read the session's latest messages within the remaining deadline. Store only if none is newer than that id. A failed read stores nothing, which is silence.
- Tests: both causally gated real-OpenCode cases of B1 (new input; abort after the second request), via `runOpenCode` and `serve`, without sleeps deciding the race; the matching hook tests; the existing `run --continue` e2e still passes. S1: when that e2e's stored-once assertion fails, it prints the timestamps for idle, Stop's answer, dispose entry, the store and dispose return.
- Owns: `src/harness/opencode/**`, `test/harness/opencode/**`, `test/harness/opencode-*.test.ts`, `test/e2e/opencode*`. No dist, version or key format.
- Done when: each new test fails at ceea98c2 and passes after; lint, typecheck, the opencode tests and the e2e file green.

## 008-29 the OpenCode e2e's misses under load

Use /worker. Outcome: when the `run --continue` e2e or the dispose regressions fail, they say why, and they do not fail only because the host is loaded.

- Inputs: `reviews/wave-3.md` S1. The `run --continue` e2e missed its stored report once at load 69, then passed; 008-28 traced the fixture's idle deadline at about 500 ms (`stop.waitMs` 0), which a loaded host can miss. Round 2: the abort regression in `test/harness/opencode-dispose.test.ts` once timed out waiting for its gated Stop to answer, then passed.
- Shape: repair, tests only. No trace code in the shipped plugin (coordinator decision, 008-28).
- Seam: the fixture's `stop.waitMs` in `test/e2e/opencode-fixture.ts`, set so the idle deadline is not the variable under test; then the test-side timings the e2e can see (requests, the session's messages, process exits) printed in the failure message; then the dispose regression's barrier timeout and what it prints when it expires.
- Owns: `test/e2e/opencode*`, `test/harness/opencode-dispose.test.ts`. Leaves alone: `src/**`.
- Done when: each test passes 10 runs in a row at a load above the CPU count, or each failure names its cause; lint, typecheck and `squeal run --all --wait` are green.

## 008-30 re-check of defect 1 with a real model

Use /worker. Outcome: `lessons.md` gains a dated section showing whether, with 0.1.186 installed, a real model's `opencode run` stores news known before idle as one Squeal message that `opencode run --continue` reads (goal 4 under `run`), and whether a Cezar-shaped `serve` session still gets exactly one continuation.

- Read: `../lessons.md` (defect 1, sessions s3 and s3b, and the Setup section), `dogfood/` (its scripts), `../reviews/wave-3.md`.
- Shape: proof. As in 008-20: only as `squeal-e2e` under `/home/squeal-e2e/dogfood-008/`, with the key by name through the logging proxy; `gpt-6-luna` (only the daemon is observed); sessions only below load 24, with the load recorded.
- Steps: update the dogfood install to 0.1.186 with `install.sh` from a `git archive` of main; repeat s3 (twice, as s3 and s3b did); repeat one Cezar-shaped `serve` session with news at the end of a turn.
- Owns: `docs/specifications/008-opencode-adapter/lessons.md` (append only) and `dogfood/**`. Fixes nothing.
- Done when: the section answers both questions with evidence, a new defect is written with a proposed row, and nothing of the run is left running.

## 008-31 a continued turn is not continued again

Use /worker. Outcome: under `serve`, a turn Squeal continued ends silently at its idle, even when its own edit flips a check before that idle. The news reaches the model at the next user prompt (goal 4, D3, D5; `lessons.md` defect 5).

- Read: `../lessons.md` defect 5 and session 030-s4, which name two candidate paths in `src/harness/opencode/turns.ts`: (a) the waiter armed at the continued turn's idle delivers an entry of a file not pending at that idle; (b) `continued` is cleared, so the idle runs Stop again. Also `../reviews/wave-3.md` (what 008-25 and 008-28 changed in `turns.ts`), and whether 0.1.184 had this.
- Shape: repair.
- Seam: first reproduce it in a real-OpenCode test through `runOpenCode` under `serve` with the scripted provider. Put it in `test/harness/opencode-*.test.ts`, not `test/e2e/` (008-29 owns that).
  1. Turn 1 edits and makes a regression known before idle.
  2. Continuation 1's scripted answer makes an edit that flips the check back before its idle.
  3. Assert no further Squeal message in the session, and that the `FAIL -> PASS` reaches the model with the next user prompt.

  Then the hook test that pins the path, then the fix.
- Owns: `src/harness/opencode/**`, `test/harness/opencode/**`, `test/harness/opencode-*.test.ts` except `opencode-dispose.test.ts` (008-29). No dist, version or key format.
- Done when: the reproduction fails at main and passes after; the dispose regressions and the `run` storage tests still pass; lint, typecheck and `squeal run --all --wait` green.

## 008-32 review of `cand/0.1.188`

Use /reviewer. Outcome: `reviews/wave-3b.md` committed with a verdict on the exact candidate SHA the spawn names. Every finding is labelled proven, plausible or unverified. This is the candidate's landing gate.

- Range: the spawn names it: main at 0.1.187, then 008-31 (2 commits), 008-29 (6 commits, tests only), then the 0.1.188 build. Spec: goal 4, D3 to D5; `lessons.md` defect 5 and session 030-s4; `reviews/wave-3.md` (what 008-25 and 008-28 built).
- Questions:
  - 008-31: does a continued turn's idle now end silent in every path? That includes a continuation the user aborts, a wake's turn, and a child session. Does `endContinued` drop anything `delivery.endTurn` did that the plugin relies on (liveness, `atRevision`, the handoff)? Does news held back this way always reach the next prompt or tool result, and never get lost? Did 0.1.184 have defect 5, or did wave 3 bring it in?
  - 008-29: does a retry ever hide a failure that is not a proven D4 deadline miss? Is the timeline's reading of a cause honest? Do the watcher and its `/proc` reads stay off the real `HOME` and leave no process?
- Writes only `docs/specifications/008-opencode-adapter/reviews/wave-3b.md`. Runs real OpenCode only through `runOpenCode`. Squeal does not key the OpenCode bundle tests to `src/harness/opencode` yet (001-399): run `npx vitest run test/harness/opencode/ test/harness/opencode-*.test.ts` yourself. Take the full-suite verdict from `squeal run --all --wait`, with no independent full run (the coordinator's gate holds the host lock).

### 008-33 repair of `reviews/wave-3b.md`

Use /worker, on `cand/0.1.188` at d3978509. The coordinator has already made the product fix for B1: `turns.ts` ends a continued turn as continued even when it was aborted, with a hook regression and the bundle rebuilt. It also removed the 250 ms slack from the e2e timeline's deadline checks (B2, in part). Outcome: both blockers fully repaired as the review's repair notes ask.

- B1: the review's barrier-ordered real-OpenCode test (the first continuation held by a provider barrier, the recovery applied, the abort event marked, then the reply released). It asserts no third Squeal request, and that the `FAIL -> PASS` reaches the model at the next real user prompt. It must fail at 5f425783 and pass at d3978509.
- B2: in `test/harness/opencode-dispose.test.ts`, `stopGone()` retries only when the held Stop died at or after its idle deadline. Uncertain causes fail with their observations, or are labelled unresolved without a retry. Add small timeline tests in `test/e2e/` (pure, with no OpenCode) for an early report loss, a genuine expiry, and missing timing evidence.
- Owns: `test/harness/opencode-*.test.ts`, `test/harness/opencode/**`, `test/e2e/opencode*`. No `src`, dist or version.
- Done when: each new test discriminates as stated; lint, typecheck and `npx vitest run test/harness/opencode/ test/harness/opencode-*.test.ts test/e2e/opencode*.test.ts` green.

## 008-35 re-review of `cand/0.1.192`'s shared files

Use /reviewer, pinned to `cand/0.1.192` (63289a86). Outcome: `reviews/wave-3b.md` gains a Round 4 with a verdict on that SHA, for the files it shares with main's code since review 008-32 passed (process step 6).

- Context: 0.1.192 is `cand/0.1.188` (round 3 PASS at 854d66ae) cherry-picked onto main at 0.1.190 (007's 007-37 to 007-43, 006's 006-53 and 006-56), with no build commit carried, then one build commit. Main's commits and the candidate share no source or test file; only the eight version places and 31 bundles under `plugins/*/dist`.
- Questions: is the version 0.1.192 in all eight places (`package.json`, `plugins/{claude-code,pi,opencode}/package.json`, both plugin manifests, `install.sh` `SQUEAL_VERSION`, `package-lock.json` root and `packages[""]`), and does `npm run check:version -- origin/main` pass? Does a clean `npm ci` and `npm run build` leave no tracked drift? Do the cherry-picked commits match round 3's `74f093ba..854d66ae` and earlier range by content (`git range-diff`)? Does `npx vitest run test/keys/key-format.test.ts` pass with format 10 unchanged?
- Writes only `docs/specifications/008-opencode-adapter/reviews/wave-3b.md`. No full suite: the coordinator's gate runs under the host lock.
