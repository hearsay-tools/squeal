# Issue 72: active verification across plugin runtime removal

Date: 2026-10-21. Source: [issue #72](https://github.com/hearsay-tools/squeal/issues/72), an agent-reported `friction` issue. Squeal 0.1.238 (this worktree at `c17caeea0`, `plugins/claude-code` as built and committed). Host: one-minute load 9.70 before the work, 11.92 and 16.00 at the two runs, 24 CPUs, so the live reproduction ran. Node 24.21.0, Vitest 5.0.3.

## Verdict

Reproduced, verified by experiment. When a running daemon's plugin directory is deleted, the daemon stays alive and keeps scheduling. A test that spawns a child after the deletion fails on the missing `recorder.cjs`, and Squeal records that as a current product FAIL. Every queued file then crashes its Vitest fork workers and reads UNKNOWN, unqueued. Nothing detects the removal and nothing names a recovery. `squeal stop`, `squeal start`, `squeal run --all --wait` through another copy of the CLI restores a clean verdict.

## Questions answered

| # | Question | Answer | Tag |
| --- | --- | --- | --- |
| 1 | Does the daemon survive the deletion of its runtime? | Yes. It stays alive and keeps scheduling, and another CLI can read its store and stop it. | verified by experiment |
| 2 | What happens to the running tier? | Its test bodies finish. A child that a test spawns after the deletion exits 1 with `ERR_MODULE_NOT_FOUND` for `<old plugin>/dist/observe/recorder.cjs`. The test is recorded as FAIL, current. | verified by experiment |
| 3 | What happens to the queued checks? | Each later tier crashes with `[vitest-pool]: Worker forks emitted error.` before any test body runs. All 4 queued files read UNKNOWN with no result and nothing queued. They do not read as false passes. | verified by experiment |
| 4 | Can the supported CLI get results without finding a versioned path by hand? | The old path fails at once. Another copy of the CLI at the same version reads the same store. Finding that copy is outside Squeal. | verified by experiment |
| 5 | Does the existing recovery work? | `retry` is refused for the false FAIL without `--reason`. `stop`, `start` and `run --all --wait` through copy B ran all 6 files: 0 failures, exit 0. | verified by experiment |
| 6 | Which tier step loads the deleted runtime? | The fork workers and spawned children load the recorder from the daemon's plugin path. The run log does not name the missing file for the fork crash. | inferred |
| 7 | Does a step-down (011-30 to 011-34) cover this? | Partly. See "Overlap". | read in source code (spec text) and inferred |

## Commands and observed output

Both runs are in `probes/issue-72/`. The deps directory is another worktree's installed `node_modules`, linked read-only into the fixture.

```sh
probes/issue-72/probe.sh <worktree>/plugins/claude-code <worktree with node_modules>          # output-run1.txt
probes/issue-72/probe.sh <worktree>/plugins/claude-code <worktree with node_modules> recover  # output-run2-recover.txt
```

Before the deletion, the daemon `.../plugin-a/dist/cli/squeal.mjs daemon .../repo` had 2 files running and 4 queued (`2 running, 4 queued`). After `rm -rf plugin-a`:

- Old CLI: `Error: Cannot find module '/tmp/sq72-qNV9/plugin-a/dist/cli/squeal.mjs'`, exit 1.
- Children of the running tier: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/tmp/sq72-qNV9/plugin-a/dist/observe/recorder.cjs' imported from /tmp/sq72-qNV9/repo/ at finalizeResolution (node:internal/modules/esm/resolve:272:11)`. This is the error in #70.
- `status` through plugin-b, 68 s later: `Known failures: 2 (2 tests); not current: 4 of 6 test files (4 unknown)`, `FAIL test/h2.test.ts ... expected 1 to be +0`, `no retry asked at these inputs`, and `4 test files without a result: vitest: unhandled error outside any test file: Error: [vitest-pool]: Worker forks emitted error.`
- The daemon was still alive. Its two later run logs end `crashed (unhandled error outside any test file: ...)`.
- `status --wait 60000` on all six files, through plugin-b: exit 3, `Named test files have no verdict`.
- `retry test/h1.test.ts`: `Not retried: test/h1.test.ts has a known failure at its inputs; a retry of it needs --reason load or --reason environment`.
- `stop`, then `start` through plugin-b: `Squeal daemon spawned`, the daemon now `.../plugin-b/dist/cli/squeal.mjs`. Then `run --all --wait`: `6 test files, 0 already current, 6 run now`, `Known failures: 0; all 6 test files current`, exit 0. Every child exited 0.

## Overlap with related work

- **#47, 011-30 to 011-34 (daemon handoff).** A handoff starts only when a hook newer than the daemon asks it to step down (spec C9, line 239). The daemon checks "its root is deleted", which is the worktree root, not the plugin directory. A removal with no newer hook boundary in this worktree therefore leaves the old daemon serving (verified: same-version replacement). Even with a newer hook, every tier that starts between the deletion and that boundary crashes (inferred). 011-33 queues again only files whose rows are `queued` or `running` (C4, line 152). Here the files are already settled as UNKNOWN and FAIL, so 011-33 does not hand them over (inferred from spec text). 011-66 treats a crash as an interrupted run only inside the stopping phase. This crash is outside it.
- **#48, 005-72 (stale session paths).** The old CLI path fails, the same symptom (verified). 005-72's `plugin-cache-cleanup.md` found that Codex 0.160.1 deletes every other version directory on install. It recommends a Squeal-owned copy of each version and a launcher in the plugin data directory. That would also keep the daemon's recorder and preloads (inferred).
- **#70 (recorder assets).** The recorder error and the false product FAIL are reproduced exactly here (verified). gh-70's triage could not run because of load.
- **Gap that only #72 names.** The daemon does not detect that its runtime is gone, and it keeps crashing queued tiers into UNKNOWN. Status names `squeal retry`, not the restart that works. Nothing hands the work to the installed runtime.

## Recommendation for Squeal

Treat gh-72 and gh-70 as one row, because one probe shows both symptoms. The root fix is runtime retention: 005-72's Squeal-owned version copy, kept while a daemon or its descendants use it. A cheap guard should come with it. Before each tier, the daemon checks that its own `dist/` still exists. When it does not, the daemon does not start the tier. It leaves the files queued, exits with a note that names `squeal start`, and lets the next boundary (or 011-34's `start`) start the installed runtime. A missing recorder in a child should also be classified as an environment failure, not a product FAIL (#70's request). `probe.sh` is the shape for the regression test.

## Open questions

- Not determined: why `run --all` after the restart re-ran the two false FAILs ("0 already current"), not only the 4 UNKNOWN files. Either the key moved with the runtime path, or the restart treated them otherwise. The time box did not allow tracing it.
- Not determined: the exact error inside the crashed fork workers. The run log keeps only `Worker forks emitted error`.
- Not tested: a newer-version successor (needs a second build), a Codex-driven deletion, or the Claude Code plugin cache.

## Sources

- Issues [#72](https://github.com/hearsay-tools/squeal/issues/72), [#70](https://github.com/hearsay-tools/squeal/issues/70), [#48](https://github.com/hearsay-tools/squeal/issues/48), [#47](https://github.com/hearsay-tools/squeal/issues/47), read 2026-10-21.
- `docs/specifications/011-core/spec.md` C4 (line 152), C9 (line 239); `docs/board.md` rows 011-30 to 011-34, 011-66, gh-70, 005-72.
- `docs/specifications/005-agent-adoption/research/plugin-cache-cleanup.md`; `research/issue-70.md`; `research/issue-47.md`.
- `probes/issue-72/probe.sh`, `output-run1.txt`, `output-run2-recover.txt`. Fixture directories `/tmp/sq72-qNV9` and `/tmp/sq72-uxPD` were kept, and no fixture process is left running.
