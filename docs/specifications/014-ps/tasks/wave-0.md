# Wave 0: the shared seam

## 014-04 the platform source, the Linux reader and the model types

Use /worker. Shape: slice.

**Outcome.** One interface that every later 014 stage reads the host through, its Linux implementation, and the types the stages pass, so that wave 1 builds on disjoint files.

**Read.** `spec.md` D2, D4, D5, D6, D8, D10, D11; `research/process-measurement.md` 3 to 5; `research/daemon-discovery.md` 1 and 2; `src/core/capacity/pool.ts` (`availableParallelism`); `src/core/fs/git-layout.ts` (`worktreeIdFor`).

**Starting seam.** `src/core/ps/source.ts`. A first edit to start from: a synchronous `PsSource` with `processTable()` (one `stat` scan: pid, ppid, pgid, comm, state, start ticks, CPU ticks, nice), `cmdline(pid)`, `markOf(pid)` (only `SQUEAL_DAEMON_CHILD`), `memory(pid)` (`RssAnon + RssShmem`, `VmSwap`), `fds(pid)`, `locks()`, `host()`, and the clock tick and boot time. `proc.ts` implements it over a root path, default `/`. `shape.ts` holds the D8 JSON `v: 1` and the model types and stage signatures for wave 1 and 2. Whatever is not on the Linux side must fit D10's macOS source; a value it cannot read is `null`.

**Owns.** `src/core/ps/{source,proc,shape}.ts`, `test/ps/**`. Leave everything else alone: no CLI entry, no `main.ts`, no daemon code.

**Rules.** `markOf` never returns or logs any other environment value. Fixtures come from `research/probes/process-measurement/logs/`, with paths anonymized. A process that vanishes between reads, or an `environ` of another user, reads as absent or `null` and never throws.

**Done when.** The reader tests pass over the fixture trees, the cases above included; `npm run lint`, `npm run typecheck`; `squeal run --all --wait` and its output pasted. Do not run `npm run build`. Your final message lists every exported type and each decision the spec did not settle.
