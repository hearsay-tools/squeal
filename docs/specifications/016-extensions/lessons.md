# 016 Extensions: D4 and 016-23 in real use

Row 016-27, researcher 2d61d0a8, 2026-10-25, 18:32Z to 18:56Z. Brief: `tasks/wave-4.md`, section 016-27, questions 1 to 5. Code read at `533929e94`. Probes: `research/probes/016-27/` (read-only; see its README).

## Verdict

| Goal or rule | Verdict | Why |
| --- | --- | --- |
| Goal 6, Vitest: a child process's imports reach `direct` | **Holds in effect** in squeal; **unproven** in cezar | squeal: 0.1.316 and later daemons store marks, and other worktrees read them. 2b73a010's first edit (17:22:55Z) reached `capacity-project.test.ts` through marks that a run in 95f83469 had stored 35 s earlier, and the file ran 4 s after the edit. In 19 of 32 small edits a marked file ran in the edit window. The store does not record `direct`, so it cannot show that the mark, and not another rule, put each file there. cezar stores marks for 175 files, but only 1 of 19 small edits ran a marked file in the window: its worktree ran no Vitest file for 6.8 minutes during a 472-file backlog. No small edit came after a daemon restart, so the restart clause is unproven. |
| Goal 6, node:test | **Unproven** | 0 marks in 87 node:test files on this host. Both node:test projects (cezar's) are fast, and 004 D5 records a spawned process only in a slow project. The kit lists this gap as KNOWN (`test/kit/packs/node-test.ts`, `FAST`). |
| Goal 6, pytest | **Unproven** | No store on this host has a pytest project under a daemon of 0.1.313 or later. The only pytest store, toolkit-dev's, names 0.1.273 as its newest daemon (2026-10-23). |
| D4: marks stay inside the K shortest | **Holds** | In no edit window did more than 4 marked files run (`runner.tierSize` is 4 in both repositories). Whether the whole edit's work stayed inside its bound is not determined (question 2). |
| 016-23: an unwatched listed directory keys by its names | **Unproven** | On this host no listed directory holds names that the watcher does not see. Every unwatched listing is absent or empty, which keys as none, as before. |
| 016-23: no wrong inheritance (question 4) | **Holds, no blocker** | 0 inherited states across worktrees whose listed ignored names differ. 2 squeal states have origins in removed worktrees. All 16 cezar states with such origins are stale. |
| R3 cost (question 5, input to 016-25) | Measured | 3 squeal and 2 cezar mixed directories, with 1 and 10 readers. 3 inherited states cross differing ignored names. None can be wrong: neither test reads the ignored entry. |

## Readings

The stores were live. Each number belongs to its reading time. The host has 24 CPUs. Local time was UTC+1, because summer time ended today.

| UTC | One-minute load | Reading |
| --- | --- | --- |
| 18:32:07 | 36.5 | Start. `squeal ps`: 12 daemons, Squeal at least 7.1 CPUs, 34% of busy |
| 18:36:25 | 57.0 | Question 1, first reading |
| 18:39:26 to 18:41:04 | 58.3 to 48.9 | Question 2, squeal |
| 18:43:02 | 46.5 | Question 2, cezar |
| 18:47:58 | 26.7 | Questions 3 to 5: listed directories classified |
| 18:50:52 | 31.0 | Question 5: ignored names in 41 squeal and 37 cezar worktrees |
| 18:51:54 | 30.4 | Question 4: inherited states |
| 18:55:34 | 28.8 | Question 1, second reading |

## The daemons read

The versions come from the incarnations in the stores (`notes.<wt>`, `daemon-exit:<wt>`, `rekeyed-moves.<wt>`) and from the `worktrees` table. 0.1.313 has D4 for node:test and pytest. 0.1.316 adds Vitest marks (016-22) and ignored listing names (016-23), and 0.1.317 and 0.1.318 keep both. 0.1.314 has D4 but not 016-22 or 016-23.

| Repository | Worktree (id8) | Daemon versions in the window |
| --- | --- | --- |
| squeal | 2fa11272 (987701c8) | 0.1.314 at 16:18Z, then 0.1.316 from 16:43:55Z |
| squeal | 95f83469 (52e58f23) | 0.1.316 from 16:52Z, 0.1.317 from 17:51Z, 0.1.318 from 18:36Z |
| squeal | 2b73a010 (557fa03e) | 0.1.316 from 17:21:24Z, 0.1.318 from 18:04Z |
| squeal | a6b4acd9 (main checkout) | 0.1.317 from 17:31Z, 0.1.318 from 17:59Z, 0.1.319 by 18:47Z |
| squeal | 52e51657 (df8a4970), 5ec55173 (1b4e94fb) | 0.1.318 from 17:51Z and 18:06Z |
| squeal | 17593946 (605ca21e), d73381a9 (6d8a1279) | 0.1.314 throughout |
| squeal | 872b8120, afb7e4a0 | 0.1.319, started after 18:47Z (questions 3 to 5 only) |
| cezar | 13 worktrees, main checkout b7555ac0 among them | 0.1.314 until 16:32Z; 0.1.318 from 17:54:58Z (288ff376 first); no 0.1.316 or 0.1.317 incarnation |

My own worktree (f7caecb2) is left out of every count.

## 1. Stored direct marks per runner

Source: `observedDirect.<project>` in each store (`marks.mjs`). The stored closure already holds the observed paths, so nearly every mark lies inside it. 1 to 3 files per project have a mark outside it.

| Runner | Store, project | Reading | Files with marks / test files | Marks per file, p50 | Max |
| --- | --- | --- | --- | --- | --- |
| Vitest | squeal, default | 18:36Z | 56 / 1,296 | 23 | 566 |
| Vitest | squeal, default | 18:55Z | 64 / 1,297 | 23 | 568 |
| Vitest | cezar, server | 18:36Z | 70 / 581 | 11 | 301 |
| Vitest | cezar, server | 18:55Z | 158 / 583 | 8 | 304 |
| Vitest | cezar, e2e and web | 18:55Z | 15 / 93 and 2 / 295 | 5 and 283 | 6 and 283 |
| node:test | cezar, test:unit and root:test:unit | both | 0 / 87 | none | none |
| pytest | none on this host at 0.1.313 or later | | | | |

The largest sets belong to tests that start the CLI or the daemon. In squeal, `test/integration/node-test-packages.test.ts` has 568 marks and `capacity-project.test.ts` and `optimizer-start.test.ts` have 567 each, because the child loads the whole CLI. Marks grow as runs land: cezar server went from 70 to 158 files in 19 minutes while its daemons worked through backlogs.

node:test has no marks for a reason in the source, not a lost write. `src/runners/node-test/run/run.ts` (`childEnv`) puts the recorder into a spawned child's `NODE_OPTIONS` only for a slow project (004 D5). cezar's two node:test projects are not slow. Their files do start project scripts: `resolve-browser-launch.test.ts` runs `node -e "await import(...)"`, and `scripts/metrics.test.mjs` runs `node scripts/metrics.mjs`. They ran under 0.1.314 and 0.1.318 daemons (531 file runs since 16:00Z) and stored no marks. Tag: read in source code; verified in the store.

## 2. Edits of a marked path

Source: `edit-work.ts`, `edits.mjs`, `repeat-hashes.mjs`. The store does not record whether a file ran as an edit's work or as catch-up. I infer it from timing. Catch-up waits for the catch-up quiet, 120 s after the last edit (`quiet:<wt>`). A run at the revision's own number that started inside those 120 s is the edit's work, unless it is a checkpoint run (those are left out). A pair counts only after the file had completed a run under a 0.1.316 or later daemon, because before that run its marks did not exist. C4 makes a revision with 10 or more keyed paths all catch-up (`CATCH_UP_KEYED_PATHS`). "Small" below means fewer than 10 changed paths.

**squeal, since 16:43:55Z**: 45 revisions touched a marked path, 32 small and 13 large.

- All 32 small revisions are 2b73a010's (0.1.316), and nearly all are single-source edits under `src/core/code/`. Each reached 1 to 13 marked files.
- In 19 of them, marked files ran in the edit window: 1, 3 or 4 a revision, never more than 4 (`runner.tierSize`). Overall, 60 marked files ran in the window, 283 later and 24 never.
- 10 of the 13 others returned every changed source to content that the worktree already had, so their keys could find stored results. Examples are revisions 34 and 35, which flip `pass/index.ts` back and forth, and 48 to 54. The other 3 (22, 24, 26) were overtaken by the next revision 2 to 36 s later, and that revision's window ran 4 marked files.
- In 14 of the 19, the window also ran 1 to 47 files that are neither marked, nor a namesake, nor a changed test. Revision 11 is an example: 4 marked files ran first, then `seed.test.ts` with 3 files whose closures hold `seed.ts`. Which rule kept those 3 is not determined, because the store holds no record of the cut. The candidates are a source's runner importers (C4 keeps them without a cap when no namesake is reached) and work that the content part queued before the runner part applied the cut.
- The 13 large revisions (pulls and version raises in 17593946, 95f83469, 5ec55173 and the main checkout) ran marked files only later, as C4 says: 2 in a window, 80 later, 56 never. The main checkout's 38 "never" pairs read `unknown`, because its baseline is lookup-only.

**cezar, since 17:54:58Z**: 26 revisions, 19 small, in 0beeb7e8 (25) and 6ceb28ed (1), all under 0.1.318.

- Only revision 34 ran marked files in its window: 3 of the 37 that it reached.
- The other small revisions reached mostly 2 marked CLI tests (`discovery/cli.test.ts`, `webhooks/cli.test.ts`, `run-store-unavailable-cli.test.ts`). These ran 200 to 1,180 s later.
- 0beeb7e8 ran no Vitest file from 18:22:20Z to 18:29:11Z while revisions 3 to 14 landed. `squeal ps` at 18:32Z gave it "472 pending". After that, its windows held only other files.
- Whether the marked files lost the K shortest on duration is not determined.

Answer: in squeal, marked files ran as edit work in 19 of the 22 small edits with new content, 1 to 4 a revision. The other 3 were overtaken, and the next revision ran them. Whether each file was there because of its mark or by another rule (a closure that holds the source) is not determined. No edit window ran more than 4 marked files, so marks never took more than `runner.tierSize` slots. Whether the whole edit's work stayed inside its bound is not determined (the 14 windows above). Tag: verified in the store, inferred from timing.

## 3. Listed directories the watcher sees no file in

Source: `listings.mjs`, `classify.mjs`, `repeats.mjs`. The observed maps hold 402 listed directories in squeal and 136 in cezar. "Sees" is Squeal's own view, as `Listings` reads it: the worktree's stat cache (`file_hashes`), less the git-ignored files that are kept as extra files.

**No listed directory holds names that the watcher does not see**, in any of the 10 squeal or 13 cezar worktrees read. A first pass that asked git alone listed 12 fixture directories under `test/fixtures/node-test/*/node_modules/@*/`. Each is a tracked symlink, for example `node_modules/@edge/lib` to `../../lib`. The stat cache holds the files below them as seen files, so they hash by their names at 0.1.314 and at 0.1.318 alike. The 0.1.318 worktree 52e51657 inherits `test/version-sensitive.test.ts` from the 0.1.314 worktree 17593946 at the same key, which agrees with that.

The listings with no file the watcher sees are all absent or empty:

| Store | Directory | State | Readers |
| --- | --- | --- | --- |
| squeal | `.codex/plugins/cache/hearsay/squeal/`, `plugins/claude-code/versions/`, `src/runners/pytest/runtime/__pycache__/` | absent in all 10 | 5: `test/cli/codex.test.ts`, `test/cli/setup/pytest.test.ts`, `test/cli/launcher.test.ts`, `test/cli/launcher-one-node.test.ts`, `test/keys/key-format.test.ts` |
| squeal | `test/keys/validity/cases/listing/` | absent in 2fa11272 only (an older checkout) | 1: `test/version-sensitive.test.ts` |
| cezar | `.ai/ast-grep/rules/` | absent in 12 of 13 | 1 |
| cezar | `packages/web/.e2e-fixtures/` | absent in 9, empty in 4 | 2 e2e files |
| cezar | `packages/cezar/src/webhooks/`, `packages/web/src/routes/settings/webhooks/` | absent in the main checkout only (deleted tracked directories) | 15 distinct, the 2 e2e files among them |

That is 6 test files in squeal and 16 in cezar. **None ran once more because of it.** An absent or empty directory keys as none at 0.1.313, 0.1.314 and 0.1.316 or later (016-23's design), so no key moved. A first-seen confirmation shows as the same file running again in the same worktree at the same revision. Since the update, 20 of the 22 readers have 0 such repeats. `env-example.test.ts` has 2, in 4fecf6b1, where its directory is present and watched. `test/version-sensitive.test.ts` has 3, in 95f83469 (revision 249, twice) and d73381a9 (0.1.314), where `test/keys/validity/cases/listing/` is tracked; their cause is not determined. The one worktree where that directory is absent, 2fa11272, ran the file once. The base rate is 0.3% of all file runs in each store.

## 4. Inheritance across differing ignored names

Source: `inherited.mjs`. **No.** For each reader of a non-watched listing, the probe compared the origin worktree's directory with this worktree's.

- squeal: 23 inherited reader states. 21 were compared, and all had the same state. In 1 (2fa11272, `test/keys/validity/cases/listing/`) the directory is absent here and tracked in the origin today, but it is absent too at the result's commit `b44e3cc90` (`git ls-tree`). 2 origins are removed worktrees (fcdb871e, a01749ca); both directories are absent everywhere today.
- cezar: 16 inherited reader states, all in the main checkout, all `stale` (not shown as current), and all from removed worktrees.

Removed worktrees cannot be read, so their names stay unproven. Tag: verified in the store and on disk.

## 5. Mixed directories (R3, row 016-25)

Source: `mixed-names.sh`, `mixed-summary.mjs`, `mixed-inherited.mjs`, over every worktree that `git worktree list` names. C2's temp names are left out; none were seen. Under R3 these directories key by their tracked names only. The columns show what keying their ignored names would split.

| Directory | Readers | Ignored name sets across worktrees | Names born today |
| --- | --- | --- | --- |
| squeal `test/fixtures/node-test/` | 1 | `{.tmp}` 19, `{}` 22 (of 41) | 6 |
| squeal `test/fixtures/scheduler/` | 1 | `{.tmp}` 24, `{}` 17 | 8 |
| squeal `test/fixtures/vitest/` | 1 | `{.tmp}` 20, `{}` 21 | 6 |
| cezar `packages/web/` | 2 | `{node_modules}` 19, `{.e2e-fixtures, node_modules}` 11, `{}` 7 (of 37) | 19 |
| cezar `packages/web/e2e/` | 8 | `{node_modules}` 4, `{}` 33 | 1 |

squeal's single reader is `test/version-sensitive.test.ts`. `.tmp` is the fixtures' scratch root: the first fixture test of a worktree creates it, and it stays there, empty. With ignored names keyed, each squeal directory's key would move once per worktree when `.tmp` is born, which happened 6 to 8 times today. Results of a worktree without `.tmp` would no longer match one with it. In cezar, `packages/web/` would split its 2 readers' results three ways, and `npm ci` (`node_modules`) and an e2e run (`.e2e-fixtures`) would each move the key. Today that is 19 births.

Three current results already cross differing ignored names:

1. squeal 2fa11272 (0.1.316) holds 7 checks of `test/version-sensitive.test.ts` inherited from 95f83469, recorded at 15:48:56Z at commit `b44e3cc90` by a 0.1.313 daemon. `test/fixtures/node-test/` and `test/fixtures/vitest/` hold `{.tmp}` there and `{}` here.
2. cezar ee1ae15d holds 34 checks of `packages/web/src/test/e2e-wait-discipline.test.ts` inherited from 4d3b3189. `packages/web/e2e/` holds `{node_modules}` there and `{}` here. Both daemons ran 0.1.309, before the update.

**Neither result can be wrong.**

- `test/version-sensitive.test.ts` never lists `test/fixtures/`. Its walk skips that directory (`if (path !== "test/fixtures") walk(path)`) since `6144d939a` (2026-10-21, row 014-18), at `b44e3cc90` and at 2fa11272's head `d8d93d4d0` alike. Its three stored listings come from runs before that change, because observed maps are merged and never pruned. They cost key inputs, never correctness.
- `e2e-wait-discipline.test.ts` lists `packages/web/e2e/` and keeps only names that end in `.e2e.ts` (read at cezar's main checkout). A `node_modules` entry cannot change its verdict.

Tag: verified on disk and in the store; the two tests read in source.

## Lessons

1. Ask Squeal's view, not git's, what the watcher sees. Tracked symlinks into `node_modules` make git and the stat cache disagree. My first count was wrong by 12 directories.
2. The store cannot tell edit work from catch-up after the fact. Question 2 rests on timing. If 016 or 011 needs this measurement again, the cut's `kept` set per revision could be recorded at the place where it is known, as `docs/styleguide.md` asks.
3. Stale observed listings are real. `test/version-sensitive.test.ts` keys on three directories that it has not read since 2026-10-21. A mixed-directory rule for row 016-25 will charge every such stale reader.
4. node:test's goal 6 depends on a slow project. Of the projects on this host, none is a slow node:test project. Real use of that path will need a project that has one.
