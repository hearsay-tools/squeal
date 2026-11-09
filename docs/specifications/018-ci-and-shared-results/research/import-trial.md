# import-trial: CI export imported into a fresh cezar clone (row 018-08)

Researcher a9fd78c8 for spec 018, 2026-11-08 to 2026-11-09. Brief: `tasks/wave-3.md`. Step 0 used Squeal `squeal--v0.1.417` (`ea776c75c`) at cezarion `bed82fdb`; Step 0b read `squeal--v0.1.418` (`2b7ae25`). The counts used `squeal--v0.1.419` (`21adaff51`), run as `node <shallow clone of the tag>/plugins/claude-code/dist/cli/squeal.mjs`, at cezarion main `721c19b0`, the commit of trial run 42596322864. Node v24.22.1 on this host and in the job (`node --version`). Vitest 4.1.10. Host: 24 vCPUs, one-minute load 3.5 to 15 during the probes. Probes: `probes/import-trial/` (throwaway). Tags: **[exp]** verified by experiment, **[src]** read in source code, **[docs]** read in official docs, **[inf]** inferred.

## Questions answered

| # | Question | Answer |
|---|---|---|
| 0a | What made revision 1 in run 42482427002 | One cezar test, `packages/cezar/src/artifacts/store-windows.test.ts`, mocks `node:path` as `path.win32`. Squeal's coverage provider runs in the same worker and builds its payload path with the mocked `join`. The result is one file whose name holds backslashes (`\tmp\squeal-1001\tmp\<hash>\coverage-<x>\.tmp\coverage-<uuid>.json`), written in the clone's root. Git does not ignore it, so the tree is dirty and the daemon records revision 1. Reproduced locally with the same status line, `bed82fdb + 1, dirty` **[exp][src]**; that it was this file in CI **[inf]** |
| 0b | Does `run --all` wait for the `at: manual` browser group | Yes. `run --all` covers every group, `manual` too; the checkpoint counted 1,843 files, the 98 browser files with them **[src][exp: CI log]** |
| 0c | Smallest workflow change | One line before `squeal start`: `printf '%s\n' '/\\*' >> .git/info/exclude`. Verified: same test, same Squeal, revision stays 0 and `git status --porcelain` is empty **[exp]**. Also leave out the 98 serial browser files: `run tests --wait`, not `run --fast` (see "Step 0, later runs") **[src]** |
| 0d | Why run 42530503204 stopped after 61 min | Squeal's idle exit: no session is ever registered in CI, and `daemon.idleExitMinutes: 60` counts only requests as activity, not running tests **[src][exp: fixture]**. Fixed in Squeal 0.1.419 (row 018-12) |
| 1 | Import alone (fresh clone, empty store) | **1,589 of 1,817 test files current from the import** (87%), 1,589 of the 1,716 exported (93%). Every Vitest project: 100% (server 1,166, web 390, contract 31, api-client 2). Both node:test projects: 0 of 127, reason "environment differs": `config fields execPath differ`. Not exported: the 100 browser files (`at: manual`, never run) and 1 failing file. No other D5 reason and no other environment difference **[exp]** |
| 2 | What the shared store already gives | **Before the import: 1,716 of 1,817 current, all inherited** (the 100 browser files have none). The import then makes **0** files current from it: 1,353 "another result kept at the same key", 236 "closure list differs", 127 "environment differs" (`execPath`). The 236 come from the shared observed sets, which are merged across worktrees and never pruned, so they hold paths a single CI run does not read. No refused-path note: the copy held no backslash observed path **[exp][src]** |
| 3 | Cost | Job 82 min 52 s, of which `run tests` 82 min 8 s, export 10 s, upload 2 s, setup 24 s. Export 2,074,272 bytes gzipped (33,176,577 bytes of JSON): 29,953 results of 1,716 test files. `squeal import` took about 2 s **[exp]** |

## The export: trial run 42596322864

cezarion `squeal-results-trial.yml` as merged in cezarion#3029: exclude line, `squeal status --wait 120000`, then `env -u CI -u GITHUB_ACTIONS squeal run tests --wait 5400000`, then `squeal export` **[exp]** (`probes/import-trial/run-42596322864-excerpt.txt`):

```
11:12:01Z Group tests completed at revision 0: 1 known failure: 1 test; 1717 test files, 1717 queued by this request
          Affected checks: 29941 passed (28224 tests, 1717 test files loaded), 0 running, 0 queued, 14 skipped (14 tests)
          browser: 100 test files; 100 not run at revision 0.
11:12:11Z Exported 1716 test files, 29953 results, to /home/runner/work/_temp/squeal-results.json.gz.
          Left out: 100 test files with no result at the key, 1 test file with a failure at the key.
```

The export header says `"dirty":false`, so the exclude line kept the tree clean. The one failure, `scripts/mock-publish.test.mjs` (`root:test:unit`), also fails on this host: count 2's daemon ran it again, and it failed.

## Count 1. Import alone

A fresh blobless clone at `721c19b0`, `pnpm install --frozen-lockfile`, no `.git/squeal/`. Then `squeal import <file>`, and after it `squeal start` (lookup-only, so no test ran) **[exp]**:

```
11:35:26Z Imported 29953 results of 1716 test files from CI run 42596322864 on hearsay-tools/cezarion at 721c19b0.
          Added where the store had none: 1716 closure lists, 1563 observed entries.
          Environment of project "server": none recorded for this worktree yet; squeal status --full compares them once its daemon keyed the files
          (the same line for the other five projects)
11:35:28Z Squeal daemon spawned
```

`squeal status --full --json` at 11:35:38Z, 10 s after the start, and every minute until 11:38:40Z gave the same answer: `testFiles 1716, currentFiles 1589, currentResults 27877, notCurrent {environment: 127, all others 0}`, `environmentDifferences ["root:test:unit: config fields execPath differ", "test:unit: config fields execPath differ"]`. `squeal status --full` prints `Imported: 1589 of 1716 test files current from CI run 42596322864 … (27877 current results)` and `Not current: 127 environment differs (…execPath…)`. The default `status` has no import line. That is right by D5, because some files are current.

Per project, from Squeal 0.1.419's own `readImports` on each project's rows (`probes/import-trial/per-project.ts`, output in `counts/c1-per-project.json`):

| Project (runner) | Listed | Exported | Current from the import | Reason for the rest |
|---|---|---|---|---|
| server (Vitest) | 1,166 | 1,166 | 1,166 | none |
| web (Vitest) | 390 | 390 | 390 | none |
| contract (Vitest) | 31 | 31 | 31 | none |
| api-client (Vitest) | 2 | 2 | 2 | none |
| root:test:unit (node:test) | 117 | 116 | 0 | environment differs: `execPath` (116); 1 failing file not exported |
| test:unit (node:test) | 11 | 11 | 0 | environment differs: `execPath` (11) |
| e2e (Vitest, `browser` group, `at: manual`) | 100 | 0 | 0 | not run in CI, so not exported |
| **All** | **1,817** | **1,716** | **1,589** | |

- **The one environment difference** **[src][exp]**: `src/runners/node-test/adapter-environment.ts:70-74` puts `execPath` in the node:test project's config, as a path relative to the root or else absolute. CI's Node is under `/opt/hostedtoolcache/node/24.22.1/x64/`, this host's is under `~/.nvm/versions/node/v24.22.1/`. The Node version is the same, but the key differs. The Vitest environments are equal: the workflow removes `CI` and `GITHUB_ACTIONS`, and the job pins Node 24.22.1 and uses the same Squeal coverage provider.
- **No other D5 reason**: no closure list, observed set, content or missing-key difference. In a fresh clone, every key is computed from CI's closure lists and observed entries, which the import added where the store had none **[exp]**.
- **Coverage is blind after an import** **[exp]**: status says `Coverage: … 1514 files unknown (1479 from a test file with no coverage record …)`. Imported results carry no coverage records, so CRAP and untested-function counts cover only files run locally.

## Count 2. What the shared store already gives

A second fresh clone at `721c19b0`, with a copy of `~/projects/cezar/.git/squeal/store.sqlite`, `-wal` and `-shm` in `.git/squeal/`. The copy was taken at 11:40:18 to 11:40:25Z while cezar's daemons ran: 3,661,017,088 bytes plus a 1,916,244,992-byte WAL. The live store was only read. **[exp]**

**Before the import.** The daemon took more than 30 s to answer `start` (the start line says so) and had keyed all files at 11:41:18Z. Status: `Known failures: 1 (1 test); not current: 100 of 1817 test files (100 unknown)`. All 1,716 current files are inherited, except `mock-publish.test.mjs`. lookup-only ran that file again, because the store held a failure for it, and it failed here too. Per project: server 1,166, web 390, contract 31, api-client 2, root:test:unit 117, test:unit 11, all current; e2e 0 of 100. The same over three reads a minute apart. **No note about refused observed paths appeared.** The copy held no observed path with a backslash or an absolute path: I checked every `observed*` and `nodeTest.observed*` key. So 0.1.419's new rule had nothing to refuse **[exp]**.

**After the import** (11:45:04Z, 1 s): `Imported 5592 results of 1716 test files …; 24361 the store held at their keys already were left as they were.` The environment comparison is equal for the four Vitest projects and differs by `execPath` for the two node:test projects. Then, stable over three reads a minute apart: `currentFiles 0`, and status still showed 1,716 current, all inherited.

| Project | Exported | "Another result kept at the same key" | "Closure list differs" | "Environment differs" |
|---|---|---|---|---|
| server | 1,166 | 935 | 231 | 0 |
| web | 390 | 385 | 5 | 0 |
| contract | 31 | 31 | 0 | 0 |
| api-client | 2 | 2 | 0 | 0 |
| root:test:unit | 116 | 0 | 0 | 116 |
| test:unit | 11 | 0 | 0 | 11 |
| **All** | **1,716** | **1,353** | **236** | **127** |

- For 1,353 files, the developers' keys equal CI's. The store already held the same results there, so the add-only import keeps them, and D5 counts them as "kept", not as from the import **[exp]**.
- **Why 236 files have a different closure list** **[exp][src]**. The daemon keys a new worktree from the one stored closure list per test file, "which the next worktree keys from at bootstrap" (`src/core/scheduler/revision.ts:276-300`). That list includes the file's observed paths. The observed sets are "shared by every worktree of the repository, merged and never pruned" (`src/core/keys/observed.ts:11-16`). Across 240 files whose key differs between the two clones (`probes/import-trial/classify.mjs`), the shared lists hold paths CI's list lacks: 11,628 source or script paths, 279 `package.json` paths, 51 uuid-named paths and 715 others. CI's lists hold no path the shared lists lack. Example (`obs.mjs`): `server:packages/cezar/src/artifacts/cli.test.ts` has 659 paths in the shared list and 582 in CI's. All 77 extra paths are in the shared observed set and none is in CI's, for example `absent-runs/<uuid>-artifacts`, `packages/cezar/src/runs/transcript-facts-worker.ts`, `packages/cezar/scripts/pi-ci-wait.mjs`. Two worktrees wrote these rows between 08:34Z and 11:33Z: cezar's main checkout at `00e0c843` (4 commits before `721c19b0`) and a task worktree at `b7c17fed` (5 commits after). D5 names the cause "closure list differs", because `reasonOf` compares the lists before the observed sets (`src/core/status/imports.ts`, `reasonOf`). The real difference is the observed sets.
- What the import gives a clone that shares cezar's store today: nothing. Local worktrees had already run this content. The import's value is for a clone or machine without that history (count 1), and for main commits that no local worktree ran **[inf]**.

## Count 3. Cost

From `gh run view 42596322864 --json jobs` and the log **[exp]**:

| Step | Start (UTC) | Time |
|---|---|---|
| Set up job, checkout, pnpm, Node, `pnpm install` | 09:49:27 | 19 s |
| Fetch the Squeal release (shallow clone of the tag) | 09:49:46 | 6 s |
| Run the suite under Squeal and export | 09:49:52 | 82 min 20 s |
| of it: `squeal start` to the group verdict | 09:49:53 | 82 min 8 s |
| of it: `squeal export` | 11:12:01 | 10 s |
| Upload the export | 11:12:12 | 2 s |
| **Job** | 09:49:26 | **82 min 52 s** |

Export file: 2,074,272 bytes gzipped, 33,176,577 bytes as JSON; the artifact zip is 2,042,989 bytes. Contents: header, environments, 1,716 test files with closure lists and observed entries, observed startup entries, 29,953 results. One job ran the whole suite, 1,717 files, on one runner. The CI status line said "load 1.28 per CPU when it ran". The job ran on a standard `ubuntu-24.04` runner; I did not check its CPU count.

## Recommendation for the next slice

1. **Produce the export from the CI test run cezar already does, not from a separate job** **[inf]**. The trial's separate job costs 83 job-minutes per commit. Running it on every main commit would cost more than `main-results.md` 4 estimates it saves. The file is small (2 MB) and the import is quick (2 s), so the cost is in producing the export, not in moving it. That needs Squeal's recorder in cezar's test step (`main-results.md` 4 B).
2. **Transport**: a workflow artifact per main commit (7 days) is enough for a trial user. A developer needs the run id of their commit, and `gh run download` needs a token **[inf]**. The next measurement is how many main commits a developer's new worktree starts at that no local worktree ran. Count 2 shows a clone that shares a busy store gains nothing at a commit its worktrees already ran.
3. **`CI=true` tolerance**: not needed when the producing step removes `CI` and `GITHUB_ACTIONS`. The four Vitest environments were equal with them removed **[exp]**. Reusing cezar's existing test step brings `CI=true` back, so that step must remove it too, or the key must tolerate it **[inf]**.
4. **node:test `execPath`**: key Node by version, not by its absolute install path. The trial lost 127 files (7% of those exported) to this one field **[exp][src]**.
5. **Observed-set rule**: observed sets merged across worktrees and never pruned make a long-lived store's keys differ from a single CI run's keys. They also take in run-specific names such as `absent-runs/<uuid>-…`. Two options to weigh: key a result by the observed set of the run that made it, or prune the union. D5 could also separate "observed paths in the closure list" from the static list, so that the reason names the observed set **[exp][src]**.
6. **Coverage**: say in status that imported files have no coverage record, or export coverage with the results **[exp]**.

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
2. ~~**Use `run --fast --wait` in place of `run --all --wait`**~~ Wrong for 0.1.417: see "Step 0, later runs" below, which replaces it with `run tests --wait`. The reason to leave out the browser group stands. Developers' daemons never run the browser group by themselves (`at: manual`), so their imports gain little from it. Without the change, the job waits for 98 serial files that have no test environment.
3. Not proposed for this run: a retry of `run` on a moved revision. Results stay stored by key, so a second `run --fast --wait` would run only the rest. But it hides the next writer instead of naming it. Add the retry only if a second run fails with a new revision.

**For Squeal, not for this workflow** **[inf]**: the provider takes `node:path` through the module runner, so a test's `vi.mock('node:path')` changes where Squeal writes. The result: a lost coverage record and a file in the user's worktree, on any machine. A row could make the provider build its path without a mockable import. Also, `run --all --wait` gives no verdict when a test writes any non-ignored file. Today the only remedy is a user's exclude.

## Step 0, later runs

**`run --fast` gives no verdict in cezar (0.1.417; CodeRabbit on cezarion#3029)** **[src]** With a `checks` key in the config, the daemon and the CLI decide differently which files are slow. The daemon's fast checkpoint leaves out every file of a group other than `tests` (`src/core/scheduler/slow.ts:83` `groups.of(ref).name !== TESTS_GROUP`, through `scheduler.ts:639` and `checkpoint-requests.ts:60`). The CLI's verdict counts every file that the default `slow` group does not own (`src/cli/run-lanes.ts:50`, then `src/core/state/slow.ts:51` `groups.of(ref).name === SLOW_GROUP`). The `browser` group owns cezar's 98 e2e files, so the CLI counts them in the fast lane. They have no result, and `src/cli/verdict.ts:238` gives "not-current", exit 3. The fix used: `squeal run tests --wait`, whose CLI files are the daemon's (`src/cli/run-group-wait.ts:149`), checked by `grep '^Group tests completed at revision '`. Merged in cezarion#3029, with the exclude line and a `squeal status --wait 120000` for the listing. Squeal 0.1.418 fixed the fast-lane classifier.

**Run 42530503204 (main `6f552e55`, Squeal 0.1.418): the daemon stopped by itself** **[src][exp]** The daemon spawned at 22:30:16Z. At 23:31:43Z, `run tests --wait 5400000` printed "Group tests has no verdict: the daemon stopped before the group's test files had results". It listed 1,414 files with results, 332 queued, and one known failure (`scripts/mock-publish.test.mjs`). It also said "no daemon has validated since 23:30:55Z", 60 min 39 s after the spawn. The cause is Squeal's idle exit. cezar sets `daemon.idleExitMinutes: 60`, and no session is ever registered in CI. In 0.1.418, `src/core/daemon/lifecycle.ts:266-273` stops such a daemon 60 min after its last request. Running tests are not activity. Requests are (`handlers.ts:214, 218, 222, 272`), but the pings that `--wait` sends are not. No environment variable overrides the limit. A tier in flight finishes and stores its results (`lifecycle.ts:203`), so the queued files got none.
- Fixture probe **[exp]**: a node:test repository under `$TMPDIR` with `idleExitMinutes: 1` and a 100 s test. `run tests --wait 300000` ran at 00:08:03Z. At 00:09:07Z the note read "daemon stopped: idle for 1 min with no registered consumers", while the test ran. A loop of `run tests --wait 40000` kept a 150 s test's daemon alive: three "deadline passed" tries, then "Group tests completed at revision 2: no known failures", exit 0. A repeated request starts nothing twice (`slow-tier.ts:916-932` `queueGroup` counts files already queued or running).
- `squeal export` after such a stop is right for each file but partial **[exp][src]**. In the fixture it exported "2 test files, 4 results" with no daemon. It leaves out failed files and files with no key, a pending key or no result (`src/core/store/transfer.ts:63-64, 91`).
- The human's choice (coordinator, 2026-11-09): fix Squeal, not the workflow. Row 018-12 makes progress on an open request count as activity, and Squeal 0.1.419 has it. Trial run 42596322864 runs on 0.1.419 at main `721c19b0`.

## Open questions

- Other test writers in cezar's full suite: answered by run 42596322864. The tree stayed clean (`"dirty":false`) with the exclude line, so no other test made a non-ignored file in that run.
- How many main commits a new worktree starts at that no local worktree ran. That sets the real gain of the import for developers who share a store (count 2 shows none at this commit). Not determined, because it needs the store's history and main's landing times (`main-results.md` 1 has the method).
- Whether the shared store's longer closure lists come only from the observed union, or also from code that differs at the writers' commits (4 before and 5 after `721c19b0`). The 77 extra paths of the example are all in the shared observed set, and CI's lists are a subset in every case. The rest is not checked file by file **[inf]**.
- The store copy was taken while cezar's daemons wrote. It opened and keyed without error. Whether a write from those 7 s is missing from the copy is not determined.

## Sources

- Job logs: `gh run view <id> -R hearsay-tools/cezarion --log` for 42482427002, 42530503204 and 42596322864 (step "Run the suite under Squeal and export its results"); excerpts in `probes/import-trial/run-*-excerpt.txt`. Step times: `gh run view 42596322864 --json jobs`. Export: `gh run download 42596322864` (artifact `squeal-results-721c19b004d5f4453488d2b4e859fd6a6256f97b`), deleted after the counts.
- Squeal at `squeal--v0.1.417` (`ea776c75c`): `src/cli/run.ts` (`pollCheckpoint`, `verdictLine`), `src/cli/run-lanes.ts`, `src/cli/verdict.ts`, `src/cli/run-group.ts`, `src/cli/run-group-wait.ts`, `src/core/state/slow.ts`, `src/core/scheduler/slow.ts`, `src/core/scheduler/scheduler.ts`, `src/core/scheduler/checkpoint-requests.ts`, `src/core/watcher/watch-spec.ts`, `src/core/watcher/candidates.ts`, `src/core/watcher/git.ts`, `src/core/daemon-loop/head.ts`, `src/core/types/revision.ts`, `src/core/scheduler/ignored-marks.ts`, `src/core/daemon/check-groups.ts`, `src/core/scheduler/slow-tier.ts`, `src/core/scheduler/slow-trigger.ts`, `src/runners/vitest/coverage.ts`, `src/core/code/coverage/provider.mjs`, `src/cli/export.ts`.
- Squeal at `squeal--v0.1.418` (`2b7ae25`): `src/core/daemon/lifecycle.ts`, `src/core/daemon/daemon.ts`, `src/core/daemon/handlers.ts`, `src/core/scheduler/slow-tier.ts` (`queueGroup`), `src/core/store/transfer.ts`.
- Squeal at `squeal--v0.1.419` (`21adaff51`): `src/core/status/imports.ts`, `src/core/keys/observed.ts`, `src/core/scheduler/revision.ts`, `src/runners/node-test/adapter-environment.ts`, `src/core/store/transfer.ts`; commit `1dd5a98b5` (row 011-310).
- cezarion at `bed82fdb` and `721c19b0`: `squeal.config.json`, `.gitignore`, `vitest.config.ts`, `packages/cezar/vitest.config.ts`, `.github/workflows/squeal-results-trial.yml`, `packages/cezar/src/artifacts/store-windows.test.ts`, `packages/cezar/src/runs/transcript-facts-queue.ts`; Vitest 4.1.10 `dist/chunks/coverage.DM_a_rWm.js` (lines 655, 740).
- cezar's shared store, copied with `-wal` and `-shm` on 2026-11-08 at 13:40Z (Step 0) and on 2026-11-09 at 11:40Z (count 2), each deleted after use; the listing of `/home/agent/projects/cezar` and its `.git/info/exclude`, read only.
- Probes: `probes/import-trial/README.md` lists them; outputs of the counts in `probes/import-trial/counts/`.
