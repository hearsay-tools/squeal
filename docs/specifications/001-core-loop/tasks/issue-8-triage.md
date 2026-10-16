# Issue 8: CLI result-query contention triage

Use /researcher. Shape: research. Reproduce [issue #8](https://github.com/hearsay-tools/squeal/issues/8), without implementing a fix.

Read spec 001 D7 (pull queries), D8 (shared store), D12, status.md, and issue #8 including comments. Start at `src/core/status/open.ts`: inspect what a read query does when opening a busy store. Compare board rows 001-10, 001-207, 001-409, 001-411, 001-412 and 001-422.

Questions: (1) Can controlled contention on a disposable store reproduce `why` and `status` failing after 1000 ms, on this baseline and shipped 0.1.199 when practical? Record exact commands, lock mode, elapsed times, exit codes, output and recovery after release. Include normal WAL writer control; never lock a live shared store. Distinguish synthetic reproduction from the unobserved production lock holder. (2) Is an existing row the same scope, and what new information do the issue comments supply? (3) How does the request fit the vision's decision filter?

Own only `docs/specifications/001-core-loop/research/issue-8-contention.md` and optional `research/probes/issue-8-contention/` throwaway fixtures. Leave product, tests, bundles, board and spec untouched. Done when the committed report answers each question with evidence or explicit limits. No fix, release, GitHub writes, or full-suite run for this documentation-only investigation. Stop after the report.
