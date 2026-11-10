# survey-020-15: server-only selection and pre-setup visibility (#172)

Recommendation: leave the test files of `manual` check groups (read at the base) out of the gate's automatic selection, add `--group <name>` to put a group back, print the selection to stderr before the first run, and report the scope. Do not add a replace-selection flag.

Examined on 2026-11-10: Squeal source at `919f108ca` (0.1.427), Vitest 5.0.3 (`node_modules/vitest/dist/chunks/index.DpLw24bj.js`), Node 24.22.1, cezar (hearsay-tools/cezarion) at `e831c2c67` and `154cba614`, read only through `git show`. Host: 24 vCPUs. The one-minute load stayed between 35 and 55 for the whole survey, so no live gate run took place (Q5).

## The cause of #172

**verified by experiment (static walk, an approximation of Vite's graph):** in both incidents every one of cezar's 100 browser specs imports the changed server code through a test helper. `packages/web/e2e/workspace-registry.ts` imports `packages/cezar/src/home/home.ts` and `home/store.ts`. Specs import it directly or through `agent-browser.ts`. The browser project's global setup `e2e/environment.ts` imports it too.

- Incident 2 (`154cba614`, which changes `home/store.ts` and `home/entry-authorization.ts`): all 100 spec closures hold both paths (`probes/selection/incident2.out.json`).
- Incident 1 (base `819ec5af0`, head `e831c2c67`): all 100 hold `workspace/backups.ts`, which `store.ts` imports (`incident1.out.json`).

So the browser files are true import-graph loaders under D3.1 and D5.2. Broad `inputs` (the 015 triage's lead) are not needed to select them. The `[test-env] building …` lines come from the browser project's own `globalSetup` (`environment.ts` → `acquireTestEnvLease`, **read in source code**, cezar `e831c2c67`). It runs because a browser spec was selected.

| # | Question | Answer | Tag |
| --- | --- | --- | --- |
| 1 | Selection contract | Scope by 019 groups. `manual` groups are out by default. `--group` adds a group. `--test` stays additive. No `--project` and no replace mode. | inferred, from source and specs |
| 2 | How the report states scope | A `scope` object, per-function `loaders.leftOut`, a gap `left-out`, and a verdict line that names what did not run | inferred |
| 3 | Selection printed before setup | Yes: after `select()` and before the first `adapter.run`. That is before any `globalSetup` or `setupFiles`. It is after config evaluation and after browser-mode `standalone()` | read in source code |
| 4 | Server-only without browser setup | Yes when the setup is a non-root project's `globalSetup` (cezar's case). No for a root `globalSetup`, config-time code or Vitest browser mode. The line before the run names a root setup | read in source code |
| 5 | Reproduce in a scratch copy | Not determined, because the load stayed above 24. The fixture is ready (`probes/selection/fixture.mjs`). The static walk reproduces the selection cause | verified by experiment (static) / not determined (live) |

## Q1. The selection contract

**read in source code:** `collect.ts:263` `select()` unions `testFiles()` matches of the changed paths and `--test`, plus `affected.direct` and `affected.transitive`. `affected.ts:60–74` adds every file of a project when a changed path is in its config, `setupFiles` or `globalSetup` closure (`project.ts:63`). `collect.ts:158` reads the runner policy from the working tree (`loadPolicy(root)`), not from the base. The gate never reads `policy.checks`.

**read in official docs** (repository spec 019 D1): a `manual` group runs "never on its own". Only `squeal run <group>` or `run --all` runs it, and Stop never requires it (D4). Groups already have a pure resolver: `resolveGroups` and `groupOf` in `src/core/daemon/check-groups.ts:104,150`, and `collect.ts` already imports `core/daemon`.

Options weighed:

- **`--project <name>`.** It adds a second scope vocabulary next to groups, and it cannot say "manual". A project with no `checks` gains nothing from it. Rejected.
- **Replace mode (`--only-tests`).** Every automatic loader it drops is still a loader. Under D5 a dropped loader rules out a violation, and its unknown test outcome rules out a pass. So a replace run can only be honest by doing what scoping does, and it hides the omission behind the user's choice. Rejected.
- **Groups, recommended.** Scope = every test file whose owning group, resolved from `checks` **at the merge base**, is not at `manual`. `--group <name>...` adds those groups, `manual` ones included, as `squeal run <group>` does. An unknown name or a lint group is a usage error (exit 2). `--test` stays additive (D3.1) and runs a named file whatever its group. A repository with no `checks` has only `tests` and `slow`, never `manual` (`defaultGroups`), so it behaves as today.

Reading `checks` at the base matters. Otherwise a branch could move a group to `manual` and escape its own gate, which D6 forbids for every other key.

## Q2. Stating the scope

**read in official docs:** 020 D5 allows a pass from a subset of loaders only when the left-out ones **completed**, because a file that did not run may hold a failing test. 015 D9 says an upper bound from the records in hand can prove a pass but "a missing record never proves a failure".

**inferred:** a left-out manual loader is the same uncertainty, which the project accepted when it marked the group `manual`. The coverage side is sound: CRAP from fewer loaders is an upper bound. The test-outcome side is the project's declared exemption, as Stop already treats it. Proposed rules:

1. A left-out file is never run. Its `closure()` is still read; no setup runs for that. So each function knows which left-out files load its source.
2. A function whose in-scope evidence is complete and passes reads `pass`, even with left-out manual loaders. Its row lists them in `loaders.leftOut`.
3. A CRAP over the limit with a left-out loader reads `incomplete` with the new gap `left-out`, because more coverage could lower it. A CC over the limit stays a `violation`.
4. A changed test file in a left-out group is not run. Its functions read `left-out`, or `skipped` when `coverage.exclude` matches them (D6 already names browser specs as an example).
5. The report gains `scope`: the groups in scope, those added by `--group`, and per left-out group its moment, its file count, the count that loads changed code, and the command that adds it. The text verdict line ends with, for example: `browser (manual) did not run: 100 test files load changed code; add --group browser to run them`. It never says "all tests".
6. `QUALITY_POLICY_VERSION` rises to 4, as D11.3 did for the gap `skipped`. The format stays `squeal-code-gate/1`, because fields are added and none change.

## Q3 and Q4. Visibility before setup, and what setup a selection can avoid

**read in source code** (Vitest 5.0.3, as installed):

- `initializeGlobalSetup` (line 21282) runs `_initializeGlobalSetup` for the projects of the selected specs **and the root project**. It is called from `runTestSpecifications` (21126) and `collectTests` (21251), not when Squeal opens the adapter.
- `standalone()` (line 21034; Squeal calls it at `adapter.ts:259`) calls each project's `_standalone()`. For a project with Vitest **browser mode** enabled, that starts the browser provider and opens a page. This happens at open, before selection.
- Config files and their top-level code run at `createVitest`, for every project that the `project` filter keeps.

So the gate can print its selection after `select()` (`collect.ts:162`) and before the first `adapter.run` (line 180). That is before every `globalSetup` and `setupFiles`. It is not before config evaluation or browser-mode start. A server-only selection avoids a non-root project's `globalSetup`, which is cezar's case. It cannot avoid a root `globalSetup`. The pre-run line names it: `global setup runs for: the root project (any selection), e2e`. Avoiding browser-mode start needs the out-of-scope project left out at `createVitest`, as `excludeProjects` does (`exclude.ts:27`). Its loaders are then unknown. Spec 020 lists browser mode as not researched, so this is an open question, not a row.

**verified by experiment** (`probes/selection/stdout-redirect.out.txt`): with `process.stdout.write` replaced by a write to stderr, in-process `console.log` and a piped child's relayed output went to stderr. A child with `stdio: "inherit"` still wrote to stdout. **read in source code:** cezar's `environment.ts:71` writes the setup's `TEST_ENV_*` lines with in-process `console.log`, which is the #172 comment's polluted `--json`. Proposal: with `--json`, the CLI sends in-process stdout writes to stderr while it collects. The help text says a child that inherits stdout can still write there.

## Q5. Reproduction

**not determined, because** the one-minute load was 49.6 at 21:54Z, 55.4 at 21:58Z, 50.5 at 22:00Z and 35.5 at 22:01Z, all above the brief's limit of 24. No gate, Vitest or daemon run took place. `probes/selection/fixture.mjs` builds three cases for a later run: `helper` (cezar's shape), `setup-only` (only the global setup imports the source) and `root-setup`. Expected today, **inferred** from source: `helper` selects and runs the browser file, and the marker shows `browser-setup`; `setup-only` selects it through the environment, so it runs and is not a loader; `root-setup` writes `root-setup` for any selection.

Static walk commands, from `probes/selection/` (each run is about 1 s on one core):

```sh
node static-closure.mjs ~/projects/cezar e831c2c67 "$(git -C ~/projects/cezar diff --name-only 819ec5af0 e831c2c67 -- 'packages/**/*.ts' | paste -sd,)" <setups> <100 specs>
node static-closure.mjs ~/projects/cezar 154cba614 "$(git -C ~/projects/cezar diff --name-only 154cba614^ 154cba614 -- 'packages/**/*.ts' | paste -sd,)" <setups> <100 specs>
```

## Design proposal: spec 020 D14, "Scope by check group (row 020-15)"

1. **Scope.** The gate runs a selected test file only when its group, resolved from `checks` at the merge base (019 D1), is not `manual`. The base policy gains the resolved groups. `--group <name>...` adds groups. `--test` files always run.
2. **Left out.** A selected file outside the scope does not run. Its closure is read. Evaluation follows Q2 rules 2 to 4. The gap is `left-out`.
3. **Report.** `scope` and `loaders.leftOut` as in Q2.5, plus a text line. `QUALITY_POLICY_VERSION` 4.
4. **Before the run.** After selection and before the first run, stderr gets one line per runner with its file count by group, one line per left-out group, and the projects whose global setup will run, the root's when it has one.
5. **JSON stdout.** With `--json`, in-process stdout writes go to stderr during collection.
6. **Not chosen:** `--project`, a replace mode, and skipping browser-mode projects at open (open question 2).

Rows, in order:

- **020-15a, scope (first).** Files: `src/core/code/gate/scope.ts` (new, pure), `collect.ts` (`select` applies the scope and reads left-out closures), `policy.ts` (`checks` at the base), `types.ts`, `rule.ts` and `evaluate.ts` (gap `left-out`), `report.ts` (`scope`), `src/cli/code-gate-args.ts` (`--group`, usage errors), help text. Tests: `test/code/gate/scope.test.ts` (resolution, `--group`, unknown and lint names), evaluator goldens (a pass with a left-out loader, CRAP over with one, CC over with one, a changed left-out test file, the `coverage.exclude` skip), a collect fixture (helper shape: the browser file is not run, its marker is empty, `leftOut` lists it, `--group browser` runs it), and a CLI case where a branch marks a group `manual` at the head and it still runs.
- **020-15b, visibility (after 15a).** Files: `collect.ts` (a `selected(summary)` callback before the first run), `src/cli/code-gate.ts` (the stderr lines, the stdout redirect with `--json`), `code-gate-text.ts`. Tests: a fixture whose global setup writes to stdout, where `--json` stdout parses whole; the selection line comes before the setup marker on stderr; a root-setup fixture names the root.

## Open questions

1. For the human: should leaving out `manual` groups be the default, or should it apply only with a flag such as `--group` naming the groups to run? The default fixes cezar without a cezar change. But it stops the gate running browser tests that it runs today.
2. Vitest browser-mode projects start a browser at adapter open. Should an out-of-scope whole-project group be left out at `createVitest`, so that its loaders are unknown?
3. Should a CRAP over the limit with only a left-out loader read `violation` rather than `incomplete`? cezar's browser specs drive a separate server process, so they likely add no in-process coverage. This is **inferred**, not measured.
4. The cost saving in incident 2 (943 selected; 100 browser files run one at a time) needs a live run once the load allows.

## Sources

- Issue #172 and its 2026-11-10 comment, fetched with `gh issue view 172 --repo hearsay-tools/squeal`.
- `../../015-coverage-complexity/research/issue-172.md` and its probe.
- Spec 020 D1, D3, D5, D6, D7, D11, D12, D13; spec 019 D1, D4, D6; spec 015 D9 (this repository at `919f108ca`).
- Squeal source at `919f108ca`: `src/core/code/gate/collect.ts`, `evaluate.ts`, `policy.ts`, `types.ts`; `src/cli/code-gate.ts`, `code-gate-args.ts`; `src/runners/vitest/adapter.ts`, `affected.ts`, `project.ts`, `run.ts`, `exclude.ts`; `src/core/daemon/check-groups.ts`.
- Vitest 5.0.3 installed source `node_modules/vitest/dist/chunks/index.DpLw24bj.js`: lines 9504–9506, 12180–12188, 12228, 21126, 21251, 21282–21286, 21034 (`standalone`) and 12341 (`_standalone`).
- cezar (local clone `~/projects/cezar`, read through `git show`/`git grep`, nothing written): `squeal.config.json` (`checks` `browser` at `manual`), `vitest.config.ts`, `packages/web/e2e/vitest.config.ts`, `e2e/environment.ts`, `e2e/workspace-registry.ts`, `.ai/scripts/test-env-lease.mjs`.
- Probes: `probes/selection/` (README there).
