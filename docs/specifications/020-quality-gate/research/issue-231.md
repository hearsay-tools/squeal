# Issue 231: gate history and seven-day pruning

Recommend a human decision on durable gate invocation history, while keeping the seven-day retention hold.

**Verdict:** reproduced the missing invocation history and age-pruning mechanism on current source. Did not reproduce the reported historical loss of 47,428 rows. No original project store was opened. The existing specs require reusable results and a report, not a durable record of every gate invocation.

## Scope and versions

Examined on 2026-11-17, starting at 14:54 UTC. Checkout
`b0da5d149d445ea92c8517497141a7ed6dbbcc96`, package 0.1.543; installed
session CLI 0.1.531. Node 26.13.0, pnpm 12.15.0, SQLite 3.54.0. Initial
one-minute load was 10.73 on 24 CPUs; probe load was 7.83 on 24 available CPUs.
The probes imported checkout source, not the installed runtime. Issue #231
reports daemon 0.1.531 and historical gates 0.1.503–0.1.516; those releases
were not executed here. All source findings below refer to this checkout.

## Questions and answers

| Question | Answer and evidence tag |
| --- | --- |
| 1. Is each invocation durably recorded with start, end, verdict, budget, selection and run linkage? | No. Pass and reuse each left zero checkpoints and zero runs. The report held verdict, budget and selection. A failed gate left only a log run, unlinked to the saved results. **verified by experiment**, 0.1.543. |
| 2. Does the code offer partial evidence that qualifies that answer? | Yes. Results carry `gate-` run ids; failure logs have start/end and test files. Neither is a full invocation record. The daemon write handler also stores supplied results without adding an invocation. **read in source code**, 0.1.543. |
| 3. What does seven-day pruning remove? | Unprotected results strictly older than the cutoff; equality survives until the clock advances. Live keys and newest main results survive age pruning. **verified by experiment**, 0.1.543. |
| 4. Did pruning cause the reported historical count change? | Not determined, because the original snapshots, exact query and store history were not examined. Pruning is a compatible mechanism, not proof of that incident. **inferred**, current source versus reported 0.1.531. |
| 5. Would longer retention alone provide exact historical measurements? | No. A same-check/same-key write replaces the previous row and its run provenance. **verified by experiment**, 0.1.543. |

## 1–2. Invocation evidence

**verified by experiment — 0.1.543.** The [throwaway probe](probes/issue-231/README.md) used one real node:test file, coverage enabled, and no daemon. Each call used `codeGateCommand(["--base", "main", "--json", "--timeout", "15"], io)`.

| Call | Report / exit | Wall / runner duration | Checkpoints | Runs | Results | Results joined to runs |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| First, passing test | pass / 0 | 400 / 169 ms | 0 | 0 | 2 | 0 |
| Same bytes | pass / 0; `from=store` | 148 / null ms | 0 | 0 | 2 | 0 |
| Changed test, expected failure | incomplete / 3 | 388 / 175 ms | 0 | 1 | 4 | 0 |

Counts are cumulative within the fixture. Each report selected and completed
`test/a.test.mjs`, with `budget={seconds:15,timedOut:false}`. The failed call's
log row had start/end, `checkpoint_id=NULL` and `end_state=completed`, although
the gate verdict was `incomplete`. Runner completion is not the gate verdict.
All result rows had `gate-` ids; none matched the log run. Timing observations
are not a performance estimate. The all-stored invocation left no extra row.

**read in source code — 0.1.543.** `CheckpointKind` accepts only `run-all` and
`baseline` (`store-records.ts:236`). The SQL column is unrestricted text;
this is the supported type, not a SQL enum constraint. `code-gate.ts:251–259`
evaluates and prints the report; no invocation write surrounds it. The keeper
allocates a `gate-` id per queued run (`keep.ts:168`). `keep-pass.ts:284` puts
that id into result provenance. `code-gate-log.ts:80` allocates an independent
id for a failed/unfinished run's log. Its start is calculated from end minus
runner duration, and its checkpoint is null. `keep-here.ts` and
`daemon/keep-request.ts` use `storeResults`, which writes results, not a run or
gate record. Main/code store schemas have no gate-invocation table. No live
daemon route, interruption, timeout or historical binary was probed.

## 3–5. Retention and historical counts

**verified by experiment — 0.1.543.** With a synthetic `now=100 days` and
`retentionDays=7`, the real `store.prune` removed an eight-day unprotected row
and a forty-day older main result. It kept a six-day row, an exactly-seven-day
row, a thirty-day live key produced by a removed worktree, and the newest
thirty-day main result. Advancing `now` by one millisecond removed the boundary
row. Writing another result for the six-day row's check/key kept one row and
replaced its run id. No size cap was set.

**read in source code — 0.1.543.** `prune-rules.ts:64` uses
`recorded_at < cutoff`; reads do not restart that age. `DEFAULT_POLICY` sets
seven days and no size cap. An enabled size cap can remove rows earlier,
including newest main rows when no live key protects them (`prune.ts:274`).
`results` has primary key `(check_id,key)` and `putMany` uses
`INSERT OR REPLACE`. It is a reusable result cache, not an append-only record
of every execution. Runs and checkpoints have separate reference/protection
rules; a retained result can retain its run. A removed worktree's unreferenced
log run can disappear at the next prune, before seven days.

**inferred — issue's reported 0.1.531 versus source 0.1.543.** The reported
130,768 to 83,340 result count and 296.6 to 190.8 hours are the reporter's
measurements, not this probe's. Old unprotected rows becoming prunable fits
the report. Replacement, a configured size cap and the query's joins can also
change counts. Their contributions cannot be assigned from these experiments.

## Recommendation and open questions

**inferred — 0.1.543 evidence.** Ask the human whether exact gate invocation
history is a product requirement. Its value is trustworthy durations, verdicts
and attribution, including calls that reuse everything. Its cost is additional
durable data with an explicit lifetime. This report does not choose a schema.
Keep retention expansion on hold. Seven-day result retention is already
documented in 011 C7; 023's human decision explicitly keeps it. Longer result
retention alone cannot recover overwritten executions.

Open: required lifetime and completeness of invocation history; interrupted
invocation semantics; whether execution aggregates are wanted at all; exact
causes of the historical count difference. Any change needs a human decision
and a spec amendment. No product, board, status, skill or hold was changed.

## Commands and sources

Exact commands used for version/load evidence and reproduction, from the repo root:

```sh
git rev-parse HEAD
node --version
pnpm --version
getconf _NPROCESSORS_ONLN
cat /proc/loadavg
gh issue view 231 --repo hearsay-tools/squeal --json title,body,url,createdAt,comments
pnpm exec tsx research/probes/issue-231/probe.ts
```

The installed launcher `<plugin-data>/bin/squeal --version` returned 0.1.531.
The probe exited 0 with `PASS: isolated prune, replacement, pass/reuse/failure gate probes`.
Its SQL includes `SELECT count(*) FROM checkpoints`, `SELECT count(*) FROM runs`
and `SELECT count(*) FROM results r JOIN runs u ON u.id = r.run_id`. No full
suite, build or product change was required. The probe is the verification of
these research claims.

`pnpm exec biome check --write research/probes/issue-231/probe.ts` passed after
sorting one import. Squeal's affected-path check returned exit 3, “No verdict”:
no test closure holds either the probe or the report. It reported zero known
failures and 119 unknown test files. No suite pass is claimed.

- [Issue #231](https://github.com/hearsay-tools/squeal/issues/231), fetched with `gh`; historical claims only.
- [020 spec](../spec.md): D7 report, D11.7 reuse, D17.3 result retention, D17.5 write bounds; [020 decisions](../status.md).
- [011 spec](../../011-core/spec.md): C1 store/log layout, C6 checkpoint meaning, C7 replacement/pruning; [011 decisions](../../011-core/status.md).
- [023 spec](../../023-results-at-commit/spec.md): Non-goals, D3–D4; [023 status](../../023-results-at-commit/status.md), 2026-11-16: “Keep 7 days”.
- Source paths above are under `src/core/` except `code-gate*.ts` under `src/cli/`; `keep*.ts` under `src/core/code/gate/`; `store-records.ts` and `policy.ts` under `src/core/types/`; store files under `src/core/store/`, result writes under `repos/results.ts`. [Pinned source tree](https://github.com/hearsay-tools/squeal/tree/b0da5d149d445ea92c8517497141a7ed6dbbcc96/src).

Coordinator integration: probes moved from the worker’s root `research/` path to this spec’s `research/probes/issue-231/`, with imports adjusted. The commands above record the original run location; the probe README gives its current command.
