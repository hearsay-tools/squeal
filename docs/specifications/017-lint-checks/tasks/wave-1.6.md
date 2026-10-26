# Wave 1.6: one owner for lint inputs outside the listing

The human, 2026-10-26, after the second FAIL (`reviews/0.1.348-r2.md`): "A. One more repair". This is the last round on wave 1; a third FAIL goes back to the human.

## R3 (worker 2e373245, resumed)

Use /worker. Shape: repair. First: `git status` clean, then `git fetch origin && git reset --hard <this commit>` (on main 0.1.346: wave 1, wave 1.5 R1 and R2, the integration, both reviews). `npm ci`. Read `reviews/0.1.348-r2.md` B3-R and B2-R, then D4 and D5.

Owns `src/core/lint/pass/**`, `src/core/lint/provider/**`, `test/lint/**`, `test/fixtures/lint/**`. No other row runs beside you.

**The rule, in one place.** Every key input that is not in the listing (closure and config files, program files) has one owner in the pass, beside the keyer. Before any lookup, each pass checks those inputs on disk. When one changed, appeared or disappeared:
1. its bytes enter the key, read from disk; a missing file is keyed apart from an existing one that is not listed (B2-R: `blobOf` gives `null` today);
2. a changed config or closure file chooses the refresh level as a listed one does; a changed program file runs the incremental walk (`refresh("none")`) before keying, so its new imports enter the program (B3-R);
3. the next lint call feeds the changed program files to the worker, hits included, so ESLint reads the bytes the key holds.

Do not add a fallback to the shared test-key encoder (`src/core/keys/check-key.ts`). Raise `LINT_KEY` (`src/core/lint/pass/keys.ts`) to `squeal-lint-key/2`, the one key-version change of this round.

**Tests, red first,** with the real provider and pass: the review's B3-R reproduction (two linked worktrees, a git-ignored `gen.ts` that gains an import, then a README-only revision); the same with a nudge and no revision; the review's B2-R reproduction (two roots, an unlisted `rule.ts`); a deleted unlisted input. Keep every earlier B1 to B3 test.

**Cost.** In `tasks/017-04/notes.md`, state how many unlisted inputs this repository's own typed fixture holds and the per-pass cost of the check (wall and CPU), beside the host's real load.

Done when the new tests pass, `npx vitest run test/lint/` passes, lint and typecheck are clean, and key-format passes. No `npm run build`, no full suite, no `squeal run --all`; `squeal stop` before you finish. Commit everything; report the commands and their real results.
