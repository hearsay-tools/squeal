# 004 wave 4.6 briefs: the last two cases, and two small rows

Decided by the human 2026-10-09 after `reviews/wave-4.5.md` (FAIL, last approved round): fix both remaining cases, then a fourth review limited to them. Common rules: test first, each review probe a failing test at `641f95b` on Node 22 and 24; do not run `npm run build`; scratch in one `/tmp` directory of your own, removed; no CPU burners; never delete or kill what you did not start; re-run a failing file alone before calling it yours.

## 004-41 every ignored declared artifact enters the key: tracked links, wildcard globs, new files (wave-4.5 B1, and 004-33)

Outcome: a slow file's key holds its declared build's bytes whatever the glob's shape and however the build directory is linked, and a file a rebuild only adds joins the key.

Read: `reviews/wave-4.5.md` B1 and its probe (a git-tracked `dist -> real-build` link under a directory-only ignore, declared `["**/dist/**", "build.json"]`); `reviews/wave-4.md` B3; `src/core/keys/ignored-inputs.ts` (asks git only for untracked files; a glob without a literal prefix finds no link).

Seams: (1) find links a declared glob can reach whether git tracks them or not (tracked symlinks are `git ls-files -s` entries of mode `120000`), match each against the glob, and walk the outermost one within the watcher's limits, as 004-38 does for untracked links. (2) 004-33: re-list the ignored declared inputs on the interval reconciliation pass (bounded to the declared globs' reach), so a file that appears in an ignored declared directory joins the key within 30 s without a reload or restart; no watcher change (001-166 and 001-167 are in the watcher now).

Owns: `src/core/keys/ignored-inputs.ts`, the re-listing in `src/core/scheduler/keying.ts`, their tests. Leave alone: `src/core/watcher/**`, `src/core/scheduler/batch.ts`, `bootstrap.ts`, `ledger.ts` (001 lane).

Done when: the review probe and its literal-glob control; a rebuild that only adds a file re-keys within one reconciliation; on both Nodes; lint, typecheck, full suite.

Use /worker.

## 004-35 the slow-tier line names every running slow file

Outcome: when an idle tier runs several slow files, the line says so ("running 3 slow files since 14:02: a, b and 1 more"), not only the first.

Seam: the published activity (`src/core/slow/state.ts`, the `#publish` calls in `src/core/scheduler/slow-tier.ts`) carries every running file; `src/core/state/slow-text.ts` and `slow.ts` render it, validating each file as running as 004-23 does for one.

Owns: those files and `test/status/slow-tier.test.ts`, `test/scheduler/slow-activity.test.ts`. Done when: tests for one and several running files; lint, typecheck, the status and scheduler tests on both Nodes.

Use /worker.

## 004-42 a first interval addition counts (wave-4.5 B2)

After 001-166 lands (the start walk seeds files under linked directories without a revision), remove 004-39's interval filter in `src/core/state/slow.ts` so only a worktree's genuine first listing, which then makes no revision, is left out; the review's probe as a test. Brief finalized when 001-166 lands.

## 004-43 fourth review: wave-4.5 B1 and B2 (last), 004-33 and 004-35 (first)

Outcome: `reviews/wave-4.6.md`. Range: on main, `aadc80b` (004-42), `f70fd92` and `435c695` (004-41 with 004-33), `92b2083` (004-35) and the 0.1.67 bundles `9833c33`; the 001 commits between `3bdeffb` and `9833c33` are out of scope except 001-166 (`4d7c203`), on which 004-42 relies (a worktree's first listing makes no revision): check that reliance only. Known at the 0.1.67 gate and not in scope: `test/daemon/busy-store.test.ts:80` fails on Node 22 (writer children's warnings on stderr; 001-161). For wave-4.5 B1 and B2 this is the human-approved fourth and last round, limited to those two cases and what their fixes touch; 004-33 and 004-35 get a first review. Rules as for 004-14.

Use /reviewer.
