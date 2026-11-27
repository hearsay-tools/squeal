# Issue 300: tree/config drift with `whenLost: "not-run"`

Investigate sync freshness and config-drift recovery while preserving the project's `not-run` policy. The refusal paths are reproduced synthetically; the original merge/new-helper trigger is **partially reproduced**, with its root cause **not determined**.

Examined 2026-11-27: Squeal source **0.1.656**, commit `2f10594e6e8b32bfec773e200e59ad94eadb392b`; issue reports **0.1.654** (Antigravity plugin 0.1.640, Claude Code 0.1.654). The session CLI remains 0.1.654. Node v26.13.0. Host load was `1.24 1.36 3.07` initially, `2.30 1.65 3.10` before the probe, and `1.72 1.62 2.94` afterwards, with **16 CPUs**. Only the small in-process probe ran; no live Agent37, held resource, daemon restart, full suite or boat sandbox was used.

## Questions answered

All experiment/source findings below concern source 0.1.656 at the commit above.

| Question | Answer and evidence tag |
| --- | --- |
| Can the named refusals leave work unrun? | **Verified by experiment:** both messages end with `not run here (whenLost "not-run")`, no local runs and no completed files in the synthetic report. |
| Does proof drift already resync? | **Verified by experiment:** persistent refusal yields two remote run requests with one intervening invalidation. A refusal repaired on the second request completes. |
| Does config drift get the same retry? | **Verified by experiment:** injected config drift after a healthy connect yields zero remote run requests and zero invalidations; the lane becomes refused. |
| Does adding a helper inherently fail? | **Verified by experiment, limited:** a newly written helper with its invalidation delivered to the stub succeeds. This is not a real Vitest or transport test. |
| Is absence of local fallback a policy defect? | **Read in source code/spec:** no; spec 026 D8.3 and spec 021 D13 require unknown/unrun under `not-run`. Bypassing it on an explicit wait would be a separate policy decision. |
| Did the reported merge cause stale bytes, or was the helper misclassified? | **Not determined:** no original daemon/tree snapshot or real runner reproduction was used. Synthetic injection starts after the unknown cause. |
| Is this a proven recurrence of closed #280? | **Inferred:** not established. #280's recorded fix handles ignored inputs and per-file proof isolation; this issue also names the earlier environment-comparison branch. |

## Findings

1. **Verified by experiment; 0.1.656.** [Probe output](probes/issue-300/result.json) records four passing assertions sets:

   | Scenario | Remote run requests | Local runs | Sent invalidations | Outcome |
   | --- | ---: | ---: | ---: | --- |
   | Config drift at `e2e/describe-error.ts` | 0 | 0 | 0 | `crashed`, refusal names config/setup difference |
   | Persistent proof drift at `fixtures/golden.json` | 2 | 0 | 1 | `crashed`, refusal says tree stayed different |
   | Proof drift repaired on retry | 2 | 0 | 1 | `completed` |
   | Newly written helper, invalidation delivered | 1 | 0 | 1 | `completed` |

   `crashed` is the lane's incomplete report, not proof that tests failed. No scheduler/store/CLI ran, so the reported **301 UNKNOWN checks**, revision 24 and `status --wait` no-verdict behaviour were **not reproduced**. Remote request counts include pre-execution refusals. The fixture stubs sync delivery and blob responses; it does not prove that real tree writes are faulty or healthy.

2. **Read in source code; 0.1.656.** There are two separate guards. `lane.ts:735–748` sends pending paths, compares the environment, and closes/refuses the host on inequality **before** admission and proof handling. `lane-compare.ts:85–94` repairs installed-dependency differences only; config differences return directly. Under remote planning, `lane-compare.ts:107–120` uses the remote runner's declared environment files on both sides and compares their blob IDs. Therefore the phrase “config and setup files differ” alone does not prove an omitted filename in a local-vs-remote config list; unequal bytes or a missing file can produce it. `environment-descriptor.ts:208–215` renders that message. This conforms to spec 021 D11.2's fail-closed environment check, but leaves a recovery question when the difference is syncable file content.

3. **Read in source code; 0.1.656.** Proof differences follow `lane.ts:605–625` and `678–691`: queue changed paths and retry once. `lane-proof.ts:59–75` classifies an existing local path outside the tracked/non-ignored tree as unsyncable. Config inputs taint all remaining files (`lane-proof.ts:108–113`). On final refusal, `lane.ts:966–988` produces no results under `not-run`. This matches spec 021 D10/D11.1/D13 and 026 D8.3. Merely adding another unconditional retry would not diagnose why the existing resend failed.

4. **Read in source code; 0.1.656.** Initial sync enumerates the tree and sends missing entries (`connect.ts:355–369`). Invalidations send non-touch changed paths via `writesFor` (`connect.ts:374–385`); `tree.ts:44–55` includes non-ignored untracked files. Thus a new helper is eligible for sync without being committed. The production symptom requires more evidence about invalidation delivery, path roots, bytes and runner environment freshness. The probe's successful helper case is only a control for lane behaviour.

5. **Read in source code; version comparison.** `git diff squeal--v0.1.654 HEAD` shows no change to `lane-compare.ts`, `lane-proof.ts`, `tree.ts` or `environment-descriptor.ts`. The `lane.ts` diff adds command routing for spec 026 D13; the examined proof retry and refusal bodies are unchanged. This supports relevance to the reported version, but is not an execution of the 0.1.654 runtime.

## Recommendation and open questions

**Inferred from the evidence:** retain a separate proposed triage row for sync/config freshness under spec **026 D8/D10/D12**, with **021 D10/D11/D13** as the underlying contract. The tradeoff is restoring useful validation without accepting unproved results or silently overriding the project's execution budget. The human must decide whether to authorize investigation and bounded recovery for syncable config drift; changing explicit waits to permit local fallback is a different policy choice, not a settled fix.

An implementation investigation needs a small real-runner reproduction of the helper addition and merge, recording local/remote blob IDs, tree membership, invalidations and environment file paths. Determine why the retry did not repair merge-updated fixtures, whether reconnect repairs config drift, and how status explains recovery while preserving `not-run`. No change to spec, policy or product is proposed as already approved.

## Commands and sources

Commands run from the repository root (read-only inspections omitted except the reproducibility/version checks):

```sh
gh issue view 300 --repo hearsay-tools/squeal --json title,body,comments,url
git rev-parse HEAD
node -p "require('./package.json').version"
node --version
cat /proc/loadavg
nproc
~/.codex/plugins/data/squeal-hearsay/bin/squeal checks
git diff squeal--v0.1.654 HEAD -- src/core/runner-host/remote/lane.ts src/core/runner-host/remote/lane-compare.ts src/core/runner-host/remote/tree.ts src/core/keys/environment-descriptor.ts
git diff --quiet squeal--v0.1.654 HEAD -- src/core/runner-host/remote/lane-compare.ts src/core/runner-host/remote/lane-proof.ts src/core/runner-host/remote/tree.ts src/core/keys/environment-descriptor.ts
pnpm exec tsx docs/specifications/026-tiered-and-cloud-execution/research/probes/issue-300/probe.ts > docs/specifications/026-tiered-and-cloud-execution/research/probes/issue-300/result.json
pnpm exec biome format --write docs/specifications/026-tiered-and-cloud-execution/research/probes/issue-300/probe.ts
```

Probe: exit **0**, four scenarios asserted; the earlier uncaptured run also exited 0. Quiet diff: exit **0**. Biome: exit **1**, no files processed because research probes are ignored; no format changes. `squeal checks`: exit **0**, default test group reported **0 test files**; it did not validate this fixture. The task explicitly requested a cheap synthetic probe, run outside the repository test suite. No test-suite pass is claimed.

- [Issue 300](https://github.com/hearsay-tools/squeal/issues/300), including intake's possible-duplicate pointer to [280](https://github.com/hearsay-tools/squeal/issues/280).
- [Spec 026](../spec.md), D8.3, D10, D12; [status](../status.md), 2026-11-25 amendment for row 026-24/#280.
- [Spec 021](../../021-remote-store-and-execution/spec.md), D10/D11/D13; [vision](../../../vision.md), principles 2 and 8.
- Source citations above resolve under `src/core/runner-host/remote/`, except `src/core/keys/environment-descriptor.ts`.
- [Throwaway probe and limits](probes/issue-300/README.md).
