# Wave 3: counts, texts and the setup skill

Three workers on disjoint files, the human's go of 2026-10-13. Code and text only: run no model session and never the real `claude` or `codex` (probe isolation). The setup skill's `claude -p` and `codex exec` runs belong to 005-17, which takes the eval slot. Leave bundles, `package.json`'s version and `docs/board.md` to the coordinator.

## 005-21 tests and file-level checks counted apart in status and headers

Use /worker. Shape: slice.

**Outcome:** every count of checks that `squeal status` and a delivery header print names tests and test files loaded apart, as `run --all` already does since 005-10.

**Read:** spec D1 (the counting rule, its 2026-10-12 reconciliation); `reviews/wave-1.5.md` S2; 001 D4 (one file-level check per test file); the 005-10 commits in `src/cli/verdict.ts` for the wording.

**Seam:** `src/core/status/format-status.ts`, then the header builders in `src/core/delivery/`. First edit: one shared formatter, `14 checks: 10 tests, 4 test files loaded`, reused from where 005-10 put it rather than rewritten. Then S2's residual in `src/cli/run.ts`: a joined checkpoint that completed before `run --all` read the join counts the joined checkpoint's files, not the request's empty list.

**Owns:** those files and their tests. **Leave alone:** `src/core/state/slow-text.ts` (001-317), `src/harness/shared/primer.ts` and the skills (005-15), `src/cli/setup/` and `warmup.ts`. If a key-format-guarded file must change, say so in a request first.

**Done when:** status and header snapshot tests name tests and test files loaded apart; S2's completed-before-read join counts the joined checkpoint; the 10,000-character cap holds; lint, typecheck, suite green.

## 005-15 texts

Use /worker. Shape: survey, then finish.

**Outcome:** each D6 item holds in the primer and `skills/squeal`, and nothing D6 asks for is said twice.

**Read:** spec D6 item by item; `001-core-loop/research/primer-skill-writing.md` (001-283's rewrite: build on it, do not redo it); the board rows 005-15 and 001-317; `evals/results/TREND.md` (luna a5-uncovered is a known offender at 3 of 10 false passes, and the trend test fails any run above 3).

**Seam:** first a table in your final notes: each D6 item, where it already holds (001-223, 001-224, 001-225, 001-283, 005-11 did several), and what is missing. Then only the missing ones, in `src/harness/shared/primer.ts` and both `skills/squeal` copies. Also the human's 2026-10-12 split: the wording around 001-292's coverage ("new matching files are picked up", "anything else the repository checks is yours to run"). For luna's `unknown` claim after a quiet line naming `run --slow --wait` (006 atomic a2-slow, 17 of 17): find which line it read and propose the change in your notes; edit it only if the line is in your files.

**Owns:** `src/harness/shared/primer.ts`, `plugins/*/skills/squeal/**`, their tests. **Leave alone:** `src/core/state/slow-text.ts` (001-317 is rewording its off branch now), `src/core/status/`, `src/core/delivery/` (005-21), `plugins/*/skills/setup/` (005-19), this repository's `CLAUDE.md` and skills.

**Done when:** the D6 table is in your notes; primer and skill tests green in both harnesses, both skill copies identical; the 1,500-character primer cap and the 10,000-character cap hold; each change names its D6 item in the commit; lint, typecheck, suite green.

## 005-19 the setup skill

Use /worker. Shape: slice.

**Outcome:** a user who installed the plugin inside Claude Code or Codex types `/squeal:setup` or `$squeal:setup` and gets `squeal setup`'s plan, questions and apply.

**Read:** spec D3 "The skill" (steps 1 to 5 and the warm-up note); `research/wave-0-checks.md` 1 and its 005-19 recommendation; `plugins/*/skills/squeal/SKILL.md` for form; 001-283's findings for how skill text is written here.

**Seam:** new `plugins/claude-code/skills/setup/SKILL.md`, identical in `plugins/codex/`. Find the CLI as wave-0 says: `squeal` (or `${CLAUDE_PLUGIN_ROOT}/bin/squeal`) in Claude Code, `node "<plugin root>/dist/cli/squeal.mjs"` in Codex. Run `squeal setup --plan --json`; interview with `AskUserQuestion` only in an interactive Claude Code session, at most four questions a round; under `-p`, or in Codex outside Plan mode, print the plan and the questions and end the turn writing nothing. Apply with `squeal setup --yes` and one flag per answer; show the diffs; never commit. Offer the launcher. Say that a warm-up from the skill runs on the session's daemon and give `squeal warmup` for a terminal.

**Owns:** `plugins/*/skills/setup/**`, the skill-copy test, and the plugin build or manifest lines only if a new skill directory must be listed. **Leave alone:** `src/cli/setup/` (ask in a request if a flag the skill needs is missing), `plugins/*/skills/squeal/` (005-15).

**Done when:** both copies identical (test); a test that every `squeal setup` flag the skill names exists in `src/cli/setup/command.ts`'s usage; the skill text stays under the existing skill size test; lint, typecheck, suite green.

## 005-33 review of wave 3

Use /reviewer. Range: the 005-21, 005-15 and 005-19 commits and the 0.1.146 build on main; ignore 001 and 006 commits. Read D1, D3 "The skill", D6 and `status.md` 2026-10-13.

**Look hardest at:**
- 005-21: does every count of checks a model reads (status, delivery header, `status --wait`, registration's `Known failures`) split tests and test files loaded, with the parts summing to the total? Is the 10,000-character cap held? Does S2's join pick the right checkpoint when two end at once?
- 005-15: does any primer or skill sentence claim what Squeal does not do (silence means a pass only for checks Squeal ran; the re-run once and its exceptions)? Does the primer stay under 1,500 characters in both harnesses with every coverage name intact?
- 005-19: does the skill write nothing in a session that cannot ask (`-p`, Codex outside Plan mode)? Does every answer map to a flag `squeal setup` takes, `--slow none` included? Does it never commit or stage? Is the Codex copy reachable without the build copying it?

**Rules:** no model session, never the real `claude` or `codex`; stub CLIs in scratch homes only; scratch roots inside your own directory. Output `reviews/wave-3.md` on your branch; change no source.
