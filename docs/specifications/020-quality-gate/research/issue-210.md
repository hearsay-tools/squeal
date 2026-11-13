# Issue 210: an unrelated failure marks a covered callback `test-failed`

Recommend making the run-wide cause explicit before changing function policy.

**Verdict:** reproduced on packaged Squeal 0.1.465. A changed, passing callback
with full coverage becomes `incomplete / test-failed` when an unrelated selected
node:test file fails. This follows current D5, rather than contradicting it.
The tradeoff is between enforcing the selected run's success on every function
and reporting each function's own evidence without implying that the gate passed.
Existing holds stand. This report authorizes no implementation or policy change.

## Questions and answers

| Question from the brief | Answer and evidence tag | Version examined |
| --- | --- | --- |
| 1. Does an unrelated failure mark a fully covered passing callback `test-failed`? | Yes, with both files selected; all-pass control passes. **verified by experiment** | Packaged 0.1.465 |
| 2. Is the cause run-wide or function-specific? | One boolean covers all selected evidence, not just that function's loaders. **read in source code** | Checkout 0.1.465, `9273ca81243c08be207eeedde8eaecc2f8bf93af` |
| 3. What is the normative policy? | D5 requires “No selected test failed”; D11.2 keeps failures as a gate input. **read in official docs** | Spec 020 at that checkout |
| 4. Does this require high load or stored evidence? | Neither is required. A fresh failure below CPU-count load reproduces it. Same-byte reuse preserves it. **verified by experiment** | Packaged 0.1.465 |
| 5. How does it relate to #200 and load retries? | Stored failure persistence overlaps #200; run-wide attribution also happens before storage. A load cause for the original incident is not determined. **inferred** | Probe 0.1.465; issue reports 0.1.464 / 0.1.457 |

## Experiment

**verified by experiment, 0.1.465:** Installed launcher and checkout both report
0.1.465. Checkout SHA is above. The probe directly ran the installed version's
packaged CLI, with Node v26.13.0, counter 5, coverage provider 3, coverage record 4,
and quality policy 4. It did not run a checkout build.

Host: Linux, 24 CPUs (`os.cpus().length` and `getconf _NPROCESSORS_ONLN`). Initial
load was `14.52 4.45 3.72`. Before each of the four gates it was
`12.89 6.32 4.44`, below the 24-CPU cutoff. The experiment ran on 2026-11-13
at 13:17 Europe/Warsaw (12:17 UTC). It induced no host load beyond its two tiny
files, with `runner.tierSize: 1` and a 20-second gate budget.

The [throwaway probe](probes/issue-210/probe.mjs) creates two
temporary Git repositories with no dependency installation and no daemon.
Each base contains `test/a.test.mjs` and `test/b.test.mjs`. A imports only
`node:test` and `node:assert/strict`; its callback changes `const value = 2` to
`const value = 1 + 1`, keeping `assert.equal(value, 2)`. B imports those same
built-ins and asserts `1 === 1` in the control or `1 === 2` in the failure case.
B's failure already exists in that case's base. In both repositories,
`git diff --name-only main` prints only `test/a.test.mjs`.

`--test test/b.test.mjs` explicitly selects B. This isolates attribution after
selection; it does not reproduce why the original repository selected its
unrelated file. Neither test imports the other. No fixture or generated output
is committed; the probe removes its repositories and stores after recording them.

Commands run:

```sh
gh issue view 210 --repo hearsay-tools/squeal --json title,body,comments,url
gh issue view 200 --repo hearsay-tools/squeal --json title,body,comments,url
git rev-parse HEAD
getconf _NPROCESSORS_ONLN
/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal --version
node docs/specifications/020-quality-gate/research/probes/issue-210/probe.mjs /home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.465/dist/cli/squeal.mjs > /tmp/issue-210-probe.jsonl
```

Each of the four child commands, from its temporary repository:

```sh
/home/agent/.nvm/versions/node/v26.13.0/bin/node /home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.465/dist/cli/squeal.mjs code --base main --json --timeout 20 --test test/b.test.mjs
```

| Case | Evidence | Exit / verdict | Changed callback | Wall time |
| --- | --- | --- | --- | --- |
| All pass, first run | Both files run here | 0 / pass | pass, gap null | 871 ms |
| All pass, unchanged repeat | Both `from: store` | 0 / pass | pass, gap null | 606 ms |
| Unrelated failure, first run | Both files run here | 3 / incomplete | incomplete, `test-failed` | 852 ms |
| Unrelated failure, unchanged repeat | Both `from: store` | 3 / incomplete | incomplete, `test-failed` | 611 ms |

In all four reports: one changed function, CC 1, CRAP 1, coverage
`{lines: 3, covered: 3, share: 1}`, and expected/measured loaders both
`["test/a.test.mjs"]`. Both files completed; no file was unfinished and the
budget did not expire. Only B appears in `runs[].failed`, as
`{"path":"test/b.test.mjs","tests":["unrelated base test"]}`. Thus A's callback
and file passed, while A's gate function state was incomplete. The probe's
behavior assertions all passed; its process exited 0.

The first failure run printed a retained-log path. Its repeat printed:

```text
squeal code: node:test: 2 test files selected (tests 2): none to run, 2 read from the stores
squeal code: 2 of 2 selected test files read from the stores
```

Neither repeat line identified which stored file failed or offered recovery.
The JSON did identify B and its stored provenance. No load attribution appeared.

## Mechanism and policy

**read in source code, checkout 0.1.465:** `gate/evaluate.ts:252` sets
`failed: evidence.testFiles.some((f) => f.failed.length > 0)` once for the whole
evaluation. `judge()` passes it beside function-specific coverage and loader
counts. `gate/rule.ts:117` turns it into `test-failed` after earlier completeness
checks. `gate/runs.ts` separately names the failed files/tests. This is an
evaluation-wide condition, even across runners in the source; the probe tests
only one node:test entry. “Every function gets test-failed” is too broad:
excluded functions stay skipped, excessive CC remains a violation, and earlier
gaps such as `no-loader` can win.

**read in official docs, spec 020 at the checkout SHA:** D5's condition 5 is
“No selected test failed.” Its subset-pass paragraph adds “It is still not a
pass while a selected test failed.” It also makes a failed test independently
block the overall verdict. D11.1 supplies “whether a selected test failed” to
the function rule; D11.2 says the daemon passes false because it reports failures
as test transitions. D3 permits explicit `--test` selection. D7 reports failures
per runner, not a causal list per function. D11.7 requires keyed reuse and
provenance; D17.3 keeps completed results. Neither excludes failed results.

**read in source code, checkout 0.1.465:** `gate/stored.ts:evidenceAt` restores
failed test names and `from: store`. `gate/lanes.ts:runOne` makes one adapter run
and collects its evidence; it does not call the daemon's retry scheduler.
The daemon's bounded new-failure retry is in `scheduler/rerun.ts`, while
`retry/load.ts` defines the load gate for explicit load retries and stored run
load metadata. Those are separate from function attribution. This source read
does not establish that high load caused the reporter's test failure.

## Recommendation, relation to #200, and limits

**inferred from the 0.1.465 probe and sources:** First clarify that `test-failed`
can mean a selected test outside the function's loaders failed, and expose its
identity with the existing run evidence. If functions should instead retain
their own passing state while the overall gate stays incomplete, seek an
explicit D5/D11 policy decision; that changes state semantics, for which D6
requires a quality-policy version increase. This report does not design that
change or recommend ignoring a real failure.

#200 concerns persistence and recovery from a stored failure. The repeat proves
that persistence on a deterministic failure, not the original load incident.
#210 adds attribution to unrelated functions on a fresh run and asks about load
handling. Their storage/recovery diagnostics overlap; attribution and automatic
retry remain separate decisions. Current stderr does disclose aggregate reuse,
so saying it never discloses storage would be inaccurate for 0.1.465.

Not determined: whether the original 0.1.464 stalled-download failure was caused
by load; whether it was reused on the reporter's second run; and why that file
was selected. No overloaded-host test, original repository gate, full suite,
daemon retry, or cross-runner experiment ran. No source/build behavior on
0.1.464 was tested. The only executed checks were the tiny packaged CLI probe;
this is reproduction evidence, not product-suite validation.

Final checks: `node --check docs/specifications/020-quality-gate/research/probes/issue-210/probe.mjs` passed; report
local links resolved. `squeal status --wait 60000 docs/specifications/020-quality-gate/research/probes/issue-210/probe.mjs
docs/specifications/020-quality-gate/research/issue-210.md` returned exit 3:
no test closure holds either file, zero known failures, 6 of 1,771 test files
not current (unknown). No product-suite pass is claimed.

## Sources

- [Issue 210](https://github.com/hearsay-tools/squeal/issues/210) and
  [issue 200](https://github.com/hearsay-tools/squeal/issues/200), fetched with
  `gh` on 2026-11-13. Reporter accounts are not independent experiments.
- [Spec 020](../spec.md), D3/D5/D6/D7/D11/D17, and [status](../status.md).
- [Evaluator at examined SHA](https://github.com/hearsay-tools/squeal/blob/9273ca81243c08be207eeedde8eaecc2f8bf93af/src/core/code/gate/evaluate.ts#L252).
  Other read source files at the same SHA: `src/core/code/gate/{rule,runs,stored,lanes}.ts`,
  `src/core/scheduler/rerun.ts`, `src/core/retry/load.ts`.
- [Earlier #200 research](issue-200.md); [probe instructions](probes/issue-210/README.md).
