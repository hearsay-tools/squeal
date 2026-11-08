# import-trial: CI export imported into a fresh cezar clone (row 018-08)

Researcher a9fd78c8 for spec 018, 2026-11-08. Brief: `tasks/wave-3.md`. Squeal `squeal--v0.1.417` (`ea776c75c`), run as `node <shallow clone>/plugins/claude-code/dist/cli/squeal.mjs`. Node v24.22.1 on this host (checked with `node --version`). cezarion at `bed82fdb` (`ci: add a manual Squeal results trial workflow (#3018)`), Vitest 4.1.10. Host: 24 vCPUs, one-minute load 9 to 15 during the probes. Probes: `probes/import-trial/` (throwaway). Tags: **[exp]** verified by experiment, **[src]** read in source code, **[docs]** read in official docs, **[inf]** inferred.

Status: Step 0 done. The three counts wait for a successful trial run (the coordinator relays its id).

## Questions answered

| # | Question | Answer |
|---|---|---|
| 0a | What made revision 1 in run 42482427002 | One cezar test, `packages/cezar/src/artifacts/store-windows.test.ts`, mocks `node:path` as `path.win32`. Squeal's coverage provider runs in the same worker and builds its payload path with the mocked `join`. The result is one file whose name holds backslashes (`\tmp\squeal-1001\tmp\<hash>\coverage-<x>\.tmp\coverage-<uuid>.json`), written in the clone's root. Git does not ignore it, so the tree is dirty and the daemon records revision 1. Reproduced locally with the same status line, `bed82fdb + 1, dirty` **[exp][src]**; that it was this file in CI **[inf]** |
| 0b | Does `run --all` wait for the `at: manual` browser group | Yes. `run --all` covers every group, `manual` too; the checkpoint counted 1,843 files, the 98 browser files with them **[src][exp: CI log]** |
| 0c | Smallest workflow change | One line before `squeal start`: `printf '%s\n' '/\\*' >> .git/info/exclude`. Verified: same test, same Squeal, revision stays 0 and `git status --porcelain` is empty **[exp]**. To consider as well: `run --fast` in place of `run --all`, so that the 98 serial browser files are not in the trial |
| 1 | Import alone | pending a successful run |
| 2 | What the shared store already gives | pending |
| 3 | Cost | pending |

## Step 0. Why run 42482427002 reached no verdict

**The log** **[exp]** (`probes/import-trial/run-42482427002-excerpt.txt`). `squeal start` at 12:55:05Z. The 200 files of the first tier ran from 12:55:35Z. At 12:55:54Z, `run --all --wait` exited 3 with `Checkpoint 1e9020c7-… has no verdict: revision 1 was recorded after the checkpoint's revision 0`. Status at that time: `Revision: 1 · bed82fdb + 1, dirty`, 57 of the 200 files ended, 1,643 queued, `browser: 98 test files; 98 pending`.

**Why one revision ends the wait** **[src]** `src/cli/run.ts` `pollCheckpoint`: `if (revision > checkpoint.revision) return { kind: "moved", revision }`. Any new revision of the worktree stops the wait with exit 3. The daemon itself goes on with the queued files.

**What makes a revision, and what makes it dirty** **[src]**
- `src/core/watcher/watch-spec.ts`: at start, the watcher excludes `.git`, nested repositories and the ignored entries that exist then.
- `src/core/watcher/candidates.ts`: a new path goes through `git check-ignore`. An ignored new path makes no revision, unless a closure names it (an "extra file").
- `src/core/daemon-loop/head.ts`: dirty means `git status --porcelain --untracked-files=normal` lists any entry. So revision 1 held a change that git does not ignore.

**The daemon alone does not move the revision** **[exp]** In a fresh clone (blobless clone, checkout `bed82fdb`, `pnpm install --frozen-lockfile`, empty store), I started the 0.1.417 daemon. cezar's config is `lookup-only`, so no test ran. Listing ended at about 50 s. Lint reached 2,896 of 3,195 files at about 6 min. Revision 0 the whole time, tree clean.

**Which test writes into the worktree**
- In the same clone, `vitest run --project api-client --project contract` (33 files, outside Squeal) changed nothing in `git status --porcelain --ignored` **[exp]**.
- In a copy of cezar's local store (1,209 revisions, 66 worktrees, 2026-10-14 to 2026-11-08), the untracked paths in revisions are ignored build output (`packages/cezar/dist/**`, `packages/cezar/web/**`, `.ai/qa/test-env.json`), plus one non-ignored path: `\tmp\squeal-1001\tmp\9bf58b24115ebd91\coverage-JKXAKJ\.tmp\coverage-ef9835cb-….json` **[exp]** (`probes/import-trial/revision-paths.mjs`). No tracked file changed and returned to its old content.
- cezar's main checkout holds two such entries, from 2026-10-28 and 2026-11-06. Its `.git/info/exclude` already has the line `\\tmp\\squeal-*`, so developers do not see them in `git status` **[exp]**.
- The `uuid` file name is not Vitest's own name (`coverage-${uniqueId++}.json`). It is the name of Squeal's provider, `src/core/code/coverage/provider.mjs` `takeCoverage`: `join(coverageFilesDirectory, \`coverage-${randomUUID()}.json\`)`, with `join` from `node:path`. The provider runs in the test worker (its header: "Vitest loads this file by path in its workers") **[src]**.
- Only one cezar test mocks `node:path` (search for `vi.mock('node:path'` and `vi.mock('path'`): `store-windows.test.ts`, which returns `{ ...actual, ...actual.win32 }` **[src]**. Then the provider's `join` gives `\tmp\squeal-1001\…\.tmp\coverage-<uuid>.json`. On Linux that is one file name relative to the worker's working directory, the clone's root.

**The reproduction** **[exp]** In the fresh clone with the 0.1.417 daemon:

```
$ squeal run tests packages/cezar/src/artifacts/store.test.ts --wait 180000      # control
Selected test files of group tests completed at revision 0: no known failures; 1 test file …
Revision: 0                                                                         # tree clean
$ squeal run tests packages/cezar/src/artifacts/store-windows.test.ts --wait 180000
Selected test files of group tests completed at revision 1: no known failures; 1 test file …
Revision: 1 · bed82fdb + 1, dirty
?? "\\tmp\\squeal-1001\\tmp\\673809215d51e751\\coverage-T740EZ\\.tmp\\coverage-b5b2036a-….json"
```

`squeal status --full` also names the lost payload: `coverage: 1 completed test file got no record …: 1 map-error (its payload did not map) … store-windows.test.ts: Error: ENOENT … open '\tmp\squeal-1001\…'`.

CI attribution **[inf]**: the CI status line is the same (`bed82fdb + 1, dirty`), the runner's uid is 1001 as here, and the file runs in about 0.1 s, so it can end in the first 20 s of a tier. The CI log lists only the first five running files. A full local run would prove it, and the brief does not allow one.

**The manual browser group** **[src]** `src/core/daemon/check-groups.ts` `heldUntilAsked`: "At either [`commit` or `manual`], `squeal run <group>` and `run --all` run them." In `slow-tier.ts` `holdsFollowers`, a request or a checkpoint lets these files run. The CI checkpoint counted 1,843 files, the 98 `browser` files with them, and they wait for the shared worker pool (`maxParallel: 1`). The trial job does not build the web app, start the test environment or install a browser. Those files would fail or run slowly one at a time, in the 90-minute wait. `run --fast` leaves out the slow lane. cezar's `slow.include` is the same glob as the browser group (`packages/web/e2e/*.e2e.ts`). Its checkpoint line is `Checkpoint <id> (the fast lane only, …) completed at revision …`. The workflow's `grep '^Checkpoint .* completed at revision '` still matches **[src]**.

## Recommendation for the trial workflow (Step 0)

1. **Exclude the stray name, one line, before `squeal start`** **[exp]**:
   ```sh
   # A test that mocks node:path as win32 makes Squeal 0.1.417's coverage provider write
   # '\tmp\squeal-<uid>\...' into the checkout root; developers' clones exclude it the same way.
   printf '%s\n' '/\\*' >> .git/info/exclude
   ```
   `/\\*` matches any top-level name that starts with a backslash, whatever the temp directory is. `.git/info/exclude` is not tracked content, and no key reads ignore rules. With it, the same test kept revision 0 and a clean tree. The coverage payload of that one file is still lost (`map-error`), as on developers' machines.
2. **Use `run --fast --wait` in place of `run --all --wait`**, unless the trial needs browser results. Developers' daemons never run the browser group by themselves (`at: manual`), so their imports gain little from it. Without the change, the job waits for 98 serial files that have no test environment.
3. Not proposed for this run: a retry of `run` on a moved revision. Results stay stored by key, so a second `run --fast --wait` would run only the rest. But it hides the next writer instead of naming it. Add the retry only if a second run fails with a new revision.

**For Squeal, not for this workflow** **[inf]**: the provider takes `node:path` through the module runner, so a test's `vi.mock('node:path')` changes where Squeal writes. The result: a lost coverage record and a file in the user's worktree, on any machine. A row could make the provider build its path without a mockable import. Also, `run --all --wait` gives no verdict when a test writes any non-ignored file. Today the only remedy is a user's exclude.

## Open questions

- Other test writers in cezar's full suite: not determined, because only a full run shows them, and the brief allows a few files only. The local store's seven days show no other non-ignored path.
- Whether the trial should keep the browser group (recommendation 2): the coordinator's call, or the human's if it changes D7.

## Sources

- Job log: `gh run view 42482427002 -R hearsay-tools/cezarion --log` (step "Run the suite under Squeal and export its results"); excerpt in `probes/import-trial/run-42482427002-excerpt.txt`.
- Squeal at `squeal--v0.1.417` (`ea776c75c`): `src/cli/run.ts` (`pollCheckpoint`, `verdictLine`), `src/cli/run-lanes.ts`, `src/core/watcher/watch-spec.ts`, `src/core/watcher/candidates.ts`, `src/core/watcher/git.ts`, `src/core/daemon-loop/head.ts`, `src/core/types/revision.ts`, `src/core/scheduler/ignored-marks.ts`, `src/core/daemon/check-groups.ts`, `src/core/scheduler/slow-tier.ts`, `src/core/scheduler/slow-trigger.ts`, `src/runners/vitest/coverage.ts`, `src/core/code/coverage/provider.mjs`, `src/cli/export.ts`.
- cezarion at `bed82fdb`: `squeal.config.json`, `.gitignore`, `vitest.config.ts`, `packages/cezar/vitest.config.ts`, `.github/workflows/squeal-results-trial.yml`, `packages/cezar/src/artifacts/store-windows.test.ts`; Vitest 4.1.10 `dist/chunks/coverage.DM_a_rWm.js` (lines 655, 740).
- cezar's local store, copied with `-wal` and `-shm` at 2026-11-08 13:40Z and deleted after the read; `/home/agent/projects/cezar` listing and `.git/info/exclude`, read only.
