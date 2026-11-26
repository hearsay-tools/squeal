# Issue 287: checks hides unit tests before discovery finishes

**Recommendation:** approve a narrow correction that distinguishes unfinished
inventory from an established absence of tests in `squeal checks`.

**Verdict:** reproduced with the installed 0.1.641 CLI against a small synthetic
store on 2026-11-26. The original repository's startup timing and 60 s focused
request timeout were not reproduced. No product change is proposed here beyond
that behavior decision.

## Questions answered

| Question | Answer and evidence |
| --- | --- |
| Can pending discovery hide the default unit-test check? | Yes. **Verified by experiment, 0.1.641:** an empty registered store hides `tests`; an unrefined revision does too. |
| Does the output distinguish incomplete inventory? | No. **Verified by experiment, 0.1.641:** browser and slow print `Test files now: 0`, without a discovery qualification; the usual manual-run footer remains. |
| Does listing a unit-test file restore the check? | Yes. **Verified by experiment, 0.1.641:** adding one key row and completing refinement restores `tests`, with one file and `1 not current`. No test execution was needed. |
| Does this prove the cause of the reported 60 s timeout? | Not determined. The report has no status JSON or daemon trace. **Inferred, 0.1.641:** the timeout is compatible with pending refinement; the synthetic probe does not exercise scheduling. |

## Evidence and bounded probe

The fetched [issue](https://github.com/hearsay-tools/squeal/issues/287) reports
0.1.641 under Codex: startup revision 0 showed browser, lint and slow but no
unit-test check; a `run tests ... --wait 60000` then expired while revision 2's
affected set was being computed. Later unit-test failure and recovery messages
arrived. This is reporter evidence, not an independently replayed incident.

Exact commands used for the reproduction and its version checks:

```sh
gh issue view 287 --repo hearsay-tools/squeal --json number,title,body,url,createdAt,comments
cat /proc/loadavg
getconf _NPROCESSORS_ONLN
git rev-parse HEAD
git rev-parse 'squeal--v0.1.641^{commit}'
~/.codex/plugins/data/squeal-hearsay/bin/squeal checks
pnpm exec tsx research/probes/issue-287/probe.ts > research/probes/issue-287/output.txt 2>&1
```

The last command ran before the probe was relocated under the owning spec;
its README gives the current command. No second probe was run.

The initial load check was `12.15 10.52 10.46`, with 16 online CPUs. Immediately
before creating its fixture, the probe read `5.30 8.79 9.86`, also 16 CPUs.
Node was `v26.13.0`. The probe's installed command is
`node --disable-warning=ExperimentalWarning ~/.codex/plugins/data/squeal-hearsay/versions/0.1.641/dist/cli/squeal.mjs`;
it runs `--version`, then four `checks` reads, each bounded to 10 s.
The version command returned `0.1.641`; the probe exited 0 in a few seconds.

The checkout was `6f8c31f3ccda481b33eae250e9c10c8cdceb16bb`, and the release tag
peeled to commit `846c3a8069d2941eb5e63f590fd11047442202eb`. A `git diff` against that
tag returned no differences for `src/cli/checks.ts`, `src/cli/checks-text.ts`,
`src/core/store/`, `src/core/state/header.ts`, and
`src/core/scheduler/refined.ts`. The checkout API seeds the store and reads
header evidence; the installed release CLI supplies the observed output.

The fixture config declares one explicit browser check, marks a slow glob,
and enables lint. No separate unit check is configured: default `tests` owns
the unit file. Each state is read from the same temporary fixture:

| Seeded state | Header evidence | Installed `checks` output |
| --- | --- | --- |
| No store | No listing exists | `tests` is shown; no file counts. |
| Registered worktree, no keys | revision 0; `testFilesListed=false`; refined revision null | `tests` disappears; browser/slow show zero. |
| Two revisions, refinement still 0 | revision 2; `testFilesListed=false`; `runnerPartPending=true` | Same missing `tests` and zero counts; no pending-discovery text. |
| One unit key, refinement 2 | revision 2; `testFilesListed=true`; `runnerPartPending=false` | `tests` returns, `Test files now: 1`, `Last result at revision 2: 1 not current`. |

Every case ends with:

```text
Squeal does not cover typecheck, build or any other test suite: run those yourself.
```

**Inferred, 0.1.641:** the combination invites the reader to treat the omitted
unit suite as uncovered. The sentence itself does not explicitly name unit
tests, and its text does not change with discovery. This is an inventory and
presentation defect, not evidence that Squeal disables the unit runner.

Full output and reproducible code:
[probe.ts](probes/issue-287/probe.ts),
[output.txt](probes/issue-287/output.txt), and
[README](probes/issue-287/README.md).

## Source explanation and contract

**Read in source code, 0.1.641:**
[`checks.ts:51-77`](https://github.com/hearsay-tools/squeal/blob/846c3a8069d2941eb5e63f590fd11047442202eb/src/cli/checks.ts#L51)
accepts any registered worktree, initializes every test group's count to zero,
then counts existing `testFileKeys`. Its view carries revision and counts but
no listing-completion or refinement state.
[`checks-text.ts:76-80`](https://github.com/hearsay-tools/squeal/blob/846c3a8069d2941eb5e63f590fd11047442202eb/src/cli/checks-text.ts#L76)
hides default `tests` when explicit checks exist and its count is zero. An
explicitly named unit check would remain visible, as would default `tests`
when no explicit checks exist. The failure therefore has a concrete condition,
not every startup.

**Read in source code, 0.1.641:**
[`not-covered.ts`](https://github.com/hearsay-tools/squeal/blob/846c3a8069d2941eb5e63f590fd11047442202eb/src/harness/shared/not-covered.ts)
builds the footer from configured exclusions, not discovery completeness.
[`header.ts:103-133`](https://github.com/hearsay-tools/squeal/blob/846c3a8069d2941eb5e63f590fd11047442202eb/src/core/state/header.ts#L103)
already exposes listing/refinement evidence separately. Initial discovery
needs care: the fixture's revision 0 has `testFilesListed=false` even though
a null refined revision makes `runnerPartPending=false` by compatibility rule.
Checking only the latter would miss the initial case.

**Read in official docs, checkout `6f8c31f3c`:** [011 spec](../spec.md) C2 keeps
revision refinement distinct from the watcher revision. C6 says unlisted files
must be named rather than presenting zero counts as complete. C9 separates
daemon lifecycle from a completed inventory. C15 says an unlisted revision
prevents a tier starting and that status distinguishes initial discovery from
idle queued work. The [vision](../../../vision.md) prefers stated uncertainty.
The [status amendment log](../status.md) retains those rules. These support a
narrow inventory correction; they do not establish a new scheduling defect.

## Limits and decision

The fixture records `daemon: null`: it models the readable store states and
does not pretend to be a live daemon. The faulty command does not consult
daemon liveness. No existing daemon was restarted; no full suite, live runner,
or heavy host workload was run. The temporary fixture was removed. The probe
assertions passed; they are research assertions, not product-suite validation.

The human decision is whether to carry discovery uncertainty through `checks`
before suppressing default checks or implying other suites need manual runs.
The decisive tradeoff is an explicitly incomplete inventory versus a concise
but unsupported absence claim. Detailed wording and implementation belong to
the subsequent approved row. The original timeout's duration and cause remain
open; resolving them is not needed to confirm this narrower defect.
