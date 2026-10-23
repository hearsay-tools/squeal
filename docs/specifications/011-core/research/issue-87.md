# Issue 87: blocked revision waits and recovery

Date: 2026-10-23. Issue: https://github.com/hearsay-tools/squeal/issues/87.

## Verdict and environment

Not reproduced, because the one-minute host load was 47.04, above 24 online CPUs. No researcher or live probe was started. Checkout and session Squeal version: 0.1.279. The issue does not name the incident version. No claim is made that the current release reproduces the incident.

Verified by experiment (environment only): `cat /proc/loadavg` returned `47.04 28.93 26.66 48/4691 2900670`; `getconf _NPROCESSORS_ONLN` returned `24`. The version is read from `package.json` and the session registration.

## Reported evidence

Read in issue, not independently reproduced: the agent ran:

```sh
squeal status --wait 60000 packages/cezar/src/core/harness-autosave-settlement.test.ts packages/cezar/src/test-wait-discipline.test.ts
```

The report says revisions 1–5 timed out while an older file run remained active. Revision 1 named a running file and a second file queued behind its tier. Revision 5 said discovery had not listed that revision. A live socket accompanied a stale heartbeat warning. The observed call bound was 966 seconds. The retained logs are in another task, `.ai/qa/1308/squeal-targeted-1.txt` through `-5.txt`; this triage did not inspect them. Scheduling, store contention and test runtime remain possible causes, not findings.

## Fit and owner

Inferred from the decision filter: passes. Clear progress and revision provenance make feedback more trustworthy and reduce unnecessary blocking across harnesses. Recovery must remain bounded and obey project policy.

Read in spec: 011 C2 separates revision recording from runner refinement; C4 governs cancellation, yield and result validity; C5 keeps state and validity distinct; C6 owns status; C9 owns daemon liveness; C15 owns selected waits and their constraint reasons. C15 explicitly says an unlisted revision can wait behind a bounded runner call and that the store has no call start for a countdown. Therefore a static call bound must not be described as a measured remaining bound. Related 005 D2 owns agent guidance. This is a proposal, not an amendment to these contracts.

## Duplicate check

Read in origin/main board and GitHub: no existing gh-87 row or exact open duplicate found. Searches covered `#87`, blocked revision/older-run wording, and both named test-file stems. The #87 mention in gh-84 is a cross-reference, not an existing row. Open issues were checked both without a label filter and with `triaged`.

Related only: #82 concerns explicit refresh under lookup-only policy; #79 concerns queue priority; #41 concerns queued/idle explanations; #43 concerns a per-file cap; #84 and #88 concern selected verdict semantics. Closed #77 concerned repeated version handover and is recorded shipped in 011-151. Done 011-27 provides recovery hints, not the requested active/requested revision and remaining-bound contract. No shared cause is established.

## Human decision

Decide whether to approve active/requested revision and progress reporting plus a bounded safe recovery action when an older run blocks selected verification. Specify whether recovery waits, yields or cancels eligible work, or uses another bounded mechanism. Do not infer that a restart or duplicate run is safe. Preserve current-result provenance and pending versus passing semantics. Existing holds stand; no implementation is authorized.
