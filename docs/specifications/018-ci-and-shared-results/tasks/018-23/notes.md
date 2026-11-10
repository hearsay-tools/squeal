# 018-23 notes: export evidence and reader gaps

Worker 746e42e2, 2026-11-10. Spec 018 D8, D9, D14. Reviews `wave-5-0.1.421-r3.md` (B1, N1, N2) and `wave-5-0.1.422-r2.md` (N1). For the reviewer and whoever continues.

## Where things are

| What | File |
|---|---|
| Reads and time changes through a descriptor, file handle or directory handle opened read-only | `src/runners/vitest/ci-runtime/descriptors.cjs` (`wrapDescriptors`) |
| The hash through an open descriptor; a path written in this process is not hashed again | `src/runners/vitest/ci-runtime/evidence.cjs` (`contents().ofOpen`, `opened`, `through`, `outputOf().gone`) |
| The hook and its settings in children and Workers started with their own env | `src/runners/vitest/ci-runtime/children.cjs` (`wrapChildren`) |
| Order of installation: `wrapFs`, `wrapDescriptors`, `wrapChildren`, then `syncBuiltinESMExports` | `src/runners/vitest/ci-runtime/evidence-hooks.cjs` (`installEvidence`) |
| The reader's `HEAD` and the export commit's blobs, under the reader's stop and a timer | `src/core/shared/local.ts` (`headOf`, `blobsAt`); `src/core/commit/tree.ts` (`lsTreeArgs`, `blobsOfTree`) |

## The rules as built

1. **Reads through an open descriptor or handle (B1).** A read-only open (`fs.open`, `openSync`, `fs.promises.open`) records the real path it reads, by descriptor number until `close`/`closeSync`, or by file handle. Each read through it hashes the file again through that descriptor, with positional reads that leave its offset as it was, once the read is done and before the caller sees the bytes. A second content leaves the path without evidence (the reader's conflict rule); a hash that cannot be taken marks the path written. Covered: `read`, `readSync`, `readv`, `readvSync`, `readFile` and `readFileSync` of a descriptor, `fstat`, `fstatSync`; streams from a path or a descriptor (they read through `fs.read`); `FileHandle.read`, `readv`, `readFile`, `stat`; `createReadStream`, `readLines` and `readableWebStream` of a handle (they read through `FileHandle.read`); `fs.promises.readFile(handle)`.
2. **Directory handles.** `opendir`, `opendirSync` and `fs.promises.opendir` already list at the open. The `Dir` lists again when a read returns `null`, at `close`/`closeSync`, and at the end of `entries()` or `for await`. Not at each read: a large directory read entry by entry would cost one listing per entry.
3. **Time changes through a descriptor (N2).** `futimes`, `futimesSync` and `FileHandle.utimes` on a tracked descriptor or handle write its path, as `utimes` does.
4. **Children and Workers with their own env (N1).** At each `ChildProcess.prototype.spawn` (async spawns, `exec`, `execFile`, `fork`), `spawnSync`, `execSync`, `execFileSync` and `new Worker`, the hook (`vitest-ci.cjs`) and this process's `SQUEAL_CI_RECORD` go into the env the caller passed, `env: {}` too. The form is `--import <url>`, or `--require <path>` when that env's `NODE_OPTIONS` already holds a `--require`, as `recorderOption` chose for the command. The daemon's recorder loads first, so its wrappers run inside these and still put its own preload first. An env with another `SQUEAL_CI_RECORD` value (a test that runs `squeal ci record` itself) is left as it is; so is a `SHARE_ENV` Worker. Argument positions follow `optionsAt` of `observe/spawn.cjs`, copied, not required: `dist/ci/` and `dist/observe/` sit at other relative places than the sources.
5. **The reader (0.1.422-r2 N1).** `HEAD` comes from the git dir (`readGitHead`). git runs only when the refs are in a reftable (`<common dir>/reftable` exists), through `gitCall` with the reader's stop and `HEAD_TIMEOUT_MS` (5 s, option `headTimeoutMs`). A files repository whose `HEAD` the git dir does not resolve is unborn: no git. The commit's `ls-tree` runs through `gitCall` with the stop and the old 30 s timer. `gitHead` and `committedBlobs` keep their behaviour for their other callers.

## Tests, each failing before its fix

Checked at `5e08d7159` (before items 1 to 3) with the new test files copied in.

- `test/runners/vitest/ci-evidence-descriptors.test.ts`: every reader of item 1 and the review's handle variant (`FileHandle.readFile`), with `sh` rewriting the file after the open; unchanged controls kept; directory handles read to the end, iterated and closed early; item 3. Three of four failed before; the control test passed before and after.
- `test/ci/export-wrapper.test.ts` modes E and F: the review's real record and export. The test opens `data/value.txt` read-only at `BAD!`, writes a mark, and reads through the descriptor (E) or file handle (F) until it sees `GOOD`, which the wrapper writes through `sh` on the mark and replaces with `BAD!` after the run. Before: the export held the test at `BAD!` (`Exported 2 test files, 5 results`); after: left out, `test/plain.test.ts` kept, the independent run fails.
- `test/runners/vitest/ci-evidence-children.test.ts` (both write cases failed before `children.cjs`; the equality test passed before and after): `execFileSync`, `spawnSync`, `execSync`, `spawn`, `fork` and a Worker, each with `env: {}`, and a child with `NODE_OPTIONS` of its own, write back the content the parent read; alone and beside the daemon's recorder. A child with other settings keeps its subtree. The recorder's observations are equal with and without the hook.
- `test/shared/reader-lifecycle.test.ts`: a stop during `ls-tree` and during the `HEAD` read through git ends the pass within 2 s with the git still held; an unborn `HEAD` starts no git; `headTimeoutMs` bounds the `HEAD` read. git 2.43 makes no reftable, so a `reftable/` directory and an orphan branch stand in for one.
- `test/runners/vitest/ci-evidence.test.ts`: the recorder-equality script also reads through a descriptor and a file handle.

## Decisions the brief did not settle

- **Hash through the descriptor, not the path.** The positional read of the descriptor's own file is what the read consumed, also when another file was renamed over the path.
- **After each read only.** The open's hash and each read's later hash bracket every read; a hash before each read would add nothing.
- **Follow children, not drop the shard's files.** Following keeps their reads as evidence and their writes as cancellations; dropping would lose every file of a test that starts Node with `env: {}`.
- **`.git` itself is not tracked as a descriptor**, so its kind hash stays its only evidence.

## Limits that remain (the condition in `squeal ci record --help`)

- **Another program's change inside one read.** A path read hashes before the read; a descriptor read hashes after it, so a change made and undone within the read is not seen.
- **A file only native code reads** (rolldown, esbuild, an addon) after a Node probe hashed it.
- **A Node process the hook does not reach**: started by a program outside Node with a cleared env (`env -i node …`), or a user preload that runs before the hook (a `--require` when the hook is an `--import`).
- **A path read whose hash cannot be taken** (the file grew during the hash) adds no line, so an earlier value stands. `through` cancels in that case; `read` does not. A small change would make `read` do the same; not done here (outside the four items).
- **A `Dir` neither read to its end nor closed**: entries it gave after the open are bracketed by nothing.
- **Descriptors opened before the hook loaded or by Node internals** are not tracked; `fs.openAsBlob` is wrapped by neither the recorder nor the hook.

## Corrects earlier notes

- `tasks/018-20/notes.md`, R1, "Not killed by the stop": the reader no longer calls `committedBlobs` or `gitHead`; both of its local reads take the stop, and the `HEAD` fallback runs only for a reftable, with a timer.
- `tasks/018-17/notes.md`, R2 limits, "a child started with an env that drops `NODE_OPTIONS` or `SQUEAL_CI_RECORD`": a child or Worker started from a recorded Node process now gets both back.

## For the coordinator

- `dist/ci/` gains `children.cjs` and `descriptors.cjs`. `test/harness/codex/packaging/runtime.test.ts` lists them (agreed, its own commit). `plugins/codex-runtime/runtime.json` and the bundles need the rebuild; the bundle-drift checks fail until then.
- Spec D8's condition sentence still names "an already open file". Proposed: nothing but the command's Node processes may change the tests' input files while it runs; another program's change inside one read, or in a file only native code reads, can make the export certify content the test did not see.
- Cost per process: one `fstat` per read through a tracked descriptor, and a full hash when the file changed within 2 s of its last hash (`SETTLED_MS`); none for a path this process wrote. Two listings per directory handle.

## Type changes

Additive only: `SharedReaderOptions.headTimeoutMs?: number`. New exports: `src/core/shared/local.ts` (`HEAD_TIMEOUT_MS`, `LocalCall`, `headOf`, `blobsAt`), `src/core/commit/tree.ts` (`lsTreeArgs`, `blobsOfTree`).

## Repair R1 (review `018-23-0.1.424.md`, B1 and B2)

Worker 746e42e2, 2026-11-10. This section amends rules 1, 3 and 4 above and the limits.

- **B1, one descriptor registry.** `descriptors.cjs` keeps one map by descriptor number for numeric opens and file handles alike: a handle registers its own `fd`. So `readSync`, `read`, `readv`, `readFile(Sync)`, `fstat`, streams and `futimes` on `handle.fd` hash or cancel as on any tracked descriptor, and the handle's own methods look the same map up by `handle.fd`. Every open sets its number, or clears it when the open can write or is outside the root; `close`, `closeSync` and `FileHandle.close` clear it. Hashes stay positional, so read offsets are unchanged.
- **B2, withhold where the hook cannot follow.** A spawn, sync call or Worker whose env holds another `SQUEAL_CI_RECORD` value keeps that value (a nested `squeal ci record` stays its own), and this process withholds its current test file: `evidence.withhold(file)` marks that file's own path written, so no closure holding it is certified. The file is Vitest's `__vitest_worker__.filepath`, else the `file` in the daemon's recorder's settings (`SQUEAL_OBSERVE`). With none known, or a file outside the root, it writes the root as a tree (`t: [""]`), which `readEvidence` reads as every path: the whole command is withheld. A `SHARE_ENV` Worker withholds when this process's own env holds another value.
- **Coordinator decision (2026-11-10):** the conservative route for B2, withholding instead of following a second recording.
- **Help and D8.** The help states the broad requirement without saying the risk is only within one read or native code. Spec D8 lists what is covered now and what remains.

### Tests, each failing before (revision 29)

- `ci-evidence-descriptors.test.ts`: `readSync`, `read`, `readFileSync`, `fstatSync` and a stream through `handle.fd`; `futimesSync` and `futimes` on `handle.fd`; an unchanged `handle.fd` read kept; a reused descriptor number reads its own file (a guard; it passed before).
- `export-wrapper.test.ts` mode G: the review's complete false export through `readSync(handle.fd)`. Before: `Exported 2 test files, 5 results` with the test; after: left out.
- `ci-evidence-children.test.ts`: a child and a Worker with another recording's settings withhold the current test file named by Vitest; the recorder's file outside Vitest; every path when none is known, for a child and a Worker. The old expectation that kept `foreign.txt` is gone.
- `test/ci/inputs.test.ts`: a root tree write drops every path.

### Limits after R1

- A child or Worker with another recording's settings withholds only the current test file when one is known. Another test file of the shard that read a path such a child wrote keeps its evidence; a hooked read after the change still sees it.
- A descriptor opened before the hook loaded, or by Node internals, is not tracked. A `FileHandle` closed by garbage collection keeps its number until the next open of that number.
- The other limits above stand: another program's change that no read through Node sees (between a hash and its read, or in a file only native code or that program reads), a Node process the hook does not reach, and a path read whose hash cannot be taken.

