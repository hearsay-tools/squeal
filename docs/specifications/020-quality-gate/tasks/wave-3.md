# Spec 020 wave 3: daemon parity (020-07)

Design: spec D11, from `research/daemon-parity.md`. Approved by the human 2026-11-10 ("All of them, go").
- 020-07a starts after 020-09 lands on the parent branch, because both edit `gate/evaluate.ts` and `gate/types.ts`.
- 020-07b and 020-07c start after 020-07a, in parallel.

Every row:
- Read the spec whole and the survey first.
- Do not run `pnpm run build` or a full suite.
- Before you finish, read `squeal status --wait 60000 <changed paths>`, and run `pnpm run lint` and `pnpm run typecheck`. Failures in the four bundle-drift packaging tests are expected.

## 020-07a one rule for the daemon and the gate; no loader reads unknown

Use /worker. Shape: slice.

Outcome: D11 items 1 to 5.

Starting seam: the survey's `probes/daemon-parity/parity.mts` table as golden tests, run through both `evaluate()` and the daemon's coverage step. They fail where the rules differ today. Then extract `judgeFunction` into `src/core/code/gate/rule.ts`. The 020-01 golden tests stay unchanged.

Also test:
- a file judged untested at 0 loaders reads unknown after the step, with no transition, and leaves `--told`;
- a `.py` file with no Python runner reads `not measured` (#165);
- a gate run with `it.skip` in a loader reads `incomplete (skipped)`, not a violation.

Owns:
- `src/core/code/gate/{rule,evaluate,types,collect,report}.ts`;
- `src/core/code/crap/{file,judge,walk,loaders}.ts`;
- `src/cli/code-coverage.ts`, `src/core/delivery/code-coverage.ts`;
- their tests.

Leave alone: `src/core/code/pass/`, the scheduler.

Done when:
- both paths give the table's agreed results;
- `QUALITY_POLICY_VERSION` is one higher than on your baseline;
- the drop of states judged with no loader is tested.

## 020-07b test files counted in the daemon

Use /worker. Shape: slice.

Outcome: D11 item 6.

Starting seam: a failing test in which a test callback over CC 20 is a first-seen fail on edit. Then:
- `pass/included.ts` stops leaving out `testFiles`;
- `crap/loaders.ts` keeps a test file as its own loader;
- remove the 015-52 listing hold: `pass/listed.ts`, and `holdUnlisted`, `waitingPaths` and `onListed` in `plan.ts`, the scheduler, `runner-work.ts` and `daemon.ts`;
- add one `include` recount at upgrade.

Owns: `src/core/code/pass/*`, `src/core/code/crap/loaders.ts` (own loader only), the `onListed` callers in `src/core/scheduler/` and `src/core/daemon/daemon.ts`, their tests.

Leave alone: `src/core/code/gate/`, `crap/{file,judge,walk}.ts`.

Done when:
- a new test file is counted before its listing;
- a test callback is judged from its own file's record;
- an upgrade gives one recount summary and no delivery per function.

## 020-07c `--base` reads the stores

Use /worker. Shape: slice.

Outcome: D11 item 7.

Starting seam:
- **First failing test:** for one fixture file, the gate's key equals the daemon's key.
- **Then:** `src/core/code/gate/stored.ts` computes keys with no store write; `core/ci/export.ts`'s `openKeys`/`keyFiles` is the lead. Measure whether a read-only overlay over the real store is needed to keep observed reads in the key, and say which you chose.

Owns: `src/core/code/gate/stored.ts` (new), `src/cli/code-gate.ts`, `gate/report.ts` (`fromStore` only), their tests.

Leave alone: `gate/rule.ts`, `evaluate.ts`, `src/core/scheduler/`.

Done when:
- a file with a record and results at its key is not run;
- a file with results and no record runs;
- a stored failure makes the verdict `incomplete`;
- the store's bytes and mtime are unchanged after the command.

## 020-10a collect and map child-process coverage

Use /worker. Shape: slice.

Outcome: spec D12 items 1 to 5. The default-off behaviour does not change by a byte.

Read: spec D12; `research/child-coverage.md` and its probes; spec 015 D8.

Starting seam: the survey's row split. Its first failing tests:
- one children directory per test file, in forks and in threads;
- a project's own `NODE_V8_COVERAGE` is kept;
- the recorder's `children/` directory exists and the own file is still found;
- a golden merge of an own record and a child record;
- a cut child file is dropped alone, and so is a file over 64 MiB;
- the coverage marker differs with the key on and off.

Fix `test/runners/vitest/own-provider.test.ts`, which the survey found reads the variable.

Owns:
- the files in the survey's 020-10a row: `core/types/policy.ts` and `core/daemon/policy-code.ts` for the key only;
- `core/code/coverage/{provider.mjs,types.ts,mapper.ts,map-worker.ts,record.ts,drops.ts}`;
- `runners/vitest/{coverage,environment}.ts`;
- `runners/node-test/runtime/recorder.cjs`, `runners/node-test/run/{coverage,run}.ts`, `runners/node-test/{coverage,adapter-environment}.ts`;
- their tests.

Leave alone: `src/core/code/gate/`, `src/core/code/crap/`, the `ci record` files (`runners/vitest/ci-record.ts`, `ci-runtime/`, `core/ci/`; spec 018 is changing them).

Done when:
- every test above passes;
- the existing coverage and adapter tests pass unchanged with the key off;
- the marker change is in the validity cases if `test/keys/key-format.test.ts` asks for one.
