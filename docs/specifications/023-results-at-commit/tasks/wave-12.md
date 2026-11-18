# Wave 12 (row 023-10): dogfood `status --at` and `squeal proof` in real agent sessions. Use /worker.

The human chose (2026-11-18): release 0.1.563 first (done: `squeal--v0.1.563`, hub `c50cc3c`), then 6 Claude Code sessions on Sonnet.

Read `../spec.md` "Testing" (the dogfood bullet) and D1 to D5; `tasks/023-09-notes.md` (the end-to-end cases and the squawk commits that fit each case); `docs/process.md` step 7 (Proof: the report goes to `lessons.md`).

Question to answer: when an agent needs a before/after comparison or a red proof, does it use `squeal status --at` / `squeal proof`, read the answer right, and leave its own tree alone (no stash, no checkout of another commit, no copying old files over its own)?

- **Isolation (hard rule).** Run every session as the throwaway OS user `squeal-e2e` (`sudo -n -u squeal-e2e -H env -i ...`, cwd `/`), never as this user and never with the real `HOME`. Credentials pass by name only (`--preserve-env=NAMES`), never in argv, files or logs. Install Squeal in that user's Claude Code from the released hearsay marketplace entry (0.1.563), as a user would. Repositories are fresh clones into that user's home: squawk (`~/projects/cezar`, read-only source; clone, never write to it) and this repository, each at the commit its task needs, with its own `pnpm install --frozen-lockfile`.
- **Sessions (6, model Sonnet, `claude -p` or the interactive harness this repo's evals already use for real sessions; no eval runner script).** Each gets a short, natural task in a user's words that does not name Squeal's commands:
  1. Before/after on squawk: "did commit X change any test results compared with its parent?"
  2. Before/after on Squeal: the same kind of question on a Squeal commit.
  3. Red proof, source fix (squawk `6414b6c20`): "show that the new test fails without the fix".
  4. Red proof, test-only fix (squawk `e71888f91`): "show the old test was the problem".
  5. Red proof, hidden dependency (the `GITHUB_RUN_ATTEMPT` case of `feb856667`, as in the 023-09 suite): "show the old test depended on the environment".
  6. Control: a task needing neither (fix a small failing test), to see the commands are not used without need.
- **Record per session:** the transcript path (kept under the throwaway user, copied out with secrets removed), whether it used the right command, whether its answer was right, every write to its own tree that swapped versions, tokens and wall time, and any Squeal message it misread.
- **Judge by situation, not by pooled counts:** each session has one expected behaviour; report per session.
- **Write** `docs/specifications/023-results-at-commit/lessons.md`: per session, the evidence, what went wrong, and the product changes the evidence asks for (as proposals, not code). No product code in this row.
- **Done when:** the 6 sessions ran (or a session that could not run is named with its reason); `lessons.md` committed; `pnpm run check:private` passes on it; no session process, daemon or clone left running; the throwaway user's clones removed. `timeout` on every session (20 minutes each).
