# 020-23 and 020-24 notes: the gate's test helpers

Worker notes for whoever integrates or reviews the rows. The findings are rows `proposed-gate-cli-test-kit` and `proposed-gate-core-test-fixtures` of `quality/2026-11.md`. Test files only, apart from one word in `src/cli/code-gate.ts` (the coordinator's decision, below).

## Where each helper lives now

- **The run proxy.** `onRun(adapter, before)` and `watched(ran)` in `test/code/gate/collect-fixture.ts`. `before` sees each run's files and options and returns the files the run gets. `watched` is the CLI's adapters with each Vitest run's files appended to `ran`. Users: `code-gate-keep-kit.ts`, `code-gate-parts-kit.ts`, `collect-stored`, `collect-order` (sorts by path), `collect-prepare` (records each node:test timeout).
- **Run `squeal code`.** `code(cwd, args, { env, adapters, stderr })` in `test/cli/code-gate-fixture.ts`: `codeCommand` with no adapters, `codeGateCommand` with them; `stderr` is a tap. `toldBefore(root, args, marker)` beside it is the one function of `code-gate-estimate` and `code-gate-prerun`.
- **The keep tests' repository.** `featureRepo(policy, files)`, `keepPolicy(onStart, more)`, `write(repo, files)` and `keysNow(repo, refs)` in `test/cli/code-gate-keep-kit.ts`. Seven setups use `featureRepo`: the six of the finding, and the `coverage.children` branch of `code-gate-stored.test.ts`. `keysNow` replaces two copies and two variants (`keyNow`, `keysOf` in `code-gate-keep-observed.test.ts`).
- **The text tests' report.** `functionRow(over)` and `gateReport(over)` in a new `test/cli/code-gate-text-kit.ts`, not in `code-gate-fixture.ts`: the fixture imports the CLI's commands, and the text tests would then rerun on every gate change. `gateReport`'s `base` merges over the default base.
- **The changed-function repository.** `test/code/gate/changed-fixture.ts`: `repo(files, head)`, `POLICY`, `lines`, `names`, `ONE`, `TWO`, on `test/hash/git-repo.ts` (`git`, `initRepo`, `writeFile`). `repo` renames `initRepo`'s `main` to `base` and checks out `work`. `changed-omitted.test.ts` and `policy.test.ts` use it too; their repositories are now on branch `work`, not `base` or git's default.
- **The evaluate wrapper.** `judged(paths, files, { policy, uncounted, scope, exceptions })` in `evaluate-fixture.ts`. `evaluate-scope.test.ts` keeps a one-line `judgedLeftOut` for its scope and default-scope policy.
- **The collect helpers.** `collect`, `judged` (async, the policy at the fixture's commit) and `scopeOf(root, added, checks)` in `collect-fixture.ts`. Two exported `judged` exist, one per fixture; no file imports both.
- **`TMPDIR`.** `stored.test.ts` takes `ownTmpdir()`.

## Moves and splits

- `code-gate-text.test.ts` (new): the `crapText` and both `formatGateReport` describes of `code-gate-args.test.ts`, and the `formatGateReport: exceptions` describe of `code-gate-exceptions.test.ts`. `crapText` was not in the finding's line range; it tests `code-gate-text.ts`, so it moved too.
- `code-gate-parts-environment.test.ts` (new): the environment and snapshot describes of `code-gate-parts-cases.test.ts`. `READS`, `RISKY` and `clearStores` are in `code-gate-parts-kit.ts`.
- `changed-counted.test.ts` (new): "changedFunctions: what is counted".

## Decisions

- **The case removed (coordinator, 2026-11-11).** `code-gate-parts.test.ts` selects `test/reads.test.ts` too, so it covers a runtime read. The case "takes every certified file, a runtime read included" of `code-gate-parts-cases.test.ts` restated it and is gone: 353 tests before, 352 after (`vitest list` over `test/cli/code-gate` and `test/code/gate`); every other name is unchanged.
- **`--test=` in `code-gate-parts.test.ts`.** A list that starts with a bare `"--test"` reads as node's own `--test` to `test/version-sensitive.test.ts` (spec 010 D4), which then wants the file listed. The case passes `--test=test/reads.test.ts`, which the gate parses the same.
- **`ADAPTERS` exported (coordinator, 2026-11-11).** `src/cli/code-gate.ts` exports it; `collect-fixture.ts` re-exports it, so `test/runners/vitest/ci-record-coverage.test.ts` imports it as before. Every collect test's closure now holds `src/cli/code-gate.ts`.
- **Report fields the text does not read.** The text builders dropped `versions`, `createdAt`, `coverageExclude` and `complexityInclude` values that differed per file; `formatGateReport` reads only the base's ref, commit and thresholds, the budget's seconds, and the lists.
- **"One `ci record` run fewer".** Not reached: the parts tests run `ci record` as often as before (`code-gate-parts` once, `-cases` once, `-environment` three times). Removing one would mean moving the case of `code-gate-parts.test.ts` onto the cases file's fixture, which renames its describe.

## Left over

- `test/code/gate/exceptions.test.ts` is 308 lines; no row names it.
- `ownHomeAndTmp` (`code-gate-fixture.ts`) and `ownTmpdir` (`collect-fixture.ts`) overlap; the keep kit swaps `TMPDIR` per call, which neither does. The finding does not name them.
- `collect-budget.test.ts` has its own `collect(durations)`; `scope.test.ts` has a `scopeOf(policy)` over a policy object. Both differ from the shared ones.
