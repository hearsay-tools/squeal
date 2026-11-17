# Issue 232: current passes beside a named wait with no verdict

Keep the sync and listing guards; treat this as related to #99 and #132 until a complete failing response proves a new contradiction.

Examined 2026-11-17 in a bounded research session. **Partial reproduction only:** exact 0.1.531 source reproduces current/pass files plus code 3 when sync or listing is pending. It prints an explicit no-verdict explanation. The reported missing verdict line and an incorrect code after completed sync/listing were **not reproduced**. No fix is authorized; existing holds stand.

| Question | Answer and evidence tag | Version |
| --- | --- | --- |
| Can two to six current/pass files accompany exit 3? | Yes, with injected pending sync or listing. **verified by experiment** | Source 0.1.531 |
| Does that prove a contradictory verdict or missing final line? | No. The six store cases agree across text, JSON and return code. Every code-3 case prints its reason. **verified by experiment** | Source 0.1.531 |
| Does a live 60-second named wait reproduce the report? | Two files returned 0. Six returned 3 with five current passes and one explicit unknown. Neither reproduces the reported combination. **verified by experiment** | Installed runtime 0.1.531 |
| Was #99 meant to remove exit 3 for stored passes? | No. Its closing comment and C15 retain the rule and change the explanation. **read in official docs** | Fix 0.1.335; contract at checkout below |
| Is #232 a proven regression or exact duplicate of #132? | Not determined: #232 has no full output, selected JSON or exact per-call revision. Related symptom; exact cause remains unproved. **inferred** | Reported 0.1.531; #132 reported 0.1.389 |

## 1. Environment and live calls

**Verified by experiment.** Checkout `b0da5d149d445ea92c8517497141a7ed6dbbcc96` identifies itself as **0.1.543**. The installed launcher returned **0.1.531**, so live results below are not 0.1.543 results. Node **v26.13.0**, pnpm **12.15.0**. The source probe used release tag `squeal--v0.1.531`, commit `daf50f82e48e697545cfb7a378f4d46b03ce8a27`, extracted separately. No product source was edited.

Commands for version and load: `squeal --version`, `node --version`, `pnpm --version`, `node -p 'require("./package.json").version'`, `cat /proc/loadavg`, `nproc`, `getconf _NPROCESSORS_ONLN`. Both CPU commands returned **24**. Initial one-minute load was **11.62**; immediately before the two-file call it was **10.91**, and before the six-file call **9.03**. Each was below 24, so neither probe was skipped. The store probe independently recorded **7.52 / 24 CPUs**.

In these exact argument lists, `squeal` abbreviates the installed launcher `~/.codex/plugins/data/squeal-hearsay/bin/squeal`; the absolute launcher was invoked. Only that home prefix is normalized.

```sh
squeal status --wait 60000 test/cli/wait-again.test.ts test/cli/selection-result.test.ts
```

Actual exit **0**, revision **0**, reported elapsed **1.8 s**. Final line:

```text
Named test files at revision 0: no known failures; 2 test files, each with a current result, after 1.8 s. Worktree: known failures 0; not current: 152 of 1923 test files (152 unknown)
```

```sh
squeal status --wait 60000 test/cli/wait-again.test.ts test/cli/selection-result.test.ts test/cli/status-paths.test.ts test/cli/status-wait-paths.test.ts test/cli/status-wait-deadline.test.ts test/cli/wait/synced.test.ts --json > /tmp/squeal-issue232-live.json 2> /tmp/squeal-issue232-live.stderr
```

Actual exit **3**, revision **8**, `waitedMs: 2028`, `outcome: settled`, `result: none`, `reason: not-current`. Five files were current/pass. `test/cli/status-wait-paths.test.ts` was **unknown**: another worktree's daemon was running its key. Stderr listed that unknown and ended with `Named test files have no verdict: 1 test file without a current result at revision 8 (1 unknown)`, followed by the claim explanation and worktree counts. This is an explained lack of a current result, not all files passing. [Sanitized JSON excerpt](probes/issue-232/live-summary.json) preserves the selection counts and file states. No manual test run or full suite was started; no pass is claimed for the unknown file.

## 2. Controlled store boundary

**Verified by experiment, source 0.1.531.** [Probe and exact commands](probes/issue-232/README.md), [direct output](probes/issue-232/boundary-output.txt). The real `waitForNamed` reads a temporary store, then `printNamed` formats that same result in text and JSON. A fresh daemon record and fixed clock isolate sync and listing. There is no actual daemon, branch switch or test execution. The probe uses an **80 ms** deadline to avoid a costly wait; it does not reproduce the incident's 60-second stall.

| Injected condition | Files, all current/pass | Result in both modes |
| --- | --- | --- |
| Sync pending at revision 80 | 2, then 6 | 3 / none / unsynced |
| Sync at 81; listing still at 80 | 2, then 6 | 3 / none / unlisted |
| Sync and listing complete at 80 | 2, then 6 | 0 / pass |

All six cases passed assertions; the probe process exited **0**. For pending sync the final line includes: `2 test files passed at revision 80; the daemon has not stored its pass over the edits made before the wait, so these results may not cover them`. For pending listing it includes: `2 test files passed at revision 80; revision 81 is not listed yet, so these results may not cover it`. Both explain exit 3 and give a repeat-wait command. Their `Current` section describes stored file results; the selection result additionally requires proof that the requested edits are covered.

## 3. Contract, recommendation and limits

**Read in source code, release 0.1.531.** `src/cli/verdict.ts:selectionResult` returns `none/unsynced` for an unconfirmed sync at timeout, then checks listing and file classes. `src/cli/named-print.ts:printNamed` derives the process code and JSON fields from `namedResult`; `status-wait-lines.ts:namedLine` uses that same result, and `no-verdict-lines.ts:timeoutText` explains pending sync/listing. JSON mode puts the human final line on **stderr**, while text mode puts it on **stdout**. A stdout-only JSON capture therefore cannot establish a missing human explanation. This is a possible evidence gap, not a diagnosis of #232.

**Read in official docs, C6/C15 and status amendments at checkout 0.1.543.** C6 requires proof of edits before the wait. C15 says readers gate on `selection.code` or `selection.result`, never file `state`. Row 011-243 states: “The result rule and exit 3 are unchanged; `--json` gains no field.” The #99 closing comment names the same 0.1.335 wording fix. Open #132 records pending-sync snapshots with current passes and remains an explanation/timing question. Its snapshot trigger is not proof of the cause of #232's longer wait.

**Inferred, 0.1.531.** Latest-edit evidence decides the tradeoff: deriving success only from stored pass counts would remove a deliberate freshness guard. Keep the guards. Carry #232 as related evidence for the explanation question; do not call the approved #99 repair regressed solely because code 3 persists. The absent-line allegation still needs a complete response.

Open questions: the original call's exact revision, full stdout and stderr, `selection.reason`, sync/listing state, whether a repeat wait resolved it, and whether edits or a branch switch occurred. This probe does not explain why a real sync might remain pending for 60 seconds. It covers no loaded monorepo campaign, daemon scheduling race, or branch switch. No implementation, spec amendment, board change or release is proposed by this research.

## Sources

- [#232](https://github.com/hearsay-tools/squeal/issues/232), [closed #99](https://github.com/hearsay-tools/squeal/issues/99), [open #132](https://github.com/hearsay-tools/squeal/issues/132), fetched with `gh issue view <number> --repo hearsay-tools/squeal --json number,title,body,state,comments` on 2026-11-17. Issue reports are reports, not independent reproduction evidence.
- [Release source](https://github.com/hearsay-tools/squeal/tree/daf50f82e48e697545cfb7a378f4d46b03ce8a27), read with `git show squeal--v0.1.531:<path>` and extracted by `git archive`; relevant paths above.
- [C6/C15](../spec.md), [amendments](../status.md), [prior #132 research](issue-132.md), [prior #99 research](issue-99.md), read at checkout `b0da5d149d445ea92c8517497141a7ed6dbbcc96`.
