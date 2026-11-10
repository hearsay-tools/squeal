# 020-08b notes: `squeal code --base --parts`

Worker a7410057, 2026-11-10, on `cez/a7410057` from `d4ee1ad19`. Spec D13 item 2. For a reviewer and whoever continues.

## Seam map

- `gate/parts.ts`:
  - `readPartsIn(dirs)` reads every `squeal-part-*.json` in each directory. A missing directory, a directory with no part, or a part that does not read is a setup error (exit 2), as in `ci export`.
  - `unusable(part)` names why a part gives no evidence: its run did not complete; format 3; `ci record` added no provider; other provider or record versions; or its run did not observe.
  - `partsEvidence(options)` is a `StoredEvidence` and is Vitest only. A file is taken when:
    - it is in exactly one part, that part usable;
    - the part's read-time evidence certifies its inputs here (`uncertified` from `core/ci/inputs.ts`);
    - its record's sources have the blobs here and its `unread` holds no changed path.
    A file with no record is taken only when it failed.
- `gate/collect.ts`: `StoredEvidence` has an optional third argument, `closure(ref)`, the gate's own runner closure. The collector always gives it. `stored.ts` ignores it (request 757e82da).
- `cli/code-gate-stored.ts`: `collectWithStores(…, parts)` builds the parts' evidence, then `inOrder` asks the parts, then the stores for what the parts left, then the rest runs. stderr counts each source: `N of M selected test files read from the parts`.
- `cli/code-gate.ts` reads the parts before the inventory, so a bad directory exits 2 before git or Vitest starts. The argument parsing moved to `cli/code-gate-args.ts`. `--parts` takes the directories after it, as `--test` does.
- `gate/types.ts`: `TestFileEvidence.from?: "store" | "parts"` replaces `fromStore?: true`. `gate/report.ts`: `runs[].from` lists each selected file with `run`, `store` or `parts`. It is present only when one file did not run here, so the 020-01 golden reports stay byte-identical (request 757e82da).

## Decisions the spec did not settle

- **What is certified.** The runner's closure here, plus everything the part says the file read: `observed.paths`, `modules`, each listing, and each recursive listing. The written-directory bound of `observedGrowth` applies: a git-ignored path below a directory the run wrote is not an input. A recursive listing of `d` is the listing of `d` and of each directory below it that holds a tracked file (`git ls-files`), as `Listings.below` in `keys/observed.ts` gives. Link targets are not added: here and in the evidence, a path is hashed through the link.
- **A part whose run did not observe gives nothing.** Without `observed`, a file read at run time is in no closure, so an edit to it would not be seen. Mutation run on 2026-11-10: with the observed reads dropped, `code-gate-parts-cases.test.ts` "runs a file whose input changed" fails, because an edited `data/input.txt` was taken from the part.
- **`coverage.children` at the base: no part is used.** `ci record` collects no child process's coverage. Its record would only lower coverage: that can turn a pass into a false violation, but never into a false pass.
- **Record sources.** Every source in the record must have the blob here, not only the changed paths. This is cheap (each file is hashed once per command), and it also covers sources outside the closure.
- **Failed files.** A failed file with no record is taken, as Q3.3 says. With no failed check, its failure is named `FILE_ERROR`, as a run names it.
- **Environment.** Superseded by R1 below: review 0.1.427 B1 proved a false pass from an allow-listed variable, and D13.2 was amended.

## Measured

- `test/cli/code-gate-parts.test.ts`, on 020-08a's math fixture: a gate from parts gives the run's report, apart from `runs[].from` and the times, and runs nothing. The parts directory keeps its sizes and mtimes.
- `test/cli/code-gate-parts-cases.test.ts` (one `ci record`, eight gates): edited inputs, another record version, a file in two parts and a format 3 part each run. A failed test reads `test-failed` and a skipped test reads `skipped`, as a run gives them. A directory with no part exits 2.
- `test/code/gate/parts.test.ts`: the rules over synthetic parts.
- `test/cli/ci-export-children.test.ts` (the coordinator's item from 020-10b's notes): with `coverage.children` on, `ci export` keys `test/math.test.ts` at a real daemon's key. Before the one-line fix in `ci-export.ts` the keys differed.

## For whoever continues

- The text report (`code-gate-text.ts`) does not name the sources; the stderr counts do.
- README line 64 says nothing of the stores or parts. README is not this row's.
- `plugins/codex/seed/skills/squeal/references/commands.md` is an older copy with no `squeal code --base` section. It was left as it is.
- `gate/collect.ts` is 337 lines and `gate/report.ts` is 310, over the 300-line guide.
- node:test files never come from parts: `ci record` records Vitest only.

## R1: the part's environment (review 0.1.427 B1)

Worker 2dca610f, 2026-11-10, on `cez/2dca610f` from `w3/int` `900449015`. Spec D13.2 as amended 2026-11-10.

### Seam map

- `gate/collect.ts`: `StoredEvidence` has an optional fourth argument, `environment()`, the runner adapter's `environment()`. The collector always gives it. `stored.ts` ignores it. `inOrder` in `cli/code-gate-stored.ts` passes it to each source.
- `gate/parts-environment.ts` (new): `environmentCheck(environment, gate)` builds the gate's `RunView` of each project and returns a check of a part's project against it. It uses `runDifferences` from `core/ci/export-check.ts`, the comparison `ci export` makes between a shard and its job.
- `gate/parts.ts`: `PartsOptions.environment` (`GateEnvironment`: `env`, `allowlist`, `recorderVersion`). `partsEvidence` checks the file's part and project before `taken`. A mismatch gives a stderr note once per part, project and reason: `<part> gives no evidence of project "<p>", so its test files run: <why>`.
- `cli/code-gate-stored.ts`: `env` is the command's (`io.env ?? process.env`), the allow-list is this worktree's policy (`readPolicy`, as `ci record` reads it), the recorder version is `RECORDER_VERSION`.

### Decisions the spec did not settle

- **The gate's descriptor.** Built as `ci record` builds a part's (`ci-runs.ts`, `partProject`): `describeEnvironment` over `coreEnvironmentInputs` (the allow-listed variables of `env`, this process's Node, platform and arch) and the gate adapter's own `RunnerEnvironment`. Not inferred from the part.
- **Adapter version.** A part is used only when its run observed (`unusable`), so its adapter version is `<adapter>+observe.<recorder>`. The gate's adapter does not observe. The gate's version is compared with this Squeal's recorder suffix added, so a part recorded under another recorder version runs: the recorder version says what the observed reads mean.
- **What is normalized.** Only what `runDifferences` already leaves out: `includeTaskLocation`, `snapshotOptions.updateSnapshot`, and D10's `watch`, `coverage`, `allowOnly` (export rejects, here allows) and `browser` (both off). The gate's Squeal coverage marker is in `coverage`, so it compares equal.
- **Not compared.** Installed dependencies and the config and setup files: a part does not hold them (`RunDescriptor`). Setup files and config files are still certified where a closure or an observed read holds them. `ci` is a hint and in no comparison.
- **No environment.** A part with no descriptor of the file's project, a project the gate's Vitest lacks, and a runner whose `environment()` rejects each give no evidence.

### Measured

- `test/cli/code-gate-parts-cases.test.ts`, "the part's environment": the review's fixture (`PROBE_COVER` allow-listed), one real `ci record` at `yes`. At `yes` the file comes from the part, exit 0, CRAP 6. At `no` it runs, exit 1, CRAP 42, and the report equals the gate's with no parts apart from sources and times. A part with `projects: []` runs the file. Red before the fix (both mismatch cases took the file), green after; also green with `CI=true` set.
- `test/code/gate/parts-environment.test.ts`: the comparison over synthetic descriptors.

### For whoever continues

- The user docs (`commands.md` "squeal code --base", the claude-code, codex-runtime and pi copies) name the environment condition, by the coordinator's agreement (request 8001bc6e). `plugins/codex/seed` was left alone.
- The `--help` text in `cli/main.ts` says "results and coverage for these bytes"; it does not name the environment.
