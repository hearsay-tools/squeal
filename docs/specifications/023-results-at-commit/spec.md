# 023 Results at a commit: before/after and red proofs without touching the user's tree

Stage: approved by the human 2026-11-16 (names `squeal status --at` and `squeal proof`; checkout in the user cache folder with a git-folder fallback; refuse uncertain environment matches and missing source imports). Research: `../018-ci-and-shared-results/research/results-at-commit.md`, `research/temp-checkout.md`, `research/environment-at-commit.md`.

## Problem

An agent that wants to compare test results before and after a change has no way to ask Squeal for the results at an older commit. It stashes or checks out inside its own tree, reruns, and switches back. That changes the user's files during the work, makes the daemon rerun twice, and loses work when the agent forgets to restore. In squawk, agents ran 39 tests by hand on 2026-11-16 for red proofs alone: the new test against the code before the fix (`../011-core/research/hand-runs-2026-11-16.md` item 4).

Squeal labels each result with a commit, but the label does not answer the question. Results are stored by content key, and an unchanged test keeps the label of the commit where it first ran. A lookup by label finds 0.9% (Squeal) and 4.1% (squawk) of the test files at main commits under a day old (first finding, Q1).

## Goals

1. `squeal status --at <commit>` prints, per test file, the result at that commit's key with its origin, or `no result`, or `not determined` with the reason. It runs nothing, writes nothing and needs no checkout (D1 to D3).
2. The same command compares each file with the current tree: pass to fail, fail to pass, unchanged, unknown on either side (D3).
3. With `--run`, Squeal makes a temporary checkout of the commit outside the user's tree, installs it, runs the missing test files within one budget (600 s by default, install included), writes them to the shared store at the commit's keys, removes the checkout, and prints the comparison (D4).
4. `squeal proof` gives a red proof for each of the three cases in squawk's `docs/sdlc/regression-proof.md`: a source fix (new test over the old code), a test-only change that removes a hidden dependency (old and new test under a named condition), and a test-only fix (old test over the current code, repeated). Each side is read from the store first and runs only when no usable result exists, normally one test file. The report shows the red side's failure text and tells a failure for the right reason (an assertion) apart from an import or setup error (D5).
5. A killed run leaves no process running and no checkout behind after the next start; `squeal ps` shows a live run (D6).
6. No number is tuned to this host (human, 2026-11-07).

## Non-goals

- Retention stays 7 days (human, 2026-11-16). Results at commits older than that are mostly gone, and the report says so.
- A per-commit key or environment history (first finding Q3; `environment-at-commit.md` Q2: it recovers 3 to 9%).
- Running a build before the tests, beyond 020 D15's node:test `prepare`. Tests that read files git does not hold read `not comparable` (D4.5).
- `manual` groups (browser e2e), another Node version, Python. Results under another Node are misses by design.
- Changing CI exports to carry failures (018 D2).

## Design

### D1. The command

```
squeal status --at <commit> [<path>...] [--run [--all-missing] [--timeout <seconds>]] [--json]
squeal proof <test file>... --base <commit> [--case source|dependency|test] [--env NAME=[value]]... [--without <path>]... [--repeat <n>] [--timeout <seconds>] [--json]
```

- `<commit>` is any commit-ish. Paths narrow the test files.
- Without `--run` it runs no test and writes nothing shared. It makes the temporary checkout by default for test files CI's published results cannot settle (D2; the human, 2026-11-17, "by default"), so every file gets an exact answer; keying every test file at a commit took about 50 s here, one file about 6 s (row 023-16).
- `squeal proof` is D5. The human chose both names on 2026-11-16.
- Exit codes as 020 D1: `0` every selected file is known on both sides, `3` some file is unknown, not determined or not comparable, `2` usage or setup error. A changed outcome is not an error: it is the answer.
- The JSON report is versioned and carries the commit, `HEAD`, dirty flag, each file's state at both sides with its origin, and the run's budget use.

### D2. Keys at the commit

Keys are computed, never looked up by label (first finding, recommendation).

**Amended 2026-11-17 (the human, "A: runner in checkout").** Computing an older commit's closure from git objects failed three reviews (`reviews/wave-1.md`, `wave-1-rereview.md`, `wave-3.md`): a closure is the runner's resolution, which git alone does not reproduce. Keys at a commit now come from Squeal's own keying run in the temporary checkout at that commit (D4, the gate's keyer, which keys and runs nothing), exact by construction. There is no fast path: every asked test file is keyed by the gate's keyer in the checkout at the commit (the human, 2026-11-17, after three reviews found resolution cases a git-side "unchanged inputs" check cannot see: configured extensions, a file beside a folder, a `package.json` `main` redirect, a folder symlink; `reviews/wave-5*.md`). A file the commit lacks reads `absent` with no checkout. Measured: 50 s for all 1,919 test files here, 5.8 to 6.4 s for one. The environment steps below are kept as a reference; the keyer in the checkout computes the environment itself.

1. **Files.** File hashes come from `git ls-tree <commit>`; they equal git blob ids (0 differences on 25,458 paths). Reuse 018 D11's `committedBlobs`, `commitSegments` and `keyOver`, with D11's closure rule: the local closure list must hold every path the result's run read, or the file is `not determined (closure)`.
2. **Environment**, first step that yields exactly one hash (`environment-at-commit.md`, recommendation):
   1. The commit's runner-file blobs and lockfile equal this worktree's: this worktree's hash.
   2. Compute the installed-dependency part from the commit's committed `pnpm-lock.yaml` (pnpm 12, whole-fingerprint mode), then select the stored `environments` descriptors with this machine's Node, platform, arch, key format, adapter and runner version, equal runner-file hashes and that installed part. Exactly one: use it. More than one: `not determined (environment)`.
   3. Only the lockfile differs: this worktree's inputs with the computed installed part.
   4. Otherwise `not determined (environment)`; `--run`'s install gives the exact hash.
   A project whose descriptors already show equal git-held inputs under more than one hash (squawk `web`, a config that reads files outside its runner files) skips step 2 (human, 2026-11-16: refuse).
3. Other lockfiles (npm, Yarn) stop at step 1 in this slice.
4. Untracked or ignored closure paths: `not determined (untracked input <path>)`.

### D3. Lookup, report and comparison

- Per file at the commit: `pass`, `fail` (with failed tests), `no result`, `not determined (<reason>)`. The origin names local run, import from CI, or this command's run.
- The current side is the daemon's current state for the worktree; with no daemon, the store lookup at the working tree's keys, as 020 D11.7 reads it.
- Text output: one line per changed or unknown file, then counts. Unchanged known files are counted, not listed.
- When most files are `no result` and the commit is older than 7 days, one line says results are kept 7 days.

### D4. `--run`: the temporary checkout

Flow (`temp-checkout.md`, recommendation 1):

1. Take the repository's worktree lock; `git worktree prune`.
2. `git worktree add --detach --lock --reason squeal` at the commit, in the checkout folder: `$XDG_CACHE_HOME/squeal/checkouts/` (or the platform's cache folder) when it is on the same filesystem as the package store; otherwise `<git common dir>/squeal/checkouts/` with one warning line that packages from parent folders can load (human, 2026-11-16), with a marker file naming the owner pid and start time.
3. Frozen install with the project's package manager, on the same filesystem as the user's package store (another filesystem made pnpm download 121 MB again). Warm: about 1 s; cold: 5 to 8 s on this host.
4. Run 020's gate in-process (no relaunch child), in a new files-only mode with a results-only verdict, with `TMPDIR` pointed at a per-run folder. `HOME` and every other variable stay as the daemon has them: these results are stored at the commit's keys, and a variable outside the key must not differ from the conditions those keys stand for. Isolation by a changed `HOME` belongs to D5's conditions, whose results are never stored.
5. Selection: the files the diff `<commit>..HEAD` selects at the commit (020 D3.1) that have no result at their key. `--all-missing` runs every file with no result; it prints 020 D17.1's estimate first (all missing files took 5 to 12 minutes at width 12 here).
6. Budget: one `--timeout`, 600 s by default, install included. Files not started read `not run (budget)`, with 020's rerun line.
7. Completed files are written to the shared store at the commit's keys, as 020 D17.3 does; they stay 7 days.
8. Stop the run's process group, `git worktree remove --force`, delete the run folder, `prune`.
9. A file whose closure reads a path git does not hold reads `not comparable (needs <path>)` and is not run.

### D5. `squeal proof`: red proofs

A red proof is two sides, red and green, run under identical conditions. A side is a pair (test file version, code version); only the named test files take part. The three cases of squawk's `docs/sdlc/regression-proof.md`:

| `--case` | Red side | Green side | Conditions |
|---|---|---|---|
| `source` (default when `<commit>..HEAD` changes a non-test file the test loads) | the test at HEAD over the code at `--base` | the test and code at HEAD | none |
| `dependency` | the test at `--base` | the test at HEAD | `--env`, `--without` on both sides; required |
| `test` (default when `<commit>..HEAD` changes only test-side files of the named test) | the test at `--base` over the code at HEAD | the test and code at HEAD | optional; `--repeat` |

1. **Store first.** Each side's key is computed as D2 does over the side's blobs. A side with a stored result at its key and no condition is read, not run: the green side normally is today's state. A stored failure on a `test` red side is the proof. A stored pass on a red side proves nothing for a flaky test, so a `test` red side with `--repeat` runs anyway. Normally one side of one file runs.
2. **Running a side.** In D4's temporary checkout at the side's code version, with the side's test version copied in. Test-side files the test imports that the code version lacks (helpers, fixtures, files under the project's test include globs) are copied with it. A source file it imports that the code version lacks: the side reads `not comparable (imports <path>, absent at <commit>)` and does not run (human, 2026-11-16: refuse).
3. **Conditions.** `--env NAME=` unsets or sets a variable; `--without <path>` hides a file or folder (a path under `HOME` is hidden by giving the run its own `HOME` holding everything else the test reads there). The same conditions apply to both sides. A side under a condition always runs, and its result is never written to the store: the key does not record the condition.
4. **Repeat.** `--repeat <n>` runs the red side up to n times and stops at the first failure. The green side runs n times and must pass every time. Default 1. Reproducing an original host load is out of scope.
5. **Verdict per test file:** `proven` (red failed on an assertion, green passed), `not red` (red passed every time), `red for another reason` (import, setup, collection or timeout failure, with its text), `not green`, `not comparable`. The report carries the red side's failed tests and their failure text (as `squeal why` shows it), the commits, the conditions and the run count, so an agent can paste it into a pull request.
6. Exit codes: `0` every named file `proven`, `1` some file `not red` or `not green`, `3` some file not comparable or red for another reason, `2` usage or setup error.

### D6. Cleanup and visibility

- The gate's child, if any remains, ends with its parent (process group); a SIGKILL of the command leaves nothing writing to the store.
- At start, and in the daemon's prune, Squeal removes checkouts whose marker names a dead owner, with their run folders.
- `squeal ps` lists a live run: its checkout, pid and age.

## Testing

- Unit: environment steps 1 to 4 on stored descriptors from fixtures; key computation from git objects against a daemon's keys on a two-commit fixture; proof side keys and store reuse; import classification; verdict classification (assertion against import or setup failure).
- Integration: `--at` on a fixture repository with three commits (unchanged, lockfile changed, config changed); `--run` creates, runs, writes and removes; a SIGKILL'd run leaves no process and is swept at the next start.
- End to end: the shipped bundle on a copy of this repository and of squawk: one before/after at `HEAD~1`, one red proof of a real fix.
- End to end, one proof per case on real squawk fixes: a source fix, a test-only fix with `--repeat`, a hidden-dependency fix with `--without`.
- Dogfood: an agent session asked for a red proof uses `squeal proof` and does not restore files in its own tree.

## Rows (proposed)

| Row | Shape | Depends |
|---|---|---|
| 023-03 keys at a commit, with D2's environment steps | slice | |
| 023-04 gate: files-only selection, results-only verdict, in-process call, child ends with parent | slice | |
| 023-05 temporary checkout lifecycle: lock, marker, install, remove, sweep, `ps` | slice | |
| 023-06 `status --at`: lookup, report, comparison, JSON (D1, D3) | slice | 03 |
| 023-07 `--run` (D4) | slice | 04, 05, 06 |
| 023-08 `squeal proof`: sides, store reuse, test-file copy, verdicts (D5.1, D5.2, D5.5, D5.6) | slice | 07 |
| 023-11 `squeal proof` conditions and repeat (D5.3, D5.4) | slice | 08 |
| 023-09 end-to-end suite | proof | 11 |
| 023-10 dogfood: red proof and before/after in agent sessions | proof | 09 |

Wave 1: 023-03, 023-04, 023-05 in parallel. Wave 2: 023-06. Wave 3: 023-07. Wave 4: 023-08. Wave 5: 023-11. Wave 6: 023-09, 023-10.

## Open questions

None open. Decided by the human on 2026-11-16: names; checkout location; refuse a single stored environment match in a project with a config-only difference; refuse a proof side whose test imports a source file its code version lacks.

## References

- Human, 2026-11-16: the question, "spec with auto-run", "keep 7 days", red proofs (`status.md`).
- Specs 018 D2, D11; 019 D5; 020 D1, D3, D11.7, D14, D15, D17; 001 D8 as amended (prune).
