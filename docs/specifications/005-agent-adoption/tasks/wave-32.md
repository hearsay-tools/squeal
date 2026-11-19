# 005 wave 32: the fixed Codex plugin's skill texts (adapter 1.0.4) and the empty lint tools reason

Rows 005-129 and 005-130. The human, 2026-11-19: "Yes, keep it consistent. One off hooks approval is a small price to pay for consistency." (the Codex adapter release) and, as a follow-up to take, "The small lint-reason defect". Coordinator: session 4d2ecbfc. One worker for both rows; then one candidate, CI, review, landing, release.

Read first: `../../002-codex-adapter/spec.md` D7 (the fixed plugin and why a change of it is an adapter release), `src/harness/codex/build-adapter.ts` (its head comment and `CODEX_ADAPTER_VERSION`), `scripts/check-version-bump.ts` (the adapter rule), commit `236275066` (how adapter 1.0.3 was raised: which files), and `../reviews/0.1.565-r2.md` N1.

Rules: no `pnpm run build` and no `pnpm run build:codex-adapter` in your worktree, no runtime version raise, no full suite. Read Squeal's verdict on your changed paths (`squeal status --wait 60000 <path>...`), but do not wait longer than 20 minutes for a queue under load: then run the test files you changed directly, one at a time, with `timeout 900`. Never run a script under `evals/bin`.

## Row 005-129: the fixed Codex plugin says what the other skill copies say

0.1.565 gave every runtime skill copy a new description and removed "the primer" from the texts an agent reads. The fixed Codex plugin (`plugins/codex`) kept its two short skill files, because any change there is an adapter release. Codex reads the skill's description from the fixed plugin, so a Codex agent still gets the old trigger text.

1. `plugins/codex/skills/squeal/SKILL.md`: the `description` becomes, word for word, the description of `plugins/codex-runtime/skills/squeal/SKILL.md` (approved by the human; change no word).
2. In `plugins/codex/skills/squeal/SKILL.md` and `plugins/codex/skills/setup/SKILL.md`: "run the command the SQUEAL primer names" becomes "run the command the SQUEAL messages name". Check that the messages a Codex agent gets do name that command (the start message or the header); if they do not, stop and say so.
3. No other word of the fixed plugin's committed files changes. `hooks/hooks.json` is untouched: its ten handlers and their trust hashes stay. Say in your notes whether Codex's hook approval depends on the skill files at all (read `../../002-codex-adapter/` research and the adapter code; do not run Codex).
4. The seed (`plugins/codex/seed`) stays frozen at runtime 0.1.368: its skill matches its own runtime's long start message, and it is only the offline fallback. Do not touch it. If a test or `check:version` demands a seed refresh for an adapter raise, stop and report.
5. Raise the adapter version 1.0.3 to 1.0.4 the way commit `236275066` did (`CODEX_ADAPTER_VERSION`, `plugins/codex/.codex-plugin/plugin.json`, the test that pins it), and add the amendment line to `../../002-codex-adapter/status.md`.
6. If a test pins the fixed plugin's skill text or compares it with the runtime copy, update it; if none compares the two descriptions, add one small test that the fixed plugin's `squeal` description equals the runtime copy's, so they cannot drift again without a failing test.

## Row 005-130: `squeal checks` with an empty lint tools list

With lint on and `lint.tools: []`, a lint check's line says "Runs: never: a check above it owns each of its tools". No check above it owns anything. Say the true reason, in the style of the two existing "never" reasons, for example "Runs: never: lint.tools is empty (squeal.config.json)". `src/cli/checks-text.ts` near line 100 to 127. Add one CLI case. Update the reference sentence in the three runtime skill copies' `references/commands.md` only if it becomes untrue; the approved `SKILL.md` bodies and the start messages do not change.

Owns: `plugins/codex/skills/**`, `plugins/codex/.codex-plugin/plugin.json`, `src/harness/codex/build-adapter.ts` (the version constant only), `src/cli/checks-text.ts`, their tests, `docs/specifications/002-codex-adapter/status.md`, `tasks/005-129/notes.md`.

Done when: the points above; lint and typecheck clean; `pnpm run check:version origin/main` output quoted in the notes (it will still ask for the runtime version raise, which the coordinator does; the adapter line must be satisfied); notes list every changed sentence, before and after.

Final message: the commits, every changed sentence, the answer to point 3, check results with their commands.

## Review brief: the candidate of rows 005-129 and 005-130

Use /reviewer. Review the range `origin/main..` the SHA your task names: the two rows' commits, then the version raise with the built bundles.

1. The fixed plugin's `squeal` description equals the runtime copies' approved description, word for word; the two "SQUEAL messages name" sentences are true for what a Codex agent receives.
2. Nothing else in `plugins/codex` changed except the adapter version: hooks, dist, bin and seed are byte-identical to main. The adapter version is raised everywhere it is pinned, and an installed 1.0.3 moves to 1.0.4 by the existing update path (read the code; do not run Codex).
3. What a Codex user must do after this release (approve again: what exactly), stated in one plain paragraph for the human.
4. `squeal checks`: the empty tools list gives a true reason; the disabled, fully owned and unowned cases of review 0.1.565 still hold.
5. `test/keys/key-format.test.ts`; no approved text changed.

Test policy: no full suite; read CI for the candidate. Run single test files directly, one at a time, with `timeout 900`. Never run a script under `evals/bin`. No artificial load.

Write `docs/specifications/005-agent-adoption/reviews/<version>.md`: PASS or FAIL first, then blocking findings (B), should-fix (S) and notes (N), each with file and line and a failing scenario.
