# Wave 4: ignored listings in one worktree, and the proof in real use

Two rows, in parallel, on disjoint ground: one repair in the core's listing keys, one read-only measurement of this host's stores. Row 016-25 waits for 011's view on R3. Workers do not run `npm run build`.

## 016-24 and 016-26 ignored listings: names added in one worktree, and absent directories

Use /worker. Shape: repair. Outcome: a name added to or removed from a git-ignored directory that a test lists re-keys that test in the same worktree, with no restart (R1); and a result stored before 0.1.316 with that directory present is not inherited where the directory is absent (R4).

Read: the board rows 016-24 and 016-26; `tasks/016-23/notes.md` (R1, R4, "For the next worker"); `spec.md` D4 (the written-directory bound); 011 C3 (the listed-directory sentence); `reviews/0.1.316.md`.

Starting seam: `Listings.apply` in `src/core/keys/observed.ts` and `rekeyListings` in `src/core/scheduler/keying.ts`. First step: send me a request with your design before you build. It must:
- pick how a revision learns that an unwatched listed directory changed (watch it like an extra file, or re-read its names at each revision), with the count of such listings in this repository's stores and the cost per revision;
- say how a test that writes into the directory it lists avoids running at every revision;
- name R4's cure and its cost (a marker for an absent listed directory, or none if the measured cost is nil), and whether `KEY_FORMAT_VERSION` moves (`test/keys/key-format.test.ts`).

Owns: `src/core/keys/observed.ts`; `src/core/scheduler/keying.ts`; their tests; `test/scheduler/ignored-listing.test.ts`; `test/keys/validity/cases/listing/**`. A watcher edit (`src/core/watcher/**`) only with the lines named in your design and my yes.

Leave alone: `src/runners/**`; `test/kit/**`; the validity harness.

Done when:
- the R1 case in `test/scheduler/ignored-listing.test.ts` runs the file once after a name is added in the same worktree, with no restart;
- a test that writes into the ignored directory it lists runs once, not at every revision;
- the R4 validity case shows the absent directory's key differs from a present one's, or your notes give the measured cost of leaving it;
- `squeal run --all --wait` is green.

## 016-27 the proof: D4 and 016-23 in real use

Use /researcher. Shape: research. Outcome: evidence from this host's real Squeal stores that goal 6 and 016-23's listing keys hold in use with no blocker, written as `docs/specifications/016-extensions/lessons.md`.

Read: `spec.md` goals 5 and 6, D4; `status.md` lines of 2026-10-25; `reviews/0.1.313.md` and `reviews/0.1.316.md`; `../011-core/research/probes/host-load/` for how to state load.

Method, read-only: the daemons of this repository's checkouts and worktrees that ran 0.1.313 and later (store meta and adapter versions tell which). Use `squeal status`, `squeal why`, `squeal failures` and read-only SQLite queries. Run no script that starts a session or writes outside your worktree, and nothing under `evals/bin`.

Questions:
1. Per runner, how many test files hold stored direct marks, and how many marked paths per file (p50, max)?
2. For edits since the update that touched a child-imported path, did the marked file run as edit work, and did any edit's work exceed `runner.tierSize` because of marks?
3. How many test files list a directory the watcher sees no file in, and how many ran once more after the update because of it?
4. Is any stored result inherited across worktrees whose listed ignored directory names differ? A yes is a blocker: report it to me at once.
5. For row 016-25 (R3), the cost of keying ignored names in a directory that also holds tracked files: how many test files list such a mixed directory, which directories, and across this repository's worktrees how often the key of each would have moved (the ignored names differ between worktrees or over the day). Leave out C2's atomic-save temp names (`<file>.tmp.<pid>.<random>`).

Done when: `lessons.md` is committed with each answer, its numbers, the load at each reading, and a verdict per goal: holds, blocker, or unproven with the reason.

## Review of the wave 4 candidate (016-24, 016-26)

Use /reviewer. The candidate branch and SHA are named in the spawn. The range is `origin/main..<SHA>`: the commits of 016-24 and 016-26 (worker 6d8a1279), the coordinator's 011 C3 sentence and status lines, the version raise and the bundle commit. Write `docs/specifications/016-extensions/reviews/<version>.md` and commit it alone on your branch.

Read: `spec.md` D4; the 016-24 and 016-26 brief above; `tasks/016-23/notes.md` and the worker's notes; 011 C3 (the listed-directory sentence); `reviews/0.1.316.md`.

Check, with proof where you can:
1. R1: a name added to or removed from an unwatched listed directory re-keys its reader at the next revision in the same worktree, with no restart. The key it moves to equals the key a restart computes for the same names (validity case (i) against the "another worktree stored" case).
2. A test that writes into the ignored directory it lists runs at first sight as before, and not at later revisions with no other change. Say what happens when a revision lands during that test's own run (the worker's residual a).
3. R4: the absent and empty markers cannot equal any key computed at 0.1.316 for a directory with names, and an empty and an absent directory key apart. Only readers of an absent or empty unwatched listed directory re-key.
4. `KEY_FORMAT_VERSION` stays at 20: compare-refs against `squeal--v0.1.316` differs by design in exactly three cases (absent marker, empty marker, case (i)), with equal outputs and nothing uncovered. A stored key whose meaning changes is a finding that goes to the human as a raise question.
5. The harness steps are additive: every existing case reads as before, and 011-204's `keyed()` hasher and its changed and touched outputs are unchanged.
6. Cost: one `readdirSync` per directory hashed from disk at each revision; check the count the worker measured and that no reader-count multiplies it.

Run lint, typecheck, `test/scheduler/ignored-listing.test.ts`, `test/keys/observed.test.ts` and `test/keys/key-format.test.ts` on Node 22 and Node 24, and the locked full suite: `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4`. Label findings proven, plausible or unverified. Only a proven break blocks. Verdict: PASS or FAIL.
