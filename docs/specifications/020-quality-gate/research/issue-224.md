# Issue 224: completed gate results lost under shared-store contention

Triage, 2026-11-15. [Issue #224](https://github.com/hearsay-tools/squeal/issues/224), agent-reported `friction`. Documentation only; no reproduction worker or probes started.

## Fit and ownership

**Inferred:** passes the vision decision filter: retaining valid completed evidence reduces repeated tests and blocking while preserving provenance. Owner: spec 020 D11.7, D17.3 and D17.5; shared-store boundaries: spec 021 D1, D5 and D15; background writer fairness: spec 011, row 011-350.

## Evidence and reproduction verdict

**Reported, not independently reproduced:** Squeal 0.1.506, revision 3, head `9c81fa9d51f4bf4e96f6a1fc3eda35801c01df9f`. The command was `squeal code --base origin/main --json`. Seven files completed; five were not kept after a 30 s shared-store wait. Holder PIDs changed between the two stderr lines. The separate test failure was real; this issue concerns retention only. The report names `.github/scripts/change-surface-readers.test.cjs`, `.github/scripts/cockpit-test-sequencer.test.cjs`, `.github/scripts/no-compat-policy.test.cjs`, and `packages/cezar/src/lint/lint-ast-grep-{1,2}.test.ts`; two other files are unnamed.

**Observed:** not reproduced, because the one-minute load average was 35.95, above 24 online CPUs. Exact host checks: `cat /proc/loadavg` returned `35.95 31.98 28.65`; `getconf _NPROCESSORS_ONLN` returned `24`. Checkout package and session runtime: 0.1.511. No live gate, store-lock probe or test suite was run. No evidence establishes the incident's exact lock operation or confirms its outcome on 0.1.511.

## Duplicate and shipped-work check

**Read in board and prior research:** fetched `origin/main` at `d4dd56b30a22ac8aa64bb4629afa362b9f2addcc`. Searched its board for `#224`, `gh-224`, retention/contention symptoms and the named test files. No existing issue-224 row or named-file row. Checked open issues with `gh issue list --repo hearsay-tools/squeal --state open --limit 200 --json number,title,labels`, including `triaged` issues: no exact open duplicate. Open #216 covers broader interruption/load recovery; #138 and #176 cover daemon progress under locks.

Closed #201 covers loss after the keep bound; closed #202 covers post-report blocking. Closed #220 is the same pre-0.1.511 retention symptom. Its [research](issue-220.md) verified that the old bound counted from the first refusal even while writes landed. The partial retention in #224 is consistent with that cause, but does not independently prove it. The spec 020 owner confirmed this interpretation by peer message on 2026-11-15 and recommended retrying on 0.1.511 or later.

**Read in current spec and board:** 020-67, released in 0.1.511, restarts the 30 s quiet bound on each landed write and applies a rerun-time ceiling; 020-68 prints final kept counts. Row 011-350, landed in 0.1.509 and released in 0.1.511, adds pauses between background write batches. These reduce contention loss; they do not promise durable pending results after bound exhaustion. D17.5 still explicitly permits unkept results at the limit. A durable pending-write queue would change that policy and requires human approval.

## Human decision

Recommend a reporter retry on 0.1.511 or later, keeping stderr and its final kept-count line, before new implementation. Decide whether to treat this as the closed #220 incident family pending confirmation, or approve stronger durable retention after the current bounds expire. Close as fixed only with adequate confirmation; if it recurs on the new version, route evidence to spec 020. Existing holds, including #216 concurrency control, stand. No implementation is authorized by this triage.
