# Wave 10 (row 023-09): end-to-end suite for `status --at` and `squeal proof`. Use /worker.

Read `../spec.md` "Testing" (the two end-to-end bullets) and D1 to D6; `tasks/023-07-notes.md`, `023-08-notes.md`, `023-11-notes.md`; squawk's `docs/sdlc/regression-proof.md` (squawk is the repository at `~/projects/cezar`; read it, never change it); the existing `test/e2e/` suites for their conventions (Squeal does not run `test/e2e/**`; they run by hand and are not in CI).

Outcome: one end-to-end suite that runs the shipped bundle (`plugins/claude-code/dist/cli/squeal.mjs`, as built) the way an agent would, on real repositories, and proves the commands give the right answer on real fixes.

- **Copies only.** Each case works on a `git clone --local` (or `--no-hardlinks` where a test writes) of this repository or of squawk into `$TMPDIR`, with `HOME` pointed at a throwaway folder and the package store kept as the clone's normal one. Never write to `~/projects/cezar`, its worktrees, or the real `HOME`. Skip a squawk case with one clear line when `~/projects/cezar` is absent.
- **Before/after.** On each copy: `squeal status --at HEAD~1` on a commit that changes one source file and its test reads the right per-file states and comparison, then `--run` fills the missing files and a second call reads them from the store with no run.
- **One red proof per case on real squawk fixes** (pick from squawk's git history; name the commits and why each fits in the notes):
  1. `source`: a fix commit that adds a regression test over changed source; `proven`, with the red side's assertion text.
  2. `test` with `--repeat`: a test-only fix of a flaky test; red fails within the repeats, green passes every run.
  3. `dependency` with `--without` (and `--home-keep` where needed): a fix that removed a hidden dependency on a file or variable; `proven` under the condition.
  When squawk's history has no fitting real fix for a case, say so in the notes and build the closest real-looking fixture from a squawk commit instead; do not invent a fit.
- **Wrong answers must fail the suite.** For each case also run a control that must not read `proven` (for example the green commit as base) and assert it does not.
- **Cost.** Record each case's wall time and the host load average at the start; keep the suite under 15 minutes on this host; no CPU load made on purpose.
- **Ownership.** New files under `test/e2e/` and their helpers; `tasks/023-09-notes.md`. No product code changes: a product defect found here is reported with a reproduction, not fixed in this row.
- **Done when:** the suite passes on this host by its own command (state it), with the per-case times and commits in the notes; lint, typecheck, check:private; nothing left running (checkouts swept, no daemon, no vitest). No version raise, no build beyond what the suite needs to read; `timeout 1200` on the suite run.
