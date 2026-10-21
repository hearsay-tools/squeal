# Wave 0: the shared seam

## 014-04 the platform source, the Linux reader and the model types

Use /worker. Shape: slice.

**Outcome.** One interface that every later 014 stage reads the host through, its Linux implementation, and the types the stages pass, so that wave 1 builds on disjoint files.

**Read.** `spec.md` D2, D4, D5, D6, D8, D10, D11; `research/process-measurement.md` 3 to 5; `research/daemon-discovery.md` 1 and 2; `src/core/capacity/pool.ts` (`availableParallelism`); `src/core/fs/git-layout.ts` (`worktreeIdFor`).

**Starting seam.** `src/core/ps/source.ts`. A first edit to start from: a synchronous `PsSource` with `processTable()` (one `stat` scan: pid, ppid, pgid, comm, state, start ticks, CPU ticks, nice), `cmdline(pid)`, `markOf(pid)` (only `SQUEAL_DAEMON_CHILD`), `memory(pid)` (`RssAnon + RssShmem`, `VmSwap`), `fds(pid)`, `locks()`, `host()`, and the clock tick and boot time. `proc.ts` implements it over a root path, default `/`. `shape.ts` holds the D8 JSON `v: 1` and the model types and stage signatures for wave 1 and 2. Whatever is not on the Linux side must fit D10's macOS source; a value it cannot read is `null`.

**Owns.** `src/core/ps/{source,proc,shape}.ts`, `test/ps/**`. Leave everything else alone: no CLI entry, no `main.ts`, no daemon code.

**Rules.** `markOf` never returns or logs any other environment value. Fixtures come from `research/probes/process-measurement/logs/`, with paths anonymized. A process that vanishes between reads, or an `environ` of another user, reads as absent or `null` and never throws.

**Done when.** The reader tests pass over the fixture trees, the cases above included; `npm run lint`, `npm run typecheck`; `squeal run --all --wait` and its output pasted. Do not run `npm run build`. Your final message lists every exported type and each decision the spec did not settle.

## 014-05 review of wave 0

Use /reviewer. Shape: review. Pinned to the candidate SHA the dispatch names, on `cand/014-04`; the range is from `f1e3b1c31` (the approved spec) to it.

**Outcome.** A verdict on whether the wave 0 seam can carry waves 1 and 2 without a change to its interface.

**Read.** `spec.md` D2 to D11 as amended, and `status.md`'s 014-04 lines; `src/core/ps/{source,proc,shape,model}.ts`; `test/ps/**`.

**Check, each finding labelled proven, plausible or unverified.**
1. `PsSource` gives every read that D2 to D7 name, and D10's macOS source can implement it from `ps`, `vm_stat`, `sysctl` and `lsof` alone.
2. Nothing writes, signals or connects. The only spawn is `ss -xle`, with fixed arguments.
3. `markOf` returns only `SQUEAL_DAEMON_CHILD`, and no other environment value reaches a return, a log or a fixture.
4. A process that vanishes, a garbled file or another user's file never throws.
5. `test/ps/proc-live.test.ts` holds on a GitHub runner: no `ss`, another PID namespace, no git identity.
6. `shape.ts` matches D8's block key for key. `model.ts`'s stage types let 014-06, 014-07, 014-10 and 014-11 work in disjoint files.

**Rules.** Change no code. Run `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4` and paste its result, with the load. Write only `reviews/wave-0.md` (verdict, verification output, blockers, should-fix, nits, what fits, inputs for wave 1) and commit it.
