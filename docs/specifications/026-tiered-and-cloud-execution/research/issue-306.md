# Issue 306: rapid edits exhaust the remote proof retry

Keep #306 open as a proposed investigation of recovery after edit bursts, related to #300 but not a proven duplicate. **Partially reproduced on 0.1.665:** two deliberately timed tracked-file edits produce the exact refusal, but the next explicitly requested lane run succeeds once edits stop. **Persistent refusal after settling: not reproduced, because the bounded synthetic probe recovered and no original Agent37/server daemon or transport evidence was available.** No policy change or implementation is authorized.

Examined 2026-11-28: source **0.1.665**, commit `2ee7252e2f1230bdd426fd92bc823bef9ea805b2`; Node **v26.13.0**. Initial load **7.25 / 16 CPUs**, pre-probe shell sample **6.65 / 16**, probe-start sample **11.18 / 16**. All were below the stop threshold. Only a small in-process probe ran on this host; no heavy or isolation-dependent work, live provider, boat sandbox, full suite, or changes to held resources.

## Questions answered

| Question | Answer and evidence |
| --- | --- |
| Can rapid tracked edits produce this refusal in current code? | **Verified by experiment, 0.1.665:** an edit during each permitted attempt produces `its tree stayed different at src/input.ts` and `not run here (whenLost "not-run")`. |
| Does one resend already exist? | **Verified by experiment, 0.1.665:** one racing edit recovers on request 2 with one intervening invalidation. |
| Does a completed edit burst inherently fail? | **Verified by experiment, 0.1.665:** eight edits completed before the run, followed by one invalidation, complete on request 1. |
| Does refusal persist once edits stop? | **Verified by experiment, limited:** the explicit next lane run completes on request 3. Automatic daemon/scheduler recovery is **not determined**, because neither ran in this probe. |
| Is this fixed by #300's 0.1.665 release? | **Inferred:** not established. The named proof refusal differs from #300's repaired config/setup comparison; both already had a bounded proof resend. |
| Should `not-run` silently fall back here? | **Read in official docs:** no. Spec 026 D8.3 and 021 D13 require unrun/unknown; the 2026-11-27 human decision on row 026-40 keeps that rule for explicit requests too. |

## Findings

1. **Read in official docs (published issue reports, not independent incident verification).** [#306](https://github.com/hearsay-tools/squeal/issues/306) reports 0.1.660, Antigravity plugin 0.1.640, and a CLI later updated to 0.1.664. It names revisions 29, 36 and 45 and tracked server source paths. A CLI update alone does not establish the version of the daemon serving each revision. There is no incident capture at 0.1.665. [#300's release comment](https://github.com/hearsay-tools/squeal/issues/300#issuecomment-7229171318) says row 026-40 shipped in 0.1.665; its original three-fixture merge refusal remained unreplicated. Its real-runner research reproduced and repaired the distinct new setup-helper case.

2. **Verified by experiment, source 0.1.665.** [Probe](probes/issue-306/probe.ts) uses real `withRemoteLane`, blob hashing and tracked-file membership. A synthetic adapter copies actual bytes into a second temporary tree on invalidation and returns its actual blob hashes. It injects local edits after expected hashes are captured and before the reply, with watcher delivery delayed beyond that window. It does not merely hardcode a refusal. [Recorded output](probes/issue-306/result.json), exit **0**:

   | Scenario | First tier requests | Resends during tier | First outcome | After settling |
   | --- | ---: | ---: | --- | --- |
   | Eight settled edits + delivered invalidation | 1 | 0 (one initial invalidation) | completed | no further request needed |
   | One edit during the first attempt | 2 | 1 | completed | no further request needed |
   | One edit during each attempt | 2 | 1 | refused, zero completed files | explicit next run completed; one further send/request |

   All three record **zero local runs**. The third first report is `crashed` with the exact refusal wording, meaning incomplete validation rather than a test FAIL. The JSON records expected, remote and local-after blob IDs. Both refused attempts have expected = remote but local-after different: ongoing local edits alone can exhaust proof, without a broken byte-copy mechanism. The next request records all three equal. This is a deterministic one-input probe, not a real parallel multi-file implementation session.

3. **Read in source code, 0.1.665.** `src/core/runner-host/remote/lane.ts` has one attempt owner (`attemptTier`, `counted < 2`). `next` queues syncable differing paths after each failed proof, including the final allowed attempt. `runInputs` drains pending paths before remote planning on the next request. `differing` compares returned remote hashes against current local hashes. Thus the phrase “tree stayed different” can describe edits during both attempts, not only a permanently stale remote. This matches the probe's recovery and the contract in spec 021 D11.1. The lane alone does not prove when the scheduler will submit another tier after the refusal.

4. **Read in source code, version comparison.** `git diff squeal--v0.1.660 HEAD -- src/core/runner-host/remote/lane.ts` retains the two-attempt limit and the `next` resend mechanism. Changes include config/setup resend wiring, refusal status detail and observed-input filtering/remote-only classification. `lane-compare.ts` gained the #300 config/setup resend. `tree.ts` has no diff over this range. The experiment ran only current 0.1.665 source; **0.1.660 and 0.1.664 were not executed**, and the comparison does not prove the original daemon's behavior or rule out a transport race.

5. **Inferred, duplicate assessment.** #300 is related, particularly its unreproduced merge proof refusal, but its shipped setup-helper fix does not establish the cause of #306's tracked-source edit bursts. Do not close #306 as fixed solely from similar wording or intake's duplicate suggestion. [#307](https://github.com/hearsay-tools/squeal/issues/307) reports 0.1.665 and a different primary symptom: a stale remote tree allegedly produces a **current FAIL** after rebase and repeats it on retry. #306 reports **UNKNOWN/refused** during edits. They may share sync machinery, but the claims and required proof differ; no exact duplicate is established.

## Recommendation and limits

**Inferred from the evidence:** retain a separate proposed row under spec **026 D8/D10/D12**, with **021 D10/D11/D13** as the proof and loss-policy contract. The decision is whether to authorize a narrow investigation of automatic recovery once editing settles. Preserve the bounded retry and refuse unproved results; adding another unconditional resend alone does not establish or fix persistent recovery. Existing holds stand. `whenLost: "not-run"` remains no local fallback, including explicit requests.

Needed next evidence: serving daemon/runtime version; local and remote blob IDs across both attempts; invalidation delivery times; whether edits continued after attempt 2; and whether a subsequent affected tier was queued and completed. The original server runner, Agent37 transport, store UNKNOWN state, revision counts and `status --wait` behavior are not reproduced. No timing-frequency or performance conclusion follows from this synthetic run.

## Commands and sources

Exact principal commands, from the repository root; `~` abbreviates the user's home in the displayed launcher path:

```sh
gh issue view 306 -R hearsay-tools/squeal --json title,body,comments,state,url
gh issue view 300 -R hearsay-tools/squeal --json title,body,comments,state,url
gh issue view 307 -R hearsay-tools/squeal --json title,body,state,url
git rev-parse HEAD
node -p 'require("./package.json").version'
node --version
cat /proc/loadavg
getconf _NPROCESSORS_ONLN
~/.codex/plugins/data/squeal-hearsay/bin/squeal checks
git diff squeal--v0.1.660 HEAD -- src/core/runner-host/remote/lane.ts
git diff --stat squeal--v0.1.660 HEAD -- src/core/runner-host/remote/lane.ts src/core/runner-host/remote/lane-compare.ts src/core/runner-host/remote/tree.ts
pnpm exec tsx docs/specifications/026-tiered-and-cloud-execution/research/probes/issue-306/probe.ts > docs/specifications/026-tiered-and-cloud-execution/research/probes/issue-306/result.json
```

`squeal checks`: exit **0**, current CLI **0.1.665**, default tests after each edit, **2348** files, **1957 pass / 391 not current** at inspection. This describes background state, not a suite pass. The explicitly requested research probe ran outside the suite; no product test edits or test-suite pass are claimed.

Sources: [spec 026](../spec.md), D8.3/D10/D12 and its [amendment log](../status.md); [spec 021](../../021-remote-store-and-execution/spec.md), D10/D11/D13; [#300 triage](issue-300.md) and [real-runner reproduction](issue-300-reproduction.md); the three linked issue reports; source paths above; [probe limits](probes/issue-306/README.md).
