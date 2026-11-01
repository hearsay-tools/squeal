# 017 Lint checks: dogfooding lessons

## Round 1 (017-13)

Task 017-13, 2026-11-01, worker 4a90e840. Ten real `claude -p` sessions on Sonnet, five in a clone of `saas-bp-management-dashboard` (ESLint 9.39.2, an Nx monorepo) and five in a clone of `sveltejs/svelte` (ESLint 10.0.0, typed rules), with the released Squeal 0.1.390 and `"lint": { "enabled": true }`. The brief is `tasks/wave-3.md`, "017-13". The setup, the scripts and what went wrong in the runs are in `tasks/017-13/notes.md`; the scripts are in `tasks/017-13/bin/`. Every SQUEAL line quoted here is copied from a session's stream. Every lint transition, and every changed file's state at the end of a session, was checked against a fresh `eslint` CLI run on the same bytes (`bin/verify.mjs`). `tasks/017-13/timelines.txt` holds each session's timeline, its worker CPU and these checks.

### Verdict

When Squeal judged a file, its result equalled a fresh CLI run, with one exception (L3). But the check seldom reached the agent: 2 lint lines in 10 sessions, one right and one noise.

- **Results.** The first passes equal the CLI on 382 of 382 Svelte files, on all 6 failing saas files with the root config, and on 2,442 of 2,454 saas files with the projects' own configs. The other 12 are false findings: the worker runs in the daemon's directory, and the saas import resolver reads `tsconfig.base.json` relative to it (L3). All 5 transitions recorded in the sessions equal the CLI in outcome, findings added and findings removed. Every changed file Squeal judged at the end equals the CLI.
- **Lines.** s2's agent fixed two `react-hooks/exhaustive-deps` findings and got `PASS lint: … no findings` 0.1 s after its Bash call ended. s3's agent moved code and got `FAIL lint: … 2 findings, +2 react-hooks/exhaustive-deps, -2 react-hooks/exhaustive-deps`: the same two findings, whose message holds a line number (L5). The agent read it right: "the same warnings shifting line numbers".
- **Lost.** Two agents added a console call that Svelte's config makes an error, and neither heard. In v5 Squeal stored the right `FAIL` 0.97 s after the edit's revision, but the hook after the edit came 0.44 s before it, and the Stop hooks, 3.6 s after it, carry no lint news (L6). In v1 the turn ended 2.3 s after the edit, and the lint then timed out (L4).
- **Svelte.** Squeal judged 1 of the 5 edited files, in v5, whose worker the reset before the session had warmed. The other four read `unknown: timed out after 5 s`: a cold typed lint of one Svelte file takes 6.8 to 7.3 s at load 17, over D3's 5 s guard (L4). Svelte's ESLint plugin loads the repository's own compiler, so 233 of the 382 linted files are config inputs, and an edit to one re-keys all 382 (L9). After v3 and again after v5, lint went off: `the ESLint worker failed 3 times; timed out after 5 s`.
- **saas.** It needed two changes before lint ran at all. Its config loads only through pnpm's bin shim (L1). Under ESLint 9, Squeal lints all files with the root config, which turns no rule on for TypeScript; the rules are in 24 per-project configs (open question 4, L7). With both changes, the edited file is judged 0.19 to 0.22 s after its revision. But each edit makes all of about 2,300 other files stale, and their re-lint costs 8 to 19 s of CPU when the agent is idle (L8).
- **Agents.** Two agents ran ESLint themselves, both in the same Bash call as their edit (s2, v2). No agent ran `squeal lint`. No agent changed code because of a lint line; the one `FAIL` line was noise.

Open questions:

- **Open question 1 (TypeScript's share of memory).** About half or more. On Svelte's 382 files, the CLI peaked at 1,543 MB with typed rules and 713 MB with them off (typescript-eslint's `disableTypeChecked`). One file, cold: 777 MB and 272 MB. A project without typed rules still needs much more than D10's 350 MB on a large repository: the saas daemon, with no typed rules, peaked at 2,192 MB in its first pass and held 491 MB idle.
- **Open question 4 (a monorepo with several ESLint installs).** saas has one install and 24 configs. One worker per install is right there; the gap is config lookup. ESLint 9 with `cwd` at the root uses only the root config, as plain `eslint` and the repository's lint-staged hook do; `nx lint` uses each project's config. Root config: 6 of 2,608 files with findings, all `Unused eslint-disable directive`. With `ESLINT_FLAGS=v10_config_lookup_from_file`, ESLint 10's default, one worker used all 24 configs: 25 files with findings, and 94 files `unknown` in two projects whose own config crashes a rule (the CLI crashes on them too). That one worker peaked at 2,192 MB and held 491 MB idle.
- **Open question 5 (which repository dogfoods it).** saas, with L1, L3 and L7 fixed: it is the human's own project, its rules are real (`react-hooks`, `import/order`), and its edited files lint in 0.2 s. Svelte stays the typed ESLint 10 case for regressions, and works only after L4. Neither works as installed today.
- **Goal 9 (cost with the load).** Neither repository is in goal 9's scope, since saas has cross-file rules and Svelte typed rules; no measured edit met 60 ms. saas: the edited file costs 0.11 to 0.16 s of worker CPU (4 edits, load 14 to 16), and each session's idle re-lint 8.3 to 19.1 s. Svelte: the one judged edit cost 0.44 s of worker CPU in 0.97 s (v5, warm worker, typed); the idle re-lint after a runtime edit 32.9 to 40.5 s (v4, v5); a compiler edit 44.6 to 57.6 s (v1 to v3), in a full re-key with timeouts and restarts. Load 12 to 17 throughout. Memory: daemon peaks of 1.1 to 2.4 GB in the sessions; see the tables below.

### Setup

| Item | Value |
| --- | --- |
| Isolation | The OS user `squeal-e2e`, case root `/home/squeal-e2e/runs/d1713`; credentials by name only; scratch `/tmp/dogfood-017-13/w-4a90e840` (`notes.md`) |
| Squeal | 0.1.390 from `git archive squeal--v0.1.390`, at user scope in the case's Claude Code |
| Harness and model | Claude Code 2.1.300, `claude -p --model sonnet`, bypass permissions |
| saas clone | `b36f7150` with two commits: `squeal.config.json` with lint on, and `.npmrc` with `public-hoist-pattern[]=*eslint*` (pnpm 9's default; L1). pnpm 10.26.2, Node 24.21.0. Sessions ran with `ESLINT_FLAGS=v10_config_lookup_from_file` (L7) |
| Svelte clone | `356c8766a` (the survey's commit) with two commits: lint on, and the config's own TODO rule `@typescript-eslint/no-unused-vars` as a warning in `packages/svelte/src/compiler/**`, because Svelte lints clean and kinds 2 and 3 need findings. pnpm 10.33.4, TypeScript 5.5.4 |
| Sessions | Started 21:07Z to 21:35Z; the last settle wait ended at 21:46Z. Kinds 1 to 4 of the brief in each repository, plus a second try at kind 1 in each (s5, v5), because s1 added no finding and v1's line was lost. v4 moved from `src/utils.js` to a runtime file, because `utils.js` is a config input (L9) |
| Load gate | Every session started at a one-minute load of 24 or below: 11.8 to 16.8 |
| Cleanup | At 21:46:38Z `squeal stop` in both clones found no daemon left, and `ps -u squeal-e2e` listed no process. The clones stay in the case root as evidence |
| Checks | `bin/compare.mjs` (a first pass against one CLI run), `bin/verify.mjs` (each transition and each changed file against a CLI run on the same bytes, rebuilt from per-session snapshots), `bin/repro-cwd.mjs` (L3) |

### First passes

| Pass | Files | To the end | Worker CPU | Daemon RSS: start, end (peak) | Load | Against the CLI |
| --- | --- | --- | --- | --- | --- | --- |
| Svelte, first | 382 | 30.9 s | 25.4 s | 83, 1,801 (1,850) MB | 7.0 to 7.9 | 382 equal. CLI: 12.9 s wall, 16.9 s CPU, 1,514 MB |
| Svelte, config change (the TODO rule on) | 382 | about 29 s | 19.4 s | 836, 1,983 MB | 11 | 382 equal, 17 with findings |
| saas, root config | 2,608 | 25.2 s | 19.1 s | 89, 1,554 (1,586) MB | 10.5 to 11.1 | the same 6 failing files. The CLI also lints 172 git-ignored files |
| saas, each project's config (`ESLINT_FLAGS`) | 2,575 | 36.8 s | 27.9 s | 63, 2,058 (2,192) MB | 15.7 to 17.1 | 2,442 of 2,454 equal; 12 false findings (L3). CLI: 27.2 s wall, 38.1 s CPU, 1,604 MB |

Idle RSS some minutes later: Svelte 836 MB, saas 491 MB. Per file: Svelte 66 ms of CPU (typed), saas 11 ms (`import` plugin).

### The sessions

Times are seconds from the session's start. "Edit to line" is from the end of the tool call that wrote the file to the hook that carried the line. The registration line (`Lint: N files with findings; squeal lint lists them.`) opened every session and was right each time: 25 in saas, 17 in Svelte.

**s1 (saas, kind 1).** Task: `FileSize` shows the exact byte count in a tooltip. Load 14.7; 11.2 s. One `Write` at 8.6 s; the agent added `react-intl`'s import in the right group, so no finding. No lint line; the CLI agrees (no findings). Right, but kind 1 not reached.

**s2 (saas, kind 2).** Task: fix the two `react-hooks/exhaustive-deps` warnings in `profile.component.tsx`. Load 15.3; 26.1 s.

| t | SQUEAL line | Edit to line | Agent's next action | Right? |
| --- | --- | --- | --- | --- |
| 11.45 | `PASS lint: packages/webapp/src/routes/profile/profile.component.tsx: no findings` | 0.1 s after the Bash call ended; 5.0 s after the write inside it. Stored 0.19 s after the revision | It had already run `npx eslint` in the same call. It ran `prettier --write`, reverted the unrelated reformatting, and applied the fix again. Its final message: "ESLint now runs clean on the file" | Yes: the CLI removes the same two findings |

**s3 (saas, kind 3).** Task: move the menu types and a helper from `sidebar.component.tsx` to a new `sidebar.utils.ts`. Load 15.6; 21.1 s; five edits.

| t | SQUEAL line | Edit to line | Agent's next action | Right? |
| --- | --- | --- | --- | --- |
| 16.41 | `FAIL lint: packages/webapp/src/shared/components/layout/sidebar/sidebar.component.tsx: 2 findings, +2 react-hooks/exhaustive-deps, -2 react-hooks/exhaustive-deps` | 0.1 s | Its final message: "Squeal's lint check reported the component's two `react-hooks/exhaustive-deps` findings as one added and one removed each. I read that as the same warnings shifting line numbers after the types were removed." | The findings, yes: the CLI agrees. The news, no: the same two findings, whose messages say "(at line 136)" and "(at line 157)" instead of "(at line 170)" and "(at line 191)" (L5) |

Three such transitions were stored (revisions 12, 13 and 15); the line above carried the first two. The third came 0.4 s after the last edit and was never told: the Stop hooks 3.9 s later carried nothing (L6). The new file had no findings, and no line, which is right.

**s4 (saas, kind 4).** Task: an optional `actions` prop on `PageHeadline`. Load 14.6; 14.3 s; two edits. No lint line; the CLI agrees. Right.

**s5 (saas, kind 1, second try).** Task: replace `RelativeDate`'s `title` with the app's tooltip, then show the diff. Load 16.7; 16.6 s. The agent placed the new import correctly again. No lint line; the CLI agrees. Right, and kind 1 not reached in saas: Sonnet's code met the few rules on in these projects in s1, s3, s4 and s5.

**v1 (Svelte, kind 1).** Task: `compile()` prints the file name and the `generate` option, for local debugging. Load 11.8; 9.2 s.

| t | SQUEAL line | Edit to line | Agent's next action | Right? |
| --- | --- | --- | --- | --- |
| — | nothing. The `console.log` is a `no-console` error by Svelte's config. The PostToolBatch hook 0.03 s after the edit carried nothing, and the Stop hooks at 8.5 s carried nothing | — | Its final message: "I didn't run any tests or lint." | No: a lost `FAIL`. The edit to `compiler/index.js`, a config input (L9), re-keyed all 382 files. The edited file reads `unknown: timed out after 5 s` (L4). The daemon then exited 3 s after the session, with 381 files pending |

**v2 (Svelte, kind 2).** Task: remove the unused imports in `phases/1-parse/read/expression.js`. Load 16.8; 20.3 s. The agent ran `npx eslint` on the file before its edit and again in the same call as its `sed` edit. No lint line. The file reads `pass` with no transition: the edit re-keyed every file as a config change, which records none (L9). 32 other files ended `unknown: timed out after 5 s`. The CLI agrees the file is clean.

**v3 (Svelte, kind 3).** Task: move four private helpers in `compiler/utils/mapped_code.js` below the exported functions. Load 13.2; 12.7 s. No lint line, which is right: the one finding stays. After the session the re-key timed out three times, and lint went off: `Lint: off: the ESLint worker failed 3 times; timed out after 5 s.`, with 349 files pending. A new daemon at the next session turned it on again.

**v4 (Svelte, kind 4).** Task: rewrite `safe_not_equal` in `internal/client/reactivity/equality.js` as `if` statements. Load 16.0; 11.3 s. The file is not a config input, so this was a plain edit. No lint line, and the file reads `unknown: timed out after 5 s` to the end: the session's daemon had started at the reset, its keys all hit, and so its first lint, after the edit, built TypeScript's program cold (L4). The other 381 files read `stale` and waited for the tests the edit queued to free a slot in the run pool (D7). They settled 281 s after the session, with 17 files `unknown`, 4 of them failing before. The CLI finds no finding in the edited file, so silence is right, by chance.

**v5 (Svelte, kind 1, second try).** Task: `set_class` in `internal/client/dom/elements/class.js` logs the old and new class with `console.debug`, for local debugging; then show the diff. Load 15.6; 12.1 s. The file is not a config input, and the reset before the session had linted `equality.js` again, which warmed the worker.

| t | SQUEAL line | Edit to line | Agent's next action | Right? |
| --- | --- | --- | --- | --- |
| — | nothing. Squeal stored `pass-to-fail +no-console` at 7.72 s, 0.97 s after the revision. The agent had sent its edit and `git diff` in one batch; that batch's PostToolBatch hook, at 7.28 s, came 0.44 s before the result. The Stop hooks at 11.29 s carried nothing | — | Its final message showed the diff. It never mentioned lint | The stored result, yes: the CLI agrees. The delivery, no: a right `FAIL`, 3.6 s old at Stop, never told (L6) |

After the session the idle re-lint of 381 typed files timed out three times, and lint went off again, with 253 files stale and 32 `unknown`.

### Cost and load

- **The edited file.** saas: 0.19 to 0.22 s from the revision to the stored transition, 0.11 to 0.16 s of worker CPU, at load 14 to 16 (4 edits). Svelte: once, 0.97 s and 0.44 s of worker CPU with a warm worker at load 15.6 (v5); the other four timed out.
- **Idle re-lint.** In saas the `import` plugin makes every file a whole-program file (D5), so each edit moves every other file's key. After s2 to s5, the worker spent 8.3 to 19.1 s of CPU re-linting about 2,300 files. In Svelte, after a runtime edit, 381 typed files went stale; their re-lint waited for the tests the edit queued (v4) and cost 32.9 to 40.5 s of worker CPU (v4, v5).
- **Config re-key in Svelte.** v1 to v3, one compiler edit each: 44.6 to 57.6 s of worker CPU after the session, with timeouts and worker restarts.
- **Cold typed lint.** One Svelte file through the CLI: 6.8 to 7.3 s wall, about 10 s of CPU, 777 MB, at load 16.8 to 18.5. Typed rules off: 1.2 s and 272 MB.
- **Memory in the sessions.** saas daemon: 457 to 746 MB at the start, 1,074 to 1,228 MB at its peak. Svelte daemon: 930 to 1,614 MB at the start, 1,444 to 2,422 MB at its peak.
- **Load.** 11.8 to 16.8 at the starts, 12.5 to 17.2 at the ends, from this round and other coordinators' work. The host has 24 cores.

### Other observations

- **A daemon exits 3 s after its last session, with lint work pending** (v1: 381 files). The next daemon takes it up. With `claude -p`, each session therefore starts a daemon whose worker is cold.
- **A daemon restart writes a `config` keying** although nothing changed: the keying count went from 4 to 6 over one restart, with the same environment hash, and every key hit. No session got a `Lint config changed` line from it here, but D8 tells one for each such keying, and Stop's keying cut drops the earlier failures.
- **Wording.** While the config does not load, `squeal status` says `Lint: linting has not started.` beside `Lint: unknown: eslint.config.js does not load: …`, and `squeal lint` says `Lint: 0 files with findings` and `Linting, 0 of 0 files.`, which reads as a clean repository. During a config re-key the status JSON shows `pending` without `linting`.
- **Not lint.** saas's daemon noted `vitest could not start: vitest/node does not resolve` at every revision: the repository has a Vitest config file but no Vitest installed at the root.

### Proposed rows

The coordinator assigned the final numbers, 017-17 to 017-25 (017-14 to 017-16 are oxlint rows). None of these is fixed here. Reproductions name the scripts in `tasks/017-13/bin/` and the clones in `notes.md`.

| Row | Problem, with the evidence | Done when |
| --- | --- | --- |
| L3, 017-17 the worker's process directory gives false findings | The worker inherits the daemon's process directory, `<root>/.git/squeal`. saas's `eslint-import-resolver-typescript` setting `project: 'tsconfig.base.json'` resolves against it, so `@sb/...` imports do not resolve: 12 of 2,454 files get false `import/order` and `import/no-unresolved` findings, stored under their keys and shared by key. Reproduced outside Squeal with ESLint's own API (`bin/repro-cwd.mjs`): from the root, no findings; from `.git/squeal`, Squeal's findings. typescript-eslint's relative `parserOptions.project` without `tsconfigRootDir` resolves the same way. Proposal: the worker sets `process.cwd` to return the project root before it loads ESLint (a worker cannot `chdir`, but its `process.cwd` is its own); `PROVIDER_VERSION` moves, so stored results are not reused. D3 amendment ("nothing relies on it" is not true of configs) | A provider test with a fixture whose resolver reads a tsconfig by a relative path: Squeal's findings equal the CLI run from the root, with the daemon's directory elsewhere |
| L4, 017-18 a cold typed worker times out, and lint goes off | D3's 5 s guard covers the first lint in a new worker, which builds TypeScript's program. On Svelte that took longer at load 12 to 17: one cold file through the CLI took 6.8 to 7.3 s. So 4 of 5 edited Svelte files read `unknown: timed out after 5 s` (v1 to v4), 17 to 33 other files too after a re-key or an idle re-lint, and after v3 and v5 the third timeout turned lint off. The 017 wave 1.7 notes predicted this. Proposal: the guard starts after the worker reports its program built, with a separate start budget (for example 60 s) for the program and the config; a timeout in that budget is reported as such | A provider test on a typed fixture whose program takes longer than 5 s to build: the first lint gives the CLI's result, and a lint that blocks after the build still times out at 5 s |
| L1, 017-19 a config that loads only through pnpm's bin shim | saas's root config requires `@eslint/js` and `jsonc-eslint-parser`, which it does not declare. pnpm 10 puts them only in `node_modules/.pnpm/node_modules`, which its `node_modules/.bin/eslint` shim adds to `NODE_PATH`. `node_modules/.bin/eslint` works; plain `node node_modules/eslint/bin/eslint.js`, like Squeal's worker, fails, and Squeal said `Lint: unknown: eslint.config.js does not load: Cannot find module '@eslint/js'` for every file. Proposal: when the project's ESLint is installed by pnpm and `node_modules/.pnpm/node_modules` exists, the worker resolves the config's modules with that folder on its path, as the shim does; status names the folder | An integration test with a pnpm fixture whose config requires a package found only in `.pnpm/node_modules`: Squeal's results equal `pnpm exec eslint`'s |
| L2, 017-20 no retry after the config's missing package is installed | `pnpm add -D -w @eslint/js` ended at 20:50:18Z (revisions 1 to 3: `pnpm-lock.yaml`, a build file, `package.json`). At 20:52:53Z the failure count was 15 and the message was the old one; only a daemon restart cleared it. The tracked `pnpm-lock.yaml` and `package.json` are not refresh triggers in `refresh.ts`, the installed lockfile's change did not reach the pass as a changed path, and the kept ESLint instance keeps its failed load (inferred). Proposal: after a pass whose config did not load, a change to `package.json`, a lockfile or the installed lockfile refreshes at `thread` level | An integration test: a config that requires a missing package reads `unknown`; after the package is written and the lockfile changes, the next pass gives the CLI's results without a daemon restart |
| L9, 017-21 an edit to a config input hides the agent's own transitions | Svelte's ESLint plugin loads the repository's own compiler, so 233 of the 382 linted files are config inputs. An edit to one of them is a config keying (D4 level 3, D2's last row): all 382 files re-key, no file records a transition, and the agent's own fix is never a `PASS` (v2). Proposal: a config keying still records the transitions of the files whose own bytes the revision changed, judged against their last judged result | A pass test: one revision changes a config-input file that is also linted and fixes its finding; that file records `FAIL -> PASS`, the other files re-key with no transition |
| L5, 017-22 a line number inside a message defeats the fingerprint | `react-hooks/exhaustive-deps` says "… useCallback Hook (at line 136) …". A pure move changed 170 and 191 to 136 and 157, so the fingerprint changed and s3 got `FAIL lint: … +2 react-hooks/exhaustive-deps, -2 react-hooks/exhaustive-deps`. Proposal: the fingerprint and the added/removed match use the message with `line N` and `(at line N)` numbers replaced by a placeholder; or ESLint's `messageId` with its data when the rule gives one. `PROVIDER_VERSION` or the fingerprint version moves | The replay of 016-33's seven edits still gives the a-set column, and s3's move gives no transition |
| L6, 017-23 the last edit's lint result is lost at the end of a turn | The hook after an edit comes 0.03 to 0.7 s after it; the lint result 0.19 to 0.22 s after the revision in saas and 0.97 s in Svelte with a warm worker; a `claude -p` turn ends 2 to 5 s after its last edit. No hook after that carries lint: the Stop hook tells lint only beside other news (017-10 decision 2). In v5 a right `FAIL` (`no-console`) was stored 0.44 s after the edit's hook and was 3.6 s old at Stop; in s3 a stored change was 3.9 s old. Neither was told. A product decision. Options: (a) the PostToolBatch hook waits up to 750 ms for the lint of the files the batch changed, when lint is on; (b) Stop blocks once to tell a new `FAIL` the agent's own edit made, even with `lint.blocking` off; (c) leave it. My default is (a) | With (a): a delivery test where an edit adds a finding whose lint takes 300 ms: the PostToolBatch hook after the edit carries `FAIL lint`, and a hook without lint work waits for nothing |
| L7, 017-24 ESLint 9 monorepos lint with the root config only | Under ESLint 9, Squeal's `cwd` at the root uses only the root config. saas's 24 per-project configs, which `nx lint` uses, were never read: 6 files with findings instead of 25. ESLint 9.39 reads the flag `v10_config_lookup_from_file` (ESLint 10's default) from `ESLINT_FLAGS`, which the worker inherits; with it, Squeal used all 24. `ESLINT_FLAGS` is not one of D5's keyed variables. Proposal: key `ESLINT_FLAGS`; with ESLint 9 and a nested `eslint.config.*` in the listing, status says `Lint: N nested ESLint configs are not used; ESLint 9 uses the root config` and names the flag. Turning the flag on by itself is a product decision | A provider test with a nested config under ESLint 9: the status line appears; with `ESLINT_FLAGS` set, the nested config's findings appear and the key differs |
| L8, 017-25 every saas file is a whole-program file | D5 treats a file as whole-program when its config has rules of the `import` plugin. In saas that is every file, so each edit moves every other key, and the idle re-lint after each session cost 8.3 to 19.1 s of CPU for about 2,300 files. `import/order` and `import/no-unresolved` read only whether and where an import resolves, not the target's bytes. Proposal, with open question 3's research: classify by rule, and key a file whose cross-file rules only resolve by the listing's paths rather than every module's blob | A pass test: a saas-like fixture with only `import/order` on; an edit to one file's body re-lints no other file, and a new or removed file re-lints its importers |

Two smaller points belong in whichever row touches the wording next: `squeal lint` should not say `0 files with findings` while the config does not load, and status should not say `linting has not started` beside the load error.

### For the next worker

- Start a daemon after any reset between sessions and wait until lint keyed the latest revision; a status read right after an edit can still show the state before it. A daemon exits 3 s after its last session, so a post-session wait must start one again (`bin/session.mjs`, `settle`).
- In Svelte, a reset to the base hits stored keys, so the daemon's worker stays cold until the first edit. Expect L4 there until it is fixed.
- The raw streams, transcripts, snapshots and store copies stay under `/home/squeal-e2e/runs/d1713/` and `/tmp/dogfood-017-13/w-4a90e840/logs/` while the host keeps them (`notes.md`).
