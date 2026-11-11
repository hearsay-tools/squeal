# 020-15b notes: the pre-run print (carries 020-16a and #182)

Worker aaa57b1a, 2026-11-11. Spec D14.4, on the integrated 020-15a and 020-16b branch (`d2d6de1e4`). For a reviewer, the coordinator's merge with 020-18, and whoever continues.

## Seam map

- **Adapter (agreed, request b432da0f).** `types/runner.ts` `GlobalSetupEntry` and the optional `RunnerAdapter.globalSetups()`. `runners/vitest/adapter.ts` reads `vitest.getRootProject()` and `vitest.projects` with `globalSetupFiles()`: config only, no setup runs, no key reads it. `vitest.projects` alone never holds the root project when `projects` is set, and `environment()` lists only `vitest.projects`, so the root's setup was not visible before. node:test does not implement it.
- **Collector.** `collect.ts` `select()` returns each runner's `Picked` (`kind`, `adapter`, `listed`, `run`, `leftOut`) with its `runner`. `collectEvidence` calls `prerun.ts` `tellSelection` once after `select()` and before `knownBefore()`, so before any `prepare`, global setup or run. New options: `CollectOptions.selected` (the callback) and `CollectOptions.excluded` (`coverage.exclude` at the base). Not called when no runner opens. `collectEvidence` stays at CC 19; the file stays 454 lines.
- **Summary.** `gate/prerun.ts` `summarize`: per runner kind the files to run by group (`placeFile`), the left-out groups (`tally.evidence([]).leftOut`), the setups (the root's, and those of projects with a file to run), and `unloaded`.
- **Unloaded paths (020-16a).** The paths of changed functions that no runner lists and no selected file's `closure()` holds, the run and the left-out files both. Every file that loads a changed path is selected (D3.1), so these closures are enough. It stops once every path is found. Not `affected([path])` per path, as the research proposed: each `affected()` walks every listed test file, so N paths cost N whole walks; the closures cost at most one walk per selected file, which the gate does again after the run. A closure that cannot be read tells no path. With `coverage.children` it tells none: a child a test starts may run any path, and its record then measures it (the `code-gate-children` case).
- **Text.** `cli/code-gate-prerun.ts` `preRunText` and `preRunOptions`; `code-gate.ts` spreads `preRunOptions(changed, policy, io.stderr)` into the collect options (one line). `code-gate-text.ts`: only `GAP_WORDS["no-loader"]`, now "no test Squeal runs loads its file" (D11.5, as 020-16a's research asks). The verdict line is untouched (020-18 owns it).
- **#182 (agreed, request c2a982e5).** `main.ts` `CliIo.relaunch`, given only by `index.ts`: `[process.execPath, ...process.execArgv, argv[1]]`. `code-gate.ts` `codeGateCommand` dispatches; the old body is `gate()`. `cli/code-gate-relaunch.ts`:
  - parent `relaunchGate`: `spawn(relaunch, ["code", ...args])` with `stdio: ["inherit", 2, "inherit", "pipe"]` and `SQUEAL_CODE_GATE_REPORT_FD=3`; forwards SIGINT and SIGTERM; reads fd 3 until it ends, or 2 s after the child exits when something else holds it; `unframe` checks the frame.
  - child: `takeReportFd` deletes the mark from `process.env` first, so nothing the gate starts sees it; `runAsChild` buffers `io.stdout` and `sendReport` writes the frame with `writeSync` (the child's end is blocking: 8 MB in one call in a probe) and closes it.
  - Probe (not kept): an fd 3 pipe did not reach a grandchild (`sh` saw fds 0, 1, 2), and a detached grandchild did not hold the pipe open.

## Decisions the spec did not settle

- Line words. `Vitest: 3 test files to run (tests 2, slow 1)`; `node:test` entries together on one line; `no test file to run` when a runner opened and runs none. `browser (manual) is left out: 1 of its 100 test files loads changed code; add --group browser to run it`, or `none of its N test files loads changed code`; every left-out group gets a line, not only those with a selected file. `global setup runs for: the root project (any selection), e2e` by project name, no file paths. The 020-16a line as the research wrote it.
- "To run" counts the files the scope runs; some may later be read from the stores or parts. The stores note after the run still says how many.
- A `prepare` is not in the setup line: 020-16b already tells it just before it runs.
- The relaunch runs only with `--json` and only from the CLI entry. Text mode and every in-process caller (tests, injected adapters) run as before.
- Exit codes of the parent: the child's, with a whole frame. An empty frame is whole: a usage or setup error in the child keeps its exit 2 and an empty stdout. No whole frame, or a child ended by a signal: nothing on stdout, a line on stderr, exit 3 (the coordinator's condition). A child that cannot start: exit 2, a setup error (D1).
- A marked process with a mark that names no descriptor (not an integer over 2) runs the gate in process and never relaunches.
- Not tested: stdin passing through (it is `stdio[0]: "inherit"`).

## Tests

- `test/code/gate/collect-prerun.test.ts` (fake adapters): told once before the first run; groups; root setup and the setup of a project with a file to run, not of one without; unloaded paths and `excluded`; no `globalSetups` gives no setup and no error; an unknown closure tells no path; no runner, no call.
- `test/cli/code-gate-prerun.test.ts` (in process; a marker file written by the first setup or test): a root global setup beside `projects`, a manual `browser` group with its own setup: the three lines come before the marker. 020-16a: `unit` lists `test/unit`, `test/e2e/x.test.mjs` holds a changed helper: the line comes before the marker, exit 3, the text uses the new words; with `test/e2e/**` in `coverage.exclude` at the base, no line and exit 0. node:test gives no setup line.
- `test/cli/code-gate-relaunch.test.ts` (`node -e` children): the args, the mark and the exit code; no frame and a cut frame give exit 3 with an empty stdout; SIGTERM is forwarded (through a test emitter, not a real signal to the worker); a marked process writes its frame to the marked descriptor and does not relaunch; text mode stays in process.
- `test/cli/code-gate-json-stdout.test.ts` (the real `src/cli/index.ts` through tsx, two processes): `research/issue-182.md`'s probe. A global setup writes `console.log` and starts `execFileSync(..., { stdio: "inherit" })` that writes to stdout. stdout parses whole; both texts are on stderr, after the selection and setup lines.
- Updated: five tests that expected an empty stderr now expect the selection line (`code-gate`, `code-gate-exceptions`, `code-gate-children`, `code-gate-stored` twice).

## For whoever continues

- `commands.md` and the README do not describe the pre-run lines or the `--json` child yet; not in this row's files.
- `collect.ts` is still 454 lines. `knownBefore`, `leftOutFiles` and `select` could move out beside `prerun.ts`; `Picked` now carries what they share.
- The bundles drift (`plugins/claude-code/dist` and the Codex runtime); the rebuild is the coordinator's.
