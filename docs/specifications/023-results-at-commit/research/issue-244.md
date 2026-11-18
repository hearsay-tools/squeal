# Issue 244: browser wait errors in red proofs

2026-11-18. Recommendation: ask the human whether proof should admit explicit
non-assertion failures before changing D5.5; the observed classification matches
the current assertion-only contract.

Examined Squeal **0.1.563**, source commit
`cddea9e124e7cc09ea231819a031d94a46254d81`, Node **26.13.0**.
Issue: [hearsay-tools/squeal#244](https://github.com/hearsay-tools/squeal/issues/244).
This is documentation-only triage. No implementation, spec amendment or approval
is implied.

## Questions and verdict

| Question | Answer and evidence tag (Squeal 0.1.563) |
| --- | --- |
| Can the reported error produce the stated classification? | **Verified by experiment:** a synthetic recorded helper `Error` with the reported stack shape produces `error`, `red for another reason`, the reported reason, and proof exit code 3. |
| Does a frame in the named test make it eligible? | **Verified by experiment:** no, even moving the first frame and location into the spec leaves it ineligible. |
| Why is green skipped? | **Read in source code:** `proof.ts` filters files through `redOnAssertion` before requesting green runs. Stored green results can still be shown. |
| Is this a breach of the approved proof policy? | **Read in source code:** spec 023 D5.5 defines `proven` as an assertion failure followed by green; timeout is explicitly another reason. Admitting the reported ordinary `Error` requires a policy decision. |
| Did this reproduce the actual browser regression? | **Not determined, because** no browser build or browser execution was attempted. Only the classifier mechanism was reproduced. |

## Reproduction boundary and commands

The initial host check, before investigation, was:

```sh
cat /proc/loadavg && getconf _NPROCESSORS_ONLN
```

It returned `12.00 12.51 16.15` for the load averages and **24 CPUs**.
The one-minute average was below the triage cutoff. A later check was
`12.05 12.39 15.93`. The permitted cheap probe was used; no full suite,
browser build, installation, temporary checkout, remote experiment or live proof
command ran. This stayed within the 20-minute research bound.

Commands used to establish the source/version and issue evidence:

```sh
git rev-parse HEAD
cat package.json
node --version
gh issue view 244 --json title,body,url
```

The issue reports this command, **not rerun here**:

```sh
squeal proof packages/web/e2e/automations-disabled.e2e.ts --base ba957ba26677 --case source --json
```

Its stated evidence is `red.from: store`, `red.failures[0].kind: error`, a wait
helper's `Error` at `agent-browser.ts:551` followed by the named spec at line 35,
green not read and exit 3. The title rename causing the wait failure is reported
by the issue author; it was not independently verified here. The issue's broader
claim about all browser red proofs is not established.

The direct production-classifier probe ran successfully (process exit **0**):

```sh
node docs/specifications/023-results-at-commit/research/probes/issue-244/classifier.mjs
```

| Synthetic recorded error | Classified kind | Green eligible | Verdict | Computed proof exit |
| --- | --- | --- | --- | --- |
| Reported-shaped helper `Error` | error | false | red for another reason | 3 |
| `Error` located directly in spec | error | false | red for another reason | 3 |
| Runner-marked timeout (`loadAverage` present) | timeout | false | red for another reason | 3 |
| `AssertionError` | assertion | true | proven | 0 |
| `ERR_ASSERTION` | assertion | true | proven | 0 |
| Assertion during setup | setup | false | red for another reason | 3 |

**Verified by experiment, 0.1.563.** All six expectations held. The helper case
returned exactly `a test threw an error that is not an assertion` as its reason.
The probe imports `errorKind`, `redOnAssertion`, `verdictOf` and `proofExit` from
the production module. It supplies synthetic recorded errors and a synthetic
passing green for the assertion controls. It does not validate runner error
serialization, real store reuse, real CLI exit propagation or browser behavior.

Verification: `git diff --check` exited 0. The session-pinned Squeal CLI's
`status --wait 60000` returned on quiet at revision 2: edits since revision 0
affect no test file, zero known failures, four of 1,985 files unknown at the
baseline. No full-suite pass is claimed. `pnpm exec biome check
docs/specifications/023-results-at-commit/research/probes/issue-244/classifier.mjs`
exited 1 because this research path is ignored, processing zero files; that is
not a lint pass.

## What the source establishes

**Read in source code, 0.1.563.**
[`src/core/proof/verdict.ts`](../../../../src/core/proof/verdict.ts) uses phase,
recorded timeout load, error name and code, in that order. Neither message text
nor stack/location participates. Only `AssertionError` or `ERR_ASSERTION` is an
assertion after the earlier checks. A helper-defined wait error without the
runner's timeout marker therefore remains `error`, even though the helper
describes a timeout. Every error of every failed test must be an assertion for
`redOnAssertion` to return true.

**Read in source code, 0.1.563.**
[`src/cli/proof.ts`](../../../../src/cli/proof.ts) calls
`open.run(refs.filter(...redOnAssertion...))`. It passes `null` as the deciding
green to `verdictOf` when red is ineligible. However,
[`src/cli/proof-side.ts`](../../../../src/cli/proof-side.ts) can populate a green
from the store before that callback, and `proof.ts` preserves a green whose
`from` is non-null in the displayed report. Thus “ordinary errors prevent a new
green run” is established; “green is never read for such errors” is too broad.
[`src/cli/proof-report.ts`](../../../../src/cli/proof-report.ts) renders a null
green as `not read` and obtains JSON failure kinds from the same classifier.

**Read in source code, 0.1.563.** [Spec D5.5 and D5.6](../spec.md) explicitly
restrict `proven` to assertion red plus green and assign exit 3 to another-reason
red. The implementation follows that conservative contract. Existing
[`test/proof/verdict.test.ts`](../../../../test/proof/verdict.test.ts) expresses
the same policy; it was inspected, not manually rerun.

## Decision and limits

**Inferred, 0.1.563.** This is a real limitation for helpers that encode failed
expectations as ordinary errors, but the evidence does not establish a product
defect against D5.5. The tradeoff is admitting useful browser regression evidence
versus certifying unrelated exceptions or environmental failures as the intended
red. A test-file frame alone shows where an error propagated, not its cause;
the reported first project frame is itself in a helper, so a strict “top frame
is the spec” rule would also miss this exact report.

The human must choose whether to keep assertion-only proof, allow an explicit
acceptance policy, or approve a broader classification rule. If expanded, the
spec must define accepted evidence and retain import/setup/hook distinctions.
No specific flag or heuristic is approved by this research. Row 023-20's planned
explanation of skipped sides is related reporting work, not approval to broaden
red eligibility. Existing work and release holds are unchanged.

Remaining unknowns: the exact runner-normalized record from the original browser
run; whether a green result was already available at its exact key; and whether
the reported title rename alone explains the timeout. The probe and its limits
are preserved in [probes/issue-244/README.md](probes/issue-244/README.md).
