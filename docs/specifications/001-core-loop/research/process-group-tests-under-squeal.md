# Do cezar's process-group tests fail under Squeal?

Research task 001-127 for spec 001, 2026-10-08, from `lessons.md` defect 28. Linux 6.8, Node v24.21.0, Vitest 4.1.10 (cezar's install), Squeal 0.1.32 (this checkout's `plugins/claude-code/dist`). cezar in fresh clones at `5974ec91` and `6b660859`. The `c8580be4` store was read read-only (`node:sqlite`, `readOnly: true`), with the coordinator's permission. Probe: `probes/process-group-tests-under-squeal/` (throwaway). Store times are UTC; cezar commit times are +0200.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Reproduce in a shell, under `setsid`, under a real daemon | The outcome depends on the cezar tree, not on the launch mode. At `5974ec91`, all launch modes fail 3 of 3 cases every time with the reported `ENOENT ... leftover-group.pid`: shell 3 runs, `setsid` 3 runs, daemon bootstrap 1 run. That is three runs, not ten, because that mock has no code that could write the file. At `6b660859`, all pass: shell 10 of 10, `setsid` 10 of 10, `setsid` without `TMPDIR` 3 of 3, daemon forced runs 10 of 10. | verified by experiment |
| 2 | Which property differs | None of them. Under the daemon, the same runs that failed cursor S26 to S28 passed the other 15 S26 to S28 cases (claude, codex, opencode, pi, omp). cezar's `vitest.setup.ts` replaces `TMPDIR` in every worker. The runner gives its child a new session whatever its parent is. | verified by experiment; read in source code |
| 3 | Is the test wrong, or Squeal? | Neither environment is at fault. The failures were real at the time: the merge brought S26 to S28 to every runner, but cursor's print mock had no `leftover` scenario yet. Squeal then kept the failures current for 74 minutes after the mock was fixed: the mock is spawned, not imported, so it is outside the closure, and editing it re-ran nothing. | verified by experiment; read in the store |
| 4 | Recommendation | No change to how Squeal runs Vitest. cezar declares its mock scripts as `inputs`. Defect 28 becomes a stale-result escape through a runtime read, not a process-group defect. | inferred from 1 to 3 |

## Findings

### 1. The test failed because of the tree it ran on

- `1c97556a`, the commit the brief names, has no S26 to S28 and no `leftover-group.pid` (`git grep`). *Read in source code.*
- S26 to S28 came from main's `b666711d` ("run each agent session in its own process group"), merged into the branch as `5974ec91`. At that merge, `harness-parity.testkit.ts` maps cursor to `scripts/mock-cursor-print.mjs` and sends it `mock:no-progress-leftover`. That mock (blob `fece365c`) has no `leftover` branch, so it never writes `leftover-group.pid`. Every other backend's mock has one (`mock-claude.mjs:21`, `mock-pi-rpc.mjs:21`, ...). `6b660859` adds it to the print mock (`mock-cursor-print.mjs:149-153`, blob `33d44549`). *Read in source code.*
- Shell and `setsid` at `5974ec91`: `Tests 3 failed | 35 skipped`, each `ENOENT: no such file or directory, open '/tmp/cez-vitest-tmp-*/cez-shutdown-cursor-*/leftover-group.pid'`, the same text as in the store (`logs/matrix-5974.txt`). *Verified by experiment.*
- Load was high throughout (load average 23 to 68, from other daemons and suites on the host) and did not change an outcome. A timeout from load would fail inside `vi.waitFor`'s 5 s on a slow write. Here the file never appears; the test takes 5.5 s in the store's runs (the `waitFor` timeout) against 0.6 s when it passes. *Verified by experiment, and read in the store's `vitest.log`.*

### 2. The daemon's environment does not reach these assertions

| Property | Shell | `setsid` | Squeal daemon 0.1.32 | Seen by the test? |
|---|---|---|---|---|
| Session, group | caller's session, own job group | pid = pgid = sid | daemon pid = pgid = sid; its Vitest fork worker is in the daemon's group and session (`logs/daemon-probe.txt`) | No. `spawnSessionLeader` spawns with `detached: true` (`session-process.ts:140`), so the agent child calls `setsid()` and leads a new session and group in all three cases. S26 checks that child's pgid; S27 and S28 signal that group. |
| Controlling tty | none (agent shell) | none | none | No. Nothing in the test reads a tty. |
| `TMPDIR` | task scratch | task scratch, or unset | daemon scratch (D10) | No. `vitest.setup.ts` sets `TMPDIR` to `/tmp/cez-vitest-tmp-*` before any test, in every worker. The store's failure paths are under `/tmp/cez-vitest-tmp-*` too. |
| cwd | clone root | clone root | root while a run is in flight (`inRootWhileRunning`) | No. The test spawns the mock with an absolute `mkdtemp` cwd. |
| Pool, isolation | cezar config | cezar config | `createVitest('test', { root, watch: false, reporters, update: 'none', includeTaskLocation: true })` (`adapter.ts:91-97`). No pool or isolation option is set, so cezar's own config applies. | Same as the shell. |

The decisive control is in the store: run `520e17d1` (revision 169, under the daemon) passed claude, codex, opencode, pi and omp S26 to S28 in 126 to 4,184 ms and failed only cursor's three (`logs/cezar-store-c8580be4.txt`). *Verified by experiment and read in source code; the table's "No" column is inferred from the source and confirmed by those passes.*

### 3. Why Squeal showed the failure after the agent's run passed

Timeline from the `c8580be4` store (`logs/cezar-store-c8580be4.txt`):

| UTC | Revision | Event |
|---|---|---|
| 10:49:19 | 162 | merge of main applied to the working tree (HEAD still `1c97556a`): S26 to S28 arrive, mock blob `fece365c` |
| 10:52 to 10:57 | 163, 166, 169 | three runs of the file, triggered by closure edits (`harness-parity.testkit.ts`, `cursor-print-runner.ts`, `process-usage.ts`). Cursor S26 to S28 fail, ENOENT |
| 10:54:02 to 11:00:52 | 164, 165, 170, 171 | four mock-only edits; the mock reaches `33d44549` (= `6b660859`) at revision 171. No run follows any of them |
| 11:52 | | `5974ec91` and `6b660859` committed, 19 s apart (branch reflog) |
| 12:14:35 | 177 | `harness-parity.testkit.ts` changes, the file re-runs, cursor S26 to S28 pass |

The stored closure of `runner-shutdown-parity.test.ts` holds no `scripts/mock-*` path (178 paths, method "static imports plus declared inputs"). cezar has no `squeal.config.json`. So from 11:00:52 to 12:14:35 the three failures stayed known and current on a tree that passes. The revision 170 mock edit landed during run `520e17d1` (10:56:52 to 10:57:32), and the post-tier re-stat did not discard that run, because it re-stats only closure paths. Whether the intermediate mock blobs (`b4b97601`, `64aca0b0`, `7a62ee93`) had the `leftover` branch is not determined: git does not have them. The failures at revisions 166 and 169 show the version present at those runs did not. *Read in the store.*

The same escape, reproduced with a real daemon (`logs/daemon-probe-stays-current.txt`). After a bootstrap at `fece365c` with 3 known failures, only the mock was replaced. The daemon recorded revision 1 ("changed packages/cezar/scripts/mock-cursor-print.mjs") and ran nothing in 60 s. Status still read "Known failures: 3 ... observed at revision 0, current", while `npx vitest run` on that tree gave `Tests 3 passed`. *Verified by experiment.*

With `{ "inputs": { "packages/cezar/src/core/*parity*.test.ts": ["packages/cezar/scripts/**"] } }`, a mock-only edit re-ran the file: the broken mock gave PASS -> FAIL (revision 2), the fixed mock FAIL -> PASS (revision 3) (`daemon-probe.txt`, the probe store). *Verified by experiment.*

## Recommendation for Squeal

1. **No change to how the daemon runs Vitest.** A detached session leader, its own `TMPDIR` and its cwd switch change nothing these tests observe, and Squeal passes Vitest no pool settings.
2. **Reword defect 28.** The tree was red at the time: S26 to S28 really failed while the merge was applied and the cursor mock was not yet fixed. The Squeal-side fault is a known one: a result stayed current after an edit to a file the test runs but does not import. Spec 001 accepts this (Non-goals: "Runtime file reads ... The closure is declared incomplete by construction"), and Open question 1 proposes per-test-file `inputs` as the remedy.
3. **For cezar** (a note to its maintainers, not Squeal work): declare the mock scripts as inputs. Suggested: `"packages/cezar/src/core/*parity*.test.ts": ["packages/cezar/scripts/mock-*.mjs"]` (11 test files). The probe verified the same key with `["packages/cezar/scripts/**"]`; narrowing it to `mock-*.mjs` is inferred to behave the same for these mocks. 53 test files name a mock or `harness-parity.testkit.ts`. Covering them all with `packages/cezar/src/**/*.test.ts` would re-key 408 files on any mock edit, which is the cost defect 25 describes. *Count read in source code; cost inferred.*

## Open questions

- Should Squeal find spawned scripts itself, for example a literal path passed to `spawn(process.execPath, [...])` in the closure, or say on a failure that its closure cannot see runtime reads? This is a spec decision, not answered here.
- When the agent asked, did the hook or status text show S26 to S28 as current, or as stale from an older revision? The store holds only today's `known_states` row, now a pass at revision 178. Not determined.

## Sources

- cezar `5974ec91`, `6b660859`, `b666711d`, `1c97556a`: `packages/cezar/src/core/runner-shutdown-parity.test.ts`, `harness-parity.testkit.ts` (cursor adapter, `SHUTDOWN_CRITERIA`), `session-process.ts:134-150`, `scripts/mock-cursor-print.mjs`, `vitest.setup.ts`; branch reflog of `feat/cursor-marketplace-plugins` in `/home/agent/projects/cezar`.
- cezar Squeal store `/home/agent/projects/cezar/.git/squeal/store.sqlite`, worktree `aba1f97b2081b6b9`: tables `revisions`, `runs`, `results`, `transitions`, `test_files`; run logs `.git/squeal/runs/{bbcd1daa,eb90fd0a,520e17d1,1204ea70}-*/vitest.log`.
- Squeal 0.1.32: `src/runners/vitest/adapter.ts:82-97`, `src/core/daemon/ensure.ts:137-185`, `src/core/daemon/scratch.ts:175-222`; `spec.md` Non-goals and Open question 1.
- Node v24.21.0 `child_process` docs, `options.detached` (quoted in `daemon-under-harnesses.md`).
- Probe logs: `probes/process-group-tests-under-squeal/logs/matrix-5974.txt`, `matrix-6b66.txt`, `daemon-probe.txt`, `daemon-probe-stays-current.txt`, `cezar-store-c8580be4.txt`.
