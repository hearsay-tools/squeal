# Research brief: issue #274 (oxlint config-mode keying stall & focused `run tests` timeout)

Use `/researcher`. Read `docs/vision.md`, `docs/styleguide.md`, `docs/specifications/017-lint-checks/spec.md` (especially D5, D7, D11), `docs/specifications/017-lint-checks/research/README.md`, and `docs/specifications/011-core/research/issue-154-cause.md`.

## Context

GitHub issue #274: in `hearsay-tools/squawk`, right after editing two lint plugin files (`packages/cezar/src/lint/owner-reader-rules.ts` and `packages/cezar/src/lint/test-enum-literal.ts`), running:

```sh
squeal run tests <6 focused test files> --wait 10000
```

exited with code 3 before the daemon accepted the request:

> `Group tests has no verdict: the deadline passed before the daemon took request 8eb1d20b-bdf4-46d6-a337-8392e13a059d; the daemon's main thread has been keying oxlint lint checks for 9 s; it waits for the scheduler, which has been applying revision 12 for 1 s. The request stays pending: wait again with squeal run tests --wait.`

A follow-up `squeal status --wait 30000` on the same 6 files succeeded in 3.6 s once revision 12 finished applying.

## Ownership

Read-only on product code, tests, board, spec and status. Own only:
- `docs/specifications/017-lint-checks/research/issue-274.md`
- `docs/specifications/017-lint-checks/research/probes/issue-274/`

Never commit absolute home paths (write `~`), session logs, or private repository names (`pnpm run check:private` fails on them). Keep probes small and stop/clean up any scratch daemon or `/tmp` directory you start.

## Questions to answer (each tagged per `research/README.md`)

1. **Where does the 9 s in `rekey()` go, and how much blocks the daemon event loop synchronously?**
   Measure each sub-step of a config-mode oxlint `rekey()` on a synthetic ~3,000-file repository under `/tmp` using this repo's installed `oxlint` (`1.90.0`), with nested directories, JS lint plugins in `closure`, mixed `.ts`/`.json`/`.md` files, and both `importPlugin: false` and `importPlugin: true`:
   - `inputsOf` -> `OxlintProvider.inputs` -> `lintedFiles` (`DEBUG_CHUNK = 256`, `observe: true` vs `observe: false`, plus the second `unknown` pass for non-selected files).
   - `OxlintProvider.inputs` -> `ready.configs.inputsOf(path)` -> `chainOf(root, path)` synchronous `existsSync` walk.
   - `Keyer.keys()` -> `lintKey()` per-file `configInputs`, `sortedUnique`, `encodeSegment` (`Buffer.from`), `sha256`, `programSegment()`.
   - `judgeAll()` -> N synchronous `store.results.get(...)` lookups + `store.transaction()` (`upsertMany` + `ensureLintCheckId`).
   Report wall time, CPU time, **max single synchronous event-loop block (ms)**, and host load (`/proc/loadavg` and CPU count) for each sub-step.

2. **Why did focused `squeal run tests <6 files> --wait 10000` time out before acceptance with BOTH `"the daemon's main thread has been keying oxlint lint checks for 9 s"` AND `"it waits for the scheduler, which has been applying revision 12 for 1 s"`?**
   Inspect `src/core/daemon/{front-desk,desk,daemon,run-group}.ts`, `src/core/lint/pass/{run,rekey,keyer,keys}.ts`, `src/core/lint/provider/oxlint/{provider,config-set,configs,run}.ts`, and `src/core/scheduler/{scheduler,refine-apply,refinement}.ts`:
   - Confirm whether `onKeying(true)` spans async child-process awaits in `lintedFiles()` as well as synchronous work, and what the two reported durations (`9 s` keying, `1 s` applying revision 12) prove about the timeline.
   - Trace how synchronous stalls in `rekey()` affect: (a) `front-desk -> main thread` `run-group` dispatch, (b) `applyRefinement` / `applyRunnerPart` holding the scheduler lock, and (c) `requestGroupPaths`.
   - Check whether `rekey()` shares any SQLite lock with the main store or only contends on the main-thread event loop and CPU.
   - Check whether `applyRunnerPart` itself has any long synchronous stall or lock hold when editing two files imported by lint/test suites, or if the delay is driven by `rekey()` (or both).

3. **What fixes are sound under spec 017 D5/D11 and spec 011 C4/C15 without changing key format or weakening validity?**
   Evaluate by source reading and targeted experiments on `oxlint@1.90.0`:
   - **Config chain lookup (`chainOf` / `inputsOf`):** Can `ConfigSet` compute `chainOf` from its discovered config map (or per-pass directory memoization) while preserving row 017-30 (`missed(path)`) and nested config semantics?
   - **Key computation (`Keyer.keys` / `lintKey`):** Can `shared(basis)` and pre-encoded `configInputs(basis)` segments be computed once per `Keyer` while producing byte-identical `CheckKey` values?
   - **`oxlint --debug files` (`lintedFiles`):** Does `oxlint --debug files` run JS plugins or load JS/TS configs in `oxlint@1.90.0` (verified by experiment)? What is the cost of `DEBUG_CHUNK = 256` vs larger chunks vs a single root pass vs skipping `observe` when safe, and what happens to `unknown` extensions in `inputsOf`?
   - **Event-loop responsiveness & yielding / offloading:** If synchronous phases (`inputsOf`, `Keyer.keys`, `judgeAll`, SQLite reads/writes) are sliced with `setImmediate` (or moved off the main thread) and/or SQLite lookups/writes are batched, what is the max event-loop stall and does `rekey()` preserve transaction atomicity and interruption safety when a newer revision arrives?
   - **`onKeying` / `MainSteps` reporting:** Should `onKeying` still report across async awaits or only genuine main-thread work, or does fixing the speed + yielding solve both?

4. **Concrete recommendation:**
   Rank the fixes by impact on (a) focused `squeal run tests` acceptance latency during config-mode oxlint re-keying, (b) main-thread event-loop stall, and (c) total `rekey()` time. Name exact files, invariants to preserve, tests to add, and whether any key version (`LINT_KEY`, `OXLINT_PROVIDER_VERSION`, `KEY_FORMAT_VERSION`) changes (prefer zero key-version change if keys stay byte-identical).

## Done when

`docs/specifications/017-lint-checks/research/issue-274.md` answers questions 1 to 4 with tagged evidence and measured numbers, probes are under `probes/issue-274/`, `pnpm run check:private` passes on your changes, and your work is committed cleanly on your branch.
