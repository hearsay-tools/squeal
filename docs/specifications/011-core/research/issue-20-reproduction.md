# Issue 20 reproduction: filesystem errors under Squeal's tmp root

Brief: `issue-20-brief.md` (triage row gh-20). Researcher run on 2026-10-17, load 11.9 to 16.8 on 24 CPUs. Squeal exercised: installed plugin 0.1.199 (`e36fea56`), copied into a scratch directory. Source read: this checkout at `de61aeac` (0.1.203). Vitest 4.1.10. Cezarion read at `82f97570c` (`new-task.e2e.ts` and `fixture-server.ts` last changed in `064bc4c15`). Probe: `probes/issue-20/` (`run.sh`, `store-scan.mjs`, `fixture/`, observed outputs).

## Answers

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | What produced the error; who owns `<hash>` | The test file's own cleanup. `new-task.e2e.ts:88:17` is `rmSync(dataRoot, …)` in **`afterAll`**, not setup. It removes the file's own `mkdtemp` directory while processes the file started can still write into it. Reproduced with Squeal (race file 8 of 12 and 11 of 12 forced runs) and without it (plain Vitest 12 of 12). `<hash>` is per worktree daemon: `sha256(repository-id \0 root)[:16]`. Every lane and run of that daemon shares it; no two worktrees do. | verified by experiment (0.1.199); read in source code |
| 2 | How it is reported today | As a file-level FAIL whose summary starts `setup failed:`, counted under `Known failures: N (N test files that did not load)`, with `no retry asked at these inputs`. This happens even when every test in the file passed. Nothing distinguishes a path under the tmp root, apart from fingerprint normalization (which keeps the `mkdtemp` suffix) and 013 V8's ENOENT rule for Vitest's own temp directories. | verified by experiment; read in source code |
| 3 | Frequency and cost in stores here | No ENOTEMPTY, EBUSY or EEXIST failure in either store. Cezarion: 3,494 runs since 2026-10-14T19:55Z, 6,876 transitions, 13 transitions naming a temp path (other codes). Squeal: 1,303 runs, 17,334 transitions since 2026-10-07, 3 transitions naming a temp path. The incident itself is not in this host's store. | verified by experiment (read-only queries) |
| 4 | What a "retry once under the owned tmp root" rule catches and masks | It catches the issue's race. It cannot tell that race from a deterministic defect with the same code and path, or from an intermittent product regression in the cleanup path. Its predicate is broader than it reads: under the daemon, `os.tmpdir()` *is* the owned root, so every test's temp directory qualifies. | inferred from the experiments |

## 1. What produced the error

- **Location.** Cezarion `packages/web/e2e/new-task.e2e.ts:85-89`: `afterAll` closes the browser, awaits `stopFixtureServer(server)`, then runs `if (dataRoot) rmSync(dataRoot, { recursive: true, force: true })`. Line 88, column 17 is that `rmSync`. `stopFixtureServer` (`fixture-server.ts:6-30`) awaits the server process's own `exit` and nothing else. The server is `cezar serve --repo dataRoot`, which starts runs and git worktrees inside `dataRoot`. Children that outlive their parent or flush on shutdown can write while `rmSync` walks the tree. *Read in source code (cezarion 82f97570c).* That this is what happened in the incident is *inferred*: its run log and store rows are gone (Q3).
- **Experiment.** `fixture/test/race.test.ts` has the same shape. It sends SIGTERM to a writer it started, without awaiting it, then calls `rmSync(dir, {recursive, force})` while the writer flushes for 3 ms. It produced the issue's message shape: `setup failed: ENOTEMPTY, Directory not empty: /tmp/squeal-1001/tmp/399a09148010c94c/i20-race-UU02b4 '…' at test/race.test.ts:37:3`. It failed in 11 of 12 forced runs in one set (`observed-run-2.txt`) and 8 of 12 in the next (`observed-run.txt`); without the shutdown flush it passed 4 of 4 (first draft of the fixture, not retained). The rate depends on load and on the fixture, so it says nothing about cezarion's rate. The same file under plain `npx vitest run`, with `TMPDIR` outside `/tmp/squeal-*`, failed 12 of 12 with the same ENOTEMPTY. Squeal is therefore neither the cause nor a precondition. Its recorder wrapper on `rmSync` (`dist/observe/fs.cjs:83`) records the path and calls the original. *Verified by experiment.*
- **Who owns `<hash>`.** `daemonScratch` (`src/core/daemon/scratch.ts`) builds it from the repository id and the worktree root, prepares it under the daemon lock and removes it at stop. `adoptScratch` sets `TMPDIR`, `TMP` and `TEMP` to it, and Vitest workers inherit them. Every race run of the first worktree (13 runs over phases A and B, fast and slow checkpoints) wrote under `/tmp/squeal-1001/tmp/399a09148010c94c`. The second worktree's run wrote under `…/cb4a0b82b31639ac`. Each run's own directory is a fresh `mkdtemp`. *Verified by experiment; read in source code.*
- **Which collision.** It is not between worktrees: their keys differ. It is not between lanes either. Lanes share the key directory but never a run's random `mkdtemp` child, and only processes given that path can write into it. It is inside one test file's own process tree. *Inferred from the above, with the plain-Vitest control as the deciding experiment.*
- **The incident's hash.** `ebe319e88fb7c67b` matches none of the 35 roots known on this host (`git worktree list` of the cezarion repository plus the store's `worktrees` table). Run `5c60add7…` is absent from the store and from `runs/`. It may come from a worktree since removed. *Verified by query; the cause is not determined.*

## 2. How it is reported today

These are the exact lines from `squeal run --all --wait` and `squeal status` (0.1.199, `observed-run.txt`):

```
Known failures: 2 (2 test files that did not load)
  FAIL  test/stuck.test.ts (file-level)
        setup failed: ENOTEMPTY: directory not empty, rmdir '/tmp/squeal-1001/tmp/399a09148010c94c/i20-stuck-dk7MFa'
        at test/stuck.test.ts:16:3, observed at revision 0, current
        recorded just now in this worktree at revision 0, load 0.85 per CPU when it ran; no retry asked at these inputs
```

`squeal why` shows the summary, location and fingerprint (`Error: ENOTEMPTY, Directory not empty: <tmp>/tmp/<hex>/i20-race-UU02b4 '…' @ test/race.test.ts:37:3`), the history, the full stack and the run log. For an intermittent file it adds `Flaky: PASS -> FAIL under the same inputs (key …)`. *Verified by experiment.*

The source path, *read in source code (de61aeac)*:

- `src/runners/vitest/run.ts:208` collects `RunReport.fileErrors`.
- `src/core/scheduler/records.ts:92` stamps each of them `phase: "setup"` when any test of the file reported, else `"load"`. Vitest does not mark which hook threw (task 001-361), so an `afterAll` error is a "setup" error.
- `src/core/state/fingerprint.ts:106` prefixes `setup failed: `.
- `src/core/status/checks.ts:71` counts the file-level FAIL as `that did not load`.
- `src/core/retry/text.ts:83` adds `no retry asked at these inputs`.

The fixture shows the wording problem: `stuck.test.ts` reported its only test as passed, yet the file is listed as a test file "that did not load", having "setup failed".

What already distinguishes temp paths, *read in source code*:

- `fingerprint.ts` `VOLATILE` normalizes temp prefixes. Here it left the `mkdtemp` suffix in (`<tmp>/tmp/<hex>/i20-stuck-JmpAzb`), so each run of the same deterministic failure was recorded as `FAIL -> FAIL, failure changed` (`why` lists 14 transitions for its 14 runs: one first-seen FAIL, then 13 `failure changed`, `observed-run.txt`). That is gh-28's subject (`issue-28.md`), and this probe reproduces it as a side effect.
- `src/runners/vitest/broken.ts` `isRunnerFailure` treats an ENOENT naming a path under the Vitest instance's own temp directories as a crashed run, not a check result (013 V8). In Vitest 4.1.10 those directories are `join(tmpdir(), nanoid())` (`cli-api.*.js:10640, 13020`). They are siblings of the tests' own temp directories inside the same daemon root. *Read in source code (vitest 4.1.10).*

The 011 C5 automatic re-run applies only to fast files. Phase A (unforced) ran `stuck.test.ts` (fast) twice and still recorded the FAIL. It ran `race` and `setup-race` (slow) once each. Forced runs re-run nothing, as C5 states. *Verified by experiment; read in 011 C5.* The issue's file was a slow file, so C5's slow-file exclusion, not a missing classification, is why it got no automatic second run.

## 3. Frequency and cost

Read-only queries with `store-scan.mjs` (`node:sqlite`, `readOnly: true`), as of 2026-10-17T08:16Z, *verified by experiment*:

| Store | Runs (span) | Transitions | Stored failure texts naming `/tmp/squeal-` | Transitions naming a temp path | ENOTEMPTY / EBUSY / EEXIST |
|---|---|---|---|---|---|
| cezarion `.git/squeal` | 3,494 (2026-10-14T19:55Z to 10-17T08:16Z) | 6,876 | 6 of 310 | 13 | 0 |
| squeal `.git/squeal` | 1,303 (2026-10-08 to 10-17) | 17,334 | 1 of 23 | 3 | 0 |

Breakdown of the 13 cezarion transitions:

- 5 are `Cannot find module '<tmp>/…/cez-installed-workers-…'` in `delegation.test.ts`. They persist from 10-15 to 10-17 across worktrees, so they look like a real defect.
- 3 are `pid file <tmp>/…/watchdog.pid holds no complete pid` (ENOENT).
- 1 is `Fixture still owns work: <tmp>/cez-parity-run-cursor-…`. This is cezarion's own guard against fixture children outliving their test, the issue's mechanism caught as an assertion.
- 1 is `Command failed: … <tmp>/…/cursor-smoke.mjs`.
- 3 are listener-announcement timeouts whose spawn arguments name a temp path.

The squeal store's one stored text naming `/tmp/squeal-` is an assertion diff in another worktree (`status-config-problem.test.ts`), not a filesystem error.

Limits of these numbers:

- A store keeps only the latest result per `(check, key)` (011 C5). The agent's passing retry replaced the incident's FAIL row.
- `prune` drops runs that no result references, together with their logs.
- No transition survives for a retired worktree: 0 orphan transitions, against result rows from 37 retired worktrees. Recorded history therefore undercounts transient failures that a later pass cleared. The reporter's 1 in 18 is the only rate for the incident, and it is unverified here.

Cost of one occurrence today: one agent `why` plus `retry --reason environment`. For a slow file, also one re-run, minutes to an hour per 004 and C5's reasoning. *Inferred.*

## 4. What a "retry once under the owned tmp root" rule would catch and mask

| Case seen | Rule's outcome |
|---|---|
| `race.test.ts`: `afterAll` race, intermittent (the issue) | Caught. A retry clears it with the file's pass probability (17 of 18 reported for cezarion). |
| `setup-race.test.ts`: the same race in `beforeAll` (true setup, tests skipped) | Caught, same as above. |
| `stuck.test.ts`: deterministic defect, same code, same path class | Not masked: the retry fails too. It costs one extra run, and for a slow file the failure stays out of `Known failures` for the duration of that run (a false-green window). |
| A product regression that makes shutdown leave children writing (what cezarion's `Fixture still owns work` guards) | Masked whenever the retry passes. The existing `Flaky: PASS -> FAIL under the same inputs` signal is the evidence a passing retry would hide unless `why` keeps the first error. |
| Store failures naming a temp path with other codes (module not found, ENOENT pid file, command failed) | Not caught by a rule limited to ENOTEMPTY, EBUSY and EEXIST. A broader rule ("any error naming the tmp root") would retry all 13 cezarion cases, including the persistent `delegation.test.ts` defect. |

*Inferred* from the cases above:

- The path test does not separate environment from code. Under the daemon, every `mkdtemp` a test makes lies under the owned root (Q1). The only directories Squeal or Vitest itself owns there are the Vitest instance directories, and 013 V8 already handles those for ENOENT.
- A narrower discriminator the evidence supports is "a file-level error raised after all of the file's tests passed". That is a teardown failure, and `race` and `stuck` both have this shape. It still does not separate those two. Only a retry outcome does, which is what C5's fast-file re-run already provides.
- The open policy question is therefore C5's slow-file exclusion for this class, not a new classification by path.

## Recommendation for Squeal

Do not key an automatic retry on "path under Squeal's tmp root": under the daemon it matches every test temp directory and separates nothing. If the human wants the issue's case handled, the evidence supports two smaller changes for a spec to weigh:

- Extend 011 C5's existing one re-run per key to a slow file's new file-level failure that comes after all of its tests passed. The re-run would be reported as pending, and `why` would keep the first error.
- Correct the wording: a file-level error after tests reported is not "setup failed" and not "did not load".

The gh-28 fingerprint fix is a precondition: otherwise every recurrence of such a failure reads as a changed one.

## Open questions

- The incident's run log, worktree and cezarion version: not determined, because hash `ebe319e88fb7c67b` matches no root on this host and run `5c60add7…` was pruned.
- Which cezarion process wrote into `dataRoot` during `rmSync`: not determined, because it was not reproduced in cezarion. That would need its e2e harness, browser and server under load, which is outside this read-only brief.
- Whether Vitest can tell an `afterAll` error apart from a `beforeAll` one in `fileErrors`: not determined here (records.ts cites task 001-361 for "no"; not re-verified on 4.1.10).

## Sources

- Issue: https://github.com/hearsay-tools/squeal/issues/20 and its comments; triage `issue-20.md`.
- Squeal source at `de61aeac`: `src/core/daemon/scratch.ts`, `src/core/daemon/paths.ts:94-102`, `src/core/scheduler/records.ts:88-95`, `src/core/state/fingerprint.ts:26-60,106`, `src/core/status/checks.ts:71`, `src/core/retry/text.ts:83`, `src/runners/vitest/broken.ts:14-19,64-82`, `src/core/store/schema.ts`, `src/core/store/prune.ts:68-125`.
- Specs: 011 C5 (re-run once per key, slow files excluded, setup check), C13, C14; 013 V4, V8; 004 D2, D4.
- Cezarion at `82f97570c`: `packages/web/e2e/new-task.e2e.ts:36-89`, `packages/web/e2e/fixture-server.ts:6-30`.
- Vitest 4.1.10: `vitest/dist/chunks/cli-api.BK8pd4xc.js:10640, 13020`.
- Probe outputs: `probes/issue-20/observed-run.txt`, `probes/issue-20/observed-run-2.txt`, `probes/issue-20/observed-stores.txt`.
