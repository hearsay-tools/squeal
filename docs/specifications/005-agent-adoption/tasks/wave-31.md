# 005 wave 31: ship the short start message, the skill texts and `squeal checks`

Row 005-128. The human, 2026-11-19: "Yes, ship all of it". Coordinator: session 4d2ecbfc. One worker; then a candidate, CI, review, landing.

Read first: `../research/start-message-experiment.md` (the evidence; read "Full check of the approved texts" and "Reading after the full check"), the amendments of 2026-11-19 in `../spec.md` and in `../../019-run-triggers/spec.md` D6, and the notes `../tasks/005-126/notes.md` and `../tasks/005-127/notes.md`.

Your baseline is main plus the experiment's commits (the product commits of row 005-126, the eval commits of row 005-127, the variant `primer-noskill`), without built bundles. In the experiment the new start message was one of four forms behind a switch, and the skill's new text reached the eval only as a variant patch. This row makes them the product.

Rules: no `pnpm run build` in your worktree, no version raise, no full suite. Read Squeal's verdict on your changed paths, but do not wait longer than 20 minutes for a queue under load: then run the test files of the directories you changed directly, one at a time, `timeout 900`. The bundle tests fail on drift until the coordinator builds, which is expected. `test/e2e/**` is outside Squeal's coverage: grep it, `evals/**`, `README.md`, `docs/` and every skill copy for each sentence you change, and run each e2e file that pins one, after the coordinator's build if it needs the bundles (then name it in your report). Write `~`, never a `/home/<user>/` path; the private-material check also rejects the company name and host names of this machine's network. **Never run a script under `evals/bin`, also not with `--help`.**

## The texts (approved by the human; change no word)

The four text sets are already in the tree, word for word:
- the start message with a skill and the one without: `src/harness/shared/primer-forms.ts`, forms `skill` and `no-skill`;
- the skill's description, its new steps 1, 4 and 8, the rewording of every "primer" reference and the step renumbering, in `SKILL.md` and the two `references/*.md` sentences: `evals/variants/primer-skill.json` (each patch's `replace` is the approved text; `tasks/005-127/notes.md`, "The full check", lists every change);
- `squeal checks`: as built.

Two more texts, from spec 023's coordinator, approved by the human, same change:
- `references/commands.md`, section "Red/green: checking that a test catches the bug": its first sentence becomes "While your fix is still uncommitted in your tree, show that a test fails without it and passes with it by letting Squeal run it rather than running it yourself." (the rest of that paragraph, the code block and the next paragraph unchanged); add a closing paragraph: "For a fix that is already committed, or when your tree must stay as it is, use `squeal proof <test file> --base <commit>` instead: it runs the old and the new side in temporary checkouts and changes no file in your tree (`--env` and `--without` for a hidden dependency, `--repeat` for a flaky test). To compare results with an earlier commit, use `squeal status --at <commit>`."
- the `SKILL.md` Reference bullet for `commands.md`: "and red/green through the wait" becomes "and red/green: through the wait for an uncommitted fix, `squeal proof` for a committed one".

## What to do

1. **The start message is the short one.** `primer()` returns the `skill` form, or `no-skill` where the harness ships no skill (`HookDeps.skill`, OpenCode). Remove the forms `full`, `minimal` and `minimal-rules`, the `PRIMER_FORM` switch, and every part of the long primer that nothing else uses (the coverage sentences, the folding to the cap, the moments sentence, the slow sentences, the retry sentence, the wait forms): find each by its callers; what `squeal checks` or another text still uses stays (for example `not-covered.ts`). Keep `PRIMER_CAP_CHARS` and `trailingPrimer` if Codex's cut of hook text still needs them, and say so. The registration header lines above the start message are unchanged.
2. **The skill.** Apply the approved text as real edits in the skill's source and every shipped copy (find how the copies are made: a build step or committed copies; `plugins/claude-code`, `plugins/codex-runtime`, `plugins/pi`, the Codex seed, and the short `plugins/codex` file for the description), with the two spec-023 edits. No copy names "the primer" afterwards.
3. **`squeal checks` and `description`**: as built; add `squeal checks` to `README.md` where the commands are listed and to the skill's `references/commands.md` with its output shape (short).
4. **Texts elsewhere that the long primer's removal makes wrong**: hook, status, Stop and `squeal --help` texts that say "the primer lists" or rely on a sentence the primer no longer has; the docs under `docs/` that describe the primer as product behaviour (not the research files, which are history).
5. **The eval.** Keep scenario `a12-manual-check`, the look-up context, the pooling and the coverage report. The variants `primer-minimal*.json`, `primer-skill*.json` and `primer-noskill.json` patch a switch that no longer exists: delete them, and keep the results files (they name their variant; say in `evals/README.md` in one line that those variants belonged to commit `cb70515eb` and its predecessors). Update `evals/lib/squeal-text.mjs` and every parser that reads the start message, each gated on the real formatter (`test/evals`). `own-run-covers` misses a completed node:test run whose summary lines were cut by `| tail` (`evals/lib/evidence.mjs`, `completedRuns`; the findings' section on `a5-uncovered`): fix it if the fix is small and exact (a run whose kept output shows a failing or passing test of the runner counts as completed), with a test from the two transcripts' shapes; else leave it and say so.
6. **Tests.** Every test that pinned the long primer is rewritten for the short one or removed with its subject; say how many of each. `test/keys/key-format.test.ts` passes.

Owns: `src/harness/**` for the primer and its callers, `src/cli/` for `checks` and help, the config's check type, every skill copy and its source, `evals/**`, `README.md`, the tests of all of these. Leave alone: `src/cli/status-at*`, `src/cli/proof*`, `src/core/proof/**`, `src/core/commit/**`, `src/core/checkout/**` (spec 023's rows run there).

Done when: the points above; `grep -rn "PRIMER_FORM\|minimal-rules" src evals test` finds nothing; no file under `plugins/*/skills` or `src` names "the primer" as something the agent reads; lint and typecheck clean; `tasks/005-128/notes.md` lists what was removed (functions and line counts), what stayed and why, and every agent-read sentence that changed outside the four approved text sets, before and after (those go to the human).

Final message: the commits, the removal count, any sentence changed beyond the approved texts, the e2e files that need the build, check results with their commands.
