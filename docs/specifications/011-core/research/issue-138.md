# Issue 138: a busy store during revision application

Recommend treating issue 138 as new evidence for held row 011-104, with its hold unchanged.

The public daemon recovered two saved edits after a write lock on both 0.1.390
and 0.1.393. A controlled scheduler probe reproduced the exact apply error and
left an added file without a key even after a later revision. The deciding
tradeoff is recovery of all affected files, not merely advancing the revision
number. Neither probe identifies the original incident's lock holder.

## Questions and verdicts

The brief's question is split into five checks below. Experiments and source
were read on 2026-11-03 Europe/Warsaw. Product source: 0.1.393,
`99d1a0e551097cd6cef71b4fe441205263900c30`. Incident runtime and second CLI
probe: 0.1.390, tag commit `ee3531548ed52c4ba692b48b0ae430d9c4965e48`.

| Question | Answer, evidence tag and version |
| --- | --- |
| 1. Does a database writer delay saved revisions? | Yes. **verified by experiment**, bundled 0.1.390 and 0.1.393: two saves under a 12 s lock left the selected wait at revision 0. |
| 2. Does release apply the newest source without losing edits? | Yes for the change-feed probe: both edits were in revision 1 and both new values passed at revision 2. Not guaranteed for refinement: after two refused applications, one added file still had a null key at revision 3. **verified by experiment**, CLI versions above and source 0.1.393 respectively. |
| 3. Can an old pass become a false current selected verdict? | None observed in either public CLI run. During the lock the old file read `current/pass`, but `selection.result=none`, `reason=unsynced`, exit 3. The controlled refinement probe did not exercise the CLI. **verified by experiment**, 0.1.390/0.1.393; wider guarantee **not determined**, because these probes cover only the named cases. |
| 4. Does this reproduce issue 138 and establish its cause? | It reproduces delayed visibility and, separately, the exact apply-error symptom under controlled timing. It does not reproduce the original multi-worktree incident or establish its cause. **inferred**, issue 138's 0.1.390 record plus probes. |
| 5. Which existing work owns this evidence? | 011-104 is the exact symptom and missing-key overlap. Issues 87, 108 and 132 describe related but different operations or conditions. **inferred**, issue bodies fetched with `gh` and board at the source commit above. |

## Findings

### F1. The public change-feed path recovers

**verified by experiment — 0.1.390 and 0.1.393, Node v24.22.1, actual Vitest
5.0.3.** `live.mjs` starts one isolated daemon and one test file. It holds the
fixture store's write lock, changes `a=1` to `a=2`, then 1.5 s later changes
`b=1` to `b=3`. It holds the lock past the daemon's normal 5 s write timeout.

| Runtime | One-minute load / CPUs | Actual hold | During lock | After release | Assert both new values |
| --- | --- | --- | --- | --- | --- |
| 0.1.393 | 17.91 / 24 | 12,007 ms | revision 0; exit 3, unsynced | revision 1; expected fail, exit 1; command 1,456 ms | revision 2; pass, exit 0; 450 ms |
| 0.1.390 | 18.07 / 24 | 12,005 ms | revision 0; exit 3, unsynced | revision 1; expected fail, exit 1; command 1,490 ms | revision 2; pass, exit 0; 1,304 ms |

Both runs recorded `the store was busy for 11.8 s ... ran once it was free:
the heartbeat, consumer expiry, revision 1`. Neither emitted `could not apply
revision`. These two saves coalesced into one stored revision; this does not
prove recovery of multiple already-stored revisions. That is F2's case.

The old per-file pass remained visible during the lock. The named text warned
that the result might not cover edits made before the wait. The aggregate
selected result withheld a verdict. Gate on `selection.result` or
`selection.code`, not the per-file `state`. C15 states this rule.

### F2. Two refused runner refinements leave a file without a key

**verified by experiment — source 0.1.393, Node v24.22.1, Vitest 5.0.3.** The
final controlled probe began at load 17.79 / 24 CPUs. Five baseline files were
current. It paused the first new closure, stored additions of `new-one.test.ts`
and `new-two.test.ts` as revisions 1 and 2, then held a separate SQLite writer
for 3 s while allowing refinement to continue. To keep this fault probe short,
it reduced the scheduler connection's busy timeout to 100 ms. No product
source changed.

After release and scheduler idle, plus 500 ms:

- latest revision: 2; refined revision: 0; `runnerPartPending=true`;
- neither new file had a stored key row;
- callback errors included `could not apply revision 1: Error: database is
  locked` and the same for revision 2; note persistence also failed while locked.

A later edit to `new-two.test.ts` produced revision 3 and refined revision 3.
That file ran and became current. `new-one.test.ts` was then listed with
`key=null`; six files were current and one was unknown. The probe passed its
assertions of this defect. It did not establish permanent loss: it did not
wait for a real daemon's periodic reconciliation or restart. Source bytes
were never lost; the missing state is validation/key application.

### F3. Source explains why the two probes differ

**read in source code — 0.1.393; the four main path files below have no diff
from tag 0.1.390.** `daemon-loop/index.ts:147` installs a busy-error retry for
change-feed passes. `scheduler/runner-work.ts:218` catches refinement errors,
reports `could not apply revision N`, and tries to mark that revision refined.
Its comment at line 263 is explicit: “nothing retries it”. `drain` shifts the
task from its queue before running it.

`refinement.ts` applies keys and then calls `storeClosures`; the latter opens a
write transaction in `scheduler/revision.ts:281`. `ledger.ts:628` puts drained
writes back on a busy commit, but that alone does not replay the failed
refinement task. This supports the observed missing-key mechanism. It does
not prove which transaction failed in the original incident.

`cli/verdict.ts:203` checks unsynced and unlisted/pending/non-current conditions
before returning pass. C2 requires prompt revision recording and pending
refinement; C4 defines validity by keys; C6 requires a coherent read; C7
separates retryable writes from runner commits; C9's daemon lock is a different
lock; C13 describes busy handling; C15 supplies the named-result gate. The
status amendment log and 011-104's human hold were read. No hold is removed.

### F4. Original incident and related issues remain distinct

**inferred — fetched issue records, versions as reported.** Issue 138 reports
apply failures at revisions 2 and 3, a wait at revision 6, then revision 7 with
the correct HEAD, without manual restart. This proves reported delay, not a
permanently lost edit or a false pass. Its daemon-start lock notes do not
identify the SQLite writer that blocked refinement.

- **011-104:** exact error plus files without keys; held on 2026-10-22 after
  one sighting. F2 is new synthetic evidence for that held row.
- **#87:** an older active run blocked selected waits. The report does not
  establish a store-write cause. Same user-facing delay, different evidence.
- **#108:** busy clearing the stop mark during `start` on 0.1.359. This is a
  different write; an alive daemon did not prove the mark was cleared.
- **#132:** revision-zero cached current/pass files with aggregate unsynced on
  0.1.389. Similar display to F1, but no lock was established in that report.

## Recommendation and open questions

Attach these findings to 011-104 and issue 138 for the human's revisit decision.
Keep implementation held. A later approved investigation must distinguish
revision storage from runner refinement and must inspect every affected key,
not only the latest revision number.

Not determined: the incident's writer, exact failing transaction, lock duration
and host load; whether periodic reconciliation or restart recovers F2's missing
key; whether the same controlled schedule fails with the production 5 s timeout;
and named-CLI behavior for F2's missing file. The attempted production-timeout
variant was **not reproduced, because** its pre-probe load was 24.49 on 24
logical CPUs; it skipped before fixture creation (one skipped, zero run). F1
used existing-file edits, F2 used added files. Neither is a broad correctness proof.

## Sources and verification

- [Issue 138](https://github.com/hearsay-tools/squeal/issues/138),
  [87](https://github.com/hearsay-tools/squeal/issues/87),
  [108](https://github.com/hearsay-tools/squeal/issues/108),
  [132](https://github.com/hearsay-tools/squeal/issues/132): fetched using
  `gh issue view <number> --repo hearsay-tools/squeal --json number,title,body,state,url`
  (138 also requested `comments`). Reports are evidence of reported behavior,
  not independent verification of the original environment.
- [Spec](../spec.md): C2/C4/C6/C7/C9/C13/C15;
  [status](../status.md); `docs/board.md`, row 011-104.
- Source at `99d1a0e`: `src/core/daemon-loop/index.ts`,
  `src/core/scheduler/{runner-work,refinement,revision,ledger}.ts`,
  `src/cli/verdict.ts`. Comparison command:
  `git diff squeal--v0.1.390 HEAD -- src/core/scheduler/runner-work.ts src/core/scheduler/refinement.ts src/core/scheduler/ledger.ts src/core/daemon-loop/index.ts`
  returned no diff.
- [Probe README and exact commands](probes/issue-138/README.md);
  [0.1.393 CLI output](probes/issue-138/live-output.jsonl),
  [0.1.390 CLI output](probes/issue-138/live-0.1.390-output.jsonl),
  [refinement observations](probes/issue-138/refinement-observations.jsonl),
  [final probe result](probes/issue-138/refinement-output.txt): one probe passed
  in 11.91 s. The [production-timeout attempt](probes/issue-138/refinement-production-output.txt)
  skipped at the host-load gate; its [load record](probes/issue-138/refinement-production-observations.jsonl) is retained. `node --check` passed. No full repository suite ran. Only research
  artifacts changed; no implementation, spec, status or board changes. Final
  `/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000`
  with the report, `live.mjs` and `refinement.probe.ts` paths returned exit 3:
  no test closure holds these paths; all 1,385 repository test files current.
  This is not probe coverage; the direct isolated runs above supply that evidence.
