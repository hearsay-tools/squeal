# Issue 74: diagnostics for inherited UNKNOWN worker exits

Date: 2026-10-21. Documentation-only triage. No implementation authorized.

## Fit and owner

Read in issue and specification: this passes the vision decision filter. It makes pulled evidence more trustworthy and preserves provenance and uncertainty across harnesses. Spec 011 owns known state, diagnostic lookup and stored run evidence: C5, C6, C7 and C14. Spec 013 V4 supplies Vitest run results and errors. Spec 010 D12 governs intake only.

## Reported evidence

Read in issue [#74](https://github.com/hearsay-tools/squeal/issues/74), not independently reproduced: Squeal 0.1.242 reported two PASS to UNKNOWN transitions during cezarion PR 1436, at 2026-10-21T18:20:33.231Z and 18:22:37.094Z. At revision 13, HEAD `bcafac34`, the report called the state inherited from main at `97ac340`. The notice said `Worker forks emitted error`. The reporter ran:

```sh
squeal why '[e2e] packages/web/e2e/worktree-setup.e2e.ts (file-level)'
squeal why '[e2e] packages/web/e2e/repo-git.e2e.ts (file-level)'
```

The response showed UNKNOWN, then PASS history, and `Run log: unknown, no stored result, or several, fit the known state`. It supplied no run ID or full worker output. The worker exit cause is unknown. Passing browser CI does not identify that cause. The issue establishes no causal link with #72.

## Reproduction verdict and host gate

Not reproduced, because the one-minute host load was 52.58, above 24 online CPUs. The user's load rule requires skipping live reproduction. No researcher, daemon probe or test runner was started. No probes were created. Checkout and session Squeal version: 0.1.245; incident version: 0.1.242. The checkout version was read from origin/main package.json, not measured as an incident reproduction.

Exact host-gate commands and output:

```text
$ cat /proc/loadavg
52.58 42.25 32.69 57/4038 3156032
$ getconf _NPROCESSORS_ONLN
24
```

## Duplicate verdict

Read in board and GitHub: no exact duplicate. After `git fetch origin`, searched origin/main's board for #74, UNKNOWN, diagnostics, why, worker exits, the two reported test paths and src/cli/why. Checked all open issue titles and the open `triaged` issues with `gh issue list --repo hearsay-tools/squeal --state open --limit 100 --json number,title` and `gh issue list --repo hearsay-tools/squeal --state open --label triaged --limit 100 --json number,title`.

Closed #15 and done 011-04 concern selection of the stored result for a known failure. Open #54 and #67, accepted design 011-64 and planned 011-77 concern replaced FAIL evidence and older failures. Done 011-59 (gh-66 part b) corrects the origin of local crash or timeout states. #43 concerns timeout recovery. #72 concerns runtime handover. These overlap but do not cover the reported UNKNOWN run-evidence contract.

## Contract constraint and human decision

Read in source specification: 011 C7 explicitly forbids storing crashes and timeouts as keyed results, since another worktree would inherit UNKNOWN as a cache hit. The reporter's word inherited does not establish how this UNKNOWN state was formed. Preserve that uncertainty. Retaining run evidence must not turn UNKNOWN into reusable validation evidence.

Human decision needed: approve a distinct diagnostic-retention slice coordinated with 011-77, or fold it into that work with explicit UNKNOWN coverage. Decide retention bounds and concrete reasons for absent logs. Done when why identifies the originating run, worktree and revision, available exit details and output, despite newer passes; absent logs state a specific reason; cross-worktree and daemon-restart tests cover it. Fixing the exit itself stays out of scope. Existing holds stand.

## Verification

Documentation inspection and `git diff --check` cover this change. No product code, spec.md, status.md or skill changes. No product test run: live reproduction is prohibited by the load gate and the change is documentation only.
