# Issue 284: zero-finding lint config news at Stop

Recommendation: ask the human whether a clean lint config summary should remain standalone Stop news under 017 D8; the observed one-time continuation follows the current delivery rule.

Examined 2026-11-26: Squeal **0.1.636**, checkout `13e3a35bd04d3796f8082764e6bdcad140fd8e3f`, Node `v26.13.0`. Issue [#284](https://github.com/hearsay-tools/squeal/issues/284) was read with `gh issue view 284 --repo hearsay-tools/squeal --json title,body,url,createdAt,comments`. This is documentation-only triage. Existing holds stand; no fix or spec change is authorized.

| Question | Answer and evidence |
| --- | --- |
| Can a config summary with zero lint findings and zero known failures block Stop? | **Verified by experiment, 0.1.636:** yes, through the real Codex Stop handler over synthetic main/lint stores, with one passing test file and one passing lint file. |
| Does the same summary repeat? | **Verified by experiment, 0.1.636:** the continuation Stop and a later ordinary Stop both return `null`. |
| Does this violate a current normative rule? | **Read in source code, 0.1.636:** 017 D8 requires a config summary and independently makes untold lint news eligible at Stop. It gives no positive-count condition for that summary. The implementation applies both rules together. |
| Was the original branch-switch incident reproduced? | **Inferred from the issue report, reported version 0.1.636:** no. The report names revision 17 after a checkout in `hearsay-tools/squawk`, but records the installed version only at session end. The exact hook, state before delivery, and branch/config bytes are not supplied. |

## Experiment

**Verified by experiment, 0.1.636.** The throwaway [probe](probes/issue-284/reproduce.mts) creates temporary SQLite stores and a fake repository layout. It registers a consumer at a completed first lint keying, then inserts a completed config keying at revision 2. A synthetic passing test file and a synthetic passing lint file remain current. It calls the actual `src/harness/codex/handlers.ts` `stop` function, which enters the shared Stop and delivery code. All optional failure/full-suite Stop gates and `lint.blocking` are off. The daemon heartbeat and the `ensureDaemon` result are synthetic; no daemon, test runner, linter, branch checkout or external wait is started. Temporary stores are closed and removed.

Initial host check: `cat /proc/loadavg` returned `0.74 0.28 0.23`; `getconf _NPROCESSORS_ONLN` returned `16`. Immediately before the successful probe, load was `0.91 0.55 0.34`, with 16 CPUs. The probe checks load again and skips above the CPU count. No heavy work or suite ran on this host.

Commands from the repository root:

```sh
cat /proc/loadavg
getconf _NPROCESSORS_ONLN
pnpm exec tsx docs/specifications/011-core/research/probes/issue-284/reproduce.mts
```

Result, exit **0**:

```text
FIRST_STOP {"decision":"block","reason":"SQUEAL · lint config changed at revision 2\nRevision 2 (changed eslint.config.js).\n\nLint config changed: 0 files with findings now; squeal lint lists them.\nKnown failures: 0; all 1 test file is current (run on the files as they are now)."}
CONTINUATION_STOP null
LATER_STOP null
PASS: zero-finding config summary blocks once through the real Codex Stop handler
```

An earlier exploratory run with no test inventory also returned `decision: block` and the zero-finding summary, but its assertion for the literal `Known failures: 0` failed: the formatter intentionally omits that count before tests are listed. Adding the synthetic passing test inventory made the final probe show both literal zero counts. This was a probe-fixture correction, not a product change or test-suite failure.

The session-pinned Squeal skill was read before the probe. The checks command was `~/.codex/plugins/data/squeal-hearsay/bin/squeal checks`. It reported default edit-triggered tests, 2,069 pass and 207 not current at that read, with typecheck, build and `test/e2e/**` outside coverage. Those are unrelated background counts, not a suite pass claim. No test suite was requested for this research.

## Rule and source seam

**Read in source code, 0.1.636.** [011 C5](../spec.md#c5-state-transitions-and-delivery-views) owns consumer views; [C8](../spec.md#c8-hook-contract) owns shared hook behavior; [C14](../spec.md#c14-adapter-contracts) points the harness side back to C8. C8 says an end of turn speaks only with news. Its gh-93 amendment excludes some informational liveness/hold changes, not lint summaries. [017 D8](../../017-lint-checks/spec.md#d8-what-the-agent-sees) supplies the lint-specific rules:

- A config or ESLint change gets one summary after the pass ends, and re-seeds views by count.
- The 2026-11-01 amendment says: “A lint change not yet told is news at Stop by itself, as a test change is: Stop holds once, tells it and never repeats it.” [017 status](../../017-lint-checks/status.md) records the human's “Yes, like tests” decision and row 017-23's landing in 0.1.392.
- `lint.blocking` is separate: lint failures never count in `Known failures`. Zero known test failures therefore does not decide whether lint news exists.

The relevant implementation sequence is:

1. `src/core/lint/surface/deliver.ts:99`, `summaryOf`: an unseen, completed keying returns a summary using `countsOf`, including a zero failing count. `newsOf` treats a non-null summary as news even with no per-file entries.
2. `src/core/delivery/delivery.ts:328`: reads lint news at Stop independently; its `news` predicate includes `lint !== null`. Lint acknowledgement follows successful delivery transaction completion.
3. `src/harness/shared/stop.ts:307`, `newsText`: asks delivery for `{ stop: true }`, formats the delta and known-failure count. `decideTurn` can return `{ news }` without any failure-policy block.
4. `src/harness/codex/handlers.ts:110`: maps both `{ news }` and `{ block }` to the harness `block` response. Its comment states that Stop has no `additionalContext`, so news costs a continuation. A continuation's `stop_hook_active` runs quiet. Antigravity's `handlers.ts:118` similarly maps either outcome to `continueTurn`; this was read, not executed.

**Inferred, 0.1.636:** this sequence is sufficient to explain the reported extra turn without a lint finding, failing test or required-check hold. The tradeoff is preserving untold lint summaries at the last boundary versus spending a continuation to tell an informational zero count. Changing that balance needs the human's delivery-policy decision; these findings do not choose a repair design.

## Limits and open questions

**Inferred from the issue report, reported 0.1.636:** the original header also had 98 manual browser files pending, an unlisted runner inventory, and one earlier failure pending rerun. These are not current known failures. The clean synthetic fixture reproduces the block without any of them, but does not prove none influenced the original session. It also does not prove whether the checkout should have caused a config keying, or whether the actual harness was Codex, Antigravity or another adapter; the issue selects “Other or none” and names `gemini-4-neon-high`.

**Read in source code, 0.1.636:** existing `test/lint/wiring/stop.test.ts` covers standalone lint finding news and silent later Stops across four harnesses; `test/lint/surface/keyed-delivery.test.ts` covers config summaries with findings. These files were inspected, not run. The probe covers the zero-count delivery mechanism only, not a real provider pass or the original branch-switch incident.
