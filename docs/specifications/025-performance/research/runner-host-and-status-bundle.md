# 025-12 (D12): Vitest runner-host idle exit and a status-only CLI bundle

Researcher, 2026-11-24, 21:50Z to 22:40Z. Brief: `../tasks/wave-3.md`, row 025-12. Squeal 0.1.628 (`957897ae3`), the shipped `plugins/claude-code` wrapper and bundle. Extends `../../021-remote-store-and-execution/research/daemon-heap.md` (021-27, on 0.1.459) and reuses its probes.

**Environment.** Timings ran on one boat.dev sandbox: AMD Ryzen 9 9950X, 8 vCPUs, 15.6 GiB, Linux 6.8.0-117, Node v26.13.0, on a copy of this repository (2,259 Vitest test files listed, `test/e2e/**` excluded). One-minute load 0.07 to 2.3 (given per row in the logs). The status read on a large store ran on the development host (16 vCPUs, Node v26.13.0, load 3 to 12) against this worktree's store, read only. Probes, method and raw logs: `probes/runner-host-and-status/` (throwaway).

## Answers

| # | Question | Answer | Tag |
|---|---|---|---|
| 1a | Runner-host memory after a warm run and after 60 s idle | **Start 103 to 110 MiB private. After 20 edits 607 to 823 MiB. After 60 s idle 483 to 529 MiB; a full GC then frees 0 to 2 MiB.** Live heap after GC 147 MiB, of which Vite's SSR module graph is 107 MiB. Native: Rolldown's mimalloc 231 MiB, glibc 97 MiB. | verified by experiment |
| 1b | Cold restart vs warm 1-file edit | **Cold (spawn, Vitest init, first edit) 6.68 to 10.83 s, median 7.13 s; warm 0.22 to 0.36 s, median 0.24 s** (5 cold, 15 warm). 92% of the cold edit is the first `affected` walk (6.1 to 10.0 s). | verified by experiment |
| 1c | Interaction with `daemon.unusedExitMinutes` and 026-05 / 026-09 | **An idle host exit already ships**: spec 021 D20 (row 021-26, 0.1.461), `runner.hostIdleMinutes`, default 2 to 10 min from RAM. It fires before either daemon exit (30 or 60 min, or 2 when keying is deferred). Under 026-05 deferred keying no host starts at all. | read in source code (0.1.628); the close itself seen once by experiment |
| 1d | Ship an idle exit timer? | **No new timer. Keep D20 as it is.** Its close returns about 0.5 GB per worktree and costs about 7 s on the next edit. The lever is that 7 s cold walk (021-27 recommendation 4), not the timer. | inferred from 1a to 1c |
| 2a | `status` wall time and split | Warm cache, small store: entry reached at **65 to 68 ms** (full bundle), `readStatus` **72 to 82 ms**, format **0.5 to 3 ms**, total about 140 to 160 ms. Real store (18,078 checks): `readStatus` **329 to 364 ms**. `status --wait` on a current file: about **600 ms after the load**, in the daemon sync. `sh` wrapper: under 1 ms. | verified by experiment |
| 2b | Status-only bundle size and load time | **1.67 MB against 5.22 MB (32%)**; 2.63 MB with `status --at`. Entry reached at **49 to 57 ms warm** (−11 to −18 ms) and **61 ms cold** (−72 ms). | verified by experiment |
| 2c | Ship a second CLI entry point? | **No.** It saves 11 to 18 ms warm on a quiet machine, 29 to 47 ms on a loaded one. That is 7 to 9% of `status` on a large store and 2 to 3% of `status --wait`. The store read (025-11) and the wait's sync are 7 to 40 times larger. | inferred from 2a and 2b |

## 1. Runner-host idle exit

**Method.** `drive-host.mts` starts the shipped bundle's `runner-host` through Squeal's own proxy, as the daemon's fast instance (2 workers, observe on, `test/e2e/**` excluded, coverage off). It runs on a copy of the clone that no daemon watches. One edit is what the daemon asks of a host: `invalidate`, `affected`, `closure`, `run` of the direct files. The edited file is `test/state/transitions.test.ts` (1 direct file).

**Latency** (`logs/latency*.jsonl`, load 0.07 to 0.97). *Verified by experiment.*

| | min | median | max |
|---|---|---|---|
| Host process, Vitest instance and `start` | 266 ms | 306 ms | 432 ms |
| List (2,259 files) | 14 ms | 15 ms | 27 ms |
| Cold first edit, start included | 6,679 ms | 7,134 ms | 10,831 ms |
| of which the first `affected` | 6,102 ms | 6,580 ms | 9,997 ms |
| Warm edit (15 edits) | 222 ms | 241 ms | 364 ms |
| Close | 69 ms | 94 ms | 114 ms |

On a quiet 9950X the cold cost is about 6.4 to 10.6 s above a warm edit. 021-27 measured 8.6 to 13.9 s cold and 0.44 to 0.89 s warm on 0.1.459 under load 15 to 20, so the shape has not changed.

**Memory** (4 runs, `logs/memory*.jsonl`, `host-vitest-*.jsonl`, `host-split.tsv`; 20 edits over 10 test files, then 60 s with no call). *Verified by experiment.*

| Moment | Private (MiB) | VmRSS | heapTotal | heapUsed |
|---|---|---|---|---|
| Started, listed | 103 to 110 | 173 to 180 | 68 | 50 |
| After the 20 edits | 607 to 823 | 679 to 896 | 414 | 302 |
| After 60 s idle | 483 to 529 | 556 to 602 | 233 | 149 |
| After a full GC | 483 to 531 | 555 to 604 | 233 | 147 |

V8 shrinks the heap by itself within 60 s idle. A forced GC then frees almost nothing, so a GC timer in the host would not help. The `/proc` split at 60 s idle after the GC (run 4): V8 pages 161 MiB, other large anonymous mappings 51, glibc `[heap]` 97, **Rolldown's mimalloc 231**. Native memory is about 60% of the idle host. Only a process exit returns it.

The heap snapshot after the GC (run 1) retains 188.5 MiB (`logs/host-dominators.txt`):

| Retainer | MiB |
|---|---|
| Vite `RunnableDevEnvironment.ssr.moduleGraph` (3,980 `EnvironmentModuleNode`; 108 MiB of strings in the heap) | 106.8 |
| Two WebAssembly memories, held by closures named `createServerHotChannel` and `parse` (owners not identified further) | 16.1 + 16.1 |
| The Squeal bundle's own source text (5.2 MB file, held as a two-byte string) | 10.0 |
| Vite's and Vitest's source text | 4.4 |

**How it fits with spec 026.** *Read in source code at 0.1.628.*

- D20 is in place. `createRecoveringRunner` (`src/core/daemon/runner.ts`) closes the fast host through `IdleClock` (`runner-idle.ts`) after `runner.hostIdleMinutes` with no counted call. The default comes from `defaultHostIdleMinutes` (`host-idle.ts`): `round(totalGiB / 8)`, clamped to 2 to 10. The sandbox's 15.6 GiB gives 2. Lane instances close after 60 s (`SlowRelease`), and remote hosts never close by this rule (D20.5). A planned close marks nothing `unknown` and re-keys nothing unchanged (D20.3).
- The daemon calls `invalidate` and `affected` on every revision (021-27 3, `refinement.ts`). So any edit keeps the host up, and it closes only after N minutes with no edit at all.
- 026-09 `daemonExits` (`policy.ts`): `unusedExitMinutes` is 30 by default, or 2 when keying is deferred. `idleExitMinutes` is 60 with no consumer. The host's 2 to 10 minutes always end first, and a daemon exit ends its hosts as well.
- 026-05 `RunnerGate` (`scheduler/runner-gate.ts`): with no test group at `edit` or `pause`, a runner gets no call until an explicit request opens it. So no host starts on edits, and an idle timer has nothing to close.
- Seen once by experiment: on the sandbox daemon with `runner.hostIdleMinutes` 1, `squeal ps` listed the fast host at 1 minute up (460 MiB). About 5 minutes later no Vitest host process was left.

**Recommendation 1.** Do not add an idle exit; D20 is that exit. Keep its default. Per worktree, a close returns 483 to 529 MiB and costs 6.4 to 10.6 s on the next edit. If Wave 4 wants a change here, it should make the reopen cheap: answer the first `affected` after a reopen from the daemon's reverse index (021-27 recommendation 4, untested). That removes about 92% of the cold edit, and a shorter default would then cost little. The memory left over is Vite's module graph and Rolldown's native heap, both owned by Vitest; Squeal cannot trim them without a process exit.

## 2. A status-only CLI bundle on top of `NODE_COMPILE_CACHE`

**Method.** `status-bundle.mts` builds scratch bundles with `bundleOptions` from `src/harness/build.ts`, the shipped build's own settings. The timed full build is 5,223,638 bytes against 5,223,255 shipped; the timing marks are the difference. `status.mjs` is `main` with only `status` dispatched. Timed copies record `performance.now()` at the entry's first line, after every module ran; around `readStatus`; before the write; and at the end. `time-status.mjs` ran 15 trials of each form on the sandbox. The daemon there was on `squeal hold` (0% CPU), and the named file was current. The store held 2,259 listed files and 919 tests.

**Phases, sandbox, 15 trials, medians in ms** (`logs/status.jsonl`, load 1.1 to 1.6). *Verified by experiment.*

| Bundle, cache | Form | Entry reached | `readStatus` | Format | Exit |
|---|---|---|---|---|---|
| Full, warm | `status` | 67.0 | 78.8 | 2.8 | 150 |
| Full, warm | `status --json` | 65.0 | 74.3 | 0.5 | 142 |
| Full, warm | `status --wait 60000 <file>` | 67.9 | – | – | 676 (605 after the entry) |
| Full, cold | `status` | 133.3 | 81.6 | 2.9 | 220 |
| Status-only, warm | `status` | 57.0 | 77.3 | 2.8 | 141 |
| Status-only, warm | `status --json` | 49.6 | 72.4 | 0.6 | 125 |
| Status-only, warm | `status --wait 60000 <file>` | 49.2 | – | – | 647 (598 after the entry) |
| Status-only, cold | `status` | 61.1 | 64.6 | 2.5 | 129 |

A bare `node -e 0` takes 15.6 ms (median), and `sh -c :` takes 0.8 ms. On a real store (this worktree's, 18,078 checks, 2,259 files), 10 trials at load 8 to 12 on 16 vCPUs (`host-phases.mjs`) gave: `readStatus` **329 to 364 ms**; entry reached at 99 to 117 ms (full) and 70 ms (status-only); exit at 438 to 504 ms (full) and 401 to 421 ms (status-only). *Verified by experiment.*

**Wall time through the shipped wrapper, sandbox, medians** (`logs/status.jsonl`, sequential blocks):

| Form | cache off | cold | warm |
|---|---|---|---|
| `--version` | 105 | 122 | 126 |
| `status` | 166 | 219 | 272 |
| `status --json` (245 KB) | 163 | 250 | 185 |
| `status --wait 60000 <file>` | 687 | 1,011 | 2,006 |

These wall times drift with the order the blocks ran in. Warm is slower than off for `status`, and the warm `--wait` p90 is 2.3 s. The daemon's sync answers that wait, and its time varies. Use the phase table above, where each run times itself, rather than these rows. *Verified by experiment; the drift is the reason.*

**`NODE_USE_ENV_PROXY`.** In the sandbox's sequential blocks, `NODE_USE_ENV_PROXY=1` with `HTTPS_PROXY` set added 50 to 90 ms to the wrapper and to plain `node` alike. Interleaved on the development host (`proxy-interleaved.mjs`, 12 rounds, warm cache), it made no difference beyond 10 ms: `--version` 100/101 ms (wrapper without/with) and 99/99 ms (`node`); `status --json` 385/375 and 377/394 ms. The interleaved run decides, because block order confounds the sequential one. So on Node 26.13.0 with a proxy on a closed local port, no proxy start cost was measured, with or without D7's carry. A proxy that resolves a name or answers could differ; not tested. *Verified by experiment; the two runs disagree, interleaving decides.*

**What fills the status-only bundle** (`bundle-inputs.mjs`): `enhanced-resolve` 254 KB, `acorn` 228 KB, `web-tree-sitter` 165 KB, `es-module-lexer` 41 KB and `tapable` 40 KB, 44% in total. Then `src/core/status` 135 KB and `src/core/store` 99 KB. Status needs none of these parsers or resolvers. Static imports with module-level side effects pull them in, so a second entry point alone does not shed them. *Verified by experiment (sizes); the cause is inferred from esbuild keeping side-effecting modules.* `status --wait` starts no daemon (`status-wait.ts` returns `no-daemon`), so a status-only bundle would not need the daemon command. *Read in source code.*

**Recommendation 2.** Do not ship a second CLI entry point now. With a warm compile cache it saves 11 to 18 ms per `status` on the quiet sandbox: 7 to 12% on a small store. On the loaded development host with a real 18,000-check store it saves 29 to 47 ms of 421 to 504 ms (7 to 9%), while `readStatus` takes 329 to 364 ms; row 025-11 targets that read. On `status --wait` it is 2 to 3%, against about 600 ms in the daemon sync (`syncDaemon`, polled every 250 ms). The 72 ms cold-cache saving comes once per Squeal version per machine. Measure again after 025-11 lands. If the read falls to about 20 ms, 11 to 18 ms becomes a quarter of `status`. Then two cheaper options come first, both inferred and not measured: lazy `import()` of command modules inside the one `squeal.mjs`, and import hygiene that keeps `enhanced-resolve`, `acorn` and `web-tree-sitter` off the status path. Both would help every command, not only `status`.

## Open questions

- **A daemon-driven idle close, timed end to end** (`host-idle-e2e.sh`): not run to the end. The sandbox copy's tree was dirty with the probe files, and a config edit queued 2,135 files in tiers of 200. The first tier ran 8 minutes with no file finished, and the parent asked not to wait for a baseline. The driver measures the same host restart directly. The daemon adds its own keying on top, which is not measured.
- **The 600 ms of `status --wait` on a current file**: inside the daemon sync. Whether `squeal hold` lengthens it was not separated.
- **The right `hostIdleMinutes` default** needs the distribution of gaps between agent edits, which the benchmark's session logs hold. Not measured here.
- The owners of the two 16 MiB WebAssembly memories in the host. Not identified beyond the closure names.
- macOS, and Vitest projects of other sizes. Not examined.

## Sources

- Squeal source at 0.1.628 (`957897ae3`): `src/core/daemon/host-idle.ts`, `runner.ts`, `runner-idle.ts`, `policy.ts` (`daemonExits`), `daemon.ts` (Vitest instances, `#hostIdleMs`); `src/core/scheduler/runner-gate.ts`; `src/core/runner-host/{channel,proxy,vitest-host,host}.ts`; `src/cli/main.ts`, `index.ts`, `status-wait.ts`, `status-sync.ts`, `wait/status-table.ts`; `src/harness/build.ts` (`bundleOptions`); `plugins/claude-code/bin/squeal`.
- Specs: `../../021-remote-store-and-execution/spec.md` D20; `../spec.md` D7, D12; `../status.md`; `docs/board.md` rows 021-26, 026-05, 026-09.
- Research: `../../021-remote-store-and-execution/research/daemon-heap.md` and its probes `inside.mjs`, `dominators.mjs`, `split.py`, `drive-host.mts`.
- Probes and logs: `probes/runner-host-and-status/`.
