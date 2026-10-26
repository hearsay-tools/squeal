# Wave 11 (run by 011's coordinator)

From main after 0.1.335, 2026-10-26, by 011's coordinator 04a258b0, which takes these two approved 005 rows (the human, 2026-10-25, triage round 10, digest group D). Both hit running sessions at each plugin update; 20 releases shipped on 2026-10-25. Two rows on disjoint seams. Dispatched 2026-10-26 from main `c652d5a4a`: W1 worker 110d4b31, W2 worker 0ad34ff8. Verification follows `docs/process.md`, "Test runs on a shared host" (2026-10-25): no `squeal run --all` and no local full suite.

## W1: 005-83 (gh-81), a Codex session's saved skill path survives plugin updates

Use /worker. Shape: slice. Row 005-83; `research/issue-81.md` (answers 4 and 5, the recommendation); spec 005 D3.

Outcome: a Codex consumer's first Squeal text names the saved skill whichever hook sends it, and `prune` keeps every copy made in the last 24 h beside the newest other, whole, `references/` included.

Seam: `skillLine` is added only at SessionStart and SubagentStart (`src/harness/codex/handlers.ts:40`, `:148`). First edit, offered as a lead: decide "first text for this consumer" where the registration header is built, and pass `skillLine` there for UserPromptSubmit and PostToolUse too. Then `prune` (`src/harness/shared/version-copies.ts:214`).

Owns `src/harness/codex/handlers.ts`, `kept.ts`, `src/harness/shared/version-copies.ts` and their tests. Not yours: `plugins/*/bin/` (W2), the board, spec text, `status.md`, bundles, version. No `npm run build`.

Done when the row's done-when holds: a test where the first text comes from UserPromptSubmit or PostToolUse after the cache version was removed (`rm -rf` as the stand-in) names a readable saved skill; two installs inside 24 h keep the older copy with `references/`; the version-copies tests pass.

## W2: 005-84 (gh-85), the version-mismatch notice prints once per version pair per session

Use /worker. Shape: slice. Row 005-84; `research/issue-85.md`; spec 005 D3.

Outcome: an unchanged pair of versions prints its notice once per session (else once per machine), a changed pair prints again, and the two lines become one that names the CLI that runs, each harness's plugin, and the version older Codex sessions keep.

Seam: the launcher's one source, `plugins/claude-code/bin/squeal-launcher` (its notices from about `:87`); the build copies it (`src/harness/build.ts:67`). First step: answer the row's first question, which session id a Codex hook's launcher call can read, from Codex's own docs or source; send the answer to the coordinator as a request before you build on it. The mark lives in the plugin data directory.

Owns the launcher source, `test/cli/launcher.test.ts` and `install-fixture.ts`. Not yours: W1's files, the board, spec text, bundles, version. No `npm run build`.

Done when, in `test/cli/launcher.test.ts`, an unchanged pair prints once, a changed pair prints again, and validation output is unchanged.

## All workers

Run lint and typecheck, then `squeal status --wait 60000 <changed paths>`, with `env -u PLUGIN_ROOT -u PLUGIN_DATA`, and paste the output. The installed Squeal may still be 0.1.334, whose selection of a source path can miss readers (row 011-233): run each test file that imports a changed module directly when its result is not current, and say so. Write `tasks/<row>/notes.md` with the cause, the evidence and the commits. Never touch the real `~/.codex`, `~/.claude` or plugin data; tests use temporary homes. Make no CPU load on purpose.
