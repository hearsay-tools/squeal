# Issue 263: new regression batches deny successive Write retries

Research, 2026-11-22. Issue: [#263](https://github.com/hearsay-tools/squeal/issues/263).
Owner: 011 C5/C8/C10; Claude Code mapping: 012 CC2.

## Verdict

**Verified by experiment, Squeal 0.1.591:** three new regression batches can deny
three consecutive identical Write calls. The same already-delivered regression
denies only once. This reproduces the reported mechanism within the current
contract, without showing a duplicate-delivery defect. Even one revision can
produce successive denials; a new revision is not required.

Recommendation: add this evidence to the held deny-once decision on board row
`gh-71`, beside #136 and #215. The human must decide whether the repeated retry
cost warrants changing that contract. No design or implementation is authorized
by this report. The tradeoff is immediate interruption for each newly available
regression versus letting a pending repair proceed through later result batches.

## Questions answered

| Question | Answer at 0.1.591 | Tag |
|---|---|---|
| Does one unchanged regression deny every retry? | No: deny, allow, allow. | verified by experiment |
| Can new batches deny consecutive identical writes? | Yes: deny alpha, deny beta, deny gamma, then allow with no new batch. | verified by experiment |
| Does this require a new revision per denial? | No: reproduced at 13/13/13 and at 13/14/14. | verified by experiment |
| Does a single batch of all three failures deny three times? | No: one denial names all three, then the retry is allowed. | verified by experiment |
| Does disabling `interrupt.onRegression` discard failure state? | No: the Write is allowed and the fixture retains one failed state. | verified by experiment |
| Is the denial scoped to the target file or a refactor burst? | No: the hook passes only the tool's edit classification to the shared deny rule; the rule consumes undelivered regression entries. | read in source code |
| Are the incident's token cost and Claude retry behavior reproduced? | Not determined: this is an in-process hook/store fixture, with no model or real refactor. | inferred (limit of the experiment) |

## Evidence and interpretation

**F1, verified by experiment, 0.1.591.** The probe extracts the exact release
source, tag `squeal--v0.1.591`, commit
`1d9d54fabca43a7082c46f58aeec0dd22df79d80`. It seeds three passing checks in
distinct synthetic test files, registers one consumer, and writes failing results
under new file keys through the real state sink. It calls `runHook` for
`pre-tool-use` using the same serialized Write input on each attempt. Between
attempts it adds one newly failing check. Each denial names only the new file,
not a previously delivered file. Five cases passed in 2.18 seconds, one worker.
The body contains 16,384 ASCII bytes. This verifies unchanged large input can be
denied successively; it does not measure Claude's tokenization or resend cost.

**F2, read in source code, 0.1.591.** `src/harness/shared/deny.ts` selects only
`pass-to-fail` deltas. `denyOnRegression` calls `delivery.peek` whenever the tool
is an edit and `interrupt.onRegression` is enabled. In
`src/core/delivery/delivery.ts`, `peek` restricts delivery to those kinds and
advances the consumer's view. There is no per-burst, per-revision, target-path or
time-window exemption in this path. The Claude mapping in
`src/harness/claude-code/hooks/pre-tool-use.ts` classifies `Edit`, `Write` and
`NotebookEdit` as edits; it does not inspect the target file or content for this
decision. These facts explain both controls: the old regression cannot deny
again, but a newly available regression can.

**F3, read in official docs and source code, 0.1.591.** Spec 011 C8 says
"a seen regression denies one edit once, through a peek that consumes only
regression entries". Spec 012 CC2 says "the same regression never denies twice".
Neither promises that a retry succeeds if different regressions arrive before
it. `src/harness/shared/text.ts` says "The same call can be re-issued; this
regression does not deny again." The experiment complies with that narrow
promise. The issue describes the practical cost when each retry meets new news.

**F4, inferred from the issue and experiment, 0.1.591.** The reporter names
different failing checks on each of three denied attempts, matching the probe's
successive-batch case. That is evidence for extending `gh-71`'s policy discussion,
not evidence that the delivery receipt lost an acknowledgement. #136 adds an
expected test-first failure; #215 adds an unrelated edit denied by a superseded
red-proof result. #263 adds a confirmed mechanism for several consecutive
denials while the agent tries to apply one repair. The row's existing hold stays
in force.

## Environment, commands and limits

The research checkout was 0.1.593 at
`733b2beb3893502148fe5a0bae1da47a3abdf36b`; the probe imports the extracted
0.1.591 source, not that checkout's product source. It uses the checkout's
installed dependencies: Node v26.13.0 and Vitest 5.0.3. At the run's start,
2026-11-22 04:37:55 UTC, one-minute load was **4.71 / 16 CPUs** (five-minute
3.36, fifteen-minute 2.95). The load check allowed the bounded probe. No daemon,
Claude process, full suite or benchmark ran.

Exact primary commands, from the repository root:

```sh
gh issue view 263 --repo hearsay-tools/squeal --json number,title,body,url,comments
git rev-parse HEAD
git show squeal--v0.1.591:package.json
bash docs/specifications/011-core/research/probes/issue-263/run.sh
```

The [run script](probes/issue-263/run.sh) records the load check, exact archive
paths and narrow Vitest command. [Output](probes/issue-263/output.txt) preserves
the successful run's synthetic results. The Squeal skill and `squeal checks`
were read first. This explicitly requested research probe is outside the
repository's regular test selection, so it ran directly; existing product tests
were not rerun to obtain this evidence.

The fixture inserts result batches synchronously, reports its stand-in daemon as
alive and invokes the programmatic hook without the production stdout receipt
hand-off. It does not reproduce watcher scheduling, concurrent writes, hook
process cancellation or failed delivery receipts. It places no intervening
PostToolBatch between the denied retries. No actual Write executes: `allow`
means the hook returned no denial. Whether Claude Code in the original session
had other boundaries, and the exact timing of those batches, remains unverified.
The reported roughly 12k extra tokens and switch to a shell write are issue
claims only. The probe models no dependency graph, so it proves no policy for
which failures are expected or related to a particular repair.

## Sources

- [Issue #263](https://github.com/hearsay-tools/squeal/issues/263), fetched with
  the command above; no comments at the time of reading.
- [0.1.591 source](https://github.com/hearsay-tools/squeal/tree/1d9d54fabca43a7082c46f58aeec0dd22df79d80):
  `src/harness/shared/deny.ts`, `src/harness/shared/text.ts`,
  `src/core/delivery/delivery.ts`,
  `src/harness/claude-code/hooks/pre-tool-use.ts`;
  specs 011 C5/C8/C10 and 012 CC2 at that tag.
- `docs/board.md`, `gh-71`; [issue 215](issue-215.md),
  [issue 136](../../002-codex-adapter/research/issue-136.md), and
  [issue 171](issue-171.md) for related prior evidence.
- [Probe source and instructions](probes/issue-263/README.md).
