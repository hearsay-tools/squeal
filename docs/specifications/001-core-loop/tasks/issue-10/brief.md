# Issue 10: reproduction research

Use /researcher. Shape: research. Review https://github.com/hearsay-tools/squeal/issues/10 (friction means agent-reported), without implementing a fix.

Read spec 001 D4, D5, D7 and D11, status.md, and the board. Starting seam: src/core/scheduler and existing daemon fixture tests; first lead is scheduling an edited, discovered, never-run test under lookup-only startup after its import changes.

1. Can you reproduce the issue on shipped 0.1.199 and/or current HEAD using a real daemon and a minimal fixture? Move an import-free helper from src/lib to e2e, edit the unit test import, with slow.include matching e2e/*.e2e.ts, not the helper. Record exact commands, version/commit, config, before/after status, exact-file waits and cleanup. Separate observed behavior from reporter claims. Avoid full-suite runs; scoped fixture validation only.
2. Is this already a board row? Name related rows and what is new.
3. Does the request fit docs/vision.md? Cite its decision filter.

Own only research/issue-10.md and optional research/probes/issue-10/ throwaway reproduction files. Do not edit product, board, spec or status. Commit the report with bounded evidence. Done when each question has evidence or an explicit limit. Stop at triage, no implementation or issue comments.
