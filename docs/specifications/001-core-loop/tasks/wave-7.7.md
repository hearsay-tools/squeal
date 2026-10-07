# Wave 7.7 worker briefs

From `reviews/wave-7.6.md`. One worker, `--backend claude --model opus --effort high`, never Fable. 001-60 passed that review; this row repairs 001-61 and carries the 001-60 tidy items. A re-review (001-64) follows.

## 001-63 daemon temp directory and the runner's children

Use /worker. Shape: repair.

Outcome: tests run by the daemon see a temp directory like the one `vitest run` gives them, the daemon leaves nothing behind, and D10 says exactly what a running daemon can hold.

Read: `reviews/wave-7.6.md` (all of it, "Inputs for the next wave" 1 and 2); spec D10, D4 (3); `lessons.md` defect 13.

Decided by the coordinator (do not re-open): B2 is option (b). Keep the root as the working directory around every runner call, because loading the project's config anywhere else can change results (Goal 3). Amend D10: the daemon itself holds nothing inside the root, but a process the project's tools start during a runner call (esbuild's service under Vite 6 and 7) may hold the root until the daemon exits; `git worktree remove` still succeeds and the daemon then exits. B1: Vitest's temp directory moves to `/tmp/squeal-<uid>/tmp/<worktree-hash>/` (a private per-user directory made like `prepareSocketDir` in `src/core/daemon/paths.ts`, never the inherited `TMPDIR`, never inside a repository), emptied under the lock at start.

Seam: `src/core/daemon/scratch.ts`. First edit: the new temp location. Then S1 (remove it in `#shutdown` after `runner.close()`, before the lock release), N5 (`git worktree remove` in the test), N1 (trailing slash in `entryDirectories`, `stale.ts`), N2 (keep the `exports` branch, say in D4 it is defensive), S2 (D4 figures: the 001-60 local figures; CI figures from the newest `main` CI log, `gh run view --log`), N3 and N4 (`status.md` wave label and placement).

Own: `src/core/daemon/`, `src/runners/vitest/stale.ts` (N1 only), `test/daemon/`, `test/runners/vitest/structural.test.ts` (N1 row only), D4 and D10 in `spec.md`, `status.md`. Do not run `npm run build` or touch `plugins/claude-code/dist`. Commit as you go.

Done when: with a real daemon, `git rev-parse` fails inside `mkdtemp(os.tmpdir())` in a test it runs; the esbuild-plugin fixture shows `git worktree remove` succeeding and the daemon exiting; the temp directory is gone after `squeal stop` and after removal; N1 is a test; the daemon is ready within the hooks' spawn budget; the full suite passes.

## 001-64 re-review of 001-63

Use /reviewer. Range `09bfc7c..57671b7`. Output `reviews/wave-7.7.md`. Second and last round on the 001-61 slice: report blockers plainly; the human decides whether a third is bought.

Outcome: whether `reviews/wave-7.6.md` B1, B2 (as decided: option b, D10 amended), S1, S2, N1 to N5 are closed, and whether the new temp location opened anything.

Read: `reviews/wave-7.6.md`; spec D10 and D4 as amended; `src/core/daemon/scratch.ts`, `paths.ts` (`preparePrivateDir`), `open.ts`, `daemon.ts`; `test/daemon/scratch*.test.ts`, `scratch-helpers.ts`.

Probe at least: the B1 probe with a real daemon; `/tmp/squeal-<uid>` pre-created by another user, as a symlink, or with loose mode; two worktrees' daemons sharing `/tmp/squeal-<uid>/tmp`; a daemon killed with SIGKILL (leftovers reaped at next start); the start order change (store before temp dir) against the hooks' spawn budget; whether D10's option (b) wording matches what the esbuild fixture shows. Do not re-check what `reviews/wave-7.6.md` lists under "What fits".
