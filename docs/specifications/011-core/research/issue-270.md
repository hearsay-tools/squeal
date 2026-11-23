# Issue 270: unit timeouts before load retry

Triaged 2026-11-23. Source: [#270](https://github.com/hearsay-tools/squeal/issues/270), an agent-reported friction observation, not proof of a product defect.

## Fit and owner

Inferred: passes the vision decision filter by reducing timeout noise and making pending validation clearer across harnesses, provided project policy governs admission and failures remain failures. Spec 011 owns C4 scheduling, C5 results and retry, C6 status, and C9 pushed updates. C10/C15 latency and fairness and spec 021 D18 host admission are related.

## Evidence and reproduction verdict

Read in issue: Squeal 0.1.604 reported four timeouts in Squawk's `packages/web/src/test/agent-browser-interact.test.ts`, three at 5000 ms and one at 10000 ms, at reported load 39.27–47.09. The reporter ran:

```sh
squeal retry packages/web/src/test/agent-browser-interact.test.ts --reason load
```

The receipt said it would join the queue below the CPU count, or after at most 10 minutes above it; load was 40.36 on 16 CPUs. Status/why JSON was not recorded. No daemon restart was tried. The retry outcome and causal role of load remain unverified.

Verified by observation during triage, with these exact commands:

```sh
cat /proc/loadavg
getconf _NPROCESSORS_ONLN
git show origin/main:package.json
```

One-minute load was 24.84 (five-minute 26.56, fifteen-minute 29.33), with 16 online CPUs. Checkout version was 0.1.608; session runtime is pinned to 0.1.604 by the session's Squeal path. These version facts do not verify incident behavior on either version.

**Not reproduced, because one-minute host load 24.84 exceeds 16 CPUs.** The human explicitly required skipping live reproduction under that condition. No researcher, test run, load generator or throwaway probe was started. No remote reproduction was substituted.

## Duplicate check and decision

Read in origin/main board and open issue inventory: no existing #270 row or exact duplicate, including issues labelled `triaged`. Board searches covered `#270`, `agent-browser-interact`, load retry, load gate and timeout symptoms. Inventory command:

```sh
gh issue list --repo hearsay-tools/squeal --state open --limit 300 --json number,title,labels
```

Related: #225 CPU admission delays; #222 pending retry visibility in the quality gate; #251 retry exhaustion after an overloaded capped retry; #150 baseline execution in read-only sessions. These do not directly own first-run load admission plus pending retry context in pushed failure updates. #127 retry priority remains held. Row 011-395's throughput research is already done; this triage does not reopen or dispatch it.

Human decision: investigate a bounded pre-execution load policy for subprocess-heavy checks, improve pushed pending-retry diagnostics, or retain current policy until incident evidence is available. The issue does not establish that admission violated policy or that the four tests would pass at lower load. Preserve provenance, uncertainty, counted failures until valid replacement evidence, fairness and all existing holds. No implementation is authorized.
