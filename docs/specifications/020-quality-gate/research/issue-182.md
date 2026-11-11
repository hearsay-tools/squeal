# Issue 182: environment launcher output corrupts the JSON gate report

Treat #182 as a reproduced stdout-contract defect in 0.1.430 under spec 020 D1,
D3 and D7. Keep launcher diagnostics available outside the JSON stream. The
tradeoff is diagnostic visibility versus a report that scripts can parse; the
probe proves that a successful gate can currently produce invalid JSON. This
is research for triage, not approval to implement. Existing holds stand.

## Scope and questions

Research date: 2026-11-11. Source checkout: `52191ab4335b7ec194d4176d6b19f75f3f304c80`.
The brief supplies the questions below; there is no research README for this
spec. Evidence is one synthetic test, the installed runtime and source reads.

| Question | Answer and evidence tag | Version examined |
| --- | --- | --- |
| Q1. Does the stdout contamination still reproduce? | **verified by experiment:** yes, exactly 175 bytes before the JSON; whole stdout fails `JSON.parse`. | Squeal 0.1.430, Node 24.22.1, Vitest 5.0.3 |
| Q2. Is an environment start needed in this fixture? | **verified by experiment:** the unchanged control starts no test and parses; the changed test with the launcher disabled runs and parses. | Same versions |
| Q3. Does it require a failed or timed-out gate? | **verified by experiment:** no. The contaminated run exits 0 with `verdict: pass`, one completed test file and no failures or timeout. | Same versions |
| Q4. Where is the cheap source seam? | **read in source code:** the CLI routes adapter notes to stderr, but opens and runs Vitest in process before writing JSON. The fixture's setup child inherits stdout. | Squeal 0.1.430; relevant files unchanged since 0.1.427; Vitest 5.0.3 |
| Q5. Does this prove the original browser incident in full? | **inferred:** it proves the reported output defect through a synthetic launcher. The original Cezar launcher, four browser files and exit-3 timeout were not run. | Reported 0.1.427; live probe 0.1.430 |

## Experiment and commands

**Verified by experiment, Squeal 0.1.430.** Used the installed packaged CLI at
`/home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.430/dist/cli/squeal.mjs`.
Its SHA-256 is
`deca970e85540b0df540fbd056c8e556114923762e3cb0f8782a69da87994f32`, matching the
installed `runtime.json`. The report records Squeal 0.1.430, counter 5, coverage
provider 3, coverage record 4 and quality policy 3. `node --version` returns
`v24.22.1`; `node -p 'require("./node_modules/vitest/package.json").version'`
returns `5.0.3`.

The [throwaway probe](probes/issue-182/probe.mjs) creates a temporary git repo.
Vitest `globalSetup` starts a Node launcher with `execFileSync(...,
{ stdio: 'inherit' })`. That child prints the issue's six literal lines to stdout
and a diagnostic to stderr. It does not start a browser or server. One tiny
passing test changes from `1 + 1` to `2 + 0`. The base policy excludes test
callbacks from CRAP; the report still proves the test file ran. No daemon or
large suite is involved.

Reproduce from this checkout:

```sh
node docs/specifications/020-quality-gate/research/probes/issue-182/probe.mjs \
  /home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.430/dist/cli/squeal.mjs
```

For each case the script runs this exact CLI command in the temporary repo,
capturing stdout and stderr separately:

```sh
/home/agent/.nvm/versions/node/v24.22.1/bin/node --disable-warning=ExperimentalWarning \
  /home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.430/dist/cli/squeal.mjs \
  code --base main --json --timeout 30
```

`ISSUE182_QUIET=0` in the first two cases and `1` in the third are the only
explicit environment overrides. The outer timeout is 45 s. Each invocation
rechecks one-minute load against CPU count. Both `os.cpus().length` and `nproc`
were 24. The retained run was at 03:24:58–03:25:01 Europe/Warsaw; the evidence
file records UTC timestamps.

| Case | One-minute load / CPUs | Elapsed | Exit / report verdict | Stdout / stderr bytes | Whole stdout parses |
| --- | --- | --- | --- | --- | --- |
| Unchanged tree, no tests selected | 7.53 / 24 | 614 ms | 0 / pass | 1,064 / 0 | Yes |
| Changed test, launcher prints | 8.13 / 24 | 1,030 ms | 0 / pass | 1,938 / 65 | No |
| Same changed test, launcher disabled | 8.13 / 24 | 792 ms | 0 / pass | 1,763 / 0 | Yes |

The changed case starts stdout with exactly:

```text
TEST_ENV_STATUS=running
TEST_ENV_BASE_URL=http://127.0.0.1:54227
TEST_ENV_DESCRIPTOR=.ai/qa/test-env.json
TEST_ENV_REUSED=0
BROWSER_PROVIDER=agent-browser
BROWSER_INSTALLED=1
{
  "format": "squeal-code-gate/1",
```

Its stderr is exactly:

```text
[test-env] synthetic launcher only; no server or browser started
```

`JSON.parse(stdout)` reports `Unexpected token 'T', "TEST_ENV_S"... is not valid
JSON`. Parsing only the suffix at byte 175 succeeds. The suffix reports
`selected: ["small.test.ts"]`, `completed: ["small.test.ts"]`, no unfinished
files or failures, and `budget.timedOut: false`. The quiet control has the same
selection and completion with no prefix. Full streams and exit evidence are in
[results](probes/issue-182/results/observations.json).

## Source seam and limits

**Read in source code, Squeal 0.1.430:** `src/cli/code-gate.ts:160` sends the
collector's `note` callback to `io.stderr`. Line 174 writes the serialized report
only after collection completes. `src/core/code/gate/collect.ts:180` invokes the
adapter's run. `src/runners/vitest/adapter.ts:231` calls `createVitest` in the CLI
process, with Squeal's reporter but no stdout isolation there. Vitest 5.0.3's
installed `dist/chunks/index.DpLw24bj.js:12180` calls
`await globalSetupFile.setup?.(this)`. The fixture demonstrates that the child
launched by that callback inherits the gate's stdout independently of the
adapter's note callback.

`git diff squeal--v0.1.427 squeal--v0.1.430 -- src/cli/code-gate.ts
src/core/code/gate/collect.ts src/runners/vitest/adapter.ts` is empty. The same
three paths have no diff from 0.1.430 to the source checkout. **Inferred:** this
is consistent with the issue's 0.1.427 report; it is not a live verification of
that older runtime or Cezar's launcher.

**Inferred recommendation, based on the 0.1.430 probe:** retain the D7 promise
that `--json --base` writes one JSON object, with a regression that exercises
inherited child stdout as well as ordinary diagnostics. The source seam is an
input to the coordinator's design. This report chooses no implementation.

Open questions: the original launcher's exact call site and Vitest version;
whether other config/setup/teardown writers use the same path; and which output
boundary should enforce D7 without losing diagnostics. These are not determined
by this bounded probe. The original timeout and browser suite remain untested.
No product code, spec, status, board or skill changed. No full suite was run.

Verification: `node --check` on `probes/issue-182/probe.mjs` and
`git diff --cached --check` pass. Independent assertions over all three retained
streams confirm byte counts, exit 0, version, load checks and parse outcomes.
`/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000`
with the findings and probe paths exits 3: no test closure holds either path.
At revision 5 it reports 0 known failures and 684 unknown of 1,598 test files.
That is no affected-test verdict, not a suite pass. The explicit synthetic CLI
runs above are the verification for this documentation-only research.

## Sources

- [Issue 182](https://github.com/hearsay-tools/squeal/issues/182), fetched with
  `gh issue view 182 --repo hearsay-tools/squeal --json number,title,body,comments,url`.
  It reports 0.1.427, six lines, 175 prefix bytes and exit 3; those historical
  claims were read, not independently rerun. No comments were present.
- [Spec 020](../spec.md), D1, D3 and D7; [decision log](../status.md), read at the
  source checkout above. D7: “writes one object”.
- [CLI source at 0.1.430](https://github.com/hearsay-tools/squeal/blob/squeal--v0.1.430/src/cli/code-gate.ts),
  [collector](https://github.com/hearsay-tools/squeal/blob/squeal--v0.1.430/src/core/code/gate/collect.ts),
  [Vitest adapter](https://github.com/hearsay-tools/squeal/blob/squeal--v0.1.430/src/runners/vitest/adapter.ts).
  Read from the local revision and compared across release tags.
- Installed Vitest 5.0.3 source:
  `node_modules/vitest/dist/chunks/index.DpLw24bj.js:12180`.
- [Probe instructions](probes/issue-182/README.md),
  [commands and observations](probes/issue-182/results/observations.json),
  [contaminated stdout](probes/issue-182/results/changed.stdout.txt),
  [stderr](probes/issue-182/results/changed.stderr.txt).
