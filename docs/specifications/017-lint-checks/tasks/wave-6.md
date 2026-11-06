# Wave 6: rows 017-29 (a grown closure re-keys only what it adds) and 017-30 (oxlint config discovery skips gitignored directories)

Coordinator e30ed1a7, 2026-11-06, from main 0.1.409. The human approved both ("Both", 2026-11-06). Cause and evidence: `../../011-core/research/issue-154-cause.md` F4 and F5. W1 and W2 own disjoint files and run in parallel. Version: 0.1.410, one candidate for both; the coordinator claims it at landing.

Host policy, as in `../../011-core/tasks/wave-60.md`: no local full suite, no `squeal run --all`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on every test command; private `/tmp` fixtures; never make CPU load on purpose; no `pnpm run build`; no real harness session under the real HOME. Not yours: the board, `spec.md`, `status.md`, `plugins/*/dist`, the `package.json` version. Read affected results with `squeal status --wait 60000 <paths>`; at high load, name the pending files and finish. The final message lists the decisions the spec did not settle and any type change. Notes in `tasks/<row>/notes.md`.

## W1: 017-29 (a lint part that grows the closure re-keys only what it adds)

Use /worker. Shape: slice, design first, then test first.

Outcome: after a restart, a lint part that reads a new rule input no longer moves the key of every check; each check is keyed at most twice at one revision on a fixture with lazily read rule inputs, and no stale result reads current.

Read: the board row 017-29; `issue-154-cause.md` F4 and its timeline (five full `config` keyings at revision 4, 7,106 results for 2,882 checks); spec 017 D5 (keys) and D7 (the pass); 011 C4 (validity).

Seam and lead: `grown()` and `ask()` in `src/core/lint/pass/lint-part.ts`, then `planOf()` in `src/core/lint/pass/rekey.ts`, where a moved `environment` makes the mode `config` for every file. First, write `tasks/017-29/design.md` (under one page): what the key holds today, which part of it a new closure input moves, and the narrowest rule that keeps validity, for example a closure input joins the keys only of the checks whose report read it, or the closure is fixed for a pass and the growth keys once more. Send it to the coordinator as a request and wait for the answer before code. Then a failing test: a fixture whose rules read two inputs lazily, one per pass, re-keys each check at most twice.

Owns: `src/core/lint/pass/**`, `test/lint/pass/**`. Leave alone: `src/core/lint/provider/**` (W2), `run.ts`'s `onKeying` contract from 011-302.

Done when: the new test passes, and the existing key-validity tests pass unchanged (an input a check read still moves its key). `key-format.test.ts` passes, or the notes name the lint key change and why. Lint and typecheck pass; affected results read. The notes have the D5 sentence to amend.

## W2: 017-30 (oxlint config discovery skips gitignored directories)

Use /worker. Shape: repair, test first.

Outcome: an `.oxlintrc.json` under a gitignored directory is neither a key input nor a config for tracked files, so cezarion's `.ai/qa/served/<task>/` clone no longer moves every lint key.

Read: the board row 017-30; `issue-154-cause.md` F5; spec 017 D11 and D5.

Seam and lead: `findConfigs()` in `src/core/lint/provider/oxlint/configs.ts` walks every directory but `node_modules` and `.git`. First edit: a test in `test/lint/provider/oxlint/` with a gitignored directory that holds `.oxlintrc.json`; `findConfigs` must not list it. Then make the walk skip ignored directories the way the pass already skips ignored files (see `offeredSet` in `src/core/lint/pass/keys.ts` and `unlisted.ts`); one Git call per walk, not per directory. Keep the 133–307 ms walk cost or lower (`../../011-core/research/probes/issue-154/configwalk.mjs` measures it; run it only at one-minute load at or below 24).

Owns: `src/core/lint/provider/oxlint/**`, `test/lint/provider/oxlint/**`. Leave alone: `src/core/lint/pass/**` (W1); ask first if the ignored list must come from there.

Done when: the new test passes; a config appearing or changing under an ignored directory moves no key (test); a tracked nested config still does; lint and typecheck pass; affected results read.
