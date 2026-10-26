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

## Final review of the candidate (0.1.351)

Use /reviewer. This is the last review of wave 1 (the human, 2026-10-26); a FAIL goes to the human. The candidate is `cand/0.1.351` at `e47e19d58`, on main `a6300f3af` (0.1.349). Whole wave 1 range `a6300f3af..e47e19d58`; this round's repair `64314f79c..e47e19d58`: worker 2e373245's R3 (`src/core/lint/pass/unlisted.ts`, the refresh per moved input in `session.ts`, the one listing read per pass in `run.ts`, `LINT_KEY` 2) and the version raise with the bundle commit. Write `docs/specifications/017-lint-checks/reviews/0.1.351.md` and commit it alone on your branch.

Read: `reviews/0.1.348.md` and `reviews/0.1.348-r2.md`; this file's R3 section; `tasks/017-04/notes.md`, its R3 decisions 14 to 18 and its cost table; D4 and D5 as amended.

Check, with proof where you can:
1. B3-R and B2-R: your reproductions now fail to reproduce, with the real provider and pass, and the new tests would have caught each. B1, B2 and B3 stay fixed.
2. The rule has one owner: every key input outside the listing is read on disk before lookup, a moved one refreshes and is fed, a missing one is keyed apart. Name any input that can still change a file's findings without moving its key.
3. The notes' limits; say whether either is a break: an unlisted input that changes between the worker's read and the pass's first look is seen only at its next change; an ignored-file edit alone starts no pass until something nudges one (your N2). A deleted program file restarts the worker.
4. Nothing that passed before regressed: off by default, containment, parts and the shared pool, quiet config epochs, the incremental walk.
5. Stored keys: key-format passes; compare-refs at `squeal--v0.1.349` equal, uncovered 0, `KEY_FORMAT_VERSION` unchanged.

Run lint, typecheck, `npx vitest run test/lint/`, the four harness bundle tests and key-format on Node 22 and Node 24. No local full suite and no `squeal run --all`: read CI run 40358013274. Label findings proven, plausible or unverified. Only a proven break blocks. Verdict: PASS or FAIL.
