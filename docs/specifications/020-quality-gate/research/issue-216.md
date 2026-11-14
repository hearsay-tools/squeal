# Issue 216: completing a gate on an overloaded host

Triaged 2026-11-14. Source: [#216](https://github.com/hearsay-tools/squeal/issues/216), an agent-reported friction issue. Documentation only; no implementation authorized.

## Fit and owner

Inferred: passes the vision decision filter. Bounded resource use and safe reuse can reduce blocking while preserving evidence, uncertainty and project policy across harnesses. Owner: spec 020 D1 (command), D3.4–5 (budget, retry and retention), D5 (failed tests block), D7 (report), D11.7 (reuse), D17.1/3/5 (estimates, keyed retention and contention), D18 (runner concurrency). Spec 011 C9/C15 is related for holds and explicit retry; existing holds stand.

## Reproduction verdict

Not reproduced, because the measured one-minute host load was 76.13, above 24 online CPUs. No researcher, live gate, load generator or probe was started. This follows the triage load rule; the original 51-minute run also exceeds the roughly 20-minute research bound.

Verified by environment inspection: `cat /proc/loadavg` returned `76.13 81.66 67.65 51/2566 867850`; `getconf _NPROCESSORS_ONLN` returned `24`. Commands ran during this triage on 2026-11-14. `package.json` at the fetched main checkout names 0.1.477; the session runtime is pinned to 0.1.475. Neither was exercised for reproduction.

Read in issue (not independently verified): incident Squeal 0.1.465, current version named by reporter 0.1.475; clean Squawk head `95b1bc30a`, revision unrecorded. Exact reported command:

```sh
squeal code --base origin/main --json --timeout 3120
```

Reported host load 75–120 on 24 CPUs. Vitest selected and completed 756 files, 50 failed, none unfinished; node:test completed 4/4. Exit 3, all 26 functions incomplete despite measured coverage and no limit violation; budget did not time out. Reporter says the failures passed CI at the same head. Two earlier runs ended at reboot with exit 143 and no whole JSON report. Load as the failure cause, interruption loss and reuse behavior remain unverified.

## Existing contract and overlap

Read in spec and board: D5 deliberately blocks all functions on any selected failure. Full measured coverage does not override that rule. Closed #210, rows 020-53/54, shipped in 0.1.475: failure attribution and one retry of fresh failed files when load meets the threshold and budget remains. It excludes stored/parts evidence and does not promise lower retry concurrency. The reported 0.1.465 run predates this fix. Row 020-55 is already running to keep rerun results; this triage does not duplicate or widen it.

Read in spec: D17.3 already keeps eligible completed keyed results for later reuse, and D17.5 reports retention exhaustion. Therefore “no way to keep the rest” is not established as a general current limitation. Retention across an interrupted process or reboot needs separate evidence; current final-report retention rules alone do not prove durable progress before interruption. D18 says Vitest uses its own workers; the command signature in D1 has no gate concurrency flag.

Read in board/open issues: no existing #216 row or exact duplicate for concurrency control plus interruption recovery. #200 covers stored-failure recovery guidance; #201 completed results lost after store contention; #202 store-lock return blocking; #212 broad setup-file selections and bounded evidence (research already approved as 020-56); #214 pending retries and stored-failure reuse. These overlap parts, not the full residual request. Board searches included `#216`, `gh-216`, overload, resume, concurrency, 51-minute, `server.ts` and harness parity; open issues and their `triaged` labels were checked with `gh issue list --state open --limit 200`.

## Human decision

Decide whether to approve bounded research on an explicit gate concurrency limit and interruption-safe reuse, plus load diagnostics, after accounting for shipped #210 and running 020-55. A retry at lower concurrency or automatic resume needs an explicit policy; neither is approved here. Confirm behavior on a calm host with exact current-version and keyed-input evidence before assigning implementation. Keep failed or unfinished required evidence incomplete, reject changed inputs, preserve retry and resource bounds, and do not infer that load makes a failure harmless.

Done when: under the approved policy, a loaded or interrupted gate has a supported bounded recovery path that reuses only valid completed evidence, identifies the remaining files and resource settings, and gives truthful failure, interruption and retention diagnostics. Cover fresh failures, real persistent failures, successful retry, interruption/reboot, unchanged-key reuse and changed-key rejection without weakening D5.
