# Research: runner-split

Row 021-04, topic `runner-split` of `README.md` (second round). Researcher, 2026-11-11. It extends `../../019-run-triggers/research/remote-runner.md` (019-04) and `remote-execution.md` (021-02) and does not repeat them. Squeal source read at `0fa197e09` (0.1.430). Vitest 5.0.3 and Vite 8.3.2 under this repository's `node_modules`; the fixture installed Vitest 5.0.3 with Vite 8.3.5. The remote is a throwaway container on this host (`node:24.22.1-bookworm-slim` with `openssh-server`), reached over SSH on loopback with a kept connection (`ControlMaster`). Keys, `known_hosts` and the SSH `HOME` lived under `$TMPDIR`. Probes: `probes/runner-split/` (throwaway). Official docs fetched 2026-11-11.

Tags: **[exp]** verified by experiment, **[docs]** read in official docs, **[src]** read in source code, **[inf]** inferred.

## Questions answered

| # | Question | Answer |
|---|---|---|
| 1 | The cut | At `RunnerAdapter`: a remote host process builds Squeal's own adapter (`createVitestAdapter({ root })`) over the remote tree, and a local proxy forwards each member over stdio through SSH. The prototype did this with no change to Squeal's code **[exp]**. The other cut (Vite server local, workers remote) is refuted: workers import dependencies, Vitest itself and builtins from their own disk, read the server's temp files, and read and write snapshots themselves **[src]**. |
| 2 | Paths and keys | Every answer the adapter gives is relative to the root it was built on. Two roots (`$TMPDIR/rs/fixture`, `/work/fixture`) gave byte-equal `environment()`, closures, affected sets, observed inputs and failure text **[exp]**. Coverage is the exception: `CoveredFile.payload` and `sources` are absolute paths to remote files **[src]**. The host must run with the root as its working directory, or failure text changes (`../..src/math.ts`) **[exp]**. |
| 3 | Prototype | Done (`host.mts`, `driver.mjs`). Edit, rsync of the named path, `invalidate`, `affected`, `closure`, blob-id proof, `run`, proof again: 5 of 5 edits passed with the proof equal before and after. An edit not yet synced was refused by the proof **[exp]**. This repository was not run remotely (see Open questions). |
| 4 | Time from save to verdict | Fixture, load 20.2 to 20.6: local 0.19 s median, container 0.24 s median, of which the sync is 0.06 s **[exp]**. The prototype makes 9 round trips per edit: +0.01, +0.18 and +0.72 s at 1, 20 and 80 ms. A two-message protocol makes 2: +0.002, +0.04, +0.16 s **[inf]**. |
| 5 | node:test and pytest | The same cut fits them: their adapters already start processes with a local `cwd`, temp directory and graph file, so the host runs the adapter, not each process. Wrapping each process in `ssh` leaks it: killing the local `ssh` left the remote process running unless a pseudo-terminal was forced **[exp]**. |
| 6 | Failure | A dropped connection rejects the run at once, and the host stopped its run and its workers within 1.5 s **[exp]**. A paused remote was seen only by the driver's own deadline **[exp]**. A missing remote install fails `open` with Squeal's own text **[exp]**. A remote on Node v24.21.0 passed under a local v24.22.1 key: a wrong hit unless the descriptor is compared **[exp]**. |
| 7 | Prior art and recommendation | Vitest's `birpc`, Bazel REAPI and Develocity Test Distribution all send declared inputs by digest and stream results back **[src][docs]**. Recommendation: cut at `RunnerAdapter`; a host process that is Squeal's own code at the same version; a request-reply protocol of a few messages per revision with a deadline on each; first slice is one Vitest lane on one SSH host. |

## Findings

### Q1. The cut

**What each member needs [src]** (`src/core/types/runner.ts:576-707`, `src/runners/vitest/adapter.ts`). `name`, `adapterVersion` and `focuses` are constants. `invalidate`, `recheck`, `affected`, `closure`, `enumerate`, `testFiles`, `environment` and `run` all read the Vite module graph, the config or the files, so they need the tree and `node_modules`. `omittedTestFiles`, `slowWidth`, `tierWidth`, `tierPart`, `besideBacklog`, `backlogSlot`, `focusesFile` and `lane` are synchronous because "selection holds the scheduler's lock" (`runner.ts:631-697`). A network proxy cannot answer them live. It must hold the values the remote last reported: Vitest's widths come from the config's `maxWorkers`, read at each instance start (`width.ts:116-119`). `close` and `releaseLane` are lifecycle calls.

**Callbacks in the options [src].** `createVitestAdapter` takes `note`, `optimizer`, `observe`, `excludeProjects` and `exclude` as functions (`index.ts:13-67`). Over a connection these become events (`note`, `optimizer`) or values sent at `open` and on a policy change. `RunOptions` holds four non-data members (`runner.ts:247-342`). `signal` and `stop` become a cancel message. `fileEnded` becomes an event. `beforeForce` lets the daemon read the processes a cancelled run started before they are killed, and it must run on the remote side. `logDir` is a local absolute path. The host makes its own, and the files come back: `runs/<run-id>/` is 5.1 KB median and 57 KB p90 (019-04 Q4).

**The daemon already has the seam [src].** The daemon builds each Vitest instance through `createRecoveringRunner({ create: () => createVitestAdapter({ root, ... }) })` (`src/core/daemon/daemon.ts:563-590`). A proxy is one more `create`. The recovering runner, the composite runner and the scheduler stay as they are.

**What crosses, measured on the fixture [exp]** (`results/driver-remote.jsonl`):

| Message | Fixture | Scaled to this repository |
|---|---|---|
| `environment()` | 2,604 B, once per instance start | Per project: the resolved config plus file lists **[inf]** |
| `closure` for 2 test files | 1,082 B | About 350 paths per test file (018 `remote-store` Q2), about 14 KB each **[inf]** |
| `run` report, 2 files, observed inputs included | 1,108 to 1,128 B | `report.json` 0.8 KB median, 7.3 KB p90 (019-04 Q4) |
| Proof: blob ids of the closure and the observed paths | 7 to 8 paths | Same count as the closure, 40 B per id **[inf]** |
| Coverage | not run | A record is about 25 KiB (`src/core/code/store/schema.ts`, comment on `CODE_INDEXES`, from 011-197's store). The raw V8 payload is larger; not measured **[src]** |

**The other cut, refuted [src]** (Vitest 5.0.3 dist, read by a sub-agent and checked against the earlier claim). 019-04 named three reasons why only the workers cannot move. All three hold, and there are more:

- Dependencies are externalized: `_shouldExternalize` returns the resolved id, and the worker runs `import(file)` itself (`vitest/dist/chunks/index.DpLw24bj.js:6196-6213`, `module-evaluator.js:93-103`).
- Source arrives with `file`, which becomes `import.meta.url`, `__dirname` and `require` (`vite/dist/node/module-runner.js:1257`, `module-evaluator.js:181-183`).
- The forks pool writes transformed code to a temp file that the worker reads: `readFileSync(result.tmp, "utf-8")` (`index.k8L_ZRzq.js:802`).
- `server.deps.inline: true` inlines every dependency, but builtins and Vitest's own runtime are always externalized: "all Vitest imports always need to be externalized" (`index.k8L_ZRzq.js:629-666`).
- Snapshot files are read and written in the worker (`node.BzimPqT5.js:25-35`).
- Without the warm-module path, it is "one strictly sequential `fetch` round-trip per module" (`index.k8L_ZRzq.js:700-707`). At 350 modules per file and 20 ms that is 7 s per fresh worker, as 019-04 estimated.

So a remote worker still needs the tree and `node_modules` on its disk, and then it might as well host the whole instance.

### Q2. Paths and keys

**Equal across roots [exp]** (`compare-env.mjs`, `results/compare-env-roots.txt`). On the same Node, the two roots gave byte-equal answers for every keyed value: `environment()` (resolved config, files, versions), closures, affected sets, observed inputs (`fixtures/data.json`, the snapshot path) and failure text with its location (`src/math.ts:7:43`, stack frames relative). Two absolute-looking strings remain in the resolved config, `"/node_modules/"` and `"/"`, and both are equal on both sides. Why it holds: the adapter relativizes against its own root (`WorktreePaths.relativizeText`, `src/core/fs/worktree-paths.ts:29-34`; `canonicalConfig`, `src/runners/vitest/environment.ts:106-137`). 018 `result-import` Q1 lists "the absolute root" among inputs in no key, and warns that "an absolute path outside the worktree also stays absolute". A config that names one would differ between roots and give a miss, not a wrong hit **[inf]**.

**Not equal by construction [src].** The core adds `process.version`, platform, arch and the installed-dependency fingerprint from the daemon's own process and the local `node_modules` (`src/core/keys/environment.ts`). The remote's values must be compared with them (Q6). Coverage: `CoveredFile.payload` is an absolute path to a JSON file the local writer "reads and deletes", and `sources` is keyed by absolute path (`src/core/code/coverage/types.ts:54-69`). The host must either convert payloads into records with relative paths before sending, or send the payload, with paths mapped.

**Working directory [exp].** With the host's working directory at Squeal's install, Vite's parse error named `../..src/math.ts` and had no location (`results/fail-remote-cwd-opt-squeal.jsonl`). With the working directory at the root, local and remote errors were equal. The daemon already runs its runner with the root as working directory (`inRootWhileRunning`, `src/core/daemon/scratch.ts:203-220`). The host must do the same.

### Q3. Prototype

`host.mts` runs on the remote as `node --import tsx host.mts <root>`, from a clone of Squeal at `0fa197e09` mounted read-only. That mount stands for "Squeal installed on the remote at the local version". The host imports `src/runners/vitest/index.ts`, builds the adapter with `observe: () => true` and `cache: false`, and answers one JSON request per line. It also answers `blobs(paths)`: the git blob id of each path, which is Squeal's file hash (018 `result-import` Q1). Stray output cannot be read as a reply: each reply line starts with a marker, and the host sends its own stdout to stderr.

`driver.mjs` plays the daemon. Per edit it appends a line to `src/math.ts` and rsyncs that path (`--files-from`). It calls `invalidate` and `affected`, which gave both test files, since `greet.ts` imports `math.ts`, and calls `closure` for each. It then compares the remote's blob ids of the closure and environment files with the local ones, calls `run`, and compares again over the closure plus the observed paths. The fixture's node_modules (40 MB, 1,834 files) was copied once by rsync in 0.79 s, standing for an install on the remote.

Results **[exp]** (`results/driver-remote.jsonl`):

- 5 of 5 edits ran remotely, all checks passed, proof equal before and after (7 and 8 paths).
- The observed input `fixtures/data.json` came back for `greet.test.ts`.
- After an edit that was not synced, the proof named `src/math.ts` as different. A run there would be refused, not stored.

This is the remote form of the core's stability check, which compares hashes at selection with the disk after the run (`changedSince(tier.snapshot, ...)`, `src/core/scheduler/tiers.ts:774-777`). It works the same over rsync, Mutagen or a git tree.

Squeal's adapter runs Vitest with `update: "none"` (`adapter.ts:235`). A test with a missing snapshot failed with "Snapshot `snap 1` mismatched" and wrote nothing, locally and remotely alike **[exp]**. So a remote run does not write snapshots into the remote tree.

### Q4. Time from save to verdict

Measured by `timed.sh`, local at 14:33:41Z and remote right after, one-minute load 20.2 to 20.6 (`results/driver-local.jsonl`, `driver-remote.jsonl`). Five edits each, milliseconds, median (range) **[exp]**:

| Step | Local (host as a child, no SSH) | Container over SSH |
|---|---|---|
| Sync, rsync of 1 named path | 0 | 62 (60 to 67) |
| `invalidate` + `affected` + 2 × `closure` | 6 (6 to 17) | 8 (6 to 17) |
| Proof before + after | 1.2 (0.9 to 2.2) | 1.8 (1.7 to 1.9) |
| `run`, 2 files | 185 (167 to 211) | 163 (148 to 167) |
| **Total** | **191 (183 to 220)** | **237 (222 to 238)** |
| Instance start (`open`), once | 576 | 841 |

The container is on the same host, so the run itself is not faster or slower for a reason that would hold on another machine. The sync is the cost the split adds on loopback. Over a real link each round trip adds its RTT **[inf]**. The prototype makes 9 round trips per edit: 7 calls, plus 2 for rsync over a kept connection (019-04 Q2). A protocol that sends the changed bytes and the expected blob ids in one message, and the run request in a second, makes 2:

| Added per edit | 1 ms | 20 ms | 80 ms |
|---|---|---|---|
| Prototype, 9 RTT | 0.01 s | 0.18 s | 0.72 s |
| Two messages, 2 RTT | 0.002 s | 0.04 s | 0.16 s |

Against this repository's one-file median of 2.6 s and an edit-run median of 6.6 s (019-04 Q4), two messages cost 1 to 6% at 80 ms. The fixture's closures are small. In this repository a closure is about 14 KB and its proof hashes about 350 files on the remote, which the full-tree check of 021-02 (11,493 files in 3.2 s at load 60) puts near 0.1 s **[inf]**.

### Q5. node:test and pytest

Both start one process group per file or batch through `startGroup({ command, args, cwd, env, stdout, stderr })`. The group is `detached`, its output goes to files under `logDir`, and the whole group is killed with `process.kill(-pid)` (`src/runners/process/group.ts:41-75`). node:test writes its graph to `SQUEAL_NODE_TEST_GRAPH` under `logDir` (`node-test/run/run.ts:190`). pytest sets `TMPDIR`, `TMP` and `TEMP` to the daemon's temp directory (`pytest/adapter-run.ts:129`). node:test learns its Node by running a probe process (`node-test/adapter-environment.ts:26-35`) **[src]**.

Wrapping each command in `ssh` would need all of these remote: the graph file and logs read back, the temp directory, the probe. It also breaks the kill. `ssh-kill.sh` started a process through `ssh` in its own group and killed the group as `startGroup` does. Without a pseudo-terminal the remote process kept running. With `-tt` it ended, but `-tt` merges stderr into stdout and rewrites line endings (`results/ssh-kill.txt`) **[exp]**.

The adapter-level cut avoids all of this. The host builds `createNodeTestAdapter` or `createPytestAdapter` on the remote, and their processes, files and kills stay on one machine, as they do today **[inf]**. pytest's `.venv` must be built on the remote: it cannot move (019-04 Q2).

### Q6. Failure

`failure.mjs`, against the container (`results/failure.jsonl`), load 49 to 60 (not timings) **[exp]**:

- **Connection dropped mid-run** (local `ssh` killed 2 s into a 6 s test). The pending `run` was rejected at once ("connection closed"). On the remote, the host saw its input end, stopped the run and closed Vitest, and 1.5 s later neither the host nor its worker was left. That cleanup is the host's own `close` handler. A host without it would leave the run behind, as the `ssh` wrapper did in Q5.
- **Hung remote** (container paused 1 s into a run). Nothing reported an error. The SSH connection stayed open, and only the driver's own 10 s deadline ended the wait. After the driver dropped the connection and the container was unpaused, the host and worker were gone within 1.5 s. 021-02 saw the same with Mutagen (`flush` blocked 45 s, "watching").
- **No install on the remote.** `open` failed in 7 ms: "vitest/node does not resolve from /work/noinstall ... Squeal runs only the project's own Vitest". This is the text the daemon already turns into a runner failure note (`load.ts`).
- **Another Node.** The host ran on v24.21.0 (binary copied from this host). The run passed. The runner's `environment()` does not name the Node version; the core takes it from the local daemon. Without a comparison this pass would be stored under a key naming v24.22.1: a wrong hit (019-04 Q3, now shown).

**What the daemon records [inf].** These follow from the cases above and the existing rules; no code was written. A lost connection or a passed deadline is a run that did not complete, like a crash or timeout today (`RunEnd`, "`crashed` and `timed-out` make every check in the tier `unknown`", `runner.ts:240-245`). It stores nothing and never becomes a test failure (018 `remote-store` Q3).

A descriptor that is not `equal` (`compareEnvironment`, spec 018 D1) and a proof that differs are refusals. Nothing is stored, and status names the reason ("remote Node v24.21.0, this worktree v24.22.1"; "remote tree differs at src/math.ts").

A missing install is the existing runner failure.

Retries: a differing proof triggers a re-sync and one retry, as the local stability check re-queues a discarded file (`MAX_DISCARDS`). A lost or hung remote is not retried in a loop. Whether its files then run locally or stay "not run" is the open policy of 019-04 and 021-02.

### Q7. Prior art and recommendation

**Vitest's worker RPC, `birpc` [src]** (bundled in Vitest 5.0.3, `index.DmDMHCg8.js`, MIT, "birpc ^4.2.0"):

- A request is `{ m, a, t: "q", i }`; an event is the same without `i`. A reply is `{ t: "s", i, r }` or `{ t: "s", i, e }`.
- Default timeout 60 s, after which the call rejects with "[birpc] timeout on calling ...".
- `$close` rejects every pending call.
- Vitest itself passes `timeout: -1` and uses structured clone (`serialization: "advanced"`), not JSON.

The prototype's protocol is the same shape. For a network link, keep the per-call deadline that Vitest turns off.

**Bazel Remote Execution API [docs]** (`remote_execution.proto` at `e0c0554bf`):

- The client uploads inputs to a content-addressed store first, then sends an `Action` whose `input_root_digest` is a Merkle tree of the input files.
- `FindMissingBlobs` lets the client skip blobs the server already holds.
- `Platform` properties must match, or "the server SHOULD reject".
- `Action.timeout` covers execution only. A `DEADLINE_EXCEEDED` result "MUST NOT be cached".
- `WaitExecution` reconnects to a running operation.

Squeal's blob ids are already such digests. What carries over: digest-named inputs, platform equality and a timeout per action. What does not: Squeal's runner is a warm, stateful instance, not one action per process.

**Develocity Test Distribution 3.8 [docs]** (docs.develocity.ai/test-distribution/3.8, redirected from docs.gradle.com):

- "All inputs declared on the test task are tracked by Test Distribution and will be transferred". Results stream back "in real time".
- Agents cache files locally.
- "Paths of inputs and outputs in JVM arguments are automatically replaced to match the agent's temporary workspace".
- With `remoteExecutionPreferred`, remote first, "falling back to local ones after waitTimeout".
- "When an agent disconnects during the build, the plugin reschedules the affected test partition".
- Agents match on JDK major version.

It is the closest model: a long-lived agent, declared inputs, path mapping and local fallback.

## Recommendation for Squeal

1. **The cut is `RunnerAdapter`.** The remote side is a Squeal host process at the same version as the daemon. It builds the project's adapter on the remote tree, with the root as its working directory. Locally, a proxy adapter is one more `create` under `createRecoveringRunner`. Watcher, hashing, keys, store, stability check and delivery stay local. The same cut serves Vitest, node:test and pytest. The process-level `ssh` wrapper does not fit: it leaks processes and splits each adapter's files across machines.
2. **The protocol is request-reply over the SSH channel's stdio**, `birpc`-shaped, JSON lines with a marker, and a deadline on every call. Per revision it needs two messages:
   - The changed paths with their bytes and blob ids. The host writes them, invalidates, and answers with affected files, closures and the blob ids of their inputs. This message replaces rsync.
   - A run of named files with the expected blob ids. The host checks, runs, checks again, streams `fileEnded`, and returns the report, observed inputs with their blob ids, and the run's log files.

   At `open` the host reports its environment descriptor and the values the synchronous members need. A result is accepted only on an `equal` descriptor and an equal proof.
3. **Smallest first slice:** one Vitest lane (the background tiers, which 021-02 Q1 found to be 94% of Squeal's work above the knee) on one SSH host the user names, opt-in. Coverage stays off for that lane until payloads are converted on the remote. Its cost to a user: a second machine with the same Node patch version and an install from the same lockfile; an SSH key; the changed files of each revision leaving the machine (principle 8: opt-in, target and deadline visible in status); Squeal installed on the remote at the daemon's version.

## Open questions for the human

1. Does a lane whose remote is lost or hung fall back to local runs, or show "not run, remote unreachable since T"? (019-04 and 021-02 left this open; the new evidence is only that nothing but Squeal's own deadline notices a hung remote.)
2. Squeal must be installed on the remote at the daemon's exact version. Does the daemon install it there (copy its own bundle over SSH), or must the user do it?

Not determined:

- **This repository run remotely.** Not run: it needs a 213 MB tree and a 631 MB `node_modules` copied into the container, on a host whose load stayed at 20 to 79 during this session.
- **Real network round trips.** No second machine; RTTs are added by arithmetic.
- **Coverage over the split.** Not run. The payload size and the conversion cost on the remote were not measured.
- **Vitest browser mode as a model for remote workers.** `@vitest/browser` is not installed here.

## Sources

- **Squeal at `0fa197e09`:**
  - `src/core/types/runner.ts`
  - `src/runners/vitest/index.ts`, `load.ts`, `adapter.ts:235`, `width.ts`, `environment.ts`, `observe.ts`, `coverage.ts`, `sources.ts`, `stamp.ts`, `run.ts`
  - `src/runners/observe/runtime.ts`
  - `src/runners/process/group.ts`
  - `src/runners/node-test/run/run.ts`, `adapter-environment.ts`
  - `src/runners/pytest/adapter-run.ts`
  - `src/core/fs/worktree-paths.ts`
  - `src/core/code/coverage/types.ts`, `src/core/code/store/schema.ts`
  - `src/core/scheduler/tiers.ts:774-777`, `keying.ts:958-964`
  - `src/core/daemon/daemon.ts:486-590`, `scratch.ts:203-220`
- **Vitest 5.0.3 and Vite 8.3.2 dist under `node_modules`:** chunks named in Q1 and Q7.
- **Earlier findings:** `../../019-run-triggers/research/remote-runner.md`; `remote-execution.md` in this folder; `../../018-ci-and-shared-results/research/result-import.md`, `remote-store.md`.
- **Bazel Remote Execution API:** https://raw.githubusercontent.com/bazelbuild/remote-apis/main/build/bazel/remote/execution/v2/remote_execution.proto, main at `e0c0554bfc8a37abf336c3e78070684367738e1d`, retrieved 2026-11-11.
- **Develocity Test Distribution:** https://docs.gradle.com/develocity/test-distribution/ (redirects to https://docs.develocity.ai/test-distribution/3.8/) and its agent page, retrieved 2026-11-11.
- **Probes, `probes/runner-split/`:** `host.mts`, `driver.mjs`, `failure.mjs`, `ssh-kill.sh`, `compare-env.mjs`, `make-fixture.sh`, `setup.sh`, `reset.sh`, `timed.sh`, and the outputs under `results/`.
