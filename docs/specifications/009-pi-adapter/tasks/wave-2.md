# 009 wave 2: idle wake and the review's fixes

009-15 and 009-16 run in parallel on 0.1.171; 009-17 reviews wave 1 beside them. Read `docs/vision.md`, `docs/styleguide.md`, `../spec.md`, every 2026-10-14 line of `../status.md` and `../reviews/wave-0.md` first. Pi runs only through `test/helpers/pi.ts`; never touch `~/.pi`. No `npm run build` in your worktree; leave `plugins/*/dist`, versions and `src/core/keys/key-format.ts` alone (the coordinator rebuilds and re-pins).

## 009-15 idle wake

Outcome: an idle Pi agent in the TUI or an open RPC session is woken with the report when its pending tests finish with news, and never under `-p` or `json` (goal 7).

- Spec: D5, D4 (as amended for native-blocked workers), 001 D9's waiter rules as amended by 001-85; research `pi-sessions-and-packaging.md` 1.
- Shape: slice.
- Seam: `src/harness/pi/extension.ts` at `agent_settled`: when `ctx.mode` is `tui` or `rpc`, post a `wait` request whose worker side calls the shared waiter (`src/harness/shared/waiter.ts`, `waitIdle`); on a delta, `pi.sendMessage(<custom squeal>, { triggerTurn: true, deliverAs: "followUp" })`. `input` and `session_shutdown` cancel it; a cancelled or expired wait is silent and must not hold the process (the worker is unreferenced; the wait is not a pending deadline call).
- Also: `"pi"` in `StopWaitHarness` (`src/core/slow/stop-wait.ts`) and the Pi Stop passing it (status: 009-12 used `"codex"`); review S2: a test where the worker is blocked in a native SQLite busy wait, asserting the handler is silent at its deadline and the process exits within the busy timeout after it.
- Owns: `src/harness/pi/**`, `test/harness/pi/**`, `test/integration/pi*.test.ts`, the `StopWaitHarness` line and its callers' types.
- Leaves alone: `test/helpers/pi.ts`, `test/fixtures/pi/**` (009-16).
- Done when: real Pi in `rpc`, a failing edit's result landing after `agent_settled` starts exactly one run carrying it, and the fake provider sees it; under `-p` no wake is armed and Pi exits promptly; a user prompt before the result cancels the wait and the news arrives with that prompt; lint, typecheck, full suite green.

Use /worker.

## 009-16 the Pi fixture's isolation

Outcome: `runPi` cannot be made to run Pi against a real home or inside a repository (review wave 0 S1, N1; status, 009-12's finding).

- Shape: repair.
- Seam: `test/helpers/pi.ts`. First edit: apply the caller's `env` before the isolation variables (`HOME`, `TMPDIR`, `PI_CODING_AGENT_DIR`, `PI_OFFLINE`, the plan and log paths), or reject overrides of them. Then a base directory outside any git work tree: `os.tmpdir()` when no ancestor has `.git`, otherwise `/tmp`; a caller's `cwd` inside a repository is rejected.
- N1: the `any` in `test/fixtures/pi/fake-provider.ts` becomes Pi's exported types, or each remaining cast gets a comment saying why.
- Owns: `test/helpers/pi.ts`, `test/fixtures/pi/**`, `test/harness/pi-fixture.test.ts`.
- Leaves alone: `src/**`, `test/harness/pi/**`, `test/integration/pi*.test.ts` (009-15).
- Done when: a test shows a protected override has no effect or throws without starting Pi; a test run with `TMPDIR` inside a repository puts Pi's project outside it; the fixture test passes in every mode; lint, typecheck, full suite green.

Use /worker.

## 009-17 review of wave 1

Shape: review. `/reviewer` over wave 1's landing, `502eb7f1..d428340c` (009-12, 009-13, the key re-pin). Focus: D3's honesty rules: one delivery per batch and none on the final turn, the deny once per regression, the continuation guard and silence after shutdown and on abort; every handler bounded by D4; `install.sh` against 005 D3's rules (no partial run, idempotent, `--uninstall` removes only what it recorded, the archive's version check) and the launcher's format 2; the status line's wording. Verify in a temporary detached worktree at `d428340c` if you build, and remove it after. Write `docs/specifications/009-pi-adapter/reviews/wave-1.md`.

Use /reviewer.
