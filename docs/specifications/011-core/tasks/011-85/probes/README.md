# Probes for 011-85 (throwaway)

Throwaway probes for `../design.md`. Nothing here is product code or a test of the suite.

Where they ran: a `git clone` of this branch at `90e442f7f` (Squeal 0.1.245, key format 20) under `/tmp/squeal-011-85/repo`, its `node_modules` copied with `rsync` from worktree `f98df774` (same `package-lock.json`, installed at 0.1.245; `.cache` and `.vite` left out). `HOME`, `XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME` and `TMPDIR` were under `/tmp/squeal-011-85`. No daemon, no build, single test files only, `--maxWorkers=1`. The clone was removed at the end. Run on 2026-10-21 between 22:27 and 22:43 CEST.

- `candidate.patch`: the change the design proposes, cut to its smallest form (rows R1 and R2 of the design), with the three validity cases and the two regression test files. Not the code rows' final form: no former-definition read (R4), no pnpm filter (R3).
- `alarm-candidate.log`: `test/keys/key-format.test.ts` with only the `src/` part of the patch. Exit 1 after 24 s, one-minute load 56.4. The alarm fires for `KEY_FORMAT_VERSION`, `VITEST_ADAPTER_VERSION`, `NODE_TEST_ADAPTER_VERSION` and `RECORDER_VERSION`, each for "changed lines no case runs" and for no case whose outputs differ.
- `alarm-cases.log`: the same, with a `key` case over a trusted hidden lockfile and an `adapter:vitest` case with two file-based projects. Exit 1 after 25 s, load 41.7. Left: the unreachable not-JSON branch of the first `withoutOwnVersions` and the line for every other lockfile format.
- `alarm-cases2.log`: the not-JSON branch removed (`staleHiddenLockfile` has already rejected such a file) and a `key` case over a pnpm `lock.yaml` added. Exit 0, 11 of 11 tests, 33 s, load 60.7.
- `existing.log`: 13 test files on the seams, one at a time, at the candidate. 12 pass; `test/runners/vitest/exclude-projects-filter.test.ts` fails one row, "excluding e2e: file-based, so its config file leaves every environment", which pins today's rule (a sibling's config file is in every environment). Loads 51.6 to 63.1.
- `regressions-candidate.log`, `regressions-base.log`: the patch's two new test files (`test/keys/own-versions.test.ts`, `test/runners/vitest/project-config.test.ts`) at the candidate (8 of 8 pass) and with `src/` reset to `90e442f7f` (3 fail: the root's raise, a workspace's raise, an edit of `e2e`'s config; the 5 guards pass). Loads 41.3 to 43.9.
- `env-files.mts`, `env-files.jsonl`: each project's config files in its environment, as the adapter reports them, for the clone itself and a copy of `test/fixtures/vitest/five-projects` inside it, at the candidate and with `src/` reset. One-minute load 57.9 to 61.3.
- `opaque-count.mjs`, `opaque-count.json`: a static estimate for question 5. It walks each test file's relative imports (type-only imports left out) and counts the closures that reach `child_process`, `worker_threads`, `cluster` or `module` (011 C11 case 1) or call `require.resolve`, `createRequire` or `import.meta.resolve` (case 2). Not Vite's graph: no bare imports, no opaque packages (case 4). 0.4 s.

No file failed under load and passed alone.
