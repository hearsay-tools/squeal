# 020-10a notes: collect and map child-process coverage

Worker c7ae008a, 2026-11-10. Spec D12 items 1 to 5. For 020-10b and any later reader.

## The path, end to end

- **Key.** `coverage.children` in `Policy` (default `false`) and in `CODE_SHAPE`. The loader keeps it as written. "Needs `coverage.enabled`" is applied by the runners: Vitest `childrenWanted()` and node:test `ProjectCoverage.#wanted()` both require `enabled()` first.
- **Daemon.** `daemon.ts` gives both runner coverage objects `children: () => policy.coverage.children` (agreed with the coordinator, request 0f295ddd).
- **Vitest.**
  - `InstanceCoverage.start` writes the flag file `children` in the instance's reports directory, beside `skip.json`.
  - At `startCoverage`, after its own session starts, the provider (`provider.mjs`) sets `NODE_V8_COVERAGE` to `<coverageFilesDirectory>/children-<id>`. It writes its next payload as `coverage-<id>.json` and then points at a new id. So the payload's name names its children's directory. `childrenOf()` in `runners/vitest/coverage.ts` is the other half of that convention.
  - A variable that is already set (from the project's `test.env`, or inherited) is left alone. The provider writes the file `kept`, and the adapter notes `KEPT_NOTE` once.
  - `coveredFiles(..., children)` hands `CoveredFile.children = { root: worktree root, dir }` over. `dropPayloads` removes the directory with the payload.
- **node:test.**
  - `ProjectCoverage` gives `Covering = false | true | "children"`. That value flows through `covered` into `run.ts`, which adds `SQUEAL_NODE_TEST_CHILDREN=1` to the env.
  - The recorder sets the variable to `<cov-i>/children` where it deletes the variable today.
  - `coveragePayloads` keeps that directory beside the own file. It removes the directory for a file that did not complete.
- **Mapping.**
  - `withChildren()` in `mapper.ts` maps every file in `children.dir` with `ownRecord(root, ...)` and merges the results with `mergeRecords()` in `record.ts`. It runs on the main thread (`recordHere`, `mapHere`) and in the worker (`map-worker.ts` `answer`).
  - The main thread removes the payload and the directory once the worker answered (`removePayload`). A worker crash leaves both for the main-thread retry.
- **Drops.** A child file over `CHILD_FILE_LIMIT` (64 MiB, checked with `stat` before the read), or one that does not parse or map, is dropped alone. The worker's `record` message carries `dropped`. `MapperOptions.childDropped` logs each drop, and `Drops` counts it under the cause `child`. The note then reads "N coverage files of child processes were dropped", apart from "test files got no record".
- **Keys.** `coverageMarker(children)` in `record.ts` is the marker for both runners. With the key off, the marker is byte-identical to before. A flip of the key re-keys once: in Vitest through the adapter's recreate check, and in node:test through `ProjectCoverage.changed()`.

## For 020-10b

- **The gate** (`gate/collect.ts` `openRunners`): pass `children: () => <base policy>.coverage.children` into both adapter factories, and read the key at the base in `gate/policy.ts`.
  - `mapHere` takes a 5th argument, `dropped(why)`, for D12.4's note.
  - Vitest's `KEPT_NOTE` arrives through the adapter's `note`.
- **Loaders (D12.6)** are not done. `CoveredFile.children` is in hand at the writer, but `crap/loaders.ts` still knows only the import graph.
- **Words and report (D12.7)** are not done.

## Facts checked here (Node 24.22.1, Vitest 5.0.3)

- Node creates a missing `NODE_V8_COVERAGE` directory, nested ones too, for a child process and for a worker thread. So neither seam makes the directory, and no empty directory is left when a test starts no child.
- Vitest applies a project's `test.env` in `setupBaseEnvironment`, before `run()` calls `startCoverage`. So the provider sees a project's own variable.
- `vi.stubEnv(name, undefined)` deletes the variable, and `vi.unstubAllEnvs()` restores it.

## Hazard for this repository's own tests

When this repository turns `coverage.children` on, a test that starts a nested Vitest whose fixture reads precise coverage itself must stub `NODE_V8_COVERAGE` away. `own-provider.test.ts` and `own-provider-children.test.ts` do. Without the stub, `own-provider.test.ts` failed 2 of its 4 tests with the variable set; with it, all 4 pass.

## Choices the spec did not settle

- A path that is `unread` in any record reads `unread` in the merge, as two blobs do. A child that reads a path as `unread` therefore removes the own record's entry for that path, and never adds a partial one.
- The children's directory is read when the payload is mapped, not at the end of the run. A late child's file that is complete by then is included. The directory is removed after the mapping.
- The map worker applies no `skip` to child scripts, as it already applies none to node:test's own files. The main thread applies it.
- `mapper.ts` is 301 lines and `runners/vitest/coverage.ts` is 309 lines, about the 300-line guide.
