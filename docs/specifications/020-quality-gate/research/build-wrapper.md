# Helpers behind a build wrapper (survey-020-16, #174)

Researcher 82831d89, 2026-11-10, at Squeal `919f108ca` (after 0.1.427). Brief: `tasks/wave-4.md`, "survey-020-16". Start: `issue-174.md`. Read-only on the product. Probes: `probes/build-wrapper/` (throwaway; the README lists each script). Versions: Node 24.22.1 (host), Node docs `latest-v24.x`, cezar at the issue's head `c817e1302` and base `a015077ac` (read with `git show` in `~/projects/cezar`, nothing written there).

**No probe ran.** The host has 24 vCPUs. The one-minute load was 35 to 63 from 21:55Z to the end of the survey window, always above the brief's limit of 24 (samples: 49.18, 53.33, 50.49, 42.39, 35.48, 39.72, 36.04, 57.70). A waiter (`probes/build-wrapper/README.md`) was set to start the probes when the load reached 24; it never did. Every "experiment" below is a probe written and not run. Its expected result is marked `inferred`.

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Can the gate collect coverage through the project's wrapper with Squeal's provider? | Not through 020-08a's hook: that hook acts only in a Vitest CLI process. For node:test, the parts exist to inject the recorder, the reporter and `NODE_V8_COVERAGE` through `NODE_OPTIONS`, but the result loses fidelity. cezar's wrapper does not need it: it is "build when stale, then `node --test` with the same flags as cezar's `test:unit` entry". Recommended: a `nodeTest` entry with a `prepare` command that the gate runs first, then Squeal's own node:test run. | read in source code (Squeal, cezar); read in official docs (Node 24 `NODE_OPTIONS`); fidelity effects inferred, probe not run |
| 2 | How is coverage attributed to the changed test functions and helpers? | With `prepare`: as for any node:test file. One process per test file, the recorder names its pid, and the record holds the test file's own functions (`verifyBinary`) and the sources it imports in process. Code that only the packed binaries run is in bundled children and reads `unread` (D12.7). The wrapper's exit code is never read. | read in source code |
| 3 | What does the gate say, before collecting, when a helper's only loader is a wrapper it cannot drive? | It cannot know about a wrapper that is not declared. After selection and before the first run, it can name each changed path that no runner lists and no listed test file imports. It says that its changed functions will read `incomplete` (`no-loader`), and gives the two ways out: give the files to a runner, or put them in `coverage.exclude` at the base. | read in source code; wording is design |
| 4 | How is a wrapper declared in `squeal.config.json`, read at the base? | `nodeTest[].prepare: { command: string[], timeoutSeconds? }`. The gate runs the base's `prepare` of the entry with the same name. When a head entry has a `prepare` that the base lacks, its files do not run and read `not-prepared`. Until the daemon supports it, the daemon does not open an entry that has `prepare`. | design |
| 5 | Cost on cezar's `binary-names.test.ts` | Not determined, because the load stayed above 24. Reported (not reproduced): wrapper runs of 68.5 s and 64.1 s, and a gate run of 134.7 s. Expected: the wrapper's time plus about +18% CPU for node:test coverage, from 015's measurement. | not determined; inferred |

## Q1. Driving the wrapper

**What the wrapper does** (read in source code, cezar `c817e1302`; `scripts/test-package.mjs` is the same on cezar's `origin/main` `1ed7d04fe`). `npm run test:package -- <file>` runs `node scripts/test-package.mjs <file>`. The script:
1. checks that each argument is a `.test.ts` file under `packages/cezar/test/e2e/`;
2. hashes the build inputs and the `VITE_*`, `NODE_ENV` and `CEZ_API_PORT` values against `node_modules/.cache/cezar-test-package/stamp.json`, and runs `npm run build` when they differ (`needsBuild`);
3. runs `node --import ../../scripts/test-home-env.mjs --import tsx --test <files>` in `packages/cezar`.

cezar's `squeal.config.json` at `c817e1302` has a `nodeTest` entry `test:unit` with exactly that `cwd` and `argv`, and `include: ["test/unit/*.test.ts"]`. No entry lists `test/e2e/*.test.ts`. That is why `verifyBinary` read `no-loader`: the gate selected nothing for it (D3.1), and `--test` on that file is a usage error (`collect.ts` `select`). The gate behaved as D5 says (`issue-174.md` reached the same reading).

**020-08a's hook does not apply** (read in source code). `vitest-ci.cjs` acts only in a Vitest CLI process and wraps `Vitest.prototype.start` (its lines 1 to 10 and 178 to 180). On a node:test command, `ci record` writes "no Vitest run in this command: nothing recorded" (`ci-record.ts` `finish`). D13.5 already says `ci record` records Vitest only.

**A node:test wrapper could be driven through `NODE_OPTIONS`** (mechanism read in docs and source; effects inferred). Node 24 allows `--require`, `--test-reporter` and `--test-reporter-destination` in `NODE_OPTIONS`. Options there come before the command line's, and a flag given more than once is concatenated (Node docs, `NODE_OPTIONS`). `NODE_V8_COVERAGE` propagates to subprocesses (Node docs, `NODE_V8_COVERAGE`). Squeal's recorder already finds the test file's own process by `NODE_TEST_CONTEXT` and names its pid in the directory (`recorder.cjs`, its coverage block; `run/coverage.ts` `ownPayload`). So `SQUEAL_NODE_TEST_COVERAGE`, `NODE_V8_COVERAGE` and a `NODE_OPTIONS` with the recorder and reporter, set on `npm run test:package -- <file>`, would give a payload of the right process. The costs (inferred; `probes/build-wrapper/wrapper-inject.sh` would measure them):
- Every Node process before the test file keeps `NODE_V8_COVERAGE` and writes a coverage file: npm, the wrapper, the whole build (`tsc`, Vite) and the `node --test` parent. D12.8 measured +26% CPU per child process under coverage. Here that is paid on the build, which the gate does not measure.
- When the command line gives no `--test-reporter`, a reporter in `NODE_OPTIONS` replaces the default `spec`. The wrapper's own output then changes (inferred from "Options there come before ...", not shown in the docs).
- A nested `node --test` inside a test inherits the reporter destination and writes into the same file.
- Squeal cannot check that the wrapper ran the file it was given, with the flags it was given. Only the recorder sees the main script.
- 011 states: "It never runs arbitrary commands." A wrapper is an arbitrary command. `ci record` and `hold` run a command the user typed. A gate that runs a command from config is new, and it is a product decision either way.

**Verdict.** Driving an opaque node:test wrapper is possible but loses fidelity, and it duplicates the node:test adapter. cezar's wrapper splits cleanly into a build step and a standard node:test run. A `prepare` command on a `nodeTest` entry covers it. Squeal then runs the files with its own adapter: its event stream, skips, closure, records, budget and keys. A wrapper that cannot be split this way (for example, one that starts a server for the length of the test) is out of scope. Its files go in `coverage.exclude` (D6), which keeps their CC check.

## Q2. Attribution

With `prepare` (read in source code): the gate treats the entry like `test:unit`. `run.ts` starts `<node> --enable-source-maps --require <recorder> <argv> --test --test-reporter=<reporter> --test-reporter-destination=<log>/events-<i>.ndjson`, one file per process. `coveragePayloads` keeps the main-thread file of the pid the recorder named. The record holds:
- the test file's own functions: `verifyBinary` and the test callback. The test file should be among each source's loaders, because its record holds its own path (inferred from `evaluate.ts` `standing`; `gate-today.sh` checks it);
- the sources it imports in process: `home/home.ts`, `home/identity.ts`, `core/shell-env.ts`, `self-update/launcher.ts`;
- not the packed CLI. The test runs it as `node <consumer>/node_modules/@wjarka/cezarion/dist/...`, a built bundle in a child process. Without `coverage.children` it gives nothing. With it, D12.7 reads bundled children as `unread`. Functions that only the binaries run keep their own unit tests' evidence. A missing record for them stays a gap, never a pass.

Selection needs no new rule. The node:test graph is static (`graph/index.ts`, `parse.ts`), so `affected()` selects `binary-names.test.ts` before any run, both as a changed test file and as an importer of a changed `src` file.

**The wrapper's pass is not evidence.** Outcomes come from Squeal's event stream, and coverage from Squeal's record. A `prepare` that fails or times out ends with no run of that entry's files. They read `incomplete` with a new gap `not-prepared`, never `pass`. No assertion needs to change.

## Q3. Saying it before collecting

Today the gate says nothing until the report, and the report's gap text is "no test loads its file" (`code-gate-text.ts`). Before the runs, `collectEvidence` already knows each runner's `testFiles()` and `affected()` (`collect.ts` `select`). Proposal:
- After `select` and before the first `run`, for each changed path with at least one changed function, it checks whether any runner lists it or any listed test file imports it. This needs one `affected([path])` per path, because `select` asks for all paths at once (inferred cost: static graph lookups).
- For each path that fails the check, one stderr line before any test runs, for example: `squeal code: no test Squeal runs loads packages/cezar/test/e2e/binary-names.test.ts: no Vitest or node:test project lists it, and no listed test file imports it. Its 1 changed function will read incomplete (no-loader). To measure it, give it to a runner (a nodeTest entry, with prepare when it needs a build); to skip its coverage, name it in coverage.exclude at the base.`
- The final text's `no-loader` words become "no test Squeal runs loads its file", as D11.5 says for the daemon.
- The JSON is unchanged. Each function's gap and empty `loaders.expected` already say it.

"Before any setup" is 020-15's question 3. Vitest's adapter opens before selection is known. If 020-15 adds a selection print, 020-16a uses it and does not build a second one.

## Q4. The declaration

```json
"nodeTest": [
  { "name": "test:package", "cwd": "packages/cezar",
    "argv": ["--import", "../../scripts/test-home-env.mjs", "--import", "tsx"],
    "include": ["test/e2e/*.test.ts"],
    "prepare": { "command": ["node", "../../scripts/test-package.mjs", "--build-only"], "timeoutSeconds": 600 } }
]
```

- `command`: an argv with no shell, as `squeal hold` runs one. It runs in the entry's `cwd`, with the entry's `env` merged, at most once per gate run, before the entry's first selected file. Its output is kept and shown (the tail) only on failure. The gate's stdout holds the report alone (D1).
- Its time counts in D3.4's one budget, and `timeoutSeconds` caps it too. The report's `runs[]` gains `prepare: { command, exit, durationMs }`.
- **At the base** (the brief; D6's reason: a branch cannot loosen its own gate). The gate runs the `prepare` of the base's entry with the same name. When a head entry has a `prepare` the base lacks, its files do not run and read `not-prepared`, with a note to land the declaration first. Running them without the build could pass against a stale `dist`. The other runner keys stay read at the head, as D1 says today. Tradeoff: the PR that adds a `prepare` cannot use it. A config-only PR has no changed functions, so landing it first costs one small PR.
- **The daemon**, until a later row: it does not open an entry that has `prepare`, and it notes once that only `squeal code --base` runs it. Otherwise the default `tests` group would run a package test on every edit with no build. With a `manual` group (019 D1), `squeal run <group>` and `run --all` would run it with no build.
- **D3.5 changes**: "Nothing is written to the project" becomes "Squeal writes nothing to the project; a declared `prepare` writes what it writes". The gate then runs a command from config. That is product-facing and goes to the human.
- **cezar needs a build-only entry**, for example `--build-only` in `test-package.mjs`, which reuses `needsBuild`. That is a cezar change. With no cezar change, `["npm", "run", "build"]` works but rebuilds on every gate run.

Not chosen: a `--prepare <command>` flag on the CLI. An agent would have to know the command, and nothing would be read at the base.

## Q5. Cost

Not determined, because the one-minute load stayed between 35 and 63, above 24. `probes/build-wrapper/cezar-cost.sh` measures, in a `/tmp` clone at `c817e1302`: the wrapper cold and warm, the gate with no entry (expected: `verifyBinary` `no-loader`, exit 3, as #174 reports), and the gate with a `test:package` entry (expected: a measured `verifyBinary`). Reported in #174 and not reproduced: wrapper 68.5 s and 64.1 s, and a gate of 134.7 s. 015's `node-test-coverage.md` measured about +18% CPU per node:test file for coverage, plus about 20 ms of mapping. The test's own comment says 85.10 s in CI and 37.75 s locally. So the gate with `prepare` should cost about the wrapper's time plus 18% of the test file's own process (inferred). It applies only when a changed path selects that file.

## Recommendation for Squeal

A new spec section, **D14. Test files behind a build step (rows 020-16a to 020-16c)**:

1. Before the runs, the gate names each changed path that no runner can load, with the ways out (Q3). Text only. The `no-loader` words follow D11.5.
2. `nodeTest[].prepare` (Q4): run once by the gate before the entry's first selected file, inside the budget, from the base's entry of the same name. On failure, a timeout or no base declaration, the entry's files read `incomplete` with the gap `not-prepared`. `QUALITY_POLICY_VERSION` rises by one, because a new gap is a new rule. D3.5 and D7 (`runs[].prepare`) are amended. The daemon does not open such an entry, and says so once.
3. Not chosen: driving an opaque wrapper through `NODE_OPTIONS` (Q1), and node:test in `ci record`. Both lose fidelity, and the second is 018's scope.

Decisions for the human: the gate runs a command declared in `squeal.config.json` (against 011's "never runs arbitrary commands"), and D3.5 changes. The coordinator decides: the gap name `not-prepared`, the head-only rule, and whether the daemon later runs `prepare` on explicit runs (020-16c).

**Row split** (order: 020-16a now, independent; 020-16b after the human's decision; 020-16c only on approval; the cezar trial is a proposal):

| Row | Files | Tests |
|---|---|---|
| 020-16a pre-run naming | `src/core/code/gate/collect.ts` (a callback with the unloaded paths after `select`), `src/cli/code-gate.ts`, `src/cli/code-gate-text.ts` | `test/cli/code-gate.test.ts`: a repository with a node:test entry for `test/unit` and a changed helper in `test/e2e/x.test.mjs`. The line is on stderr before any run (an ordering marker); it names the path and both ways out; the verdict is still exit 3; with the file under `coverage.exclude` at the base, no line appears |
| 020-16b `prepare` in the gate | `src/core/types/policy.ts`, `src/core/daemon/policy-node-test.ts` (key, problems), `src/core/code/gate/policy.ts` (base read), `collect.ts`, `types.ts` and `rule.ts` (gap), `report.ts`, `code-gate-text.ts`; the daemon's node:test adapter set-up (skip and note); README and skill policy reference | the probe fixture (`probes/build-wrapper/fixture`) as a test fixture. With `prepare` the helper is measured and passes. With a failing `prepare` its files read `not-prepared`. With a `prepare` only at the head they read `not-prepared` with the note. `prepare` time counts in the budget. No file is written by Squeal outside what `prepare` writes. The daemon lists no file of the entry |
| 020-16c daemon explicit runs (optional) | scheduler and `run <group>` | `squeal run <group>` runs `prepare` once, then the files |
| cezar trial (proposal) | cezar: `--build-only` in `test-package.mjs`; a `test:package` entry with `prepare` | `squeal code --base` on #174's commits gives a measured `verifyBinary`; time against the wrapper |

## Open questions

1. Not determined: every timing and every effect in Q1 and Q5, because the load never reached 24. Running `probes/build-wrapper/*.sh` at a load of 24 or less decides them.
2. Not determined: whether a `--test-reporter` in `NODE_OPTIONS` alone replaces the default `spec` output. The docs do not say. `wrapper-inject.sh` mode `inject` shows it.
3. For the human: may the gate run a command that `squeal.config.json` declares?
4. For 020-15's coordinator: one selection print for both surveys (Q3).

## Sources

- Squeal `919f108ca`: spec 020 (D1, D3, D5, D6, D7, D11, D12, D13) and `status.md`; spec 011 (the line "never runs arbitrary commands", `squeal hold`); spec 019 D1, D6; `research/issue-174.md`, `ci-evidence.md`, `child-coverage.md`; `../../015-coverage-complexity/research/node-test-coverage.md`; `src/core/code/gate/{collect,evaluate,types,report}.ts`; `src/cli/{code-gate,code-gate-text}.ts`; `src/runners/node-test/{coverage.ts,run/coverage.ts,run/run.ts,runtime/recorder.cjs,runtime/reporter.mjs,graph/index.ts}`; `src/runners/vitest/{ci-record.ts,ci-runtime/vitest-ci.cjs}`; `src/core/types/{policy,check-groups}.ts`.
- cezar (`~/projects/cezar`, read with `git show`): `c817e1302` `squeal.config.json`, `scripts/test-package.mjs`, `package.json`, `packages/cezar/package.json`, `packages/cezar/test/e2e/binary-names.test.ts`; `origin/main` `1ed7d04fe` for the same wrapper.
- Node.js docs, v24: https://nodejs.org/docs/latest-v24.x/api/cli.md (`NODE_OPTIONS`, `NODE_V8_COVERAGE`, `--test-reporter`, `--test-reporter-destination`); https://nodejs.org/docs/latest-v24.x/api/test.md ("Test reporters").
- Issue: https://github.com/hearsay-tools/squeal/issues/174 (through `issue-174.md`).
- Probes, not run: `probes/build-wrapper/{wrapper-inject.sh,gate-today.sh,cezar-cost.sh,whoami.cjs,fixture/}`.
