# Issue 313: ignored artifacts and remote proof after 026-38

Recommend investigating the active daemon/runner bundle and effective observation
policy as a recurrence of closed #304 before proposing further proof changes.
Keep the human's decisions to refuse unproven inputs and honor `not-run`.

Source: [#313](https://github.com/hearsay-tools/squeal/issues/313), fetched
2026-11-28. Reported versions: local 0.1.665, remote installation 0.1.640.
Examined source: 0.1.667 at `7b7e595db88e3440606f7c073d2c5e567994836b`.
Session launcher: 0.1.665; it also reported Claude Code/Codex 0.1.665 and
Antigravity 0.1.640. These are installations, not proof of the reporter's
active runner. Initial host load: 0.98/0.32/0.27 on 16 CPUs; probe load:
0.32/0.35/0.29; Node v26.13.0. No heavy work was performed.

| Question | Answer |
| --- | --- |
| Does current code reject ordinary ignored scratch? | **verified by experiment, 0.1.667:** fresh observed screenshot under its run's written directory preserves synthetic PASS and FAIL in one run. An applied exact runtime-file declaration does too. |
| Does it still refuse unproven remote-only inputs? | **verified by experiment, 0.1.667:** yes, in one run with no resend and a specific reason. Both synthetic outcomes are discarded. |
| Can the reported two-attempt pattern be produced? | **verified by experiment, 0.1.667:** yes when the probe deliberately omits optional `unsynced` metadata for an undeclared remote-only input. Both runs complete, two `sending again` lines appear, and neither verdict survives. This does not establish why the reporter lacked the newer behavior. |
| Is the actual browser incident reproduced? | **not determined:** only the component mechanism was exercised, not the reporter's browser, recorder, daemon, VM, configuration, scheduler or store. |
| Does #304 overlap? | **read in official docs:** #304 was closed by released row 026-38 in 0.1.665 and covers these exact artifact categories and resend symptom. **inferred:** #313 is a reported recurrence, not evidence by itself of a new defect or a proven fixed duplicate. |

## Findings

1. **verified by experiment, 0.1.667:** the [probe](probes/issue-313/probe.ts)
   ran ten scenarios using actual Git filtering, tree transport, host protocol,
   lane proof and effective-input helpers. Synthetic PASS and FAIL each produce:

   | Observation | Remote runs | Resend log lines | Kept outcome |
   | --- | ---: | ---: | --- |
   | New ignored screenshot, run wrote its ancestor directory | 1 | 0 | Original PASS/FAIL |
   | Exact applied `runtimeFiles` descriptor | 1 | 0 | Original PASS/FAIL |
   | Undeclared input exists only remotely | 1 | 0 | None; remote-only refusal |
   | Same undeclared input, `unsynced` omitted by probe | 2 | 2 | None; tree stayed different |
   | Previously retained ignored input differs, run writes its directory | 1 | 0 | None; locally present ignored-input refusal |

   Every case has zero local runs under `whenLost: "not-run"`. The rejected
   lane report ends `crashed`, with zero completed files/results and a refusal
   reason. UNKNOWN in the scheduler/store is not directly measured here.
   Two `sending again` lines mean two total attempts, not three runs.

2. **read in source code, 0.1.665/0.1.667:**
   `remote/lane.ts:differing` weighs expected closure/config paths and only
   effective observations. `scheduler/proven-observed.ts:provenObserved` keeps
   previously keyed inputs, drops fresh ignored scratch beneath a directory
   the run wrote, and applies the reader's runtime policy.
   `remote/lane-proof.ts:classify` refuses absent-local paths immediately only
   when the host says sync never wrote them (`RemoteRunReply.unsynced`).
   `host.ts:unsyncedOf` obtains that fact from `tree-host.ts:unsynced`.
   Without it, local absence is classified as repairable, preserving legitimate
   deletion of a previously synced file. `attemptTier` caps total attempts at
   two. The examined proof, sync and effective-policy files have no diff from
   release `squeal--v0.1.665` (commit `36dc2739b`; tag object `be89f7e56b`).

3. **read in source code, 0.1.667:** `remote/connect.ts:startRemoteHost` copies
   and starts the daemon's own versioned bundle; `proxy.ts` rejects a host whose
   reported version differs from the daemon's. Spec 021 D14 describes this.
   **inferred:** “remote VM Squeal 0.1.640” does not prove the active lane used
   that version, and the missing-metadata simulation is not a mixed-version
   deployment reproduction. Establish the daemon version, launched bundle path,
   host handshake and observation payload before attributing a version cause.

4. **read in official docs, 2026-11-27 decisions:** spec 026 `status.md` records
   the human's 026-38 choice “Refuse, name the file”, rejecting trust of remote
   setup outputs and runtime folder patterns; 026-40 keeps refusing under
   `whenLost: "not-run"`. Spec 021 D10 excludes untracked ignored files from
   sync, D11 requires matching proven inputs, and D13 makes unproven execution
   unknown. Spec 026 D8 extends the lane to groups and other tiers; D10 changes
   the environment key space, not file proof. **inferred:** blanket ignore
   exemption or storing every completed assertion would weaken provenance.
   An ignored build product executed by a test can be a genuine input.

5. **read in official docs/source history:** [#304's release comment](https://github.com/hearsay-tools/squeal/issues/304#issuecomment-7229169625)
   names screenshots, `.ai/qa/test-env.json` and `.ai/qa/build/**`, one-attempt
   refusal, runtime declarations and `remote.alwaysLocal`.
   [Prior research](issue-304.md) reproduced two attempts on 0.1.659 before the
   fix. Current `test/runner-host/remote/lane-proof-runtime.test.ts` covers these
   categories. **inferred:** retain #313 as recurrence evidence for 026-38 and
   narrow investigation; the current component experiment does not justify a
   second blanket-exclusion feature.

## Commands, results and limits

```sh
gh issue view 313 --repo hearsay-tools/squeal --json title,body,comments,url,createdAt
gh issue view 304 --repo hearsay-tools/squeal --json state,closedAt,comments
git rev-parse HEAD
node -e 'const os=require("node:os");console.log(JSON.stringify({load:os.loadavg(),cpus:os.cpus().length,node:process.version,sourceVersion:require("./package.json").version}))'
env -u NODE_OPTIONS pnpm exec tsx docs/specifications/026-tiered-and-cloud-execution/research/probes/issue-313/probe.ts > docs/specifications/026-tiered-and-cloud-execution/research/probes/issue-313/results.jsonl
git diff --exit-code squeal--v0.1.665 HEAD -- src/core/runner-host/host.ts src/core/runner-host/remote/lane.ts src/core/runner-host/remote/lane-proof.ts src/core/runner-host/remote/tree-host.ts src/core/runner-host/remote/tree.ts src/core/runner-host/remote/connect.ts src/core/runner-host/proxy.ts src/core/scheduler/proven-observed.ts src/core/scheduler/observed.ts src/core/keys/runtime-files.ts
cat /proc/loadavg
```

Probe exit 0; ten cases asserted, raw evidence in
[results.jsonl](probes/issue-313/results.jsonl). Run command wall time about
1.3 seconds. Source comparison exited 0 with no diff. Final sampled load:
`0.30 0.34 0.29`. No browser/cloud provisioning, install, full suite, product
edit or manual execution of covered repository tests. Read the session-pinned
Squeal skill first; session launcher `squeal checks` reported 2,351 default
edit test files, 2,349 pass and 2 not current. That is contextual coverage,
not a claim that this reproduction passed the suite.

Final affected-result query:

```sh
~/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 docs/specifications/026-tiered-and-cloud-execution/research/probes/issue-313/probe.ts
```

It exited 3: `No verdict: no test file's closure holds` the probe; worktree
known failures 0, not current 2 of 2,351 test files (2 unknown). The standalone
probe above is the verification for this research artifact. `git diff --check`
exited 0; the artifact search found no absolute home paths.

Open evidence: active daemon/host versions and bundle provenance at the failed
run; raw `observed.paths`, `written`, `unsynced`, keyed closure/retained inputs,
and applied runtime rules; whether browser/subprocess writes were attributed;
whether claimed artifact paths were ever synced or tracked. Without those,
the production cause and a regression after 0.1.665 remain undetermined.
