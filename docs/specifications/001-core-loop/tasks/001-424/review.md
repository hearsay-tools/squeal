# 001-426 brief: review of cand/0.1.199 (001-424)

Use /reviewer. Shape: review.

**Outcome:** a verdict on `cand/0.1.199` at the SHA the spawn names, range `b0830050..<sha>`, written to `reviews/wave-15b.md`.

**Read:** board rows 001-424 and 001-426; `tasks/001-424/brief.md` and `notes.md`; spec 001 D3 (environment hash) and D4 (`affected`, recreate).

**Commits:** `fix(001-424)` (the fix, the client-env fixture, two tests), `fix(keys)` (key format 10 re-pinned in place, unreleased: the last tag `squeal--v0.1.168` has 9), and `build(plugin)` (bundles, 0.1.199).

**Check, with probes where cheap:**
- The reported shape is closed: a `setupFiles` or `globalSetup` closure, at any depth, imports a missing file. After the add, the next result arrives with no touch.
- Only projects whose setup closures have a missing import get a new environment hash.
- Nothing is lost from `isProjectInput` (`project.ts`).
- What a `recreateTriggers` hit on a candidate costs.
- Whether `test/integration/setup-missing-import.test.ts` fails on main reliably enough to guard. Notes say main sometimes recovered there, by a path nobody identified.
- Not probed by the worker: browser mode, mixed client and ssr `projects`. Name them; they block nothing.

**Leave alone:** `docs/board.md` and every product file.

**Done when:** the review file is committed with its verdict. It holds the output of `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4`, lint and typecheck.
