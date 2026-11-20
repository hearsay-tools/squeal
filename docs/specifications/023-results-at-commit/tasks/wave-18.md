# Wave 18 (rows 023-29 to 023-32): before/after fixes from dogfood round 4. Use /worker.

The human chose (2026-11-20, "All R1-R8"). Read `../lessons.md` "Round 4 (023-28)" (evidence and R1 to R8), `../spec.md` D3, D4 (step 10 is new), D5 (5a is new), D6 (the process line is new), and `tasks/023-28/` for the exact texts and session logs. Never write the lab VM's host name or the company name in a committed file.

## Row 023-29: `status --at --run` answers both sides (R1, R2, R3, R4, R8)

- **R1, both sides.** With `--run`, after (or beside) the commit side, run the selected files that have no result in the working tree, in the worktree, as the daemon runs them (through the daemon when one serves this worktree; otherwise the same gate in-process). One budget covers both sides; report each side's not-run files. Their results are ordinary worktree results.
- **R2.** `--at <commit resolving to HEAD> --run` refuses as without `--run` (exit 2, names `--at HEAD~1 --run`), before any keying.
- **R3.** A batch whose setup fails (a group's global setup, a browser that does not launch) reads "N not run: the batch's setup failed (<group>: <first line of the error>)", never `not run (budget)`, and no rerun line with a bigger `--timeout`. Groups that run only on request (`squeal checks` shows them) run in their own batch, so their setup cannot stop the rest.
- **R4.** The rerun line's fit comes from this run's measured rate (files per second, per side). When no budget up to the cap fits: "1307 not run; at this run's rate they need about 3 h", and no `--timeout` suggestion.
- **R8.** A file with no result at the commit that the change did not select: "<file>: no result at <commit>, not selected by the change; `--all-missing` runs it". Counts must not say "N of N ran" while such a file exists without that mark.
- **Ownership.** `src/cli/status-at*.ts`, `src/cli/main.ts` help lines for `status --at`, tests beside them. If R1 needs a change in the gate or the daemon protocol, stop and send the coordinator a request first.
- **Done when:** a test per item that fails on today's code; lint, typecheck, check:private, boundaries; `squeal status --wait 60000` on changed paths; direct runs with `timeout 600 pnpm exec vitest run --maxWorkers=2 <paths>`. No version raise, no build, no full suite, nothing left running.

## Row 023-30: the proof's summary and the skill's step 8 (R5, R1's step-8 clause)

- **R5.** In a `source` proof whose named test changed between the sides, the summary line (the first verdict line, text and JSON `summary` if one exists) says: "proven: the new test fails on the old code. This is not the file's result at <base>; that is `squeal status --at <base> <file> --run`". Keep Q5's line under the red side or drop it if it now repeats; keep JSON fields stable.
- **Step 8.** In all five SKILL.md copies (`plugins/claude-code/skills/squeal/SKILL.md`, `plugins/codex/skills/squeal/SKILL.md`, `plugins/codex/seed/skills/squeal/SKILL.md`, `plugins/codex-runtime/skills/squeal/SKILL.md`, `plugins/pi/skills/squeal/SKILL.md`): replace Q1's `--run` clause with "`--run` fills both sides", and add one short sentence: "to compare a changed test file with its old version: `squeal status --at <base> <file> --run`; `proof` answers a different question". Same words in every copy; no other skill change. Check the start-message character cap test if step 8 is counted.
- **Ownership.** `src/cli/proof-report*.ts`, `src/core/proof/verdict.ts` (text only), the five SKILL.md copies (step 8 only), tests beside them. Bundle drift is expected: no build.
- **Done when:** as 023-29.

## Row 023-31: end the processes a removed checkout leaves (R6)

- **Evidence.** Round 4 s1-10: after `--run` removed its checkout, a test server, a browser driver and 15 headless Chrome processes kept running with cwd "(deleted)", after `squeal stop` too.
- **Change.** Before Squeal removes a checkout (status `--run`, `proof`, the sweep of dead owners), find every process of the current user whose cwd, or whose command line, lies under the checkout path (Linux: `/proc/<pid>/cwd` and `cmdline`; macOS: `lsof`/`ps` equivalents, or skip with a note), send SIGTERM, wait up to 2 s, then SIGKILL. Never touch a process outside the path, the caller's own process tree above it, or another user's. The report names them: "ended 17 processes left under the checkout (cezar serve, chrome ×15, agent-browser)". The run's own process group stop stays as it is.
- **Ownership.** `src/core/checkout/**` (new module allowed), the call sites' report lines in `src/cli/status-at-report*.ts` and `src/cli/proof-report*.ts` (one line each; coordinate with 023-29 and 023-30 through the coordinator if a hunk collides), tests beside them.
- **Done when:** a test that starts a detached child with its cwd in a checkout, removes the checkout and finds the child gone and named; a test that a process outside the path survives; lint, typecheck, check:private, boundaries; Squeal's affected results; nothing left running.

## Row 023-32: Q4 again, with round 4's setup (R7)

- **Setup.** squawk is `~/projects/cezar` (read it, never change it). On the lab VM, as round 4 did (see `tasks/023-28/` for the throwaway-user scripts): a bare clone, then `git clone --no-checkout` from it, `checkout -B main 8be977ad6`, `pnpm install --frozen-lockfile`, `squeal run --all --wait` with released 0.1.577 or later, then `squeal status --at HEAD~0`'s equivalent comparison (`--at 8be977ad6` from a tree one commit ahead, or the 0.1.577 path that compared HEAD) and `--run`. Expect `packages/cezar/src/home/runtime-cli.test.ts: no result -> pass`.
- **Find the cause** as row 023-25's brief says (`tasks/wave-16.md`), building on `tasks/023-25-notes.md`. **Fix** in `src/core/commit/at-keys*.ts` or the checkout setup when the cause is there; stop and request the coordinator before touching the gate keyer or the key format.
- **VM turn.** Another coordinator holds the VM until about 01:00-01:30Z on 2026-11-21. Prepare scripts until the coordinator steers "VM free"; then check its load, work in `~/work/<your task id>/`, and leave nothing.
- **Done when:** cause in `tasks/023-32-notes.md` with evidence; a regression test when there is a fix; lint, typecheck, check:private, key-format, boundaries.
