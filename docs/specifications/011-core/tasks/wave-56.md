# Wave 56: row 011-262

Coordinator 04a258b0, 2026-10-26. One row. Row 011-261 (gh-105's automatic-rule research) runs in a separate session from `research/issue-105-auto-brief.md` and shares no file with this row. Host policy (2026-10-25): no local full suite, no `squeal run --all`; affected results through `squeal status --wait 60000 <paths>`; every test command with `env -u PLUGIN_ROOT -u PLUGIN_DATA`; private `/tmp` fixtures only; never make CPU load on purpose. No `npm run build`. Not yours: the board, spec text, `status.md`, bundles, version. Notes in `tasks/011-262/notes.md`.

## W1: row 011-262 (the change notice names its paths and says which git ignores)

Use /worker. Shape: slice.

Outcome: a change delivery names the changed paths as the full header does, and marks each one git ignores, so an agent sees why tests re-ran.

Read: the board row; `research/issue-105-findings.md` section 4; 001 D6 and task 001-407 (why the news form dropped the paths).

Seam and lead: `newsLine` (`src/core/delivery/header.ts:116`) drops `changedPaths`; `fullLine` (`:95`) shows them through `changedText` (`:43`). Add the same clause to the news form, and mark an ignored path, for example `(changed .ai/qa/test-env.json, git-ignored)`. No stored field says a path is ignored: the daemon knows its extra files (`keying.ts:689`). Find the cheapest source the hook can read, with no `git` process per delivery. If it needs a store field, a `StatusHeader` field or a `--json` change, send me the shape first.

Owns: `src/core/delivery/header.ts`, `src/core/delivery/liveness.ts`, the source you pick for the ignored mark, and their tests.

Done when: a delivery after an edit names up to three paths and "and N more"; an ignored path carries the mark in both forms; a test reproduces findings E1's descriptor step (`.ai/qa/test-env.json` rewritten, `git status` empty) and shows the mark; `test/keys/key-format.test.ts` and the delivery and header tests pass; lint and typecheck pass.
