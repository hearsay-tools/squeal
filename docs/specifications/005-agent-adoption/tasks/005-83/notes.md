# 005-83 notes: a Codex session's saved skill path survives plugin updates

Worker notes, 2026-10-26. Brief W1 in `tasks/wave-11.md` (baseline `c652d5a4a`); `research/issue-81.md` answers 4 and 5 and its recommendation; spec 005 D3; gh-81.

## Cause

1. Only SessionStart and SubagentStart put the line that names the saved skill before the primer (`skillLine`, `src/harness/codex/handlers.ts` 40 and 148 at the baseline). gh-81's session got no SessionStart text. Its first Squeal text was a PostToolUse registration, which had no skill line. The skill catalog is Codex's text and named `cache/.../0.1.275/`, which Codex's startup upgrade deleted four seconds after the session started (`research/issue-81.md` 1).
2. `prune` (`src/harness/shared/version-copies.ts`) kept the newest other copy and every copy whose path a running process names. A Codex session process names no copy, so a second install while the session lived removed the copy whose skill the session named (research probe step 3; the digest's live report of 2026-10-24, 0.1.289).

## What changed

- `src/harness/codex/kept.ts`: `registeredSkillLine(text, deps)`. For a text that ends with the primer, which at these hooks is the text that registers a consumer, it keeps this version's copy when none exists (`keepCodexCli`, the call SessionStart makes) and returns `skillLine`. For any other text it returns `""` and copies nothing.
- `src/harness/codex/handlers.ts`: UserPromptSubmit, PostToolUse and SubagentStart pass `registeredSkillLine(text, deps)` as `additionalContext`'s `keep`, so `capContext` puts the line before the primer and keeps both whole. SessionStart is unchanged.
- `src/harness/shared/version-copies.ts`: `prune` also keeps every copy whose directory was made in the last `KEEP_MS` (24 h). `madeAt` reads the directory's modification time. A copy whose time cannot be read is kept.

## Decisions the brief did not settle

- **The registering hook keeps the copy** (the coordinator's decision, 2026-10-26, option 2 of my request). This applies also beside a daemon that answers, where 005-81's `keepOnSpawn` copies nothing. Only the text that registers a consumer keeps the copy, and only when this version has none. A later hook of the same consumer copies nothing. The text still names the cache's CLI, as 005-81's spawning hook does; its next hook names the launcher. The D3 sentence ("a hook that registers its consumer, or spawns the daemon, keeps the copy") is the coordinator's at integration.
- **"Registers" is read from the text, not from the store.** At UserPromptSubmit, PostToolUse and SubagentStart, only `withPrimer`'s registration ends with the primer. The test is `trailingPrimer`, which `capContext` already uses to keep the primer whole. UserPromptSubmit registers inside `submitPrompt` (`src/harness/shared/prompt.ts`, not this row's), so its handler cannot see the consumer's state before. One rule covers the three hooks. A registration after the daemon expired an idle consumer (001 D10) names the skill again, with the primer it restates.
- **SubagentStart now keeps the copy too.** It registers a new consumer, so the same rule applies. Before, it named the copy only when one existed.
- **"Made" is the copy directory's modification time.** The copy is filled under `.<version>.<pid>.tmp`, and the rename in the same `versions/` directory keeps the time. Nothing writes into a whole copy afterwards. Copies made by earlier releases have the same property.
- **24 h counts from when the copy was made, not from its last use**, as the board row says. A session that started on a copy made more than 24 h before can still lose it after two installs. The digest states this price ("A session older than 24 hours can still lose its copy").

## Tests

Red first: each new test below failed before its change and passes after.

- `test/harness/codex/kept.test.ts`, `registeredSkillLine (005-83)`: in process, through `runCodexHook`, for `user-prompt-submit` and `post-tool-use`. The daemon answers, so nothing spawns. The first text ends with the skill line and the primer, and names `<data>/versions/<V>/skills/squeal/SKILL.md`. After `rm -rf` of the cache root, the skill and `references/commands.md` read. Then the copy is removed, a regression lands, and the next PostToolUse is a delta: no skill line, no copy. Two more cases: a text that registers nothing names and copies nothing; no `PLUGIN_DATA`, or a version that is no plain release, names nothing. With the baseline `handlers.ts`, the two hook cases fail; with the change, all 10 tests of the file pass.
- `test/harness/codex/version-copies.test.ts` (bundles of A and B): the 005-73 case "copies nothing at a hook before any SessionStart" now expects the copy and the skill line beside a socket that holds the daemon's place. A new case: the catalog names A, B is installed and A removed, the first text comes from B's UserPromptSubmit and names B's saved skill; after B's cache is removed too, the skill and `references/commands.md` read. Line 112 (the launcher's notice) is W2's and is not touched.
- `test/harness/codex/version-copies-hook.test.ts`: the 005-81 case "copies nothing at a PostToolUse or Stop whose daemon answers" is now "only the PostToolUse that registers keeps the copy; a later Stop copies nothing".
- `test/harness/shared/version-copies.test.ts`: "005-83: keeps every copy made in the last 24 h, whole, `references/` included". The copies are 0.1.1 (more than a day old), then 0.1.2 with `references/`, then two installs, 0.1.3 and 0.1.4. The result is 0.1.2, 0.1.3 and 0.1.4, and 0.1.2's references read. With 0.1.2 made a day ago, the next install removes it. `copied()` now backdates its copies by 25 h, so the older prune tests keep testing 009-18's rule. With the baseline `prune`, the new test fails (`0.1.2` removed); with the change, all 16 tests of the file pass.

None of these tests writes a `squeal.config.json` or checks a whole status, so 015 wave 12's `codeOff` does not apply to them.

## Measurement: the first copy's time in a hook

`first-copy.mts` (beside this file) builds the Codex plugin at 0.1.900 with `codexPluginAt`, then runs the bundled `post-tool-use.mjs` as Codex does, in temporary homes, beside a socket that answers the probe's ping, so no daemon is spawned. Each round has two cases: the first registration with no copy (the hook makes it), and the first registration in another repository with the copy already there. Command: `npx tsx docs/specifications/005-agent-adoption/tasks/005-83/first-copy.mts "$PWD" 5`, 2026-10-26 11:19, load 22.90 on 24 CPUs (the host's own load; nothing added).

| Round | Makes the copy | Copy there |
|---|---|---|
| 0 | 152.9 ms | 106.4 ms |
| 1 | 158.5 ms | 98.1 ms |
| 2 | 141.3 ms | 85.3 ms |
| 3 | 139.5 ms | 83.4 ms |
| 4 | 120.0 ms | 73.3 ms |

Median 141.3 ms against 85.3 ms: the first copy adds about 56 ms, once per version per machine. This includes the `ps -A` of `prune`. Every case named the skill. The hook's timeout is 2 s. The copy is `dist/` (9.2 MB) and `skills/` (72 kB) of `plugins/codex` (`du -sh`). `test/harness/codex/latency.test.ts` runs its hooks without `PLUGIN_ROOT` and `PLUGIN_DATA`, so it never copies. Its result is in "Checks" below.

A first run shared one runtime directory and one session id between the two repositories, and the second hook said nothing. The hooks keep a session's root per session id under `<runtime dir>/squeal-sessions` (`src/harness/shared/session-root.ts`), so the second hook went to the first repository, where its consumer was already registered and had no news. The script gives each repository its own runtime directory.

## Checks

Run in the worktree at `5a0d229b2`, 2026-10-26, at a host load of about 20 on 24 CPUs.

- `npm run lint`: "Checked 2234 files. No fixes applied."
- `npm run typecheck`: no errors.
- `env -u PLUGIN_ROOT -u PLUGIN_DATA squeal status --wait 60000 <the 7 changed source and test paths>` at revision 16: 268 test files selected; 244 pass; 4 checks fail, all bundle drift (`test/harness/codex/plugin.test.ts`, `test/harness/opencode/package.test.ts`, `test/harness/pi/package.test.ts`, `test/harness/plugin.test.ts`: "cli/squeal.mjs differs from the build"), expected without `npm run build`; 23 transitive readers still pending in Squeal's catch-up (daemon and CLI tests).
- Each of the 27 test files that imports a changed module directly (`codex/handlers`, `kept`, `index`, `hooks`, `main`, `shared/version-copies`) has a current result: all pass except `test/harness/codex/plugin.test.ts` (the drift above). This includes `test/harness/codex/latency.test.ts` and `test/harness/opencode/latency.test.ts`. Squeal's results for them were current, so none was run directly.
- Direct runs during the work: `npx vitest run test/harness/codex/kept.test.ts` (10 passed; 2 failed with the baseline `handlers.ts`) and `npx vitest run test/harness/shared/version-copies.test.ts` (16 passed; 1 failed with the baseline `prune`).

## Commits

- `9b485703e` feat(codex): the text that registers a consumer keeps the copy and names its skill (005-83)
- `5a0d229b2` feat(version-copies): prune keeps every copy made in the last 24 h (005-83)

## Open after this row

- **Stop as a first contact.** A main agent's Stop with no registration registers it (`newsText`, `src/harness/shared/stop.ts`). It is silent, or it blocks with the registration and no primer when failures are known. Its later texts are deltas, so such a consumer hears neither the primer nor the skill line. This row's done-when does not cover it, and `stop.ts` is not this row's file.
- **Bundles.** `plugins/codex/dist` is not rebuilt here (no `npm run build`). `test/harness/codex/plugin.test.ts` ("has the bundles exactly as `npm run build:plugin` produces them") fails until the coordinator's build.
- **D3.** Two sentences change: the registering hook keeps the copy (the coordinator's wording above), and pruning keeps every copy made in the last 24 h beside 009-18's rule.
