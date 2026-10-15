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
