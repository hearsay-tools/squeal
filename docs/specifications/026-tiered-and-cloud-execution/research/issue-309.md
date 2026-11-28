# Issue 309: missing committed sibling module and later remote loss

**Partially reproduced, with an injected delivery gap, on Squeal 0.1.665.** A committed sibling module omitted from the synthetic remote tree can escape the real closure walker and lane proof, allowing the same import error twice. The original Agent37 sync loss and later unreachable host were **not reproduced, because** this bounded probe uses a synthetic transport, transform and runner rather than the reporter's worktree, real Vitest or Agent37 connection. No product change or policy change is authorized.

Examined 2026-11-28 at commit `018267eeae8a99e1cd7fb90a5cdb33e737eecf04`, package version **0.1.665**, Node **v26.13.0**. Reported incident: CLI **0.1.665**, Antigravity plugin **0.1.640**. Initial host load **3.38 / 16 CPUs**; probe load **3.05 / 16 CPUs** (five/fifteen-minute averages **2.34/2.79**). The load guard allowed the probe. Command exit **0**, about **0.74 s**. No cloud instance, held resource or user configuration changed.

## Questions answered

| Question | Answer and evidence |
| --- | --- |
| Can an omitted new sibling produce a proven import failure? | **Verified by experiment, 0.1.665, conditional:** create and commit `src/codex-questions.ts`, but deliver only its importer. The real graph walker omits the sibling after the synthetic transform throws. The real lane accepts a file-level failure with proof over only the test and importer. |
| Does the error repeat, and can delivery repair it? | **Verified by experiment, 0.1.665:** two consecutive lane runs each return one completed file with one import error and no repair send. Explicit delivery recovers. In the control, adding the sibling to proof paths triggers one resend and a successful second attempt. Both cases have zero local runs. |
| Does commit itself cause a missed sync? | **Not determined:** the file really is committed in the fixture, but the missed send is deliberately injected. The watcher, commit hook, Git bootstrap/index sync and scheduler do not run. |
| Did the missing module cause the later 30-second timeout? | **Not determined:** no real connection or hung runner runs here. The report alone does not establish this causal link. |
| Is the UNKNOWN outcome a fallback bug? | **Read in official docs, 021 D13 and 026 D8:** `whenLost: "not-run"` deliberately leaves files unknown without local fallback. Whether reconnect/backoff failed in this incident is not determined. |

## Evidence and limits

**Read in official docs (issue report, not independently verified):** [#309](https://github.com/hearsay-tools/squeal/issues/309) describes missing `ask-card-parts.tsx` at revisions 10–29, 216 failures after adding `codex-questions.ts` at revision 39, and 482 checks changing from PASS to UNKNOWN when Agent37 stopped answering at revisions 44–46. The reporter did not try restarting the daemon. A mix of installed plugin versions is reported; its role is unknown.

**Verified by experiment, 0.1.665:** [probe.ts](probes/issue-309/probe.ts) adapts [issue 307's probe](probes/issue-307/probe.ts). Two tiny temporary trees start equal. The local tree creates and commits a sibling and its changed importer. The fixture deliberately withholds the sibling. Real `importClosure`, `withRemoteLane`, Git membership and blob hashes determine the proof and acceptance result. Synthetic transform, transport and runner output model the missing-file error; runtime observations are absent. [result.json](probes/issue-309/result.json) records two accepted errors, explicit recovery, and the candidate-in-proof control. This confirms the same conditional mechanism as #307, not that the production watcher lost these files or that stored keys were current.

**Read in source code, 0.1.665:** `src/runners/vitest/graph.ts` catches transform errors in `importTargets` and returns no targets. `src/core/runner-host/remote/lane.ts` obtains closure paths from the remote planner and compares the supplied proof. With neither closure nor observed inputs naming the missing sibling, that sibling cannot force a mismatch. Whether real Vitest/observation retains the candidate for the original `.tsx` and `.ts` imports remains open.

**Inferred:** primary owner **026 D7.3/D8/D10/D12**, related **021 D10/D11/D13**. #307 overlaps the proven conditional import mechanism; #306 overlaps refusal/recovery machinery but has a different reproduced outcome. #80 has the same broad new-module symptom but no proven shared remote cause. Keep #309's later unreachable-host symptom explicit until incident evidence connects it. Existing holds and `whenLost: "not-run"` stand.

## Recommendation

**Inferred from source and probe:** the human can approve a bounded diagnosis shared with #307 for actual sibling-file delivery and real Vitest closure/observation completeness, while retaining a separate question about connection recovery. Capture revision, sent paths/blobs, remote closure and observed paths, proof, reconnect events and exact plugin/runtime versions. Never accept an incomplete-tree failure as current. Do not silently change loss policy. This research grants no implementation approval.

## Commands and sources

Commands executed from the repository root; `~` abbreviates the home directory in the launcher:

```sh
gh issue view 309 --repo hearsay-tools/squeal --json body,title
uptime
getconf _NPROCESSORS_ONLN
git rev-parse HEAD
node -p 'require("./package.json").version'
~/.codex/plugins/data/squeal-hearsay/bin/squeal checks
pnpm exec tsx docs/specifications/026-tiered-and-cloud-execution/research/probes/issue-309/probe.ts > docs/specifications/026-tiered-and-cloud-execution/research/probes/issue-309/result.json
```

The probe executes `git init -q`, `git add .` and two `git -c user.name=Probe -c user.email=probe@example.invalid commit -qm ...` commands only in its temporary local tree; it removes both trees in `finally`. `squeal checks` exited 0 and reported **0 test files** at inspection, with startup still incomplete; this is not a test-suite pass. The explicit research probe is outside normal suite coverage. No full suite ran.

Sources: linked issue, [issue 307 findings](issue-307.md), [spec 026](../spec.md) and [status](../status.md), [spec 021](../../021-remote-store-and-execution/spec.md), named source files, and the retained probe/output.

Completion check: path-scoped `squeal status --wait 60000` over the board, findings and all three probe files returned exit 3: no test closure holds these documentation/research paths. Worktree had 0 known failures and 4/2348 test files unknown; no suite pass is claimed. `git diff --check` passed.
