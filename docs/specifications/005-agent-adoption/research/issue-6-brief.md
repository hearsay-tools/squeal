# Brief: issue 6 (recovered from the triage branch's research/README.md addition, cez/0aea87cd)

## Issue 6: exact test-file waits (2026-10-16)
Use /researcher. Shape: research. Reproduce https://github.com/hearsay-tools/squeal/issues/6 without fixing product code. Read spec D2, status.md, issue body and all comments (bug + friction means agent-reported use). Start at the named-path selection implementation in src/cli; locate it by searching for the D2 selection error string.
1. Does an exact listed test-file path also select consumers when declared inputs overlap? Run a minimal isolated reproduction against the current source or shipped 0.1.199, retaining commands, actual output, version/commit and expected selection. Also check a source path still selects consumers. Prefer a cheap deterministic selector/store probe; do not claim a real CLI timeout unless observed.
2. Which source seam explains the result, and what existing tests miss it?
3. Compare existing board rows (especially 005-11) and issue comments: what is new, and what queue-delay claims remain unverified?
Own only research/issue-6-exact-file-waits.md and research/probes/issue-6-exact-file-waits/. Leave board, spec, status and product code untouched. Done when the report contains evidence-tagged answers, reproducible retained probe, vision alignment and uncertainties. Commit deliverables. Do not implement, run full suites, release, or contact GitHub.
