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

## 020-07a I: integrate 020-07a and 020-10a onto 0.1.424

Use /worker. Shape: finish.

Outcome: one branch with the 0.1.424 candidate, then 020-07a (local branch `hold/020-07a`, commits `c9a834af2^..c1606000e`), then 020-10a (`hold/020-10a`, commits from `ea397680c` up to `af09043a1`), with every check green. The later wave 3 rows start from it.

The known conflict is in `src/core/code/gate/evaluate.ts`. 020-09 R1 (review 0.1.424 B1, `reviews/0.1.424.md`) added a completeness gap beside D5's subset judgement, so an exception accepts only complete head evidence. 020-07a moved the per-function decision into `judgeFunction` (`gate/rule.ts`). Keep both intents: `judgeFunction`'s output carries the completeness gap (the first unmet D5 condition, `null` when complete) apart from its subset judgement, and `exceptions.ts` keeps requiring it. The tests in `test/code/gate/exceptions-complete.test.ts` and `test/code/gate/parity.test.ts` must both pass unchanged.

Owns: conflict resolution in the files the two holds touch; `gate/rule.ts` and `gate/exceptions.ts` for the carried gap.

Leave alone: new behaviour. This row is an integration.

Done when:
- `git cherry-pick -x` of both holds is complete, with conflicts resolved and the resolution in its own commit;
- lint and typecheck are clean;
- `squeal status --wait 60000` on the changed paths is current, apart from bundle drift.

## 020-10b using child-process coverage in the gate and the daemon (after 020-07b and 020-07c)

Use /worker. Shape: slice.

Outcome: spec D12 items 6 and 7, on top of 020-10a's collection, 020-07a's rule, 020-07b's own-file loaders and 020-07c's stored evidence.

Read: spec D12; `research/child-coverage.md` (row split 020-10b); `tasks/020-10a/notes.md` (the seam map).

Starting seam: a gate end-to-end test. A changed script that only a spawned child runs, selected with `--test`, passes with `coverage.children: true` at the base. With the key off, the same script reads a violation or `incomplete`. Then:
- the gate reads `coverage.children` at the base (`gate/policy.ts`) and passes it to the runners (`gate/collect.ts`);
- in the daemon, with the key on, a test file whose observed set holds a path is also a loader of that path (`crap/loaders.ts`). Prove it with a daemon test before relying on it; the survey only read it.
- the texts say children are measured, as a lower bound (`cli/code-coverage.ts`, `delivery/code-coverage.ts`);
- the report adds `coverage.children` to `base` and child counts per run;
- README and `commands.md` document the key.

Owns: `src/core/code/gate/{collect,policy,report,types}.ts` (additive), `src/core/code/crap/loaders.ts`, `src/cli/code-coverage.ts`, `src/core/delivery/code-coverage.ts`, README and `commands.md` with its copies, their tests.

Leave alone: `src/core/code/coverage/` (020-10a), `src/runners/`, `gate/rule.ts`.

Done when:
- the gate test passes with the key on and off as described;
- a daemon test shows a function only a child runs reads covered with the key on;
- the default-off output is unchanged.

## 020-08a coverage records in `ci record` parts

Use /worker. Shape: slice. Agreed with spec 018's coordinator (3739e45a) on 2026-11-10. It gets the candidate diff before review.

Outcome: spec D13 items 1 and 3 to 6. `ci record` adds Squeal's provider and writes records into `squeal-ci-part/4`, and `ci export` stays byte-compatible for exports.

Read:
- spec D13;
- `research/ci-evidence.md`: its row split and probes;
- spec 018 D8 to D16 and its `status.md` lines for 018-23 and 018-26.

Starting seam: the survey's first test. On the real Vitest 4.1 fixture (`test/fixtures/vitest/vitest-4.1`) and on Vitest 5, the records in a part equal the gate collector's records for the same fixture. Then:
- `ci-runtime/coverage.cjs` (new): the override, the allow rules, stamps, batches, the worker map, the yield to a project's own `--coverage`, drops;
- `vitest-ci.cjs` wires it in;
- `vitest/ci-runs.ts` and `cli/ci.ts` put the records into the part;
- `core/ci/parts.ts`: format 4, with `readPart` accepting 3 and 4;
- `ci export` leaves out a `node:inspector` closure when the shard ran with the provider;
- `main.ts` help: say when the provider is added and when it is not.

Owns: those files, `harness/build.ts` only if the worker path needs it, and their tests.

Leave alone:
- 018-23's read-time evidence rules in `vitest-ci.cjs`, `descriptors.cjs` and `children.cjs`: do not change them;
- `src/core/code/gate/`;
- `src/core/code/coverage/`, which 020-10a changed on another branch. Import from it; don't edit it.

Done when:
- the records equal the collector's;
- `--coverage` yields, with exit code 1 kept and the project's report written;
- `isolate: false`, `-t` and `node:inspector` give no record;
- an error of the hook gives a part reason and leaves the exit code unchanged;
- `ci export` of format 3 and format 4 parts gives the same bundle;
- spec 018's text (D8 and the non-goal) is amended in your commit, quoting D13.

## 020-08b `squeal code --base --parts` (after 020-07c and 020-08a)

Use /worker. Shape: slice.

Outcome: spec D13 item 2.

Read: spec D13 and D11.7; `research/ci-evidence.md` Q3 (rule 3) and its row split; `tasks/020-07c/notes.md`. The `CollectOptions.stored` seam is the one to reuse.

Starting seam: a failing test in which a gate run from parts equals a gate run that executes the tests on one fixture, apart from where the evidence came from and the times. The parts come from `squeal ci record` (020-08a). Then:
- `src/core/code/gate/parts.ts` (new) reads `squeal-ci-part/4` parts and gives `StoredEvidence` through the same seam;
- `--parts <dir>...` in `cli/code-gate.ts`;
- the report's per-file evidence source (`from`: `run`, `store` or `parts`).

Owns: `gate/parts.ts` (new), `gate/collect.ts` (the seam only, if it needs a change), `gate/report.ts`, `cli/code-gate*.ts`, help in `cli/main.ts`, the `squeal code --base` section of `commands.md` with its copies, their tests.

Leave alone: `src/core/ci/` (020-08a), `gate/stored.ts` (020-07c).

Done when:
- each of these makes that file run: an edited input, another record version, a duplicate file in two parts, a format 3 part;
- a `fail` check reads `test-failed` without a run, and a `skip` check reads `skipped`;
- nothing is written to the parts directory.

## 020-08b R1 repair of review 0.1.427 B1: parts evidence needs the same environment

Use /worker. Shape: repair, on the wave 3 candidate branch `w3/int`.

Outcome: `squeal code --base --parts` takes a file's evidence from a part only when the part's project environment matches the current gate runner's environment. Otherwise that file runs.

Read: `reviews/0.1.427.md` B1, with its reproduction and acceptance; spec D13.2; `tasks/020-08b/notes.md`, its "Environment" decision; `core/ci/export.ts` `runDifferences` and `core/keys/environment-descriptor.ts` `describeDifferences` (the lead).

Starting seam: the review's fixture, an allow-listed `PROBE_COVER`, as a failing end-to-end test in `test/cli/code-gate-parts-cases.test.ts`. Then, in `gate/parts.ts`, before a file is taken:
- certify the part's project descriptor against the gate runner's current descriptor;
- compare allow-listed variables and the runner, config, runtime and dependency inputs the descriptors hold;
- normalize only the fields Squeal owns, as 018 D10 does;
- on a mismatch, or with no descriptor, give no evidence for that file.

Owns: `src/core/code/gate/parts.ts`, `gate/collect.ts` (the seam only, if needed), `src/cli/code-gate-stored.ts`, and their tests.

Leave alone: exports, keys and `KEY_FORMAT_VERSION`, `src/core/ci/`, `src/runners/`. Do not run `pnpm run build`.

Done when:
- the review's acceptance holds: reuse at the same environment; after the variable changes, the file runs and gives exit 1 with CRAP 42, equal to the fresh gate;
- a missing descriptor is pinned;
- every existing parts case stays green;
- lint and typecheck are clean.
