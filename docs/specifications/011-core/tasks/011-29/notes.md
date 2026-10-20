# 011-29 notes: decisions the brief did not settle

Row 011-29 (`tasks/011-24/briefs.md`, design `tasks/011-24/design.md` sections 1.1 to 1.3, 3, 4 and R4; 011 C6 as amended 2026-10-20). Worker run `c64881ab`, 2026-10-20 and 2026-10-21.

## Ownership: the per-file standing moves to core (coordinator's decision (a), 2026-10-20)

`src/core` cannot import `src/cli`, and the groups need the per-file standing that `src/cli/named-files.ts` and `named-standing.ts` derived for 011-27's named waits. The coordinator chose to move it, under this contract:

- One refactor commit first (`b8a2e2486`), before any 011-29 behaviour: `src/cli/named-files.ts` became `src/core/status/standing.ts` and `src/cli/named-standing.ts` became `src/core/status/standing-facts.ts`. The two CLI files keep their exports by re-export. No test changed in that commit, and every named-wait test passed at it.
- `src/core/state/header.ts` and `file-class.ts` are unchanged (guarded key-source seams).
- `buildSnapshot` derives `outstanding` from the rows it already reads; the extra store reads are below with their cost.

## The groups (`src/core/status/outstanding.ts`)

- **Which files.** With no daemon validating, one group says so and no other prints: no file advances until a daemon starts, and a pending retry waits in the store for it. While the daemon has not listed the test files, one `listing` group. Otherwise every listed test file that is not current is in exactly one group. A file with a pending retry is in its retry's group, not its standing's. The slow files that the `Slow tier:` line counts are left out, except a running one whose project has a global setup the store knows (gh-46), since that line does not say it. A revision whose runner part is pending adds an `unlisted` group. A checkpoint in progress, and not owed, adds a `checkpoint` group.
- **Order.** What holds everything first, then what an agent can run, then what only time advances: no-daemon, listing, unlisted, checkpoint, retry, no-install, setup-failed, runner, timed-out, no-result, stale, never-run, claim, running, queued, slow.
- **Grouping.** By the same `groupId` the named class lines use (moved to `src/core/status/standing-groups.ts` with `widest`, plus a `retry` case), so one standing reads the same in a named wait and in status.
- **Caps.** The default text prints at most 6 groups and 3 paths a group (`a, b, c and 21 more`), then `and K test files in M more groups (\`squeal status --full\` lists every group)`. `--full` prints every group. `--json` holds every group with all its files.
- **Words.** A group line is `N test file(s) <reason>: <paths>; <step>`, the reason and the step from `nextStep(standing, { named: false })` through `reasonWords` and `stepText`. A reason that does not read after "N test files" gets a prefix: `without a result, ` for no-install, setup-failed and runner; `without a result: ` in place of `no result: `; `queued, ` for unlisted. `never run at its inputs` became `never run at {its} inputs`, a new placeholder in `fill`, so a group reads `their inputs` (the 011-27 pin in `test/cli/next-step-rows.test.ts` moved with it).
- **Status's own steps.** The no-daemon group carries a held `squeal stop` and a daemon that died, as the `Daemon:` line said them. The checkpoint group says what it has done and names `run --all --wait`. The retry group says its reason, or `no result at its inputs` for a file without a result (011-27: it runs at once whatever the reason), and when it runs, as `waitsText` said under `Pending retries:`, plus `queued by another worktree's daemon` when another worktree claimed the run.
- **Paths in a printed command** are relative to the current directory on `squeal status` and the pathless wait (`fromBase`, `baseOf` now exported from `status-wait-paths.ts`). `squeal run --all --wait` and `squeal start` print the default text with root-relative paths: they pass no base, since both run from anywhere in the worktree and name no path.

## The default text and `--full` (`format-status.ts`, `status-detail.ts`)

- **What stays above `Outstanding:`.** `Revision`, `Known failures` with its not-current clause, the earlier failures, each failure block, `Affected checks`, `Full-suite checkpoint`, the owed-checkpoint line and `Slow tier`. After it: the config-problems line and the `Not run:` excluded line, which an agent acts on. Last, `More:`.
- **What moved behind `--full`.** Worktree, daemon, inheritance and its sources, `Test files without checks`, the per-file `Test files without a result` list, closure method, store schema and notes. `test/status/outstanding.test.ts` lists every line `--full` adds and asserts each is one of these. The idle and discovery lines (`work-line.ts`), `Pending retries:` and the checkpoint-in-progress line are gone: their content is a group. `work-line.ts` and its test are deleted.
- **`More:`** names what `--full` adds, each part only with content: always `the worktree and daemon`; `the N current results inherited from M worktrees`; `the N test files without a result one by one`; `N notes`.
- **Line counts.** gh-44 E1's worktree prints the 7 lines of design 1.1. Its `--full` prints 37 lines, not today's 36: the 2-line `Outstanding:` block replaces today's 1-line `Idle:` line, and the 30 detail lines follow a blank line as today. `test/status/default-text.test.ts` pins both.
- **`--notes`** keeps its meaning and implies `--full` (011-28): the full text with each note on its own line.

## The pathless wait (`status-wait-lines.ts`)

- `waitText(wait, now, command, options)` prints `formatStatus` with the same options, so the wait prints the default text and `--full` adds the detail. The blank line before the verdict line stays: dropping it broke the readers that split on it, for no gain.
- The verdict lines drop `N checks pending in all`; the `Outstanding:` block above says what else is not current.
- The quiet line says its scope (gh-41 E1): `none of the N test files the edits since revision M re-keyed is pending` (`the 1 test file ... is not pending`, `the edits since revision M re-keyed no test file`), then `; this wait does not hold for the rest of the worktree` when any check is pending or any group is outstanding.

## Extra store reads and their cost

`outstandingOf` reuses the snapshot's `states`, `keys`, `header`, `runs`, pending retries and checkpoint. Through `standingsOf` it reads beyond them: once a call, the unknown-files record (`unknownReasons`), the worktree record and the promoted ids (`promotedOf`), and `squeal.config.json` twice (`readPolicy` in `outstandingOf` and in `standingsOf`); per file not current, `testFileKeys.claimed` (indexed by `test_file_keys_by_key`) for each stale or unknown file with a key and each queued file. The once-a-call reads and the walk over every listed file happen with every file current too. With no daemon validating, or the test files not listed, it reads nothing more.

Measured on this host on 2026-10-21 (24 CPUs, load 4), 20 runs each, the daemon forced alive in the call so the per-file path runs:

| Worktree | Test files | Groups | `outstandingOf` median | max | `readStatus` median |
|---|---|---|---|---|---|
| main checkout | 468 | no-install 256, no-result 212 | 4.6 ms | 7.9 ms | 29.8 ms |
| `4c670899` | 330 | queued 139 | 1.8 ms | 7.6 ms | 15.7 ms |
| this worktree, all current | 770 | none | 4.2 ms | 7.0 ms | 46.5 ms |

`readStatus` on this worktree, all current, 40 runs, before (`b8a2e2486`) and after: median 47.3 and 46.4 ms before, 53.6 and 49.6 ms after.

## Evals (`evals/lib/squeal-text.mjs`, `transcript.mjs`)

- `NO_DAEMON` reads a down daemon from its `Outstanding:` group (`^  no daemon has validated`), since the default text has no `Daemon:` line.
- `pendingRetries` reads the files of a retry group too, the shown ones; the files past `and N more` are not named in the text.
- `countsOf` reads the `Known failures:` clause when the text has a `More:` line and no `Test files without checks:` line: the `Affected checks:` line counts checks only, so a file without checks would read as current. The eval pin's `statusCounts` says the same for the status form.
- `transcript.mjs` keeps `Outstanding:`, `More:` and every group line whole in a trim.
- Pinned by `test/evals/outstanding-evidence.test.ts` (new), which round-trips `formatStatus` and `waitText` with groups, plain and in a Claude Code hook's JSON, and by the existing round-trips in `evidence-squeal.test.ts` and `header-forms.test.ts`. The `withoutChecks` fixture in `header-forms.test.ts` gained `testFileCounts` and `testFilesByPhase`, as `readHeader` counts them.

## Skill texts (`plugins/*/skills/squeal/references/commands.md`)

The status sample is the default text with a running tier and 24 never-run files, not a queued group: a queued group's step names `squeal status --wait 60000 <test file>`, and `test/harness/skill.test.ts` requires every paragraph naming `status --wait` to state the next-tool-call default first, which a code block cannot. Its pinned `Affected checks:` line changed from `12 queued (10 tests, 2 test files loaded)` to `0 queued` with it. The three copies stay identical.

## Type changes

- New `src/core/types/standing.ts`: `LoadNow`, `KnownSetup` and `Standing` moved from `next-step.ts` (which re-exports them); new `OutstandingStanding` (`Standing`, `listing`, `retry`) and `OutstandingGroup`.
- `StatusSnapshot.outstanding?: readonly OutstandingGroup[]` (additive, optional: a snapshot from an older daemon or built without a store has none, and the text then falls back to its no-daemon or listing group).
- `formatStatus(s, now, command, options?: StatusFormatOptions)` with `{ full?, allNotes?, base? }`; `waitText(wait, now, command, options?)` alike.
- `StatusOptions.load?: () => LoadNow` and `buildSnapshot(store, root, now, load?)`, so a test seeds the load.
- New: `standingsOf` and `WorktreeReads` (`standing.ts`), `outstandingOf` and `OutstandingReads` (`outstanding.ts`), `outstandingLines` (`outstanding-text.ts`), `detailLines`, `hiddenParts` and `ageText` (`status-detail.ts`), `groupId` and `widest` (`standing-groups.ts`).

## Expected failures and checks outside Squeal

- The four bundle-drift tests (`test/harness/plugin.test.ts`, `codex/plugin.test.ts`, `opencode/package.test.ts`, `pi/package.test.ts`) fail until the coordinator builds `plugins/*/dist`.
- `test/e2e/stopped.test.ts` now reads the stop from the default text's `Outstanding:` line. It runs the shipped bundle, so it passes only after that build; Squeal excludes `test/e2e/**`, and this worker did not run it.

## For whoever continues

- `src/core/status/standing.ts` is 318 lines, over the 300-line guide; `standingsOf` and `readNamedFiles` could split from the per-file derivation.
- `src/cli/status-wait-lines.ts` and `status-wait-paths.ts` are still over the guide. The named-wait lines were not moved out (011-28's notes): no 011-29 change needed it.
- Design section 4 also changes `SKILL.md` step 4 ("`Known failures: 0` with checks pending means no known failures yet"). The 011-29 brief did not give `SKILL.md` to this row, so it is unchanged.
