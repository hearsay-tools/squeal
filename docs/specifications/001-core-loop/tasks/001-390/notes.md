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

## Review 001-401

Repair worker notes, 2026-10-15. Findings: `reviews/wave-13bt.md` (at `6bedb6f3`), candidate `bc1f4bfc` (0.1.189). B1, B2, B3, N1 and S1. Node 24.21.0 and 22.23.3 (the nvm installs on this host). Probes ran in this task's temp directory with `env -i` and a temp `HOME`; none touched the real HOME, another checkout or cezar.

### B1: the recorder's form at every spawn (`spawn.cjs`)

- `injected` tokenizes the child's `NODE_OPTIONS` as Node does and takes this recorder's own preload out of it, either form, by path or `file:` URL (`withoutSelf`). It then puts the recorder back first, as `--require` when the rest of `NODE_OPTIONS` or the child's own options hold a `--require`, else as `--import`. So an inherited `--import` turns into `--require` for a child that has its own `--require`, and an inherited `--require` turns back into `--import` for a grandchild that has none. The recorder appears once. A `NODE_OPTIONS` Node would reject keeps the old behaviour: a `--require` put first unless the recorder is already there.
- Worker: the options are `execArgv`, or the parent thread's `process.execArgv` when it has none, which Node passes on. A `SHARE_ENV` Worker's env is its parent's own, so it is left alone. When its options hold a `--require`, the recorder's `--require` goes ahead of them in its `execArgv`. Node evaluates the `.cjs` once, beside the shared env's `--import`, and `globalThis.__squealObserve` guards the install too.
- Not covered: a test that adds a `--require` to its own `process.env.NODE_OPTIONS` at run time, then starts a `SHARE_ENV` Worker. That preload, from the shared env, runs before the execArgv recorder. Changing the shared env would change what the test sees.
- Tests: `test/runners/observe/spawn-preload.test.ts`. They cover the default env, `{...process.env}`, `execFileSync`, a grandchild in both directions, and Workers with default, `{}` and `SHARE_ENV` env, each spawning a child with its own `--require`. They assert the preload reads, the form, and one recorder per `NODE_OPTIONS`. All 5 were red at `bc1f4bfc`. With the `SHARE_ENV` branch disabled, the Worker test fails on `pre-s.txt`.

### B2: only a `--require` Node would run (`preloads.cjs`, new)

- `spawnRequires(file, args)` returns true only for Node itself, a program running a Node it names (`env node`, `npx node`), or a shell (`sh`, `bash`, `dash`, `zsh`, `ksh`, `mksh`, `ash`) given a command with `-c` (`-lc` too). For a Node it reads the option region: everything before its entry, its `--`, or its first other word. The values of Node's valued options (`node --help` on 24.21.0, plus `-p`, `-pe`, `--loader`) are skipped. Probe: `node -e code -r x` runs the preload; `node -e code a -r x` passes `-r` to the program; `-rX` and `-r=X` are rejected by Node.
- `shellCommands` splits a POSIX command the way the shell passes its words on. It removes single quotes, double quotes and backslashes, drops redirections (`2>&1`, `>out`), and splits on `;`, `&`, `|`, newlines and parentheses.
- **Policy where a command cannot be read for certain:** a `-r` or `--require` that could be Node's counts, because a `--require` recorder loses no reads. Such a command has an expansion (`node $FLAGS a.js -r x`, `$NODE -r x`), a long option `node --help` does not list followed by a word, a here-document, an unterminated quote, or `cmd.exe`. For a here-document or an unterminated quote the old loose match applies to the whole text. `rm -r`, a `-r` after the entry, and `npx mocha -r` never count. A plain `node "$DIR/a.js"` does not count either.
- Tests: `test/runners/observe/preloads.test.ts` (parsing) and the last two of `spawn-preload.test.ts`. The shell test covers unquoted, single-quoted and double-quoted `-r` and `--require`, `--require=` after `cd . && X=1`, and `execSync`. The plain-child test covers `' -r '`, `-r ./x.cjs` after the entry, `-e code arg --require`, and `rm -rf … && node child -r x` beside a `package.json` that is not JSON: each exits 0 with no stderr. The existing `delivery.test.ts` cases still pass: `node -r`, `--require=`, `execSync -r`, and Worker `execArgv`.
- `preloads.cjs` ships with the recorder. `copyObserveRuntime` copies every `.cjs`. `test/daemon/helpers.ts` (`OBSERVE_FILES`) and the Codex plugin test's list now name it.

### B3: the note only from the recorder files the run used (`signature.ts`)

- `withRecorderSignatures(report, use)` and `recorderSignature(error, use)` take a `RecorderUse`: `files`, the recorder files the run gave its processes; `inNodeOptions`; and `relativize`, the runner's own `relativizeText`. With no files there is no note.
  - Vitest: `VitestObserver.files` is the recorder while the instance records, none otherwise.
  - node:test: the module recorder `runtime.recorder` (always in argv), plus the warm-up's `NodeTestReads.recorder`.
- Missing file: `Cannot find module '<file>'` for one of those files, absolute or as the runner relativized it, which covers a recorder inside the worktree (Squeal's own). A project's `src/observe/recorder.cjs` no longer matches, and neither does an installed recorder of another path. The `--import` form names the path too: probe, `Cannot find module '/…/recorder.cjs' imported from /cwd/` on both Nodes.
- `ERR_INVALID_PACKAGE_CONFIG` counts only with a stack that shows Node loading a preload. That stack has a `trySelf` frame, below it no `require (` frame, and then Node's preload loop: an unnamed `node:internal/modules/cjs/loader` frame on 24, and that frame plus `loadPreloadModules` on 22 (probe). A module's own load (`Object..js`) or its own `require` of a bare name beneath the bad file (`require (node:internal/modules/helpers`) does not count, and neither does a bare `code`.
- Old Node's refusal of `--import`: unchanged, while a recorder was in `NODE_OPTIONS`.
- Tests:
  - `test/runners/observe/signature.test.ts`, rewritten. It covers Node 22 and 24 preload stacks, project load and require stacks, a lookalike path, a relativized recorder, and no recorder.
  - `test/runners/vitest/observe-signature.test.ts`, new. A real project's missing `src/observe/recorder.cjs`, and a module beneath a `package.json` that is not JSON, both fail with no note, observing and not. Both cases were red against the `bc1f4bfc` signature code.
  - `observe-fidelity.test.ts` is unchanged and green: a project's own `--require` beside the bad file is still named while observing, and unnamed without.
- The fingerprint and the 300-character summary are untouched (`fingerprint.ts` unchanged; the summary test still passes).

### N1 and S1: Priority

- N1: `lowerWhile`'s doc now says each look starts `EVERY_MS` after the last one ended, with no deadline. The review's probe measured intervals of 140 ms with a 40 ms look. Wording below.
- S1, fixed. `carriers` adds `#orphans`. When a child of the daemon was reaped since the last scan, it scans `/proc` at most once a second for the members of the daemon's group that carry the lane's mark, started since the run began, are no children of the daemon, and are not the group's strangers. A reaped child shows as growth in the daemon's `cminflt`, field 10 of `/proc/<daemon>/stat`: the page faults of the children it has reaped.
  - Probe: `cminflt` grew 0 while idle, 109 after `spawnSync` of a shell, and 87 after an async `/bin/true`.
  - Cost: one more `stat` read per look, 16 µs. A daemon that leads no group never scans.
  - Worst case: a thread worker that keeps spawning short children causes one full scan a second. That costs about 18 to 23 ms CPU per scan (001-393's measure), the old poll's cost, and only while such children exit.
- S1 test: the third case of `test/daemon/low-priority.test.ts`. A detached Node leads its own group and stands in for the daemon. Its shell leaves `sleep 30` behind and exits. Two sleepers, the second 1.1 s later, both reach nice 10 within 3 s. Two mutations make it fail: with `#orphans` off, and with the `cminflt` trigger replaced by a single scan, the result is `expected +0 to be 10`. Like the other two cases, it holds trivially under a daemon that already runs at nice 10.

### Proposed D11 wording, for the coordinator

Fidelity. Replace "It stays a `--require` where a `--require` is already present: in the inherited `NODE_OPTIONS`, in a spawned child's own arguments or shell command, or in a Worker's `execArgv`." with:

> It is chosen at every spawn, also where the child inherits it already, and appears once. It is a `--require` where the process runs a `--require` anyway: one in its `NODE_OPTIONS`, in Node's options among its own arguments (before its entry, its `--` or its first other word), in those of a Node a shell's `-c` command starts, read as the shell passes its words on, or in a Worker's `execArgv`, or its parent's when it has none. A `SHARE_ENV` Worker gets that `--require` in its `execArgv`, and its shared env stays as it was. Where a command cannot be read for certain (an expansion, a here-document, an unterminated quote, an option Node does not list), a `-r` or `--require` that could be Node's counts, since a `--require` loses no reads. A program's own `-r` does not count (task 001-390, review 001-401).

Replace "A failure whose text carries a signature of the recorder says, at the end of its summary, that it ran under Squeal's recorder, and what the signature points at: `ERR_INVALID_PACKAGE_CONFIG`, and an old Node's `--import is not allowed in NODE_OPTIONS` or `bad option: --import`, while the recorder was in the run's `NODE_OPTIONS`; a missing recorder file, always." with:

> A failure whose text carries a signature of a recorder the run used says, at the end of its summary, that it ran under Squeal's recorder, and what the signature points at. The signatures are three. While a recorder was in the run's `NODE_OPTIONS`: `ERR_INVALID_PACKAGE_CONFIG` raised as Node loaded a `--require` preload, which its stack shows, and an old Node's `--import is not allowed in NODE_OPTIONS` or `bad option: --import`. And `Cannot find module` naming a recorder file the run gave its processes, as the runner wrote that path. Squeal cannot tell which `--require` made Node parse the file. The note says only that a `--require` preload did, under its recorder. A run that used no recorder gets no note, and a project's own module load gets none.

Priority. Replace its third sentence with:

> A Vitest fork worker, a child of the daemon carrying its lane's mark, is looked for among the daemon's children (`/proc/<daemon>/task/*/children`) and lowered with what it has started by then (task 001-393). Each look starts 100 ms after the last one ended, so a worker runs at normal priority for that polling interval plus the look's own time and the event loop's delay, with no hard deadline. A look costs about 0.5 ms CPU with 8 marked children, about 5 ms CPU a second per active lane. After a child of the daemon exits, a look also scans `/proc` for the lane's marked processes in the daemon's group whose parent left before a look found them, at most once a second, and lowers them too (review 001-401 S1).

### Type changes

- `RecorderUse` (new, `src/runners/observe/signature.ts`, exported). `recorderSignature` and `withRecorderSignatures` take it in place of the `inNodeOptions` boolean. Not additive, but internal: their only callers are the two runners, and the type is in no spec interface.
- `VitestObserver.files` (new getter). `NodeTestReads.recorder` is now public and read-only.
- `CheckError.recorder`: unchanged.

### For whoever continues

- Rebuild all four bundles. `dist/observe/` gains `preloads.cjs`. Key format 10 is re-pinned in place (`8e84e7c7…`). Neither the version nor `dist` was changed here.
- `src/core/daemon/escaped.ts` is now 459 lines (407 before), past the ~300-line signal. A split candidate is the `/proc` reading (`snapshot`, `reapedFaults`, `strangersOf`, `lineOf`, `descendantsOf`).
- The node:test module recorder is unchanged (always `--require`), as the review asked.
- `VALUED` in `preloads.cjs` is `node --help` on 24.21.0. An option added later, followed by a word, falls under the policy for commands that cannot be read for certain.
