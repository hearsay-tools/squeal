# 001-390: the recorder loads by `--import`, and a recorder-caused failure says so

Worker notes, 2026-10-15. Spec 001 D11 Fidelity; `research/injected-environment.md` F1, F4, O1 and O4. Squeal 0.1.187 (`956cba88`), Node 22.23.3 and 24.21.0, Vitest 5.0.3. The probes ran in this task's temp directory with a temporary `HOME` and `env -i`, against copies of the recorder; no real `HOME`, no other checkout and no cezar tree. Scripts: `probe/bench.mjs` (start-up) and `probe/old.mjs` (older Node).

Tags as in the research: **[exp]** experiment, **[src]** source, **[inf]** inferred.

## Probe 1: a child on Node older than 18.18

**[exp]** A Node 24.21.0 process with the recorder installed, as a Vitest worker has it, spawns Node 18.17.1 and 16.20.2 (official tarballs, unpacked in the temp directory). The child reads one worktree file.

| Recorder in the parent's `NODE_OPTIONS` | child env `{ ...process.env }` | child env `{ PATH }` |
| --- | --- | --- |
| `--require <path>` (before this row) | exit 0, read recorded (both Nodes) | exit 0, read recorded |
| `--import <file: URL>` | **exit 9**: `node: --import is not allowed in NODE_OPTIONS` (both Nodes) | exit 0, because the spawn patch still injected `--require`; with this row it injects `--import` and fails the same way |

Given `--import` in argv, Node 18.17.1 prints `bad option: --import` and exits 9.

So `--import` swaps the package.json false FAIL, which can hit any supported Node, for a new one on every child started on Node before 18.18. Nothing at spawn time tells which Node a child is. Those Nodes are past end of life: 16 since 2023-09, 18 since 2025-04. The coordinator decided to go ahead (the human can reverse it before release), and both refusal messages are recorder signatures (below).

## Probe 2: start-up of one spawned child

`probe/bench.mjs` runs `node child.cjs` (it reads one file) 60 times per mode, the modes interleaved: no recorder, the recorder as `--require`, the recorder as `--import`.

First pass, **not calm**: the 1-minute load was 40 to 96 on 24 CPUs, because this worktree's `npm ci` had started its daemon's baseline.

| Node | none p50 / p90 | `--require` p50 / p90 | `--import` p50 / p90 |
| --- | --- | --- | --- |
| 22.23.3 | 79 / 153 ms | 145 / 219 ms | 192 / 298 ms |
| 24.21.0 | 112 / 244 ms | 172 / 303 ms | 179 / 401 ms |

Calm pass (load below 8): see "Calm start-up" at the end.

## Probe 3, found on the way: an argv `--require` parses package.json too

**[exp]** In a directory whose `package.json` is not JSON, `node --require /abs/stub.cjs main.cjs` exits 1 with `ERR_INVALID_PACKAGE_CONFIG` on both Nodes. That is the same as with `NODE_OPTIONS=--require`. (The research's row "`--require` in argv only: pass" ran in a valid cwd.) With `NODE_OPTIONS=--import <stub>` beside the argv `--require`, it still exits 1.

**[exp]** An argv `--require` runs before any `--import`, the recorder's included. So an `--import` recorder missed what such a preload read. `test/runners/node-test/adapter-attribution.test.ts` ("keeps a spawned child's own --require in that file's closure", 004 re-review S2/S3) failed for the slow project's module recorder delivered as `--import`.

**[exp]** A `.cjs` given both as `--require` and as `--import` is evaluated once, on both Nodes.

## What changed

- `recorderOption` (`src/runners/observe/runtime.ts`) returns `--import "<file: URL>"`. It returns `--require "<path>"` when the inherited `NODE_OPTIONS` holds a `--require` (`holdsRequire`). `observeEnv` puts it first and first leaves out any Squeal recorder in the inherited value (`ownNodeOptions`, `src/runners/node-test/recorders.ts`, now shared with `projectEnv`). Another Squeal's recorder is no project preload. Under a Squeal that runs these tests, its settings were overridden in any case, so it recorded nothing of the inner run. Kept, its old `--require` made the inner recorder `--require` too, and Node then loaded the outer recorder's code first.
- Vitest: `createVitest`'s `env` and a project's own `env.NODE_OPTIONS` (`observe.ts`) go through `recorderOption`. The environment hash (`environment.ts` `withoutInjected`) strips the leading recorder option in either form, matched by the recorder's path.
- The spawn patch (`spawn.cjs`) applies the same rule per child. It also keeps `--require` when the child's own arguments, a shell's command or a Worker's `execArgv` hold a `--require` or `-r` (probe 3). A match it should not make (`rm -r`) only keeps the recorder as before. It recognises an inherited recorder by its path or its URL.
- node:test warm-up (`reads.ts`, 001-132's recorder under `observeIgnored`) goes through `recorderOption`. Its modules now load after argv's `--require` of the module recorder, from no module, so they root the preloads (`observedClosure`). They lie outside the worktree, so no closure or key changes. Test: `run-reads-fidelity.test.ts` asserts `preloadPaths: []`.
- The node:test **module recorder** (003) stays `--require`: always in argv, and in `NODE_OPTIONS` for a slow project or beside a project `--require` (`run.ts` `childEnv`). It has no spawn patch, so it cannot see a spawned child's argv. As `--import`, a child's own `--require` loads went unkeyed (probe 3), which is an invisible false PASS. The coordinator agreed: key fidelity wins there.
- Signatures (`src/runners/observe/signature.ts`). Each is searched for in the whole message, the stack, the causes and the code:
  - `ERR_INVALID_PACKAGE_CONFIG`, and `--import is not allowed in NODE_OPTIONS` or `bad option: --import`: only while the run had a recorder in `NODE_OPTIONS`. For Vitest that is while observing. For node:test, during a warm-up, or when `childEnv` put the module recorder there.
  - `Cannot find module '…/(observe|node-test|runtime)/recorder.cjs'`: always.

  A match sets `CheckError.recorder`. `describeFailure` then ends the summary with `; ran under Squeal's recorder in NODE_OPTIONS: <what>`, in a room it keeps within the 300 characters. The fingerprint is unchanged, so the note re-tells no failure.

## Decisions the spec did not settle

1. A child's own argv `--require` counts as "a project's own `--require`" (probe 3). Plain Node parses the nearest package.json then anyway, so no verdict changes, and the preload's reads stay observed. Agreed with the coordinator.
2. The slow project's module recorder stays `--require` (above). Agreed.
3. `RECORDER_VERSION` stays 3. The recorder sees the same paths: `--import` only where no `--require` is present, so nothing runs before it. The re-pin of key format 10 (unreleased) re-keys every check against 9 in any case.
4. The note is said only on a signature, never always (research O4: always would be noise). A test that asserts on a child's exit status without its stderr carries no signature, and gets no note.
5. `npx vitest run` gave these focused runs. The verdict is Squeal's (below).

## Type changes

- `CheckError.recorder?: string` (additive, `src/core/types/check.ts`).
- New exports: `recorderOption`, `recorderSignature`, `withRecorderSignatures` (`src/runners/observe/index.ts`), and `ownNodeOptions` (`src/runners/node-test/recorders.ts`).

## Proposed spec wording (D11 Fidelity), for the coordinator

Replace "The recorder is delivered as `--import` of a `file:` URL, `--require` kept only beside a project's own `--require` (task 001-390, after a probe of start-up and older-Node children), and a failure whose signature points at the recorder (`ERR_INVALID_PACKAGE_CONFIG`, a missing recorder file) says it ran under Squeal's recorder." with:

> The runtime-input recorder (D4) is delivered in `NODE_OPTIONS` as `--import` of its `file:` URL, in Vitest's workers, in each process and thread a test starts, and in a node:test warm-up. It stays a `--require` where a `--require` is already present: in the inherited `NODE_OPTIONS`, in a spawned child's own arguments or shell command, or in a Worker's `execArgv`. Node runs every `--require` before any `--import`, so the recorder still sees what that preload reads, and Node parses the nearest `package.json` there in any case. Another Squeal's recorder is no project `--require`. The node:test module recorder (003 D5) stays a `--require`, in argv and, for a slow project or beside a project `--require`, in `NODE_OPTIONS`: it cannot see a spawned child's arguments, and as an `--import` it would miss what that child's own `--require` loads. Known cost, accepted for now (task 001-390): a child on Node before 18.18, which is past end of life, rejects the `--import` and exits 9. A failure whose text carries a signature of the recorder says, at the end of its summary, that it ran under Squeal's recorder, and what the signature points at: `ERR_INVALID_PACKAGE_CONFIG`, and an old Node's `--import is not allowed in NODE_OPTIONS` or `bad option: --import`, while the recorder was in the run's `NODE_OPTIONS`; a missing recorder file, always. The fingerprint leaves the note out.

## Follow-up row (proposed)

- **The module recorder's own spawn patch, choosing per child.** Give the node:test module recorder (`src/runners/node-test/runtime/recorder.cjs`) a spawn patch, like `spawn.cjs`, so a slow project's spawned child gets `--import` unless its env, argv or shell command holds a `--require`. Then a slow project's child in a directory whose `package.json` is not JSON starts as it does without Squeal, and its own `--require` loads stay keyed. Done when `adapter-attribution.test.ts` passes beside a slow-project version of `run-reads-fidelity.test.ts`.

## For whoever continues

- `withoutInjected` matches the leading recorder option by path, after decoding a `file:` URL. A configured project env and the daemon's env can take different forms in one instance: the daemon's has no `--require`, so it gets `--import`, while a project `--require` gets `--require`.
- A nested Squeal (Squeal's own adapter tests under a Squeal daemon) used to load the *outer* recorder's code in inner workers once the inner one was `--import`: the outer `--require` ran first and took the `globalThis.__squealObserve` guard. `ownNodeOptions` in `observeEnv` closes that. Keep it if the delivery changes again.

## Calm start-up

**[exp]** Same script, 100 runs per mode, interleaved, at 07:49 with a 1-minute load of 4.2 to 7.2 on 24 CPUs, the recorder as of `d1e77f74`:

| Node | none p50 / p90 | `--require` p50 / p90 | `--import` p50 / p90 |
| --- | --- | --- | --- |
| 22.23.3 | 22.3 / 24.2 ms | 34.0 / 36.9 ms | 43.8 / 47.0 ms |
| 24.21.0 | 22.8 / 25.9 ms | 31.2 / 35.6 ms | 32.1 / 37.3 ms |

The recorder's own cost, over none, is about 12 ms on 22.23.3 as `--require` and 21 ms as `--import`, so `--import` adds about 10 ms per spawned Node there. On 24.21.0, `--import` costs about 1 ms more than `--require`. That is per spawned child, which is small beside the 0.97 / 1.50 ratios of `tasks/001-132/notes.md`. A test that spawns hundreds of Node children on 22 pays about 1 s per hundred.
