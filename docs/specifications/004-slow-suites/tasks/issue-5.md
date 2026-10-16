# Issue 5 triage

Use /researcher. Shape: research. Reproduce the optional-slow-policy guidance mismatch reported in https://github.com/hearsay-tools/squeal/issues/5; no implementation.

Read spec 004 D7 to D9 and status.md, shared primer generation, installed Codex skill, quiet/stop hints, and board rows 001-283, 001-284, 001-285, 001-317, 001-323, 004-61. Determine whether an existing open row covers this issue and what evidence is new. Compare with docs/vision.md completion-policy principles.

Starting seam: src/harness/shared/primer.ts slowSentences. Run a cheap isolated probe of generated guidance with stop.requireSlowSuite false and true; record exact command, output and revision. Do not queue the real repository's slow suite or start paid agent sessions. Distinguish reproduced guidance from the reporter's unverified 91/89-file runtime incident. Inspect skill and quiet/stop text for policy conflicts without changing them.

Own only docs/specifications/004-slow-suites/research/issue-5.md and research/probes/issue-5/. Leave board, spec, status and product files alone. Done when the committed findings provide reproducible steps, evidence limits, duplicate-row assessment, and a recommendation to surface the decision to the human. No product fix or release.
