# Issue 274: where an oxlint config keying spends 9 s, and why a focused run request timed out

**Verdict.** The 9 s is almost all waiting for child processes, not main-thread work. A config keying runs `oxlint --debug files` in parts of 256 paths, and each run loads the project's JS plugin again. On a 5,479-file fixture with a plugin shaped like the issue's, that is 22 runs and 96% of the keying. The main thread is blocked once, for 236 ms on a quiet host and 540 to 640 ms on this host. The request did not time out because of a 9 s stall. A focused `run tests` request waits for the runner work of every revision queued before it. At the deadline it was still waiting for revision 12's apply step. The socket's text ("the daemon's main thread has been keying ... for 9 s") counts the child-process wait as main-thread work. Four fixes keep every key byte-identical: bigger `--debug files` parts, `chainOf` memoized per pass, key parts computed once per `Keyer`, and a yield every 256 files. Together they cut the keying from 3.8 s to about 0.5 s and the longest block from 236 ms to about 15 ms (quiet host, projected from the measured steps). No key version changes.

Issue [#274](https://github.com/hearsay-tools/squeal/issues/274). Source examined: Squeal 0.1.611 (`0fdd64474`). The daemon in the incident ran 0.1.606. Between the two, the only change in the files read is `439137750` (narrow-run batch order), which does not touch the wait path. oxlint 1.90.0. Dates: 2026-11-23/24.

## Questions answered

| Q | Answer | Tag |
| --- | --- | --- |
| 1 | On 5,479 files (3,853 linted, 73 closure files), a config `rekey()` takes 3,761 ms quiet and 8,755 to 11,611 ms here. `lintedFiles` takes 96% of it in 22 child processes (4,970 ms child CPU quiet). The main thread is blocked once: `chainOf` 66 ms, `Keyer.keys` 115 ms, `judgeAll` lookups 6 ms and its transaction 14 ms, 236 ms in total quiet (640 ms here). | verified by experiment |
| 2 | `onKeying` spans the child processes. At the deadline the main thread was live: it had read the request and posted the lock holder 1 s earlier. The request sat behind revision 12's runner work, by design of the narrow request. The lint keying added one main-thread block (about 0.5 s here, inferred from the fixture) and about one CPU of child processes. `rekey()` shares no SQLite lock with the main store. It queues scheduler lock turns through `lintRecorded`. | read in source code; timeline inferred |
| 3 | All four fixes give byte-identical keys and the same linted set (verified). A run with no paths is not a drop-in replacement: it applies `.gitignore`, while explicit paths do not. `--debug files` loads JS plugins and TS configs, so `observe` must stay on. One write transaction must stay one synchronous call. Everything else can yield. | verified by experiment; read in source code |
| 4 | Order of fixes: bigger `--debug files` parts, `chainOf` memo, once-per-`Keyer` keys, yields, `onKeying` around synchronous work only. No change to `LINT_KEY`, `OXLINT_PROVIDER_VERSION` or `KEY_FORMAT_VERSION`. Acceptance latency is mainly a scheduler question (open question 1). | inferred from the above |

## Setup

Fixtures from `probes/issue-274/make-fixture.mjs`: 3,009 files (`plain`, `import`, `heavy`) or 5,479 files (`heavy-large`). They use nested folders, `.ts`/`.json`/`.md` files, 3 nested configs and a local TS JS plugin whose rules sit in `owner-reader-rules.ts` and `test-enum-literal.ts`. `heavy*` adds 70 rule modules (about 640 KB) and `@babel/parser`. That is the shape of the issue's repository: 5,356 tracked files, about 4,300 with lintable extensions, a root JS plugin that imports 36 rule modules directly, in a folder of about 70 non-test files (about 640 KB), and imports `@babel/parser` (read there, nothing run). `probe.ts` drives Squeal's own `src/` modules. Quiet host: boat.dev, Ryzen 7 9700X, 4 vCPU, Node 24.22.1, load 1.4 to 1.8. This host: 16 CPUs visible, Node 26.13.0, load 25 to 41. Its numbers vary about 50% between runs.

## Findings

### Q1. Where the time goes (`heavy-large`, config keying after the two plugin files changed)

| Step | Quiet: wall / CPU own+child / longest block, ms | This host, ms |
| --- | --- | --- |
| whole `rekey()` | 3,761 / 356+4,970 / 236 | 11,611 / 886+10,890 / 640 (earlier run: 8,755 / 542, load 27) |
| `provider.inputs` (async, inside `rekey`) | 3,607 | 11,219 |
| `lintedFiles`, 256 per run, observe on (22 runs) | 3,323 / 107+5,360 / 6 | 10,971 / 310+10,670 / 15 |
| same, observe off | 2,824 / 71+4,600 / 6 | 10,170 |
| 1,024 per run (4 runs) | 801 / 24+1,280 | 2,593 |
| 4,096 per run (1 run) | 299 / 8+450 | 1,292 |
| one run with no paths | 138 / 5+230 | 529 |
| `chainOf` over 3,853 files (22.5 `existsSync` per file) | 66 (one block) | 267 |
| `chainOf` memoized per folder | 7 | 13 |
| `Keyer.keys` (import plugin off / on) | 115 / 104 | 229 / 248 |
| keys with parts computed once per `Keyer` | 25 / 25 | 94 / 101 |
| `judgeAll`: 3,853 `results.get` | 5.5 | 101 |
| the keying's write transaction | 14 | 32 |
| config keying, `lint.include` narrowed (2 `inputs` calls) | 794 | 2,686 |

The 3,009-file fixture with the small plugin: `rekey` 1,125 ms quiet (block 58 ms) and 3,242 ms here (block 221 ms). The import plugin changes `Keyer.keys` by little. The segment is built once per `Keyer`. **Verified by experiment.**

**One block, not several.** After the last `--debug files` process closes, everything up to the end of the write transaction runs as one task. That covers the `inputsOf` loop in `provider.inputs`, `Keyer.keys`, `judgeAll`, `staleOthers` and `store.transaction`. Each `await` between them waits on a settled promise, a microtask, so no timer, socket message or worker message runs in between. The measured longest block (236 ms quiet, 640 ms here) is about the sum of those steps. **Verified by experiment; read in source code** (`provider.ts:116-131`, `keyer.ts:109-134`, `rekey.ts:102-139`).

**Why `Keyer.keys` costs what it does.** For each file, `lintKey` rebuilds `shared(basis)` (an `Object.entries` sort). It hashes a JSON environment, sorts `configInputs(basis)` again (configs plus 73 closure files) and encodes each of those 74 segments with `Buffer.from`. That is about 285,000 encodes for 3,853 files. **Read in source code** (`keys.ts:168-184,296-311`, `check-key.ts:39-42`); the count is inferred.

### Q2. The incident's timeline

- **F2.1 `onKeying` spans the awaits.** `told()` wraps all of `rekey()` (`pass/run.ts:54-64,104`), so it covers the `--debug files` processes. `session.ready()` (the config walk and `--print-config`) runs before it and is not counted. **Read in source code.**
- **F2.2 What the two durations prove.** The socket worker answers from its own copy (`desk.ts:330-347`, `run-group.ts:224-240`). The text has no "has not read the request" clause, so the main thread had read it. "applying revision 12 for 1 s" is a holder that the main thread posted when that lock task started (`mutex.ts:42-46`), so the main thread ran 1 s before the deadline. The keying step was posted 9 s before the deadline and had not ended. No heartbeat clause only rules out a silence longer than 10 s (`HEARTBEAT_GRACE_INTERVALS` 2 × 5 s). So: keying started about 1 s after the request and ran past the deadline; revision 12's apply started about 9 s after it. **Read in source code; timeline inferred.** The 8.8 to 11.6 s measured here for a matching fixture fits the reported 9 s. **Inferred.**
- **F2.3 The request's path.** A narrow request (`narrow-run.ts:119-179`) waits for a reconciliation pass that started after it (`afterPass`). Then it waits, through `afterRunnerWork` (`runner-work.ts:298-307`), for every runner task queued before it: here revision 12's refinement, whose runner phase re-resolves the tests that import the two edited files, then its apply under the lock (`refine-apply.ts:74-79`). Only then do its own `selectNarrow` and stage run. Lint takes no part in this. A main-thread block of the keying delays whichever of these steps it lands between, by at most its length. **Read in source code.**
- **F2.4 Locks.** The keying takes no scheduler lock. After its transaction and after each part, `ctx.recorded()` calls `scheduler.lintRecorded()`, which queues an "updating the commit report" lock turn (`scheduler.ts:893-896`, `#updateCommit`). Its cost was not measured. `lint.sqlite` is not the main store's file (`lint/store/open.ts:25-27`), so there is no shared SQLite lock with the main store. But every worktree's daemon writes the same `lint.sqlite`. A `BEGIN IMMEDIATE` there waits synchronously on the main thread, up to the busy timeout of 1,000 ms, while another daemon writes (`store/connection.ts:47-58`, `store/open.ts:53`). **Read in source code; not measured.**
- **F2.5 `applyRunnerPart`.** It holds the scheduler lock across its awaits (`setEnvironments`/`regrowStartup`, `trackUntracked`) and its synchronous work over the closures the runner re-resolved (`refinement.ts:241-301`). The text proves the apply had held the lock for at least 1 s at the deadline. How much of that second was the apply's own work and how much was the keying's block landing inside it is **not determined**: no daemon log of the incident exists, and measuring it needs a daemon on the issue's repository. Only that repository's runner phase could explain the other 8 s. **Inferred.**

### Q3. Fixes that keep keys and validity

- **F3.1 `--debug files` parts.** `--debug files` imports a JSON config's JS plugin and loads a TS config. It does not call a rule's `create`. **Verified by experiment** (`out/debug-files-semantics.txt`). So each run pays the plugin's load: about 150 ms quiet and 500 ms here for the heavy plugin. `observe` must stay on: `lintedFiles` uses the preload only to detect failures (an uncaught throw, no report: `run.ts:94-112`), and turning it off saves only 10 to 15%. Parts of 256 against one run: 3,323 → 299 ms quiet, 10,971 → 1,292 ms here, with the same 3,853 files listed. **Verified by experiment** (`out/chunk-equality.txt`). A run with no paths is not equivalent. It walks the working folder with `.gitignore` applied, and lists `node_modules` files when they are not git-ignored. Explicit paths skip `.gitignore` but keep `ignorePatterns` (`src/sub/s.ts` listed, `gen/g.ts` not). A tracked file in a git-ignored folder would lose its check. **Verified by experiment.** The issue's repository's 5,356 paths take 277 KB on the command line; `ARG_MAX` here is 2 MiB. A part bounded by bytes (128 KiB) gives 3 runs there. **Measured; limits of other platforms not verified.** One run on a big repository must also stay under D3's 5 s guard; a byte bound keeps each run bounded. **Inferred.**
- **F3.2 The `unknown` pass.** With `lint.include` narrowed, `inputsOf` offers a second batch: every non-selected file whose extension is not learned yet (here every `.md`). It costs a second `provider.inputs` call, measured as 2 calls in the narrowed keying. With the default `**` the batch is empty. Both batches can go to one `--debug files` call: learning an extension twice changes nothing. **Verified by experiment (2 calls); merge inferred.**
- **F3.3 `chainOf`.** Memoizing `configIn` per folder for one `inputs` call gives byte-identical `config` strings on all 4 fixtures, 66 → 7 ms quiet and 267 → 13 ms here. A chain built from the found-configs list (no file system) was also identical on the fixtures. By design it differs for a config in a folder that git ignores whole, or one made after the refresh. In those cases today's walk sees the file, and row 017-30's `missed()` exists to catch the second. Prefer the memo; keep `missed()` reading the disk. **Verified by experiment; read in source code** (`config-set.ts:309-313`).
- **F3.4 Keys.** Compute once per `Keyer`: the shared JSON prefix; the sorted config-and-closure paths with their segments encoded; the environment hash per distinct config chain. Then insert the file's own segment at its sort position (dropped when the file is itself a closure path) and call `keyFromSegments` with the same arguments. All 3,853 keys were byte-identical, with the import plugin on and off, on all 4 fixtures: 115 → 25 ms quiet, 229 → 94 ms here. **Verified by experiment** (`fastKeys` in `probe.ts`).
- **F3.5 Yields.** 3,853 `results.get` in one block: 6 ms quiet, 86 ms here. With a yield every 256: at most 10 ms. **Verified by experiment.** After F3.3 and F3.4 the synchronous steps total about 40 ms quiet and 130 ms here. Slicing them every 256 files limits each block to about 10 ms. Only the write transaction stays whole: 14 ms quiet, 32 ms here. It must, because a yield inside `BEGIN ... COMMIT` would let other main-thread writes on the same connection join it. **Inferred.** Atomicity and interruption do not change. All writes stay in that one transaction. Today the code already awaits seconds of child processes between `planOf`'s state reads and that write. Only one pass per tool runs at a time (D7). `rekey()` has no interruption check: a newer revision is keyed by the next pass from the cursor. **Read in source code.** A worker thread is not needed at these sizes. **Inferred.**
- **F3.6 `onKeying`.** The socket text says "the daemon's main thread has been keying". With the fixes the span shrinks from 9 s to about 1.5 s here, but most of it is still child processes. Tell the step around the synchronous steps only. If the whole span should stay visible, show it as lint progress, not as main-thread work. **Inferred.**

## Recommendation for Squeal

| Rank | Fix | (a) request acceptance | (b) longest block, quiet / here | (c) `rekey()` total, quiet / here |
| --- | --- | --- | --- | --- |
| 1 | `lintedFiles` parts bounded by bytes, not 256 paths; the `unknown` batch in the same call (`provider/oxlint/run.ts`, `pass/rekey.ts` `inputsOf`) | removes about 1 CPU of child processes during the runner's refinement | none | −3.0 s / −9.7 s |
| 2 | `chainOf` memoized per `inputs` call (`provider/oxlint/configs.ts`, `config-set.ts`); `missed()` unchanged | −60 / −250 ms block | −60 / −250 ms | same |
| 3 | `Keyer` computes the shared prefix, config segments and environment per chain once (`pass/keys.ts`, `pass/keyer.ts`) | −90 / −135 ms block | −90 / −135 ms | same |
| 4 | yield every 256 files in the `inputsOf` loop, `keys` and `judgeAll`; one transaction | blocks ≤ about 15 / 35 ms | to ≤ the transaction | +a few ms |
| 5 | `onKeying` around synchronous work only (`pass/run.ts`, `daemon/run-group.ts` `keyingStep`) | the text names what holds the request | none | none |

Invariants: keys byte-identical, so `LINT_KEY` (`squeal-lint-key/4`), `OXLINT_PROVIDER_VERSION` (1) and `KEY_FORMAT_VERSION` (21) stay as they are; the same linted set; `observe` on whenever JS runs; one failed run still fails the whole `inputs` call (D9, as today); `missed()` reads the disk; one write transaction per keying.

Tests to add: fast keys equal `lintKey` for a path that sorts before, between and after the closure paths, and for one equal to a closure path; the memoized chain equals the disk walk with nested configs and folders without one; byte-bounded parts send each path once and stay under the bound; a fake event loop or counter shows `judgeAll` and `keys` yield every 256 files; the keying step is told only around synchronous work.

## Open questions

1. What held revision 12 for about 8 s before its apply: the runner phase in the issue's repository, the CPU load, or a main-thread block from elsewhere (the config walk in `session.ready` measured 133 to 307 ms in `011-core/research/issue-154-cause.md`). Not determined: no daemon log exists. Whether a narrow request should wait for runner work it does not need is a scheduler question (011 C15), outside lint.
2. The cost of the "updating the commit report" lock turn that each keying and part queues (F2.4), and of `lint.sqlite` busy waits on the main thread. Not measured.
3. Command-line limits on macOS and Windows for a byte-bounded part. Not verified.

## Sources

- Squeal 0.1.611 at `0fdd64474`: `src/core/lint/pass/{run,rekey,keyer,keys}.ts`, `src/core/lint/provider/oxlint/{provider,config-set,configs,run,spawn}.ts`, `src/core/keys/check-key.ts`, `src/core/lint/store/{open,results,states}.ts`, `src/core/store/connection.ts`, `src/core/daemon/{desk,run-group,daemon}.ts`, `src/core/scheduler/{scheduler,mutex,refine-apply,refinement,runner-work,request-intake,narrow-run}.ts`, `src/cli/group-pending.ts`, `src/core/presence/heartbeat.ts`.
- oxlint 1.90.0 (this worktree's install), by experiment only.
- Probes and raw outputs: `probes/issue-274/` (README, `make-fixture.mjs`, `probe.ts`, `boat-run.sh`, `debug-files-semantics.sh`, `out/`).
- Issue text: https://github.com/hearsay-tools/squeal/issues/274. Spec 017 D5, D7, D11; `011-core/research/issue-154-cause.md`.
