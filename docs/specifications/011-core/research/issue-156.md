# Issue 156: finding the lint Stop wait budget

Make the lint Stop timeout name its effective budget and `stop.slowWaitMs`, and make that relationship explicit in the policy reference.

## Scope and versions

Research only, 2026-11-07, within the 15-minute bound. Inspected and probed **Squeal 0.1.414**, checkout `d3f363054fbe5d30e6e11bf8f212e1ac74d567e1`, **Node v24.22.1**, **pnpm 12.15.0**, Linux, **24 CPUs**. The session-pinned runtime is also 0.1.414; the experiment imports checkout source, not the installed bundle. Read the local release source for **0.1.408**, `8dc8bc38f72d034f1e65d6d482d4857a89bfeaa1`, the version investigated in the issue. The original timeout's version, revision and output were not recorded.

`cat /proc/loadavg; nproc` gave `18.96 9.52 7.82 11/3887 3140533` and `24` initially; the later check gave `16.51 9.87 7.99 14/3725 3149610` and `24`. The synthetic probe recorded one-minute load **16.46**, below 24. No live probe was needed or run. No original two-minute wait, daemon, linter or full suite was launched. Existing holds stand; no implementation is authorized.

## Questions and verdicts

| # | Question and evidence plan | Tagged answer and version |
| --- | --- | --- |
| 1 | Which key sets lint's Stop wait? Run the production loader and required-check resolver with four configs. | **verified by experiment, 0.1.414:** `stop.slowWaitMs`, default 120000 ms, effective maximum 3540000 ms. Changing only `stop.waitMs` leaves it at 120000 ms. |
| 2 | Does the timeout name the effective budget and key? Run the production Stop formatter with pending lint and each resolved bound; trace its caller. | **verified by experiment, 0.1.414:** the synthetic bound reason prints seconds and the group command, but no `stop.slowWaitMs` key or explicit budget label. A custom 123456 ms renders as 123.5 s. Text gap reproduced; original hook timeout not reproduced. |
| 3 | Can users find the setting from lint/Stop timeout documentation? Read the policy reference and compare with the reported release and installed reference. | **read in official docs, 0.1.408 and 0.1.414:** the reference correctly covers groups at Stop, but the budget row never says lint. No lint-timeout example or direct lint/timeout match appears. **inferred, same versions:** discoverable through cross-reading `checks`, but weaker than the issue's requested direct lookup. |
| 4 | Is this the scheduling problem in #154? Read both issue bodies and 019 D6/status. | **read in official docs, 0.1.407 issue report and current 019 contract:** #154 concerns an explicit group request not taken before its CLI deadline. **inferred, 0.1.414 evidence:** improving timeout text is separate; increasing a Stop budget is not shown to fix request admission. |

## Findings

### 1. Budget and message

**verified by experiment, 0.1.414.** Command:

```sh
pnpm exec tsx docs/specifications/011-core/research/probes/issue-156/stop.mjs > docs/specifications/011-core/research/probes/issue-156/output.txt
```

Exit **0**; final line: `PASS: four synthetic policy/Stop-text cases; no timer wait, daemon, linter or test suite.` The fixture uses `{"name":"lint","lint":true,"at":"stop"}`, with lint enabled, one pending ESLint check and revision 2. It calls `readPolicy`, `stopRequired` and `stepReason`. Exact complete output is in [output.txt](probes/issue-156/output.txt).

| Config change | Resolved budget | Reason's duration |
| --- | ---: | --- |
| No Stop override | 120000 ms | `after 120 s` |
| `stop.slowWaitMs: 123456` | 123456 ms | `after 123.5 s` |
| `stop.slowWaitMs: 3600000` | 3540000 ms | `after 3540 s` |
| Only `stop.waitMs: 1000` | 120000 ms | `after 120 s` |

Default output, verbatim:

```text
Squeal policy checks puts the lint group at stop and after 120 s 1 lint check is still not linted at revision 2: src/a.js. `squeal run lint --wait` waits for their results.
This is Stop's last hold this turn: no later Stop in it waits for the lint group, and `squeal run lint --wait` runs it and waits for its results.
```

**read in source code, 0.1.414.** `stopRequired` uses `stopWaitBoundMs` for both required test and lint groups. `waitForRequired` in `stop-slow.ts` computes `waitedMs = Math.min(bound, Math.round(now - started))`; `stepReason` passes it to `lintOpenReason`. That formatter labels elapsed seconds, not the configured limit. The waiting entry can also decide when a daemon has been down for 10000 ms, so elapsed text alone need not identify the configured budget. The quick entry separately caps `stop.waitMs` at 1500 ms. This is source evidence, not a measured hook run.

**read in source code, 0.1.408 and 0.1.414.** The diff of `stop-lint.ts`, `stop-required.ts`, `stop-slow.ts`, `required.ts` and `stop-wait.ts` changes imports and one re-export only. Their inspected budget and formatter bodies are unchanged. This supports the same text finding for 0.1.408 source; no 0.1.408 runtime was executed.

### 2. Reference and contract

**read in official docs, 0.1.408 and 0.1.414.** `policy.md:24` says:

> `stop.slowWaitMs` | `120000` | How long Stop waits for the checks it waits for: the slow files under `stop.requireSlowSuite` and the groups at `"stop"` in `checks`.

It also gives the 3540000 ms cap. Line 22 gives `stop.waitMs`, default 0, with its 1500 ms cap. Line 26 defines lint groups and says Stop waits for a lint group at `stop`. Thus the answer exists, but requires connecting two table rows. The examples in the budget row concern slow test files. The search `rg -n 'lint.*timeout|timeout.*lint|slowWaitMs' plugins/claude-code/skills/squeal/references/*.md` returned only `policy.md` lines 11, 23 and 24, all `slowWaitMs` matches. No line matched lint with timeout.

`git diff squeal--v0.1.408 HEAD -- plugins/claude-code/skills/squeal/references/policy.md` returned no output. The checkout and installed 0.1.414 policy references both hash to `9dbecec4df4ee4eefb639295ba9541f2af54f54f33aa725acc37bcdf0cf6a7dc` (SHA-256).

**read in official docs, checkout d3f363054.** Relevant contracts:

- **011 C8:** shared hook behavior and bounded execution apply across harnesses.
- **019 D2:** the resolver separately records whether Stop waits for a group; default slow behavior remains compatible.
- **019 D4.2:** `stop.slowWaitMs` keeps 120000 ms and covers every required check, capped at 3540000 ms. Renaming remains open question 2.
- **019 D6:** messages name groups and commands; the skill lists policy. It does not explicitly require the timeout key in the bound message.
- **017 D8:** ordinary lint news and `lint.blocking` govern findings. Its ordinary no-wait statement must be read with the required-group behavior added by 019 D4/row 019-45, not treated as a separate lint timeout.

**inferred, 0.1.414.** This is a proven discovery gap against the issue's requested behavior, not proof that the current formatter violates an explicit existing key-printing contract. Making the current key and scope explicit is narrower than choosing an alias or changing waiting policy.

### 3. Separation from #154 and limits

**read in official docs, issue reports fetched with `gh issue view`.** #156 explicitly says the original timeout output was not recorded and disclaims a scheduling diagnosis. #154 reports 0.1.407, a 46.5 s Stop hold, then `squeal run lint --wait 60000` exiting 3 with `deadline passed before daemon took request ...; request remains pending`. Current 019 D6 requires that CLI deadline to name its recorded blocker; the status log records that diagnostic in 0.1.409. These are distinct from discovering the Stop setting.

**inferred, 0.1.414.** Recommend a scoped text/reference improvement that exposes the effective value, key and applicability to lint and all required groups. The tradeoff is a little more actionable text versus a new key or broader scheduling work. Leave alias design to the coordinator and human. No scheduler change or larger default follows from this evidence.

Open: the original hook's full output, effective policy, elapsed time and daemon state; whether any proposed alias is worth compatibility work; real user search success. The synthetic probe does not exercise Stop handoff, timers, the installed Codex bundle, daemon admission or linter completion. None is claimed reproduced.

## Sources and verification

- Fetched issues: [#156](https://github.com/hearsay-tools/squeal/issues/156), [#154](https://github.com/hearsay-tools/squeal/issues/154). Exact commands: [probe README](probes/issue-156/README.md).
- Local source at `d3f363054fbe5d30e6e11bf8f212e1ac74d567e1`: `src/core/{daemon/policy.ts,state/required.ts,slow/stop-wait.ts}`, `src/harness/shared/{stop.ts,stop-slow.ts,stop-required.ts,stop-lint.ts}`. [Pinned source tree](https://github.com/hearsay-tools/squeal/tree/d3f363054fbe5d30e6e11bf8f212e1ac74d567e1).
- Official project reference: `plugins/claude-code/skills/squeal/references/policy.md`; installed copy `/home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.414/skills/squeal/references/policy.md`. Historical source: tag `squeal--v0.1.408` at the commit above.
- Specs and amendment logs: `docs/specifications/011-core/{spec,status}.md`, `019-run-triggers/{spec,status}.md`, `017-lint-checks/{spec,status}.md` at the inspected commit.
- Probe assertions passed; no product test suite, build or typecheck was needed for this research-only change. Additional checks are recorded below.
- `pnpm exec biome check research/probes/issue-156/stop.mjs`: exit 0, `Checked 1 file in 6ms. No fixes applied.` `node --check research/probes/issue-156/stop.mjs` and `git diff --check`: exit 0, no output.
- `/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 research/probes/issue-156/stop.mjs docs/specifications/011-core/research/issue-156.md`: exit **3**, revision **5**: `No verdict: no test file's closure holds research/probes/issue-156/stop.mjs; no test file's closure holds docs/specifications/011-core/research/issue-156.md. Worktree: known failures 0; not current: 529 of 1490 test files (529 unknown)`. These paths have direct research evidence, not an affected-suite pass.

Coordinator correction: probes were moved from root `research/` to this spec's `research/probes/issue-156/` as required by the triage brief. Commands above use the final paths; the original recorded run used the root path. Imports were adjusted for the move.

After relocation: `node --check docs/specifications/011-core/research/probes/issue-156/stop.mjs` and `git diff --check` passed. Biome ignored the relocated docs path and processed zero files, so this is not a second lint pass. The researcher's passing lint result above applies to the same probe before its relative imports changed.
