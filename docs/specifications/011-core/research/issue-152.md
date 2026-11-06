# Issue 152: completed files inside a named batch

Treat early verdict publication as a validity-contract change; investigate the reported changed-file queue delay separately.

Partial reproduction, 2026-11-06. The completed-file delay reproduces on installed
Squeal **0.1.407**. A later named file with no known duration waits behind the
batch. A later **edited** file runs beside it and becomes current before it ends.
The original report's changed-file blockage is **not reproduced**, because this
small edited-file case advances normally and the original 290-file history was
not replayed. This research changes no product, policy, spec, board or hold.

## Questions and verdicts

| Question from the brief | Answer and evidence tag | Version examined |
| --- | --- | --- |
| 1. Does a completed file become current before a non-yielding named batch ends? | No. Its module end is visible but its key has no stored results until the tier ends. **verified by experiment** | Squeal 0.1.407, Vitest 5.0.3 |
| 2. Is the pending state due to a changed revision or key? | No in the unedited case: revision 0 and identical keys throughout. In the edited case only the later file changes key; the original pair still waits. **verified by experiment** | 0.1.407 |
| 3. Must a later narrow wait also wait? | An unedited file with unknown duration queued; an actual edit passed beside the batch. These are separate scheduling cases. **verified by experiment** | 0.1.407 |
| 4. Does the current streaming contract promise early verdicts? | No. `fileEnded` streams progress, not results. Final report, completion barrier and stability checks precede storage. **read in source code** | 0.1.407 source at `7cc32a610`; same callback contract at 0.1.403 tag `138bdc6f1` |

## Experiment and exact evidence

The session began at 04:27 Europe/Warsaw. Initial commands were
`cat /proc/loadavg` and `getconf _NPROCESSORS_ONLN`: **1.81** one-minute load,
**24** CPUs. Before each live run the probe checked Node's `loadavg()[0]` against
`cpus().length`: **6.37/24** and **7.21/24**, both below the skip threshold.
The two runs started at 04:29:18 and 04:30:24 Europe/Warsaw and each stopped its
own daemon in about 24 s. No 290-file parity run or full suite was requested.

Commands, generated fixture, CLI arguments and environment isolation are in
[`probes/issue-152/README.md`](probes/issue-152/README.md).
Both used Node **v24.22.1**, Vitest **5.0.3**, and the retained runtime at
`/home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.407/dist/cli/squeal.mjs`.
The launcher and that runtime each printed `0.1.407`. The issue reports
**0.1.403**, based on its retained session skill path; that does not independently
identify the historical daemon binary. I read the 0.1.403 tag but did not run it.

**Question 1 — verified by experiment, 0.1.407.** In the unedited probe,
`status --wait 60000 --json fast.test.ts slow.test.ts` started one two-file batch.
At 2.878 s after probe start, status reported one ended file. A separate 1.5 s
wait on `fast.test.ts` returned **3**, `timeout`, `result: none`, `pending`.
A read-only store snapshot at 22.059 s still showed no result rows and the batch
open. Its text said:

> 1 ended at revision 0, awaiting the tier's final checks and 1 file not reported ended ... the tier does not yield: it runs a file this wait or an earlier one selected

The original wait returned **0** at 23.019 s. The store records the fast and slow
passes at the same time, `1793935781058`, when their run ended. The final named
wait returned **0**, with all three files current and passing. Evidence:
[`evidence/`](probes/issue-152/evidence/), especially
`fast-wait.json`, `mid-batch.txt`, `store-mid.json`, `store-final.json`, and
`events.json`. The two rows per file are its test and file-level results.

**Question 2 — verified by experiment, 0.1.407.** Revision stayed **0** throughout
the first run. The fast key stayed
`3bedbb35bcc755d86d92d4e05640658816145d965110bbe58e18c626e42ce4c5` and the slow key
stayed `684dfe2bec62feb0baf1f69bfd80ab393971193f43764bb0dd3eceb54e1ef47f`.
There was no earlier cached verdict: the isolated store started empty and the
lookup-only baseline queued nothing. Named waits asked the files' first runs.
This proves the delay can occur without a re-key, stale result or invalidated
run. It does not prove that final validity checks can safely be skipped.

**Question 3 — verified by experiment, 0.1.407.** The later 50 ms file had no
stored duration. Its 1.5 s named wait returned **3**, queued and promoted in batch
2 behind batch 1. It ran after the original batch, then passed. In the second
isolated run the probe added a comment to `later.test.ts` at 4.732 s, then waited
on it. That wait returned **0** at 6.173 s, while the original batch stayed open
until about 22.305 s. `store-before-end.json` holds the later file's revision-1
pass beside the still-open revision-0 run. The original fast/slow keys were
unchanged. Final status at revision 1 classified all three files as current;
the original pair's results correctly retain run revision 0. Evidence:
[`evidence-edited/`](probes/issue-152/evidence-edited/).
Here “narrow” means fewer named file paths, not C15's `--check` partial-test mode.
No `--check` request was exercised.

## What the contracts and source establish

**Question 4 — read in source code, 0.1.407 and the 0.1.403 callback.** C4 says
“A tier stores its results when it ends” and explicitly rejects storing each
module's result on module end: a later run crash, byte check or touch check can
invalidate it. C14's implementation, `src/core/types/runner.ts:274–284`, says:
“It stores nothing: results wait for the report, the completion barrier and the
stability check”. Spec 013 V4's streaming promise is the module-end callback;
V5 covers byte and touch evidence. It is not a stream of current verdicts.

The implementation follows this split. `RunCollector.moduleEnd` calls the
callback (`src/runners/vitest/reporter.ts`). `executeTier` updates `Tier.ended`
and releases spare capacity (`src/core/scheduler/tiers.ts`). `Scheduler.#fly`
awaits the complete `executeTier` result before calling the recorder
(`src/core/scheduler/scheduler.ts:1118`). `recordTier` stores results per file
inside the ending transaction. `git diff squeal--v0.1.403..HEAD --` for
`src/core/types/runner.ts`, `src/runners/vitest/reporter.ts` and
`src/core/scheduler/tiers.ts` was empty. This is source continuity, not a runtime
reproduction on 0.1.403.

**Read in source code/spec, 0.1.407 checkout.** C6 reports current keys and actual
stored evidence. C15 preserves named batches in request order beyond the wait's
deadline. C4 step 5 permits a second Vitest instance for edit work or a later
batch whose queued files have at most 30 s of known time, **none unknown**. Thus
the unedited later-file observation fits the policy; the edited-file observation
fits its exception. Neither establishes why the report's two changed files
failed to advance. `--check` is a separate contract and does not create a
current keyed result.

## Recommendation, limits and open questions

**Inferred from the experiments and contracts, 0.1.407:** preserve the final
validity checks. Treat publication before tier end as a proposed contract change
requiring the coordinator's design and the human's decision. The deciding
tradeoff is early evidence versus a verdict that a later whole-run failure or
input check would retract. The small fixture proves latency, not safe early
publication. Diagnose changed-file scheduling separately before claiming that
all narrow waits are blocked or that a scheduler repair is needed.

The original 0.1.403 daemon, 31-file batch, 290-file selection, shared fixture
edit and 11 repeated waits were not replayed. No long stall, cancellation,
crash, touch or failed validity check was induced. No exact historical keys,
edit classification or lane occupancy were supplied, so their role is not
determined. A shared `node_modules` link produced a pnpm-lock diagnostic; Squeal
used package-manifest hashing instead. Both runs kept stable keys for the
original pair. This limits install realism, not the observed ordering.

## Sources and verification

- [Issue 152](https://github.com/hearsay-tools/squeal/issues/152), fetched with
  `gh issue view 152 --repo hearsay-tools/squeal --json number,title,body,url,comments`.
- [011 spec](../spec.md), C4/C6/C14/C15, and [status amendments](../status.md),
  especially 011-268/269 and 011-283; read at `7cc32a610bf3d00a331dffa76205f30251fafd79`.
- [013 spec](../../013-vitest-runner/spec.md), V4/V5, and its status log at that commit.
- [0.1.403 callback source](https://github.com/hearsay-tools/squeal/blob/138bdc6f14f068708dfe9927c8471a3ede8235a8/src/core/types/runner.ts#L274),
  read with `git show squeal--v0.1.403:src/core/types/runner.ts`.
- [Probe and evidence](probes/issue-152/README.md): two live
  scenarios, each final named selection passed 3 files; both daemons stopped
  with exit 0. No repository suite was run. Probe formatting/lint and affected
  status are recorded in [`verification.txt`](probes/issue-152/verification.txt) beside the probe.
