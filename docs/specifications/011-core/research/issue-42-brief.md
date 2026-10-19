# Issue 42 reproduction brief

Use /researcher. Reproduce the scoped snapshot refusal and unrelated output reported in https://github.com/hearsay-tools/squeal/issues/42 within 20 minutes. Read Spec 011 C6/C15 and related 005 D2, their status logs, and the issue. Start at src/cli/status-command.ts and its argument parser; do not edit product code.

Questions: (1) Does shipped 0.1.222 reject one and multiple paths without --wait? (2) Does --wait 1 include unrelated state before the selected verdict? (3) What remains unverified about unknown/pending/passing selected states?

Own only research/issue-42.md and research/probes/issue-42/ under this spec. Throwaway probes must stay there; mark them throwaway. No board, spec.md, status.md, skill or product edits. Recheck one-minute load against CPU count before live probes; if above, skip and write "not reproduced, because" with measured values. Name Squeal version, host load, exact commands, outputs and reproduction verdict; distinguish experiment from source evidence. Preserve existing holds. Commit findings and probes; do not build bundles or run full suites for this read-only research. Report the commit.
