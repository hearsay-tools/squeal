# Issue 278: remote failure visibility in named commands

Recommend a proposed, human-approved follow-up for named wait, retry and proof
diagnostics under the existing remote-loss policy. Do not silently turn
`whenLost: "not-run"` into local execution.

## Scope, versions and reproduction verdict

Investigated 2026-11-24. Source: Squeal **0.1.627**, commit
`ad0de28f67a9eb9f7a4f21f77ffcec3edee8324c`; Node `v26.13.0`, pnpm `12.15.0`.
The [incident](https://github.com/hearsay-tools/squeal/issues/278) names version
`0.1.623` and a separate revision field `0.1.624`; the exact incident commit is
not supplied. Its 2,041 unknown files, 30-minute stall, Agent37 HTTP 409,
missing `pnpm`, failed restart and recovery after restoring local runners are
**reported incident evidence**, not independently verified observations here.

**Reproduction verdict:** the remote planning policy and a named-wait diagnostic
omission were **verified by experiment** at 0.1.627 using synthetic inputs.
The complete historical outage was **not reproduced, because** it requires the
historical daemon/store state and a real provider/setup failure; this bounded
triage neither changes remote configuration nor induces a cloud outage. Retry
and proof paths were read in source, not exercised as complete CLI calls.

Initial `/proc/loadavg`: `3.79 15.23 24.45`; `nproc`: `16`. Final sample:
`2.09 10.59 21.49`. Load1 did not exceed the CPU count, so the load rule did not
skip the cheap probe. No boat sandbox was needed: the probe only calls source
functions with synthetic in-memory inputs, starts no daemon or runner, opens
no store, and contacts no provider. No product code, policy, credentials or
holds changed. No test suite was run or claimed passing.

## Questions and findings

| Question | Answer and evidence at 0.1.627 |
| --- | --- |
| Is remaining unknown under `not-run` itself a defect? | **Verified by experiment; read in source code.** No. 026 D8.3 and 021 D13 explicitly require it. `remotePlanning().testFiles()` rejects with the remote cause and makes zero local calls under `not-run`; the same synthetic unavailable host makes one local call under `local`. |
| Does the missing-`pnpm` trigger remain open? | **Read in source code and project records.** Row 026-22 shipped in 0.1.627. `remote/package-manager.ts` provisions a missing pnpm/yarn and `tree-install.ts` uses it. This research did not rerun that fix's tests or verify the incident host after upgrading. Provider HTTP 409 is a different reported trigger. |
| Does plain status still require `--full` to show a remote? | **Read in source code.** Row 026-20 already added the remote summary and failed-listing explanation. `format-status.ts:87` uses `listingFailed`; line 107 includes `remoteLines` in normal output. The incident's broad wording is not a reason to duplicate that completed row. |
| Why can a named wait omit the remote? | **Read in source code; verified by experiment for the lapsed clause.** `status-wait-lines.ts:386` builds default named output separately: its header has revision and holds; only `--full` calls `formatStatus`. `no-verdict-lines.ts:32` returns immediately for reason `lapsed`, before per-file reasons. A synthetic snapshot containing both `remote` and `listingFailed` still produces only the heartbeat clause. |
| Why can retry say a file was not keyed? | **Read in source code.** `retry-unlisted.ts:36` checks setup failures, file existence, policy eligibility and listing/ctime state, then returns the exact incident wording. It does not read remote summary or failed-listing cause. Depending on those inputs it can instead say “Not listed yet” and suggest another wait, also without remote context. The historical branch inputs are unknown. |
| Why can proof say no runner lists a test? | **Read in source code; inferred causal connection to the outage.** `proof-green-rows.ts:28` derives listed files solely from stored test-file-key rows. `proof-green.ts:167` maps a missing named row to `no runner lists it at <commit>`; `proof-side.ts:197` has the same fallback if no more specific `notDetermined` exists. Neither fallback proves runner exclusion. Whether the incident reached either branch because remote planning failed is not determined without its commit-daemon state. |

The probe's heartbeat branch is narrower than the incident's complete text.
The incident says a stale heartbeat was observed while the socket answered;
`status-wait-lines.ts` can append that liveness explanation separately. This
probe does not establish which `SelectionResult` the incident selected, nor
whether every remote failure loses its per-file explanation. Named class lines
can carry recorded runner-environment reasons when those exist.

Proof also has a useful counterexample: `proof-green.ts:194` preserves a commit
daemon setup failure as “the commit daemon's setup ... failed: <text>”. Therefore
“proof always hides remote errors” is not supported. The research identifies
the missing-row fallback and leaves its connection to this outage unverified.

## Probe and exact commands

Run from the repository root:

```sh
cat /proc/loadavg
nproc
git rev-parse HEAD
node --version
pnpm --version
gh issue view 278 -R hearsay-tools/squeal --json number,title,body,comments,url,createdAt
pnpm exec tsx docs/specifications/026-tiered-and-cloud-execution/research/probes/issue-278/probe.mjs
```

The final command exited **0**, with these observations (the remote and failure
are synthetic):

```text
planning: remote probe-remote unreachable since 2026-11-24T20:06:21.678Z (synthetic setup failure); not planned here (whenLost "not-run")
local planning calls: not-run=0, local=1
named wait timeout clause: the daemon's heartbeat had lapsed at the last read; results are as of revision 14
status summary: Remote: probe-remote: unreachable since 2026-11-24T20:06:21.678Z (synthetic setup failure)
```

The throwaway probe and its limits are in
`docs/specifications/026-tiered-and-cloud-execution/research/probes/issue-278/{README.md,probe.mjs}`. It checks existing source
functions, not copied implementations. Its deliberately minimal wait object
only exercises the early lapsed branch; it is not a full status snapshot.

## Recommendation and open questions

**Inferred from the findings, 0.1.627:** keep #278 as a diagnostic follow-up
owned by 026 D8/D12, with 021 D13/D17 and 023 D5/D7.6 dependencies. A file's
blocked planning/execution should explain the recorded remote cause and the
configured recovery policy wherever that cause is known. Preserve unrelated
file reasons, explicit holds, unknown verdicts and existing policy boundaries.
Changing `not-run` to automatic local fallback is a separate human decision;
`local` already supplies policy-controlled fallback.

Before implementation, settle how selected files are tied to a remote blocker
without attributing an unrelated remote failure to them. Verify a minimal
commit-daemon fixture for proof's missing-row case, plus retry with an existing
file and a failed remote listing. Test named waits with both healthy and stale
heartbeats, default and `--full` output, and holds. No implementation or release
is authorized by this report; existing holds remain in force.

## Sources

- Issue: <https://github.com/hearsay-tools/squeal/issues/278>.
- Contracts: `docs/specifications/026-tiered-and-cloud-execution/spec.md`
  D6/D8/D12 and `status.md`; `docs/specifications/021-remote-store-and-execution/spec.md`
  D13/D17; `docs/specifications/023-results-at-commit/spec.md` D5/D7.6.
- Source at the commit above: `src/core/runner-host/remote/lane-planning.ts`,
  `lane.ts:709`, `package-manager.ts`, `tree-install.ts`;
  `src/core/status/{format-status,remote-status}.ts`;
  `src/cli/{status-wait-lines,no-verdict-lines,retry-unlisted,proof-green,proof-green-rows,proof-side}.ts`.
- Existing completed work: board rows `026-20`, `026-22`;
  `test/e2e/spec-026-remote.test.ts:396` tests honest plain refused-remote status.
  Those tests were read, not rerun here.
