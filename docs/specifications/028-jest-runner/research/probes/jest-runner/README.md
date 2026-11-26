# Throwaway probes: jest-runner research (spec 028)

Throwaway. Not product code, not tests of Squeal. Kept only so the findings in
`../../jest-runner.md` can be rerun. Nothing here is imported by `src/` or `test/`.

Every script copies `fixture/` into `<installDir>/fx` and runs Jest there, so no
Jest output lands in this repository. `<installDir>` is a scratch directory under
`$TMPDIR` that holds `node_modules` with Jest:

```sh
mkdir -p "$TMPDIR/jfx29" && cd "$TMPDIR/jfx29" && echo '{"private":true}' > package.json
npm install jest@29.7.0 jest-environment-jsdom@29.7.0   # and jfx30: jest@30 (30.5.2 on 2026-11-26)
```

Real-repository probes ran on a scratch clone of `apptension/saas-boilerplate` at
`caa46d2` under `$TMPDIR/sb` (`pnpm install --frozen-lockfile --ignore-scripts`),
never on `~/projects/saas-boilerplate`. That clone sits under this repository's
tree, so Jest 29's ts-node found this repository's `tsconfig.json`; the runs set
`TS_NODE_PROJECT=$TMPDIR/sb/tsconfig.base.json` (finding F1.4).

| File | What it shows |
| --- | --- |
| `fixture/` | Synthetic Jest project: re-exports, `moduleNameMapper`, manual mock, computed `require`, JSON, CSS, `setupFiles`, `setupFilesAfterEnv`, fs reads, a child process, snapshots (`test/`); report shapes (`report/`); a hanging file for the deadline probe (`hang/`). `report/syntax.test.js` has a deliberate syntax error. |
| `time-direct.sh` | Wall time and max RSS of one direct `jest --config <project> <files>` run (no Nx). |
| `run-observe.sh` | Runs the fixture with three observers at once: Squeal's `recorder.cjs`, `observe-resolver.cjs`, `observe-runtime.cjs`. |
| `observe-runtime.cjs` | Jest `runtime` subclass. Wraps the per-test-file `ScriptTransformer` (works on Jest 29.7 and 30.5) and, on 29 only, `_loadModule`/`readFile`. |
| `observe-resolver.cjs` | Jest `resolver` wrapping the default resolver. |
| `resolve-runtime.cjs` | Finds the project's own `jest-runtime` through jest → jest-cli → @jest/core → jest-runner (pnpm does not hoist it). |
| `wrap-config.cjs` | Writes a wrapper config outside the project that loads a project's `jest.config.ts` and adds `runtime` (and a reporter). |
| `summarize.cjs` | Per test file, which paths each observer saw. |
| `squeal-reporter.cjs` | Streaming reporter: one JSON line per `onRunStart`, `onTestFileStart`, `onTestCaseResult`, `onTestFileResult`, `onRunComplete`. |
| `run-report.sh`, `show-report.cjs` | Runs `report/` with the reporter; prints it compactly. |
| `run-kill.sh` | Kit K8 analogue: SIGTERM to Jest's process group while `hang/c-hangs.test.js` hangs; lists what the reporter kept; reruns on the same cache. |
| `warm-host.cjs` | One long-lived process: `runCLI` per call, or config + haste map + context built once and `createTestScheduler().scheduleTests()` per call. |
| `warm-fresh.cjs` | Freshness in a warm process after a source edit, a manual-mock edit and a `jest.config.js` edit. |
| `multi-project.cjs` | Time and RSS to read N project configs and build their haste maps in one process. |
