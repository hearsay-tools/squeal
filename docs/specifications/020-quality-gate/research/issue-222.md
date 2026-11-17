# Issue 222: stored failures while a load retry is pending

Date: 2026-11-15. Owner: spec 020, with spec 011 retry state.

## Verdict

**Not reproduced, because** the one-minute host load was 88.63 on 24 CPUs. The triage instruction requires skipping live reproduction above the CPU count. No researcher, probe, build or test run was started.

## Evidence

- **[read in issue]** [#222](https://github.com/hearsay-tools/squeal/issues/222) reports 0.1.503 initially and 0.1.506 after recovery, revision 33, head `6124bc00b`, in Squawk. Two CLI tests timed out at load about 67/24 CPUs. A pending `retry --reason load` did not stop the gate reusing their stored failures. After successful retries, 61 functions changed from `incomplete` to `pass`. The reporter attributes the timeouts to load; this triage does not establish causality.
- **[read in repository]** Checkout/main `be6efd781b061cd453a6fefeabbed8b816769041` is 0.1.509; the session runtime is 0.1.506 (session registration). Spec 020 D5 preserves selected failure blocking; D7 and D11.7 specify provenance and keyed reuse; D17.3 covers kept evidence. Spec 011 C4/C5/C6/C9/C15 owns same-key validity, state, retry and recovery. A queued retry is no replacement evidence.
- **[read in prior findings]** [Issue 214 research](../../011-core/research/issue-214.md), F4/F5, reproduced this core behavior on 0.1.477 with a real one-file gate and deliberately pending load/environment requests. It did not reproduce the original timeout cause or daemon stall. This is prior evidence, not a new reproduction on 0.1.509.
- **[read in board/spec]** Closed #214 and #200 led to done row 020-60, released in 0.1.495: stderr identifies stored failures and gives `--rerun-stored-failures`; this flag reruns once within the budget. D7 records rerun outcomes and retains failure when the rerun does not finish. Row 020-63 added text outcomes in 0.1.503. Neither decision automatically invalidates a failure because a daemon retry is pending.
- **[read in board/issues]** No existing #222 row or exact open duplicate, including issues labelled `triaged`. Closed #214 overlaps directly; #216 concerns broader load and interruption recovery; #127 concerns held retry priority. The external Squawk test paths named in #222 are not separate board work here.

## Decision needed

**[inferred]** This passes the vision filter for trustworthy evidence and reduced unnecessary blocking. Decide whether existing explicit recovery is sufficient, whether the gate should name pending retries, or whether a pending request should trigger a bounded wait/rerun. Preserve incomplete verdicts until successful replacement evidence exists. Do not infer that load proves a failure false. Existing holds, including retry priority, stand. This triage authorizes no implementation or spec amendment.

## Commands and actual results

- `git fetch origin`: exit 0; board read with `git show origin/main:docs/board.md`.
- `gh issue view 222 --repo hearsay-tools/squeal --json state,title,body,labels,comments,url`: OPEN, needs-triage, no comments.
- `cat /proc/loadavg`: `88.63 61.00 66.98 61/4454 1792271`; `getconf _NPROCESSORS_ONLN`: `24`.
- `node -p 'require("./package.json").version'`: `0.1.509`.
- Board searched for `#222`, `gh-222`, pending retries, stored failures, load timeouts and the reported CLI paths: no existing issue row; overlaps above.
- `gh issue list --repo hearsay-tools/squeal --state open --limit 200 --json number,title,labels`: checked symptom matches and labels. Also `gh issue list --repo hearsay-tools/squeal --state open --label triaged --search 'stored failure retry' --json number,title`: no exact open duplicate.
- `gh issue view 214 --repo hearsay-tools/squeal --json state,title,labels`: CLOSED, triaged.

Reporter commands (not executed here):

```sh
squeal retry packages/cezar/src/discovery/cli.test.ts --reason load
squeal retry packages/cezar/src/artifacts/cli.test.ts --reason load
squeal code --base origin/main --timeout 900 --json
```

Documentation-only verification: `git diff --check`; no product tests required or claimed.
