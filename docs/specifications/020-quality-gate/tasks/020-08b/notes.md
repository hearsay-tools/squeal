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

## R2: one owner of "may this run's evidence be reused" (review 0.1.427-r2 B1)

Worker 87ebb386, 2026-11-10, on `cez/87ebb386` from `w3/int` `b6e47b925`. The human's option A: one shared rule, one more review.

### Seam map

- `core/ci/export-check.ts`:
  - `reuseRefusal(named, here?, project?)` is the one rule. It returns the first `RunRefusal` (`key-format`, `incomplete`, `snapshot`, `environment`) or `null`. Order: the part's key format, then its end, then for each run of the project: `updateSnapshot` must be `none`, then the place must have the project, then `runDifferences` against the place's run must be empty. With `project`, a part that holds no run of it is refused (`holds no environment of project "…"`).
  - `Place` (`name`, `runner`, `runs`) is where the evidence would stand. The export's is `this job's` / `this checkout's Vitest`, the gate's `this gate's` / `the gate's Vitest`. The names only phrase the refusal texts.
  - `partsRefusal` calls `reuseRefusal(named)` per part with no place, before `no-commit`. The set refusals stay its own: `no-commit`, `commits`, `checkout`, `shards`, `duplicate`, and the shard-against-shard `environmentRefusal`.
  - `RefusalKind` is `RunRefusalKind` plus the set kinds. `snapshotRefusal` and `jobRefusal` are gone.
  - `runDifferences` stays exported: `export-check.test.ts` calls it. Its comment says: compare through `reuseRefusal`.
- `core/ci/export.ts`, `environmentRefusal`: builds the job's `Place` from `runner.environment()` and the job store's descriptors, then calls `reuseRefusal(named, here)` per part. A project with no stored descriptor is absent from the place, as before.
- `core/code/gate/parts-environment.ts`: `gatePlace` builds the gate's `Place` as R1 built its views. `Certify` takes a `NamedPart` and returns the refusal's text, cached per part and project.
- `core/code/gate/parts.ts`: `unusable` lost its `end` check; it keeps the coverage and observing checks, which are the gate's own (a coverage record is not export evidence).

### Decisions the spec did not settle

- **What "every refusal" means for the gate.** The rule holds the refusals of one run: key format, incomplete, snapshot, environment. The set refusals are not about one run, so the gate does not make them. The gate takes a file from the one part that holds it (a file in two parts is taken from neither), and it certifies every input by its content here, not by a commit. `SET_ONLY` in `test/code/gate/parts-environment.test.ts` names each with its reason.
- **Key format now applies to the gate.** Before R2 the gate did not compare the part's header `keyFormat`. A part of another key format now runs its files. The gate's synthetic parts in `test/code/gate/parts.test.ts` moved from key format 1 to `KEY_FORMAT_VERSION`.
- **Texts.** The shared texts name the part file, as the export's did. The gate's note keeps R1's shape, `<part> gives no evidence of project "…", so its test files run: <text>`, so the file is named twice. The snapshot text ends `only a run that writes no snapshot ("none", as in CI) gives evidence`, not `are exported`. The export's job texts now name the part, not "the shards". The test-checked prefixes are unchanged.
- **Order in `partsRefusal`.** The snapshot refusal now comes per part, before `no-commit`, `commits`, `checkout` and `shards`. Only a set with two problems names a different first refusal.

### Measured

- `test/cli/code-gate-parts-cases.test.ts`, "the part's snapshot update mode": the review's fixture with a real `ci record -- vitest run --update`. The part's `updateSnapshot` is `all`. Before the fix, the gate took the file (red: `ran` was `[]`). After: it runs, exit 1, CRAP 42, and the report equals the fresh gate's apart from sources and times. A second real part recorded with `CI` set (`none`) is taken: exit 1, CRAP 42, `from: parts`.
- The kit (`code-gate-parts-kit.ts`, `recordInto`) now records with `CI=true`, as a CI job does. Without it, a local run is `updateSnapshot: "new"`, which the rule refuses.
- `test/code/gate/parts-environment.test.ts`, "one rule for ci export and the gate": `REFUSED` is a `Record<RunRefusalKind, …>` with a part for each refusal. Each case is refused by the gate's check, and by `partsRefusal` too unless it needs the job's environment. A new kind fails typecheck until it has a case; a new set kind fails typecheck until `SET_ONLY` names it.

### For whoever continues

- The user docs (`commands.md`, "squeal code --base", item 1, in the claude-code, codex-runtime and pi copies) name the environment condition but not the snapshot one. Not this row's files; the coordinator was asked (request fe2330d5).
- A part recorded on a developer's machine without `CI` gives no evidence: its runs could write new snapshots.
