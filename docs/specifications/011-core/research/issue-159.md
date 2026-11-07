# Issue 159: Stop holds while parking for an external reply

Keep parking versus completion as an explicit policy decision, linked to #153, while preserving existing holds.

## Scope and verdict

**Partial reproduction, synthetic only.** On Squeal **0.1.414**, the real Codex
Stop functions waited for pending lint after an injected revision with clean
commit metadata. They did not distinguish supplied parking and completion hints.
The original reset/build, Cezar parent wait and 120-second wall delay were **not
reproduced**, because this bounded investigation used a small synthetic fixture
without the incident worktree, effective policy, registration state or hook input.
No real harness session or production daemon was launched for the probe.

Examined checkout: `d3f363054fbe5d30e6e11bf8f212e1ac74d567e1`, package and installed
CLI 0.1.414, Node 24.22.1, Vitest 5.0.3, Linux, 24 CPUs. Investigation began
2026-11-07 at 22:39 Europe/Warsaw. Initial `/proc/loadavg`: **18.96 9.52 7.82**;
later check **16.51 10.19 8.13**; final probe's one-minute load **16.85**.
All were below the 24-CPU threshold. The probe checks this itself. No live
reproduction was skipped because of load; the limit was incident fidelity.

## Questions answered

| Question | Tagged answer and examined version |
| --- | --- |
| 1. Can Stop hold for pending lint without a dirty source diff? | **verified by experiment, 0.1.414:** yes, with synthetic clean commit metadata after a revision advance. One unrelated pending lint check caused a bounded hold. Actual reset/build admission remains undetermined. |
| 2. Does parking for a parent or CI reply change the decision? | **read in source code, 0.1.414:** Squeal's Codex parser and Stop handlers read no external-wait or completion-intent signal. **verified by experiment, 0.1.414:** invented hints were dropped and yielded the same hold. Actual Cezar wait integration was not exercised. |
| 3. What controls the delay and repetition? | **read in source code, 0.1.409 and 0.1.414:** `stop.slowWaitMs` defaults to 120000 and covers required lint. `stop.maxHolds` defaults to 1 per consumer turn. **verified by experiment, 0.1.414:** with a 150 ms budget, four held cases took 157–159 ms; the next waiting Stop was silent. |
| 4. Is this the same request as #153 or #156? | **inferred, 0.1.414 and issues fetched 2026-11-07:** #153 shares the no-edit/provenance mechanism; #159 adds parking after recorded changes and an external-wait contract question. #156 concerns discovering the budget setting. Neither comparison proves an exact duplicate of the complete issue. |

## Evidence

### 1. The no-edit exemption concerns observation history

**read in source code, 0.1.414.** `unchangedSinceRegistration` requires the latest
revision to equal the consumer's registration revision and `seesEveryChange` to
confirm the same daemon that had completed its start scan. It does not inspect a
Git diff, changed-file authorship or a completion claim. Its comment states:
“Any revision counts, another session's or the agent's own.” Spec 004 D9 defines
this rule; 019 D4 explicitly preserves it. A clean tree after a reset is therefore
not sufficient evidence for this exemption.

**verified by experiment, 0.1.414.** Five cases ran through the real Codex parser,
quick Stop and waiting Stop, with real stores and a fake daemon endpoint:

| Synthetic input | Unchanged exemption | Lint requests | Waiting-entry result |
| --- | --- | --- | --- |
| Same revision, same scanned daemon | yes | 0 | silent, 2 ms |
| New revision, `dirty: false`, parent-reply hint | no | 1 | block, 159 ms |
| Same new-revision state, CI hint | no | 1 | block, 159 ms |
| Same new-revision state, completion hint | no | 1 | block, 157 ms |
| Same revision, missing scan evidence | no | 1 | block, 159 ms |

All five passed. Every held case recorded one hold and the next waiting entry
returned silently. The fixture did not change source bytes or run Git: its clean
metadata and generated-file revision were injected, not observed from a build.

### 2. Required-group lint is distinct from ordinary lint news

**read in source code, 0.1.414.** `requiredLintOpen` selects pending or stale lint
states in required groups across the worktree. It does not narrow them to files
this consumer edited. `requiredStep` applies the no-edit exemption first.
`stopSlow` requests the open group and waits until it settles, its budget expires,
or the daemon-down bound ends the wait. The probe used `lint.blocking: false`.

**read in official docs (repository specs), checkout above.** 017 D8 says an
ordinary lint result not yet stored is not waited for at Stop. The later 019 D1/D4
rule explicitly makes a lint group at `stop` required and waited for; 019 status
records this as row 019-45, shipped in 0.1.406. These are different policy paths.
011 C8 defines the shared hook contract and Codex's 002 D3/D5 mapping supplies the
Stop boundary. 011 C10 defines shared capacity, including lint parts. This probe
does not measure queue throughput, capacity contention or daemon heartbeat delay.

**verified by experiment, 0.1.414.** The pending case produced:

```text
Squeal policy checks puts the lint group at stop and after 0.1 s 1 lint check is still not linted at revision 2: src/untouched.js. `squeal run lint --wait` waits for their results.
This is Stop's last hold this turn: no later Stop in it waits for the lint group, and `squeal run lint --wait` runs it and waits for its results.
```

**read in source code, 0.1.409 and 0.1.414.** A local release-tag comparison found
only import/export changes in the inspected decision files; the examined Codex
parser/handlers and policy defaults were unchanged. This supports the mechanism's
relevance to the reported 0.1.409 incident, but is not a runtime test of 0.1.409.
The 120000 ms default comes from `src/core/types/policy.ts`; the wait cap and
requests are in `src/core/slow/stop-wait.ts`. `stop.waitMs` is the separate quick
entry budget, capped at 1500 ms. Raising a budget does not distinguish parking.

### 3. Related reports and decision

**read in official docs (GitHub reports), fetched 2026-11-07.** #159 reports
0.1.409 at revision 4 with 2817 pending checks, then a later hold with 1744. Its
CI-wait comment records revision 26, `dirty: false`, and a queue that progressed.
Later comments report broad relint after a merged config and shared setup change.
Those are incident reports, not measurements reproduced here.

**inferred from the evidence above, 0.1.414.** Link #159 to the proposed `gh-153`
row's Stop-provenance decision. #153's research already reproduced missing-scan
and cleared-daemon cases; #159 also concerns a later revision while the daemon
remains available. Its external-wait request is distinct from #153's environment
cleanup question. Keep #156's setting-discovery request separate: a clearer
timeout message would not remove the parking/completion ambiguity.

The deciding tradeoff is prompt release of an external wait versus preserving
required-check evidence when revisions or observation gaps exist. A broader
exemption needs a policy decision and a trustworthy harness signal. This finding
authorizes no bypass of required checks, requested stops, command holds or
coverage/environment leases, and proposes no product implementation.

## Open questions

- Which hook input and effective `checks`, `lint` and `stop` policy applied at
  the incident, and which consumer/registration and scan evidence did Stop read?
- Which paths and inputs made revision 4 and the lint backlog after reset/build?
  The probe does not establish that generated assets caused all queued checks.
- Can the harness provide an authoritative distinction between parking and task
  completion? Invented fields in this probe establish no such interface.
- Did repeated holds belong to different prompt turns or registrations? The
  supplied incident output cannot establish a breach of the per-turn hold cap.

## Sources and checks

- Fetched with `gh issue view <159|153|156> --repo hearsay-tools/squeal --json number,title,body,comments,url,state`:
  [#159](https://github.com/hearsay-tools/squeal/issues/159), [#153](https://github.com/hearsay-tools/squeal/issues/153), [#156](https://github.com/hearsay-tools/squeal/issues/156).
- Source at [d3f36305](https://github.com/hearsay-tools/squeal/tree/d3f363054fbe5d30e6e11bf8f212e1ac74d567e1):
  `src/harness/shared/{no-edit,stop-required,stop-slow,stop}.ts`,
  `src/core/{delivery/registered,state/required,slow/stop-wait,types/policy}.ts`,
  `src/harness/codex/{input,handlers}.ts`. Local tag `squeal--v0.1.409` resolves
  to `6edeb3cba35642d8c2f52c5e77e2e41bf4651270`; compared with `git diff squeal--v0.1.409 HEAD -- <these decision files>`.
- Read 011 C8/C10, 019 D1/D4, 017 D8 and their status logs; Codex 002 D3/D5;
  004 D9; [issue-153.md](issue-153.md) and board row `gh-153`.
- [Probe and exact commands](probes/issue-159/README.md),
  [raw output](probes/issue-159/output.txt): one file,
  **5 passed**, exit 0. Focused Biome check passed. No product test suite,
  full suite, build or live incident replay was run.
- Affected check: `/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 docs/specifications/011-core/research/probes/issue-159/stop.test.ts docs/specifications/011-core/research/probes/issue-159/vitest.config.ts docs/specifications/011-core/research/issue-159.md`
  exited **3** at revision 12: the probe is outside runner discovery; no test
  closure holds the config or report. Worktree: **known failures 0; 529 of 1490
  test files not current, all 529 unknown**. This is no product-suite verdict.
  Squeal also reported the probe as untested, with CRAP 156 for its case function;
  the direct five-case run above is its verification. No coverage claim is made.

## Integration verification

The coordinator moved the throwaway probe into this spec’s `research/probes/issue-159/` as required by the triage scope, and adjusted imports and config paths. The documented focused command passed again: 5 tests, exit 0, at one-minute load 16.32/24 CPUs on 2026-11-07 at 22:46 Europe/Warsaw. No product suite was run.

After relocation, repository Biome ignored both probe files under `docs/**` and processed zero files (exit 1); the worker’s original Biome pass predates relocation. `git diff --check` passed.
