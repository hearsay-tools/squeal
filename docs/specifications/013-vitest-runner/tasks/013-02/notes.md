# 013-02 notes: a touch withholds only what the Vitest instance could have read

Worker 782141bb, 2026-10-20, brief `../wave-1.md` (013-02), design `../013-01/design.md` sections 2, 3 and 6. Commits on `cez/782141bb`: the adapter (`306daead`), the agreed `withheld-touch` fixture (`1445edb6`), D2 (`489d6005`), key format 18 (`e9a2c454`).

## Seam map

- `src/runners/vitest/touched.ts`: `ModuleIndex` (each environment's modules by the project file they name, file index and ID scan together), `sortTouched` (inputs read once, module paths, the rest; every touch is an input under a browser-mode project), `Touches` (pending touches with the call count at hearing, calls in flight, `mark`/`since` around a start, `forget`).
- `src/runners/vitest/moved.ts`: `mayHaveReadTouched` is the touch walk beside `mayHaveRun` (unchanged). `withoutTouched` takes the dropped files and the counted paths.
- `src/runners/vitest/adapter.ts`: `#call` wraps every lane call in `Touches.call`; `#instance` asks `#counts`, which sorts the pending touches and forgets the settled uncounted ones; the run sorts at its end, before a hung or broken instance is dropped.
- `src/runners/vitest/sources.ts`: `Environment`, `environments` and `sourceOf` are exported for the sort, an additive change.
- `src/core/scheduler/scheduler.ts` `#record`: `barred` holds the tier's files whose inputs or observed growth name a touched path. Only they are withheld, recorded in `#withholds` and named in notes; the rest are cleared. `stability.ts` `withheldForTouch(report, touched, files?)` drops only `files` and keeps the runner's `withheld` for the rest. Without `files` it drops every file, as before (`test/delivery/unknown-reason.test.ts` calls it that way).

## Decisions the spec left open, and the choice

1. **The run's end sorts every pending touch**, not only those heard during the run. A touch still pending at the run's start was heard while an older call was in flight. That call may have cached transient bytes, and the run can share its transform (regression 7's shape). Settled uncounted touches are forgotten at each call's `#instance`, so what is pending at a run's start is only that case.
2. **Any module node naming the path counts**, whether or not its transform is cached. An invalidated node keeps its place in the graph, so this errs conservative.
3. **Inline projects share the root's Vite server** (verified by a probe here, Vitest 5.0.3: `projects[0].vite === projects[1].vite` for two inline projects). The rule is kept as V5 words it, per project. A module only one inline project's file reaches then falls back to every file of the run in each other inline project. Regression 4's two-project case therefore gives each project a config file of its own, the wave-13b B2 shape. A walk per server would narrow this, at the same risk 001-146's `mayHaveRun` already accepts. That would be a spec change.
4. **The reason names every counted path**, including one that withheld no file of this run.
5. **D2's per-file inputs** are the tier's `inputs` (`stabilityPaths`: closure with observed paths, environment files, lockfile) plus the file's observed growth. These are the same sets the content discard reads (`tiers.ts`).

## Found against the design

- `touched-in-flight`'s self-written `fixtures/data.txt`: design section 6 says that when observed, the barrier withholds it with the 001-168 reason. It does not. The recorder leaves out a path the test wrote (`src/runners/observe/inputs.ts:45`), so no key ever names the file and both modes store it from the first run. The test pins that.
- `test/scheduler/withheld-touch.test.ts` was not listed in section 6, but D1 broke it: it touched a tracked file nothing loads. With the coordinator's agreement, its fixture now loads the file through a computed `import()` and its assertions are unchanged.
- The shared `withheldByBarrier` (`test/integration/stamps-repo.ts`) checks every `putMany` of the run, not one file's. Under D2 a file sharing the withheld run is stored from that run, so `touched-in-flight` checks `holds` per file in a local helper. Any later test that uses `withheldByBarrier` on a multi-file tier under D2 hits the same limitation.

## Left for other rows

- `mayHaveRun` (001-146) could share the touch walk and its ID-scan start set. That is a change to stamps.
- Leftover ignored extras stay watched (013-01 section 4): a keys row.
- node:test and pytest treat a touch as structural (013-01 section 5): a row for 003 and 007.
